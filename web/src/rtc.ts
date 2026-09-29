export type Signal = {
  kind: "offer" | "restart" | "answer" | "ice" | "hangup" | "busy";
  call: string;
  video?: boolean;
  data?: any;
  mode: "call" | "data";
};
export type CallState =
  | "idle"
  | "connecting"
  | "ringing"
  | "incoming"
  | "connected"
  | "reconnecting"
  | "ended";
export class RTC {
  pc?: RTCPeerConnection;
  channel?: RTCDataChannel;
  local?: MediaStream;
  remote = new MediaStream();
  call = "";
  peer = "";
  device = "";
  state: CallState = "idle";
  video = false;
  mode: "call" | "data" = "call";
  pending: RTCIceCandidateInit[] = [];
  incoming?: Signal;
  timer?: ReturnType<typeof setTimeout>;
  onChange = () => {};
  onData = (data: string) => {};
  constructor(
    private ice: () => Promise<RTCIceServer[]>,
    private send: (
      peer: string,
      device: string,
      signal: Signal,
    ) => Promise<void>,
  ) {}
  set(state: CallState) {
    this.state = state;
    this.onChange();
  }
  async create() {
    this.pc = new RTCPeerConnection({ iceServers: await this.ice() });
    this.pc.onicecandidate = (e) => {
      if (e.candidate)
        this.send(this.peer, this.device, {
          kind: "ice",
          mode: this.mode,
          call: this.call,
          data: e.candidate.toJSON(),
        }).catch(() => {});
    };
    this.pc.ontrack = (e) => {
      for (const t of e.streams[0]?.getTracks() || [e.track])
        if (!this.remote.getTracks().includes(t)) this.remote.addTrack(t);
      this.onChange();
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc?.connectionState;
      if (s === "connected") {
        clearTimeout(this.timer);
        this.set("connected");
      }
      if (s === "disconnected") this.set("reconnecting");
      if (s === "failed") {
        this.set("reconnecting");
        this.restart().catch(() => this.end());
        this.timer = setTimeout(() => this.end(), 15000);
      }
    };
    this.pc.ondatachannel = (e) => this.attach(e.channel);
  }
  attach(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onmessage = (e) => this.onData(e.data);
    channel.onopen = () => this.onChange();
  }
  async start(
    peer: string,
    device: string,
    video = false,
    mode: "call" | "data" = "call",
  ) {
    if (this.state !== "idle" && this.state !== "ended")
      throw Error("Уже есть соединение");
    this.peer = peer;
    this.device = device;
    this.video = video;
    this.mode = mode;
    this.call = crypto.randomUUID();
    this.set("connecting");
    try {
      await this.create();
      if (mode === "call") {
        this.local = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video,
        });
        for (const track of this.local.getTracks())
          this.pc!.addTrack(track, this.local);
      } else this.attach(this.pc!.createDataChannel("welcome"));
      await this.pc!.setLocalDescription(await this.pc!.createOffer());
      await this.send(peer, device, {
        kind: "offer",
        call: this.call,
        mode,
        video,
        data: this.pc!.localDescription,
      });
      this.set("ringing");
      this.timer = setTimeout(() => this.end(), 45000);
    } catch (e) {
      await this.end();
      throw e;
    }
  }
  async restart() {
    if (!this.pc) return;
    await this.pc.setLocalDescription(
      await this.pc.createOffer({ iceRestart: true }),
    );
    await this.send(this.peer, this.device, {
      kind: "restart",
      call: this.call,
      mode: this.mode,
      data: this.pc.localDescription,
    });
  }
  async receive(peer: string, device: string, s: Signal) {
    if (s.kind === "offer") {
      if (this.state !== "idle" && this.state !== "ended") {
        await this.send(peer, device, {
          kind: "busy",
          call: s.call,
          mode: s.mode,
        });
        return;
      }
      this.peer = peer;
      this.device = device;
      this.call = s.call;
      this.mode = s.mode;
      this.video = !!s.video;
      this.incoming = s;
      this.pending = [];
      this.set("incoming");
      this.timer = setTimeout(() => this.end(), 45000);
      if (s.mode === "data") await this.accept();
      return;
    }
    if (s.call !== this.call || peer !== this.peer || device !== this.device)
      return;
    if (s.kind === "restart" && this.pc) {
      await this.pc.setRemoteDescription(s.data);
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      await this.send(peer, device, {
        kind: "answer",
        call: this.call,
        mode: this.mode,
        data: this.pc.localDescription,
      });
      this.set("reconnecting");
      return;
    }
    if (s.kind === "hangup" || s.kind === "busy") {
      await this.end(false);
      return;
    }
    if (s.kind === "ice") {
      if (this.pc?.remoteDescription) await this.pc.addIceCandidate(s.data);
      else this.pending.push(s.data);
    }
    if (s.kind === "answer") {
      await this.pc!.setRemoteDescription(s.data);
      for (const ice of this.pending) await this.pc!.addIceCandidate(ice);
      this.pending = [];
      this.set("connecting");
    }
  }
  async accept() {
    if (!this.incoming) return;
    clearTimeout(this.timer);
    this.set("connecting");
    try {
      await this.create();
      if (this.mode === "call") {
        this.local = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: this.video,
        });
        for (const t of this.local.getTracks())
          this.pc!.addTrack(t, this.local);
      }
      await this.pc!.setRemoteDescription(this.incoming.data);
      for (const c of this.pending) await this.pc!.addIceCandidate(c);
      this.pending = [];
      await this.pc!.setLocalDescription(await this.pc!.createAnswer());
      await this.send(this.peer, this.device, {
        kind: "answer",
        call: this.call,
        mode: this.mode,
        data: this.pc!.localDescription,
      });
      this.incoming = undefined;
    } catch (e) {
      await this.end();
      throw e;
    }
  }
  async end(notify = true) {
    clearTimeout(this.timer);
    if (notify && this.peer)
      await this.send(this.peer, this.device, {
        kind: "hangup",
        call: this.call,
        mode: this.mode,
      }).catch(() => {});
    this.local?.getTracks().forEach((t) => t.stop());
    this.remote.getTracks().forEach((t) => t.stop());
    this.pc?.close();
    this.channel = undefined;
    this.pc = undefined;
    this.local = undefined;
    this.remote = new MediaStream();
    this.incoming = undefined;
    this.set("ended");
  }
  mute() {
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    this.onChange();
  }
  camera() {
    this.local?.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    this.onChange();
  }
  async replace(kind: "audio" | "video", constraint: MediaTrackConstraints) {
    const stream = await navigator.mediaDevices.getUserMedia({
      [kind]: constraint,
    });
    const track = stream.getTracks()[0];
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === kind);
    if (!sender) {
      track.stop();
      throw Error("Сначала начните звонок с этим типом медиа");
    }
    await sender.replaceTrack(track);
    this.local
      ?.getTracks()
      .filter((t) => t.kind === kind)
      .forEach((t) => {
        t.stop();
        this.local!.removeTrack(t);
      });
    this.local?.addTrack(track);
    this.onChange();
  }
  async share() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });
    const t = stream.getVideoTracks()[0];
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) {
      t.stop();
      throw Error("Демонстрация экрана доступна в видеозвонке");
    }
    const old = sender.track;
    await sender.replaceTrack(t);
    t.onended = () => {
      sender.replaceTrack(old).catch(() => {});
      this.onChange();
    };
    this.onChange();
  }
}
