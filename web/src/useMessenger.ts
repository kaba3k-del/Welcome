import { useEffect, useRef, useState } from "react";
import { store } from "./storage";
import { Client } from "./api";
import { checkProfile, seal, open, encryptFile, type Identity } from "./crypto";
import { RTC, type Signal } from "./rtc";
import {
  randomId,
  type Chat,
  type Event,
  type Profile,
  type Envelope,
} from "../../shared/protocol";
export type Contact = Profile & { state: string; requested_by: string };
export function useMessenger(identity: Identity | undefined) {
  const [chats, setChats] = useState<Chat[]>([]),
    [contacts, setContacts] = useState<Contact[]>([]),
    [events, setEvents] = useState<Event[]>([]),
    [online, setOnline] = useState(false),
    [pending, setPending] = useState<Record<string, boolean>>({}),
    [presence, setPresence] = useState<Record<string, boolean>>({}),
    [typing, setTyping] = useState<Record<string, number>>({}),
    [toast, setToast] = useState(""),
    [loading, setLoading] = useState(true),
    [version, bump] = useState(0);
  const socket = useRef<WebSocket>(undefined),
    client = useRef<Client>(undefined),
    rtc = useRef<RTC>(undefined),
    profiles = useRef<Record<string, Profile>>({}),
    chatsRef = useRef(chats),
    eventsRef = useRef(events),
    receiving = useRef(Promise.resolve());
  chatsRef.current = chats;
  eventsRef.current = events;
  const alert = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 5000);
  };
  const run = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Ошибка");
      return undefined;
    }
  };
  const getProfile = async (id: string, refresh = false) => {
    if (!profiles.current[id] || refresh) {
      const r = await fetch(
        (import.meta.env.VITE_API_URL || "") + "/api/profile/" + id,
      );
      if (!r.ok) throw Error("Профиль недоступен");
      const p = (await r.json()) as Profile;
      await checkProfile(p);
      profiles.current[id] = p;
    }
    return profiles.current[id];
  };
  async function sync() {
    const c = client.current!;
    const [ch, ct] = await Promise.all([
      c.request<Chat[]>("/api/chats"),
      c.request<Contact[]>("/api/contacts"),
    ]);
    for (const chat of ch)
      for (const p of chat.members) {
        await checkProfile(p);
        profiles.current[p.id] = p;
      }
    setChats(ch);
    chatsRef.current = ch;
    setContacts(ct);
    setPresence(await c.request("/api/presence"));
    await store.set("chats", ch);
    await store.set("contacts", ct);
  }
  async function receive(e: Envelope, ack = true) {
    if (!identity) return;
    const p = await getProfile(e.from, true);
    const event = await open<Event>(identity, e, p);
    if (
      event.id !== e.id ||
      event.chat !== e.chat ||
      event.from !== e.from ||
      event.device !== e.device
    )
      throw Error("Заголовок сообщения не совпадает");
    if (!chatsRef.current.some((c) => c.id === event.chat)) await sync();
    if (
      !chatsRef.current
        .find((c) => c.id === event.chat)
        ?.members.some((m) => m.id === event.from)
    )
      throw Error("Отправитель не участник");
    if (!eventsRef.current.some((x) => x.id === event.id)) {
      await store.put(event);
      if (
        event.type === "message" &&
        event.from !== identity.id &&
        document.hidden &&
        "Notification" in window &&
        Notification.permission === "granted" &&
        (await store.get<{ notifications: boolean }>("settings"))?.notifications
      )
        new Notification("Welcome", {
          body: "Новое сообщение",
          tag: event.chat,
        });
      setEvents((prev) => {
        const next = [...prev, event];
        eventsRef.current = next;
        return next;
      });
      if (event.type === "message" && event.from !== identity.id)
        await sendEvent(event.chat, {
          type: "receipt",
          target: event.id,
          read: false,
        });
    }
    if (ack)
      await client.current!.request("/api/mailbox/ack", "POST", {
        ids: [e.id],
      });
  }
  async function drain() {
    let batch: Envelope[];
    do {
      batch = await client.current!.request("/api/mailbox");
      let failures = 0;
      for (const e of batch)
        try {
          await receive(e);
        } catch (err) {
          failures++;
          alert(err instanceof Error ? err.message : "Ошибка пакета");
        }
      if (failures) break;
    } while (batch.length === 100);
  }
  async function signal(
    peer: string,
    device: string,
    s: Signal | { kind: "typing"; chat: string },
  ) {
    if (!identity || socket.current?.readyState !== WebSocket.OPEN)
      throw Error("Нет realtime соединения");
    const profile = await getProfile(peer),
      d = profile.devices.find((d) => d.id === device);
    if (!d) throw Error("Устройство недоступно");
    socket.current.send(
      JSON.stringify({
        type: "signal",
        peer,
        envelope: await seal(identity, d, s, "signal"),
      }),
    );
  }
  async function sendEvent(chat: string, partial: Partial<Event>) {
    if (!identity) return;
    const c = chatsRef.current.find((c) => c.id === chat);
    if (!c) throw Error("Чат не найден");
    const event: Event = {
      id: randomId(),
      chat,
      from: identity.id,
      device: identity.device,
      time: Date.now(),
      type: "message",
      ...partial,
    };
    const envelopes: Envelope[] = [];
    for (const peer of c.members) {
      let fresh: Profile;
      try {
        fresh = await getProfile(peer.id, true);
      } catch (error) {
        if (!profiles.current[peer.id]) throw error;
        fresh = profiles.current[peer.id];
      }
      for (const device of fresh.devices) {
        if (device.id === identity.device) continue;
        envelopes.push(await seal(identity, device, event, chat, event.id));
      }
    }
    await store.set("outbox:" + event.id, envelopes);
    await store.put(event);
    setEvents((prev) => {
      const next = [...prev, event];
      eventsRef.current = next;
      return next;
    });
    setPending((p) => ({ ...p, [event.id]: true }));
    try {
      await deliver(event.id, envelopes);
    } catch (error) {
      alert("Сообщение в очереди: " + (error as Error).message);
    }
    return event;
  }
  async function deliver(id: string, envelopes: Envelope[]) {
    for (const e of envelopes) {
      await client.current!.request("/api/messages", "POST", e);
      if (
        rtc.current?.channel?.readyState === "open" &&
        rtc.current.device === e.to
      )
        rtc.current.channel.send(JSON.stringify(e));
    }
    await store.set("outbox:" + id, []);
    setPending((p) => ({ ...p, [id]: false }));
  }
  async function retry() {
    for (const e of await store.events()) {
      const envelopes = await store.get<Envelope[]>("outbox:" + e.id);
      if (envelopes?.length) await deliver(e.id, envelopes);
    }
  }
  useEffect(() => {
    if (!identity) {
      setLoading(false);
      return;
    }
    let disposed = false,
      reconnect: ReturnType<typeof setTimeout>,
      poll: ReturnType<typeof setInterval>;
    client.current = new Client(identity);
    rtc.current = new RTC(async () => {
      const ice = await client.current!.request("/api/ice", "POST", {});
      if (!ice.turn)
        alert("TURN не настроен: звонок работает только при доступном P2P");
      return ice.iceServers;
    }, signal);
    rtc.current.onChange = () => bump((v) => v + 1);
    rtc.current.onData = (data) => {
      receiving.current = receiving.current
        .then(() => receive(JSON.parse(data)))
        .catch((e) => alert(e.message));
    };
    async function connect() {
      try {
        if (!identity!.registered) {
          await client.current!.register();
          identity!.registered = true;
          await store.set("identity", identity);
        }
        await sync();
        await drain();
        await retry();
        const ws = await client.current!.socket();
        if (disposed) {
          ws.close();
          return;
        }
        socket.current = ws;
        ws.onopen = () => setOnline(true);
        ws.onmessage = (ev) => {
          receiving.current = receiving.current
            .then(async () => {
              const d = JSON.parse(ev.data);
              if (d.type === "mail") await receive(d.envelope);
              if (d.type === "contacts" || d.type === "chats") await sync();
              if (d.type === "presence")
                setPresence((p) => ({ ...p, [d.user]: d.online }));
              if (d.type === "signal") {
                const payload = await open<
                  Signal | { kind: "typing"; chat: string }
                >(identity!, d.envelope, await getProfile(d.from, true));
                if (payload.kind === "typing") {
                  setTyping((t) => ({
                    ...t,
                    [payload.chat]: Date.now() + 4000,
                  }));
                } else
                  await rtc.current!.receive(
                    d.from,
                    d.envelope.device,
                    payload,
                  );
              }
              if (d.type === "revoked" && d.device === identity!.device)
                throw Error("Это устройство отозвано");
            })
            .catch((e) => alert(e.message));
        };
        ws.onclose = () => {
          setOnline(false);
          if (!disposed) reconnect = setTimeout(connect, 4000);
        };
        ws.onerror = () => ws.close();
        setLoading(false);
      } catch (e) {
        setOnline(false);
        setLoading(false);
        alert(e instanceof Error ? e.message : "Сервер недоступен");
        if (!disposed) reconnect = setTimeout(connect, 6000);
      }
    }
    (async () => {
      await store.purgeExpired();
      const local = await store.events();
      setEvents(local);
      eventsRef.current = local;
      const cached = (await store.get<Chat[]>("chats")) || [];
      setChats(cached);
      for (const c of cached)
        for (const p of c.members) profiles.current[p.id] = p;
      for (const e of local) {
        const box = await store.get<Envelope[]>("outbox:" + e.id);
        if (box?.length) setPending((p) => ({ ...p, [e.id]: true }));
      }
      setContacts((await store.get<Contact[]>("contacts")) || []);
      await connect();
    })();
    poll = setInterval(() => {
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify({ type: "ping" }));
      run(async () => {
        await store.purgeExpired();
        await drain();
        await retry();
      });
    }, 25000);
    return () => {
      disposed = true;
      clearTimeout(reconnect);
      clearInterval(poll);
      socket.current?.close();
      rtc.current?.end();
    };
  }, [identity?.device]);
  const api = async <T = any>(path: string, method = "GET", data?: unknown) => {
    if (!client.current) throw Error("Сначала создайте профиль");
    return client.current.request<T>(path, method, data);
  };
  const file = async (
    chat: string,
    f: File | Blob,
    name: string,
    type: string,
    expires?: number,
  ) => {
    if (f.size > 24 * 1024 * 1024) throw Error("Лимит файла 24 МБ");
    const encrypted = await encryptFile(f);
    const result = await client.current!.request(
      "/api/files?chat=" + encodeURIComponent(chat),
      "POST",
      encrypted.blob,
      true,
    );
    return sendEvent(chat, {
      attachment: {
        id: result.id,
        key: encrypted.key,
        iv: encrypted.iv,
        name,
        type,
        size: f.size,
      },
      expires,
    });
  };
  const typingEvent = async (chat: Chat) => {
    for (const peer of chat.members.filter((p) => p.id !== identity?.id))
      for (const d of peer.devices)
        await signal(peer.id, d.id, { kind: "typing", chat: chat.id });
  };
  return {
    chats,
    contacts,
    events,
    online,
    pending,
    presence,
    typing,
    toast,
    loading,
    alert,
    run,
    api,
    sync,
    getProfile,
    sendEvent,
    file,
    typingEvent,
    rtc: rtc.current,
    version,
  };
}
export function materialize(events: Event[], chat: string) {
  const messages = events
    .filter(
      (e) =>
        e.chat === chat &&
        e.type === "message" &&
        (!e.expires || e.expires > Date.now()),
    )
    .sort((a, b) => a.time - b.time);
  return messages
    .map((m) => {
      let out = {
        ...m,
        deleted: false,
        pinned: false,
        reactions: {} as Record<string, string[]>,
        delivered: false,
        read: false,
      };
      for (const e of events
        .filter((e) => e.chat === chat && e.target === m.id)
        .sort((a, b) => a.time - b.time)) {
        if (e.type === "edit" && e.from === m.from) out.text = e.text;
        if (e.type === "delete" && e.from === m.from) out.deleted = true;
        if (e.type === "pin") out.pinned = !!e.active;
        if (e.type === "receipt" && e.from !== m.from) {
          out.delivered = true;
          if (e.read) out.read = true;
        }
        if (e.type === "reaction" && e.emoji) {
          const set = new Set(out.reactions[e.emoji] || []);
          e.active ? set.add(e.from) : set.delete(e.from);
          out.reactions[e.emoji] = [...set];
        }
      }
      return out;
    })
    .filter((m) => !m.deleted);
}
