import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Plus,
  Search,
  MessageCircle,
  Phone,
  Video,
  Settings,
  Send,
  Mic,
  MicOff,
  Camera,
  CameraOff,
  PhoneOff,
  Monitor,
  Volume2,
  MoreVertical,
  Paperclip,
  Check,
  CheckCheck,
  Clock,
  X,
  Copy,
  QrCode,
  Shield,
  Users,
  FileText,
  Download,
  Reply,
  Trash2,
  Pin,
  Smile,
  Edit3,
  Forward,
  Link,
  Smartphone,
  RefreshCw,
  LogOut,
} from "lucide-react";
import QRCode from "qrcode";
import { store } from "./storage";
import {
  makeIdentity,
  recoveredDevice,
  publicDevice,
  exportRecovery,
  recoveryPhrase,
  importRecovery,
  decryptFile,
  fingerprint,
  pairingDraft,
  sign,
  checkProfile,
  type Identity,
} from "./crypto";
import { useMessenger, materialize } from "./useMessenger";
import {
  certPayload,
  type Chat,
  type Event,
  type Profile,
  type Attachment,
} from "../../shared/protocol";
import "./style.css";
import { QRScanner } from "./QRScanner";
const avatars = ["🌊", "🌙", "🌲", "🪐", "🐈", "🦊", "🏔️", "⚡"];
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};
const stamp = (t: number) =>
  new Date(t).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
const labels = {
  idle: "",
  connecting: "Соединение…",
  ringing: "Вызов…",
  incoming: "Входящий звонок",
  connected: "Соединение установлено",
  reconnecting: "Переподключение…",
  ended: "Звонок завершён",
};
function Avatar({
  p,
  size = "",
}: {
  p: { name: string; avatar: string };
  size?: string;
}) {
  return (
    <div className={"avatar " + size} aria-label={p.name}>
      {p.avatar || p.name.slice(0, 1).toUpperCase()}
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overlay" onClick={close}>
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="handle" />
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={close} aria-label="Закрыть">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export default function App() {
  const [identity, setIdentity] = useState<Identity>(),
    [ready, setReady] = useState(false),
    [name, setName] = useState(""),
    [avatar, setAvatar] = useState(avatars[0]),
    [busy, setBusy] = useState(false);
  const m = useMessenger(identity);
  const [active, setActive] = useState<string>(),
    [tab, setTab] = useState<"chats" | "contacts" | "settings">("chats"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [sheet, setSheet] = useState(""),
    [peer, setPeer] = useState<Profile>(),
    [link, setLink] = useState(""),
    [draft, setDraft] = useState(""),
    [reply, setReply] = useState<Event>(),
    [edit, setEdit] = useState<Event>(),
    [menu, setMenu] = useState<Event>(),
    [chatSearch, setChatSearch] = useState(""),
    [expiry, setExpiry] = useState(0),
    [qr, setQr] = useState(""),
    [recoveryKey, setRecoveryKey] = useState(""),
    [devices, setDevices] = useState<any[]>([]),
    [groupName, setGroupName] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [pairText, setPairText] = useState(""),
    [pairDraft, setPairDraft] = useState<any>(),
    [tick, setTick] = useState(0),
    [recording, setRecording] = useState(false),
    [recordSeconds, setRecordSeconds] = useState(0),
    [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]),
    [mutedSpeaker, setMutedSpeaker] = useState(false),
    [settings, setSettings] = useState({
      receipts: true,
      notifications: false,
    }),
    [finger, setFinger] = useState(""),
    [scanTarget, setScanTarget] = useState("new");
  const fileInput = useRef<HTMLInputElement>(null),
    record = useRef<MediaRecorder>(undefined),
    recordStream = useRef<MediaStream>(undefined),
    endRef = useRef<HTMLDivElement>(null),
    remoteVideo = useRef<HTMLVideoElement>(null),
    localVideo = useRef<HTMLVideoElement>(null),
    seen = useRef(new Set<string>()),
    lastTyping = useRef(0),
    touch = useRef(0);
  const chat = m.chats.find((c) => c.id === active),
    messages = chat ? materialize(m.events, chat.id) : [],
    other = chat?.members.find((p) => p.id !== identity?.id),
    title = chat?.kind === "group" ? chat.title : other?.name || "Чат",
    rtc = m.rtc,
    callVisible =
      rtc &&
      rtc.mode === "call" &&
      rtc.state !== "idle" &&
      rtc.state !== "ended";
  useEffect(() => {
    (async () => {
      setIdentity(await store.get("identity"));
      setSettings(
        (await store.get("settings")) || {
          receipts: true,
          notifications: false,
        },
      );
      setReady(true);
    })();
  }, []);
  useEffect(() => {
    store.get<boolean>("compact").then((v) => {
      document.documentElement.style.fontSize = v ? "14px" : "16px";
    });
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1);
      if (record.current?.state === "recording") setRecordSeconds((s) => s + 1);
    }, 1000);
    return () => {
      clearInterval(timer);
      recordStream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (identity) {
      setName(identity.name);
      setAvatar(identity.avatar);
    }
  }, [identity?.name, identity?.avatar]);
  useEffect(() => {
    const id = location.pathname.startsWith("/u/")
      ? location.pathname.split("/")[2]
      : "";
    if (id && ready)
      m.run(async () => {
        setPeer(await m.getProfile(id));
        setSheet("profile");
      });
  }, [ready]);
  useEffect(() => {
    if (sheet === "share" && identity)
      QRCode.toDataURL(location.origin + "/u/" + identity.id, {
        width: 280,
        margin: 2,
        color: { dark: "#0b1017", light: "#ffffff" },
      }).then(setQr);
    if (sheet === "devices")
      m.run(async () => setDevices(await m.api("/api/devices")));
    if (sheet === "fingerprint" && peer)
      fingerprint(peer.root_key).then(setFinger);
  }, [sheet, peer]);
  useEffect(() => {
    if (remoteVideo.current && rtc) remoteVideo.current.srcObject = rtc.remote;
    if (localVideo.current && rtc)
      localVideo.current.srcObject = rtc.local || null;
  }, [m.version, callVisible]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    if (chat && identity && settings.receipts)
      for (const e of messages.filter((e) => e.from !== identity.id)) {
        if (!seen.current.has(e.id)) {
          seen.current.add(e.id);
          m.run(() =>
            m.sendEvent(chat.id, { type: "receipt", target: e.id, read: true }),
          );
        }
      }
  }, [active, m.events.length]);
  useEffect(() => {
    if (!chatSearch) setQuery("");
  }, [active]);
  useEffect(() => {
    if (
      chat?.kind === "direct" &&
      other &&
      identity &&
      identity.id < other.id &&
      m.presence[other.id] &&
      rtc &&
      (rtc.state === "idle" || rtc.state === "ended")
    ) {
      rtc.start(other.id, other.devices[0].id, false, "data").catch(() => {});
    }
  }, [active, m.presence]);
  const saveIdentity = async (i: Identity) => {
    await store.set("identity", i);
    setIdentity(i);
  };
  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await saveIdentity(await makeIdentity(name.trim(), avatar));
    } catch (e) {
      m.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const close = () => {
    setSheet("");
    setMenu(undefined);
  };
  const openPeer = (p: Profile) => {
    setPeer(p);
    setSheet("profile");
  };
  const openChat = (c: Chat) => {
    setActive(c.id);
    setTab("chats");
    close();
  };
  async function direct(p: Profile) {
    const c = await m.api<Chat>("/api/chats", "POST", {
      kind: "direct",
      peers: [p.id],
    });
    await m.sync();
    openChat(c);
  }
  async function send() {
    if (!chat || !draft.trim()) return;
    const text = draft.trim();
    if (edit) {
      await m.sendEvent(chat.id, { type: "edit", target: edit.id, text });
      setEdit(undefined);
    } else
      await m.sendEvent(chat.id, {
        text,
        reply: reply?.id,
        expires: expiry ? Date.now() + expiry : undefined,
      });
    setDraft("");
    setReply(undefined);
  }
  async function loadLink() {
    const id = link.trim().split("/").filter(Boolean).pop() || "";
    if (!/^[\w-]{10,80}$/.test(id)) throw Error("Вставьте ссылку /u/… или ID");
    setPeer(await m.getProfile(id));
    setSheet("profile");
  }
  async function call(video: boolean, p = other) {
    if (!p) throw Error("Выберите контакт");
    if (
      !m.contacts.some((c) => c.id === p.id && c.state === "accepted") &&
      !chat?.members.some((c) => c.id === p.id)
    )
      throw Error("Сначала примите контакт");
    if (rtc?.mode === "data") await rtc.end();
    await rtc?.start(p.id, p.devices[0].id, video);
    close();
  }
  async function voice() {
    if (recording) {
      record.current?.stop();
      setRecording(false);
      return;
    }
    if (!chat) return;
    const currentChat = chat.id;
    recordStream.current = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(recordStream.current);
    record.current = recorder;
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      recordStream.current?.getTracks().forEach((t) => t.stop());
      m.run(() =>
        m.file(
          currentChat,
          new Blob(chunks, { type: recorder.mimeType }),
          "Голосовое сообщение",
          recorder.mimeType,
          expiry ? Date.now() + expiry : undefined,
        ),
      );
    };
    recorder.start();
    setRecordSeconds(0);
    setRecording(true);
  }
  async function pairApprove() {
    const p = JSON.parse(pairText);
    if (
      p.type !== "welcome-pair" ||
      p.expires < Date.now() ||
      p.expires > Date.now() + 660000
    )
      throw Error("Код устройства истёк");
    const certificate = await sign(
      identity!.rootPrivate,
      certPayload(identity!.id, p.id, p.sign_key, p.enc_key),
    );
    await m.api("/api/pair", "POST", { ...p, certificate });
    const result = {
      type: "welcome-approved",
      user: identity!.id,
      name: identity!.name,
      avatar: identity!.avatar,
      rootPublic: identity!.rootPublic,
      certificate,
      device: p.id,
      nonce: p.nonce,
    };
    setPairText(JSON.stringify(result));
    m.alert(
      "Устройство подтверждено. Передайте код ответа на новое устройство.",
    );
    await m.sync();
  }
  async function pairFinish() {
    const p = JSON.parse(pairText);
    if (
      !pairDraft ||
      p.type !== "welcome-approved" ||
      p.device !== pairDraft.id ||
      p.nonce !== pairDraft.nonce ||
      pairDraft.expires < Date.now()
    )
      throw Error("Ответ не соответствует приглашению");
    const profile = await m.getProfile(p.user, true);
    await checkProfile(profile);
    const d = profile.devices.find((d) => d.id === pairDraft.id);
    if (!d || d.certificate !== p.certificate)
      throw Error("Устройство не подтверждено сервером");
    const i: Identity = {
      id: p.user,
      name: p.name,
      avatar: p.avatar,
      rootPublic: p.rootPublic,
      rootPrivate: {} as JsonWebKey,
      device: pairDraft.id,
      label: pairDraft.label,
      signPrivate: pairDraft.signPrivate,
      signPublic: pairDraft.sign_key,
      encPrivate: pairDraft.encPrivate,
      encPublic: pairDraft.enc_key,
      certificate: p.certificate,
      registered: true,
    };
    await saveIdentity(i);
    setPairDraft(undefined);
    close();
  }
  if (!ready)
    return (
      <div className="boot">
        <div className="brand">W</div>
        <p>Загрузка локального хранилища…</p>
      </div>
    );
  return (
    <>
      {!identity ? (
        <main className="onboarding">
          <div className="brand">W</div>
          <h1>Welcome</h1>
          <p className="tagline">Ваши люди. Ваше пространство.</p>
          <div className="benefits">
            <div>
              <Shield size={19} /> Шифрование на устройстве
            </div>
            <div>
              <Users size={19} /> Без номера телефона
            </div>
            <div>
              <MessageCircle size={19} /> Личные чаты и группы
            </div>
          </div>
          <label>
            Как вас называть?
            <input
              autoFocus
              placeholder="Отображаемое имя"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </label>
          <div className="avatars">
            {avatars.map((a) => (
              <button
                className={a === avatar ? "selected" : ""}
                key={a}
                onClick={() => setAvatar(a)}
                aria-label={"Аватар " + a}
              >
                {a}
              </button>
            ))}
          </div>
          <button
            className="primary"
            disabled={busy || !name.trim()}
            onClick={create}
          >
            {busy ? "Создание ключей…" : "Продолжить"}
          </button>
          <button className="quiet" onClick={() => setSheet("restore")}>
            Восстановить профиль
          </button>
          <button
            className="quiet"
            onClick={() =>
              m.run(async () => {
                const p = await pairingDraft();
                setPairDraft(p);
                setPairText("");
                setQr(
                  await QRCode.toDataURL(
                    JSON.stringify({
                      type: "welcome-pair",
                      id: p.id,
                      label: p.label,
                      sign_key: p.sign_key,
                      enc_key: p.enc_key,
                      nonce: p.nonce,
                      expires: p.expires,
                    }),
                    { width: 280 },
                  ),
                );
                setSheet("pair-new");
              })
            }
          >
            Подключить как новое устройство
          </button>
          <small>
            Ключи хранятся в этом браузере. Сохраните recovery-файл после
            создания профиля.
          </small>
        </main>
      ) : (
        <main className={"app " + (active ? "chat-open" : "")}>
          <aside className="sidebar">
            <header className="sidebar-head">
              <div>
                <span className="wordmark">W</span>
                <h1>
                  {tab === "settings"
                    ? "Настройки"
                    : tab === "contacts"
                      ? "Контакты"
                      : "Чаты"}
                </h1>
              </div>
              <button
                className="add"
                aria-label="Добавить контакт или группу"
                onClick={() => setSheet("new")}
              >
                <Plus />
              </button>
            </header>
            <div className="connection">
              <span className={m.online ? "online-dot" : "offline-dot"} />
              {m.online ? "Подключено" : "Нет соединения · локальная история"}
            </div>
            {tab !== "settings" && (
              <>
                <div className="search">
                  <Search size={17} />
                  <input
                    placeholder="Поиск по имени или сообщению"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      className="icon"
                      onClick={() => setQuery("")}
                      aria-label="Очистить поиск"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                {tab === "chats" && (
                  <div className="filters">
                    {[
                      ["all", "Все"],
                      ["direct", "Личные"],
                      ["group", "Группы"],
                    ].map(([v, l]) => (
                      <button
                        className={filter === v ? "selected" : ""}
                        key={v}
                        onClick={() => setFilter(v)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="sidebar-content">
              {tab === "chats" && (
                <>
                  {m.loading && m.chats.length === 0 ? (
                    <div className="skeleton-list">
                      {[1, 2, 3, 4].map((i) => (
                        <div className="skeleton" key={i} />
                      ))}
                    </div>
                  ) : (
                    m.chats
                      .filter(
                        (c) =>
                          (filter === "all" || c.kind === filter) &&
                          ((c.kind === "group"
                            ? c.title
                            : c.members.find((p) => p.id !== identity.id)
                                ?.name || ""
                          )
                            .toLowerCase()
                            .includes(query.toLowerCase()) ||
                            materialize(m.events, c.id).some((e) =>
                              e.text
                                ?.toLowerCase()
                                .includes(query.toLowerCase()),
                            )),
                      )
                      .map((c) => {
                        const p =
                            c.members.find((x) => x.id !== identity.id) ||
                            identity,
                          ms = materialize(m.events, c.id),
                          last = ms.at(-1);
                        return (
                          <button
                            className={
                              "chat-row " + (active === c.id ? "active" : "")
                            }
                            key={c.id}
                            onClick={() => openChat(c)}
                            onTouchStart={(e) =>
                              (touch.current = e.touches[0].clientX)
                            }
                            onTouchEnd={(e) => {
                              if (
                                touch.current - e.changedTouches[0].clientX >
                                80
                              ) {
                                setPeer(p as Profile);
                                setSheet("profile");
                              }
                            }}
                          >
                            <Avatar
                              p={
                                c.kind === "group"
                                  ? { name: c.title, avatar: "👥" }
                                  : p
                              }
                            />
                            <div className="row-text">
                              <strong>
                                {c.kind === "group" ? c.title : p.name}
                              </strong>
                              <p>
                                {m.typing[c.id] > Date.now()
                                  ? "печатает…"
                                  : last?.attachment
                                    ? last.attachment.name
                                    : last?.text || "Начните разговор"}
                              </p>
                            </div>
                            <small>{last ? stamp(last.time) : ""}</small>
                          </button>
                        );
                      })
                  )}
                  {!m.loading && m.chats.length === 0 && (
                    <div className="empty">
                      <MessageCircle size={40} />
                      <h3>Начните с приветствия</h3>
                      <p>Поделитесь своей ссылкой или добавьте контакт.</p>
                      <button
                        className="primary"
                        onClick={() => setSheet("share")}
                      >
                        Поделиться профилем
                      </button>
                    </div>
                  )}
                </>
              )}
              {tab === "contacts" && (
                <>
                  {m.contacts
                    .filter((c) =>
                      c.name.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((p) => (
                      <button
                        className="chat-row"
                        key={p.id}
                        onClick={() => openPeer(p)}
                      >
                        <Avatar p={p} />
                        <div className="row-text">
                          <strong>{p.name}</strong>
                          <p>
                            {p.state === "accepted"
                              ? "Контакт"
                              : p.state === "blocked"
                                ? "Заблокирован"
                                : "Запрос контакта"}
                          </p>
                        </div>
                        {p.state === "pending" && (
                          <span className="badge">!</span>
                        )}
                      </button>
                    ))}
                  {!m.contacts.length && (
                    <div className="empty">
                      <Users size={36} />
                      <h3>Ваши контакты</h3>
                      <p>Добавьте человека по его постоянной ссылке.</p>
                      <button
                        className="primary"
                        onClick={() => setSheet("new")}
                      >
                        Добавить контакт
                      </button>
                    </div>
                  )}
                </>
              )}
              {tab === "settings" && (
                <>
                  <button
                    className="my-profile"
                    onClick={() => setSheet("myprofile")}
                  >
                    <Avatar p={identity} size="large" />
                    <strong>{identity.name}</strong>
                    <small>Мой профиль</small>
                  </button>
                  <div className="settings-list">
                    {[
                      ["share", "Моя ссылка и QR", Link],
                      ["privacy", "Конфиденциальность", Shield],
                      ["devices", "Устройства", Smartphone],
                      ["recovery", "Резервная копия ключей", Download],
                      ["appearance", "Внешний вид", Settings],
                      ["notifications", "Уведомления", MessageCircle],
                      ["about", "О Welcome", FileText],
                    ].map(([s, l, Icon]) => {
                      const I = Icon as typeof Link;
                      return (
                        <button
                          key={s as string}
                          onClick={() => setSheet(s as string)}
                        >
                          <I size={19} />
                          <span>{l as string}</span>
                          <span className="chevron">›</span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    className="danger quiet"
                    onClick={() => setSheet("clear")}
                  >
                    <Trash2 size={17} /> Удалить локальную историю
                  </button>
                </>
              )}
            </div>
            <nav>
              {[
                ["chats", "Чаты", MessageCircle],
                ["contacts", "Контакты", Users],
                ["settings", "Настройки", Settings],
              ].map(([v, l, Icon]) => {
                const I = Icon as typeof Link;
                return (
                  <button
                    className={tab === v ? "selected" : ""}
                    key={v as string}
                    onClick={() => {
                      setTab(v as typeof tab);
                      setActive(undefined);
                    }}
                  >
                    <I size={20} />
                    <span>{l as string}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
          <section className="conversation">
            {chat ? (
              <>
                <header className="chat-head">
                  <button
                    className="icon back"
                    onClick={() => setActive(undefined)}
                    aria-label="Назад"
                  >
                    <ArrowLeft />
                  </button>
                  <button
                    className="chat-title"
                    onClick={() => {
                      if (chat.kind === "group") setSheet("group");
                      else if (other) openPeer(other);
                    }}
                  >
                    <Avatar
                      p={
                        chat.kind === "group"
                          ? { name: title, avatar: "👥" }
                          : other || identity
                      }
                    />
                    <div>
                      <strong>{title}</strong>
                      <small>
                        {chat.kind === "group"
                          ? `${chat.members.length} участников`
                          : m.typing[chat.id] > Date.now()
                            ? "печатает…"
                            : other && m.presence[other.id]
                              ? "в сети"
                              : "личный чат"}
                      </small>
                    </div>
                  </button>
                  {chat.kind === "direct" && (
                    <>
                      <button
                        className="icon blue"
                        onClick={() => m.run(() => call(false))}
                        aria-label="Аудиозвонок"
                      >
                        <Phone size={20} />
                      </button>
                      <button
                        className="icon blue"
                        onClick={() => m.run(() => call(true))}
                        aria-label="Видеозвонок"
                      >
                        <Video size={22} />
                      </button>
                    </>
                  )}
                  <button
                    className="icon"
                    onClick={() => setSheet("chat-options")}
                    aria-label="Меню чата"
                  >
                    <MoreVertical size={21} />
                  </button>
                </header>
                {sheet === "search-chat" && (
                  <div className="search chat-search">
                    <Search size={17} />
                    <input
                      autoFocus
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                      placeholder="Поиск в чате"
                    />
                    <button
                      className="icon"
                      onClick={() => {
                        setChatSearch("");
                        close();
                      }}
                      aria-label="Закрыть поиск"
                    >
                      <X />
                    </button>
                  </div>
                )}
                <div className="message-list">
                  <div className="date-label">
                    {new Date().toLocaleDateString("ru", {
                      day: "numeric",
                      month: "long",
                    })}
                  </div>
                  {messages.length === 0 && (
                    <div className="empty chat-empty">
                      <Shield size={26} />
                      <h3>Здесь начинается разговор</h3>
                      <p>
                        Текст и файлы шифруются на вашем устройстве.
                        <br />
                        Сверьте отпечатки ключей при первом общении.
                      </p>
                    </div>
                  )}
                  {messages
                    .filter(
                      (e) =>
                        !chatSearch ||
                        e.text
                          ?.toLowerCase()
                          .includes(chatSearch.toLowerCase()),
                    )
                    .map((e) => {
                      const mine = e.from === identity.id;
                      const parent = messages.find((x) => x.id === e.reply);
                      return (
                        <div
                          className={"message-wrap " + (mine ? "mine" : "")}
                          key={e.id}
                        >
                          <div
                            className="bubble"
                            onContextMenu={(ev) => {
                              ev.preventDefault();
                              setMenu(e);
                            }}
                          >
                            <button
                              className="message-more"
                              onClick={() => setMenu(e)}
                              aria-label="Действия с сообщением"
                            >
                              <MoreVertical size={14} />
                            </button>
                            {chat.kind === "group" && !mine && (
                              <strong className="sender">
                                {
                                  chat.members.find((p) => p.id === e.from)
                                    ?.name
                                }
                              </strong>
                            )}
                            {e.forwarded && (
                              <small className="forwarded">
                                Пересланное сообщение
                              </small>
                            )}
                            {parent && (
                              <div className="reply-preview">
                                {parent.text ||
                                  parent.attachment?.name ||
                                  "Сообщение"}
                              </div>
                            )}
                            {e.attachment && (
                              <Media
                                attachment={e.attachment}
                                api={m.api}
                                alert={m.alert}
                              />
                            )}
                            <p>{e.text}</p>
                            {e.pinned && <Pin size={12} />}
                            <div className="message-meta">
                              <time>{stamp(e.time)}</time>
                              {mine &&
                                (m.pending[e.id] ? (
                                  <Clock size={13} />
                                ) : e.read ? (
                                  <CheckCheck size={14} className="read" />
                                ) : e.delivered ? (
                                  <CheckCheck size={14} />
                                ) : (
                                  <Check size={14} />
                                ))}
                            </div>
                            {Object.entries(e.reactions).filter(
                              ([, v]) => v.length,
                            ).length > 0 && (
                              <div className="reactions">
                                {Object.entries(e.reactions)
                                  .filter(([, v]) => v.length)
                                  .map(([emoji, users]) => (
                                    <button
                                      key={emoji}
                                      onClick={() =>
                                        m.run(() =>
                                          m.sendEvent(chat.id, {
                                            type: "reaction",
                                            target: e.id,
                                            emoji,
                                            active: !users.includes(
                                              identity.id,
                                            ),
                                          }),
                                        )
                                      }
                                    >
                                      {emoji} {users.length}
                                    </button>
                                  ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  <div ref={endRef} />
                </div>
                {(reply || edit) && (
                  <div className="compose-reference">
                    <Reply size={18} />
                    <div>
                      <small>{edit ? "Редактирование" : "Ответ"}</small>
                      <p>
                        {(edit || reply)?.text ||
                          (edit || reply)?.attachment?.name}
                      </p>
                    </div>
                    <button
                      className="icon"
                      onClick={() => {
                        setReply(undefined);
                        setEdit(undefined);
                      }}
                      aria-label="Отменить ответ"
                    >
                      <X size={18} />
                    </button>
                  </div>
                )}
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    m.run(send);
                  }}
                >
                  <button
                    type="button"
                    className="icon"
                    onClick={() => fileInput.current?.click()}
                    aria-label="Прикрепить файл"
                  >
                    <Plus size={25} />
                  </button>
                  <input
                    placeholder={
                      recording ? `Запись · ${recordSeconds} сек` : "Сообщение…"
                    }
                    value={draft}
                    disabled={recording}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      if (Date.now() - lastTyping.current > 3000) {
                        lastTyping.current = Date.now();
                        m.typingEvent(chat).catch(() => {});
                      }
                    }}
                    maxLength={16000}
                  />
                  <button
                    type="button"
                    className="icon"
                    onClick={() => setSheet("emoji")}
                    aria-label="Добавить эмодзи"
                  >
                    <Smile size={22} />
                  </button>
                  {draft.trim() ? (
                    <button
                      className="send"
                      type="submit"
                      aria-label="Отправить"
                    >
                      <Send size={19} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={"icon mic " + (recording ? "recording" : "")}
                      onClick={() => m.run(voice)}
                      aria-label={
                        recording ? "Отправить голосовое" : "Записать голосовое"
                      }
                    >
                      <Mic size={22} />
                    </button>
                  )}
                  <input
                    hidden
                    ref={fileInput}
                    type="file"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f)
                        m.run(() =>
                          m.file(
                            chat.id,
                            f,
                            f.name,
                            f.type || "application/octet-stream",
                            expiry ? Date.now() + expiry : undefined,
                          ),
                        );
                      e.target.value = "";
                    }}
                  />
                </form>
                {expiry > 0 && (
                  <div className="expiry-note">
                    Новые сообщения исчезают через {expiry / 60000} мин.
                  </div>
                )}
              </>
            ) : (
              <div className="desktop-empty">
                <div className="brand">W</div>
                <h2>Welcome</h2>
                <p>Выберите чат, чтобы продолжить разговор.</p>
                <button className="primary" onClick={() => setSheet("share")}>
                  Пригласить человека
                </button>
              </div>
            )}
          </section>
        </main>
      )}
      {menu && chat && (
        <Modal title="Сообщение" close={() => setMenu(undefined)}>
          <div className="emoji-row">
            {["❤️", "👍", "😂", "🔥", "😮", "😢"].map((emoji) => (
              <button
                key={emoji}
                onClick={() =>
                  m.run(async () => {
                    await m.sendEvent(chat.id, {
                      type: "reaction",
                      target: menu.id,
                      emoji,
                      active: true,
                    });
                    setMenu(undefined);
                  })
                }
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="actions">
            <button
              onClick={() => {
                setReply(menu);
                setMenu(undefined);
              }}
            >
              <Reply />
              Ответить
            </button>
            {menu.text && (
              <button
                onClick={() =>
                  m.run(async () => {
                    await navigator.clipboard.writeText(menu.text!);
                    setMenu(undefined);
                    m.alert("Текст скопирован");
                  })
                }
              >
                <Copy />
                Скопировать
              </button>
            )}
            <button
              onClick={() => {
                setSheet("forward");
              }}
            >
              <Forward />
              Переслать
            </button>
            <button
              onClick={() =>
                m.run(async () => {
                  const current = messages.find((e) => e.id === menu.id);
                  await m.sendEvent(chat.id, {
                    type: "pin",
                    target: menu.id,
                    active: !current?.pinned,
                  });
                  setMenu(undefined);
                })
              }
            >
              <Pin />
              Закрепить / открепить
            </button>
            {menu.from === identity?.id && (
              <>
                {menu.text && (
                  <button
                    onClick={() => {
                      setEdit(menu);
                      setDraft(menu.text!);
                      setMenu(undefined);
                    }}
                  >
                    <Edit3 />
                    Редактировать
                  </button>
                )}
                <button
                  className="danger"
                  onClick={() =>
                    m.run(async () => {
                      await m.sendEvent(chat.id, {
                        type: "delete",
                        target: menu.id,
                      });
                      setMenu(undefined);
                    })
                  }
                >
                  <Trash2 />
                  Удалить у участников
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
      {sheet && sheet !== "search-chat" && sheet !== "call-more" && (
        <Modal
          title={
            (
              {
                new: "Новый разговор",
                profile: "Профиль",
                myprofile: "Мой профиль",
                share: "Поделиться профилем",
                group: "Участники группы",
                media: "Медиа чата",
                devices: "Устройства",
                recovery: "Recovery-файл",
                privacy: "Конфиденциальность",
                restore: "Восстановить профиль",
                "pair-new": "Новое устройство",
                "pair-approve": "Подтвердить устройство",
                "chat-options": "Настройки чата",
                forward: "Переслать",
                fingerprint: "Отпечаток ключа",
              } as Record<string, string>
            )[sheet] || "Welcome"
          }
          close={close}
        >
          {sheet === "new" && (
            <>
              <p className="muted">
                Добавьте человека по ссылке или постоянному ID.
              </p>
              <input
                autoFocus
                placeholder="https://…/u/…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
              <button className="primary" onClick={() => m.run(loadLink)}>
                Открыть профиль
              </button>
              <button
                className="quiet"
                onClick={() => {
                  setScanTarget("new");
                  setSheet("scan");
                }}
              >
                <QrCode size={18} />
                Сканировать QR
              </button>
              <button className="quiet" onClick={() => setSheet("new-group")}>
                <Users size={18} />
                Создать группу
              </button>
            </>
          )}
          {sheet === "new-group" && (
            <>
              <input
                placeholder="Название группы"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                maxLength={80}
              />
              <div className="contact-picker">
                {m.contacts
                  .filter((c) => c.state === "accepted")
                  .map((c) => (
                    <label key={c.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        onChange={(e) =>
                          setSelected((s) =>
                            e.target.checked
                              ? [...s, c.id]
                              : s.filter((x) => x !== c.id),
                          )
                        }
                      />
                      <Avatar p={c} />
                      {c.name}
                    </label>
                  ))}
              </div>
              <button
                disabled={!groupName.trim() || !selected.length}
                className="primary"
                onClick={() =>
                  m.run(async () => {
                    const c = await m.api<Chat>("/api/chats", "POST", {
                      kind: "group",
                      title: groupName,
                      peers: selected,
                    });
                    await m.sync();
                    setGroupName("");
                    setSelected([]);
                    openChat(c);
                  })
                }
              >
                Создать группу
              </button>
            </>
          )}
          {sheet === "profile" && peer && (
            <>
              <div className="profile-card">
                <Avatar p={peer} size="huge" />
                <h2>{peer.name}</h2>
                <small className="mono">{peer.id}</small>
              </div>
              {peer.id === identity?.id ? (
                <button className="primary" onClick={() => setSheet("share")}>
                  Поделиться профилем
                </button>
              ) : m.contacts.find((c) => c.id === peer.id)?.state ===
                "accepted" ? (
                <div className="profile-actions">
                  <button onClick={() => m.run(() => direct(peer))}>
                    <MessageCircle />
                    Написать
                  </button>
                  <button onClick={() => m.run(() => call(false, peer))}>
                    <Phone />
                    Аудио
                  </button>
                  <button onClick={() => m.run(() => call(true, peer))}>
                    <Video />
                    Видео
                  </button>
                </div>
              ) : (
                <>
                  <p className="muted">
                    Присутствие скрыто до принятия контакта. Звонки доступны
                    после принятия.
                  </p>
                  <button
                    className="primary"
                    disabled={
                      !identity ||
                      m.contacts.some(
                        (c) =>
                          c.id === peer.id &&
                          c.state === "pending" &&
                          c.requested_by === identity?.id,
                      )
                    }
                    onClick={() =>
                      m.run(async () => {
                        await m.api(
                          "/api/contacts/" +
                            (m.contacts.some(
                              (c) =>
                                c.id === peer.id &&
                                c.state === "pending" &&
                                c.requested_by !== identity?.id,
                            )
                              ? "accept"
                              : "request"),
                          "POST",
                          { peer: peer.id },
                        );
                        await m.sync();
                        m.alert("Контакт обновлён");
                      })
                    }
                  >
                    {!identity
                      ? "Сначала создайте свой профиль"
                      : m.contacts.some(
                            (c) => c.id === peer.id && c.state === "pending",
                          )
                        ? m.contacts.find((c) => c.id === peer.id)
                            ?.requested_by === identity?.id
                          ? "Запрос отправлен"
                          : "Принять контакт"
                        : "Отправить запрос контакта"}
                  </button>
                </>
              )}
              <button className="quiet" onClick={() => setSheet("fingerprint")}>
                <Shield size={17} />
                Сверить ключ
              </button>
              {identity && peer.id !== identity.id && (
                <button
                  className="danger quiet"
                  onClick={() =>
                    m.run(async () => {
                      await m.api("/api/contacts/block", "POST", {
                        peer: peer.id,
                      });
                      await m.sync();
                      close();
                    })
                  }
                >
                  Заблокировать
                </button>
              )}
            </>
          )}
          {sheet === "scan" && (
            <QRScanner
              onResult={(value) => {
                if (scanTarget === "new") {
                  setLink(value);
                  setSheet("new");
                } else {
                  setPairText(value);
                  setSheet(scanTarget);
                }
              }}
            />
          )}
          {sheet === "fingerprint" && (
            <>
              <p className="muted">
                Сравните этот отпечаток с устройством контакта лично или по
                доверенному каналу. Первое получение ключа использует TOFU.
              </p>
              <div className="fingerprint">{finger}</div>
            </>
          )}
          {sheet === "myprofile" && identity && (
            <>
              <div className="avatars">
                {avatars.map((a) => (
                  <button
                    key={a}
                    className={avatar === a ? "selected" : ""}
                    onClick={() => setAvatar(a)}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <input
                placeholder={identity.name}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
              />
              <button
                className="quiet"
                onClick={() =>
                  m.run(async () => {
                    setPeer(await m.getProfile(identity.id));
                    setSheet("fingerprint");
                  })
                }
              >
                <Shield size={17} />
                Мой отпечаток ключа
              </button>
              <button
                className="primary"
                onClick={() =>
                  m.run(async () => {
                    const updated = {
                      ...identity,
                      name: name.trim() || identity.name,
                      avatar,
                    };
                    await m.api("/api/me", "PUT", updated);
                    await saveIdentity(updated);
                    close();
                  })
                }
              >
                Сохранить
              </button>
            </>
          )}
          {sheet === "share" && identity && (
            <>
              <div className="profile-card">
                <Avatar p={identity} size="large" />
                <h3>{identity.name}</h3>
              </div>
              {qr && (
                <img
                  className="qr"
                  src={qr}
                  alt="QR-код постоянной ссылки профиля"
                />
              )}
              <div className="link-box">
                <span>
                  {location.origin}/u/{identity.id}
                </span>
                <button
                  className="icon"
                  aria-label="Копировать ссылку"
                  onClick={() =>
                    m.run(async () => {
                      await navigator.clipboard.writeText(
                        location.origin + "/u/" + identity.id,
                      );
                      m.alert("Ссылка скопирована");
                    })
                  }
                >
                  <Copy size={20} />
                </button>
              </div>
              {"share" in navigator && (
                <button
                  className="primary"
                  onClick={() =>
                    m.run(() =>
                      navigator.share({
                        title: "Welcome · " + identity.name,
                        url: location.origin + "/u/" + identity.id,
                      }),
                    )
                  }
                >
                  Поделиться
                </button>
              )}
              <small>Постоянная ссылка. Она не передаёт приватные ключи.</small>
            </>
          )}
          {sheet === "chat-options" && chat && (
            <div className="actions">
              <button onClick={() => setSheet("search-chat")}>
                <Search />
                Поиск в чате
              </button>
              <button onClick={() => setSheet("media")}>
                <Paperclip />
                Медиа и файлы
              </button>
              <button onClick={() => setSheet("pinned")}>
                <Pin />
                Закреплённые сообщения
              </button>
              <button onClick={() => setSheet("disappearing")}>
                <RefreshCw />
                Исчезающие сообщения
              </button>
              {chat.kind === "group" && (
                <button onClick={() => setSheet("group")}>
                  <Users />
                  Участники группы
                </button>
              )}
              {chat.kind === "direct" && (
                <button
                  onClick={() =>
                    m.run(async () => {
                      await rtc?.start(
                        other!.id,
                        other!.devices[0].id,
                        false,
                        "data",
                      );
                      close();
                      m.alert("Попытка прямого DataChannel соединения");
                    })
                  }
                >
                  <Link />
                  Прямое соединение DataChannel
                </button>
              )}
            </div>
          )}
          {sheet === "disappearing" && (
            <>
              <p className="muted">
                Срок применяется к новым сообщениям. Он не удаляет скриншоты и
                сторонние копии. Файлы на сервере удаляются через 30 дней.
              </p>
              <select
                value={expiry}
                onChange={(e) => setExpiry(Number(e.target.value))}
              >
                <option value="0">Выключено</option>
                <option value="60000">1 минута</option>
                <option value="3600000">1 час</option>
                <option value="86400000">24 часа</option>
                <option value="604800000">7 дней</option>
              </select>
              <button className="primary" onClick={close}>
                Готово
              </button>
            </>
          )}
          {sheet === "pinned" && (
            <div className="actions">
              {messages
                .filter((e) => e.pinned)
                .map((e) => (
                  <button
                    key={e.id}
                    onClick={() => {
                      setReply(e);
                      close();
                    }}
                  >
                    <Pin />
                    {e.text || e.attachment?.name}
                  </button>
                ))}
              {!messages.some((e) => e.pinned) && (
                <p className="muted">Нет закреплённых сообщений.</p>
              )}
            </div>
          )}
          {sheet === "media" && (
            <div className="media-grid">
              {messages
                .filter((e) => e.attachment)
                .map((e) => (
                  <Media
                    key={e.id}
                    attachment={e.attachment!}
                    api={m.api}
                    alert={m.alert}
                  />
                ))}
              {!messages.some((e) => e.attachment) && (
                <p className="muted">В этом чате ещё нет медиа.</p>
              )}
            </div>
          )}
          {sheet === "group" && chat && (
            <>
              <h3>{chat.title}</h3>
              {chat.members.map((p) => (
                <div className="member-row" key={p.id}>
                  <button onClick={() => openPeer(p)}>
                    <Avatar p={p} />
                    <span>
                      {p.name}
                      <small>
                        {p.id === chat.owner
                          ? "Владелец"
                          : p.role === "admin"
                            ? "Администратор"
                            : "Участник"}
                      </small>
                    </span>
                  </button>
                  {identity?.id === chat.owner && p.id !== identity.id && (
                    <button
                      className="quiet role-button"
                      onClick={() =>
                        m.run(async () => {
                          await m.api(
                            "/api/chats/" + chat.id + "/members",
                            "POST",
                            {
                              peer: p.id,
                              role: p.role === "admin" ? "member" : "admin",
                            },
                          );
                          await m.sync();
                        })
                      }
                    >
                      {p.role === "admin" ? "Снять админа" : "Админ"}
                    </button>
                  )}
                  {identity?.id === chat.owner && p.id !== identity.id && (
                    <button
                      className="icon danger"
                      aria-label="Удалить участника"
                      onClick={() =>
                        m.run(async () => {
                          await m.api(
                            "/api/chats/" + chat.id + "/members",
                            "POST",
                            { peer: p.id, remove: true },
                          );
                          await m.sync();
                        })
                      }
                    >
                      <X size={17} />
                    </button>
                  )}
                </div>
              ))}
              {identity?.id === chat.owner && (
                <>
                  <select
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                  >
                    <option value="">Выберите контакт</option>
                    {m.contacts
                      .filter(
                        (p) =>
                          p.state === "accepted" &&
                          !chat.members.some((x) => x.id === p.id),
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                  <button
                    className="primary"
                    disabled={!link}
                    onClick={() =>
                      m.run(async () => {
                        await m.api(
                          "/api/chats/" + chat.id + "/members",
                          "POST",
                          { peer: link },
                        );
                        setLink("");
                        await m.sync();
                      })
                    }
                  >
                    Добавить участника
                  </button>
                </>
              )}
            </>
          )}
          {sheet === "forward" && menu && (
            <div className="actions">
              {m.chats.map((c) => (
                <button
                  key={c.id}
                  onClick={() =>
                    m.run(async () => {
                      if (menu.attachment) {
                        const encrypted = await m.api<ArrayBuffer>(
                          "/api/files/" + menu.attachment.id,
                        );
                        const blob = new Blob(
                          [
                            await decryptFile(
                              encrypted,
                              menu.attachment.key,
                              menu.attachment.iv,
                            ),
                          ],
                          { type: menu.attachment.type },
                        );
                        await m.file(
                          c.id,
                          blob,
                          menu.attachment.name,
                          menu.attachment.type,
                        );
                      } else
                        await m.sendEvent(c.id, {
                          text: menu.text,
                          forwarded: true,
                        });
                      setMenu(undefined);
                      close();
                    })
                  }
                >
                  <Forward />
                  {c.title ||
                    c.members.find((p) => p.id !== identity?.id)?.name}
                </button>
              ))}
            </div>
          )}
          {sheet === "emoji" && (
            <div className="emoji-picker">
              {[
                "🙂",
                "😊",
                "❤️",
                "👍",
                "😂",
                "🔥",
                "🎉",
                "👋",
                "😎",
                "🥰",
                "🤔",
                "😢",
                "😭",
                "😮",
                "🙌",
                "✨",
                "💙",
                "💪",
                "✅",
                "👀",
                "😴",
                "🤝",
                "🙏",
                "🚀",
              ].map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    setDraft((s) => s + e);
                    close();
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
          {sheet === "devices" && (
            <>
              <p className="muted">
                Каждое устройство имеет отдельный ключ. Отзыв закрывает
                серверный доступ и получение новых сообщений.
              </p>
              {devices.map((d) => (
                <div className="member-row" key={d.id}>
                  <Smartphone />
                  <div>
                    <strong>{d.label}</strong>
                    <small>
                      {d.id === identity?.device ? "Это устройство" : d.id}
                    </small>
                  </div>
                  {d.id !== identity?.device && (
                    <button
                      className="danger quiet"
                      onClick={() =>
                        m.run(async () => {
                          await m.api("/api/devices/" + d.id, "DELETE");
                          setDevices(await m.api("/api/devices"));
                        })
                      }
                    >
                      Отозвать
                    </button>
                  )}
                </div>
              ))}
              {identity?.rootPrivate.d ? (
                <button
                  className="primary"
                  onClick={() => {
                    setPairText("");
                    setSheet("pair-approve");
                  }}
                >
                  Подтвердить новое устройство
                </button>
              ) : (
                <p className="muted">
                  Подтверждение новых устройств доступно с исходного устройства,
                  где хранится root-ключ.
                </p>
              )}
            </>
          )}
          {sheet === "pair-new" && pairDraft && (
            <>
              <p className="muted">
                На доверенном устройстве откройте «Устройства → Подтвердить».
                Передайте QR или код приглашения. Код действует 10 минут.
              </p>
              {qr && (
                <img
                  className="qr"
                  src={qr}
                  alt="Приглашение нового устройства"
                />
              )}
              <button
                className="quiet"
                onClick={() =>
                  m.run(async () => {
                    await navigator.clipboard.writeText(
                      JSON.stringify({
                        type: "welcome-pair",
                        id: pairDraft.id,
                        label: pairDraft.label,
                        sign_key: pairDraft.sign_key,
                        enc_key: pairDraft.enc_key,
                        nonce: pairDraft.nonce,
                        expires: pairDraft.expires,
                      }),
                    );
                    m.alert("Код скопирован");
                  })
                }
              >
                Скопировать приглашение
              </button>
              <button
                className="quiet"
                onClick={() => {
                  setScanTarget("pair-new");
                  setSheet("scan");
                }}
              >
                <QrCode size={18} />
                Сканировать ответ
              </button>
              <textarea
                placeholder="Вставьте код подтверждения с доверенного устройства"
                value={pairText}
                onChange={(e) => setPairText(e.target.value)}
              />
              <button className="primary" onClick={() => m.run(pairFinish)}>
                Завершить подключение
              </button>
            </>
          )}
          {sheet === "pair-approve" && (
            <>
              <p className="muted">
                Вставьте код с нового устройства. Подтверждайте только своё
                устройство. Ответ передайте ему по доверенному каналу.
              </p>
              <button
                className="quiet"
                onClick={() => {
                  setScanTarget("pair-approve");
                  setSheet("scan");
                }}
              >
                <QrCode size={18} />
                Сканировать приглашение
              </button>
              <textarea
                value={pairText}
                onChange={(e) => setPairText(e.target.value)}
                placeholder="Код приглашения"
              />
              <button className="primary" onClick={() => m.run(pairApprove)}>
                Подтвердить сертификат
              </button>
              <button
                className="quiet"
                onClick={() =>
                  m.run(async () => {
                    await navigator.clipboard.writeText(pairText);
                    m.alert("Код ответа скопирован");
                  })
                }
              >
                Копировать код ответа
              </button>
              <button
                className="quiet"
                onClick={() =>
                  m.run(async () => {
                    setQr(await QRCode.toDataURL(pairText, { width: 300 }));
                    setSheet("pair-response");
                  })
                }
              >
                Показать QR ответа
              </button>
            </>
          )}
          {sheet === "pair-response" && qr && (
            <img
              className="qr"
              src={qr}
              alt="Подтверждение нового устройства"
            />
          )}
          {sheet === "recovery" && identity && (
            <>
              <p className="muted">
                Зашифрованная копия ключей этого устройства. Сохраните файл и
                recovery key отдельно. Восстановление не переносит локальную
                историю. Можно использовать recovery key или стандартную фразу
                BIP39 из 24 слов.
              </p>
              <button
                className="primary"
                onClick={() =>
                  m.run(async () => {
                    if (!identity.rootPrivate.d)
                      throw Error(
                        "Экспорт recovery выполняется на исходном устройстве с root-ключом",
                      );
                    const r = await exportRecovery(identity);
                    setRecoveryKey(r.key);
                    download(
                      new Blob([r.file], { type: "application/json" }),
                      "welcome-recovery.json",
                    );
                  })
                }
              >
                Экспортировать recovery-файл
              </button>
              {recoveryKey && (
                <>
                  <div className="fingerprint">{recoveryKey}</div>
                  <p className="muted">Recovery phrase · 24 слова</p>
                  <div className="fingerprint">
                    {recoveryPhrase(recoveryKey)}
                  </div>
                  <button
                    className="quiet"
                    onClick={() =>
                      m.run(async () => {
                        await navigator.clipboard.writeText(recoveryKey);
                        m.alert("Recovery key скопирован");
                      })
                    }
                  >
                    Копировать recovery key
                  </button>
                </>
              )}
            </>
          )}
          {sheet === "restore" && (
            <>
              <p className="muted">
                Выберите ранее сохранённый recovery-файл и введите его ключ.
              </p>
              <input
                placeholder="Recovery key или 24 слова"
                value={recoveryKey}
                onChange={(e) => setRecoveryKey(e.target.value)}
                autoComplete="off"
              />
              <input
                type="file"
                accept="application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    m.run(async () => {
                      const restored = await importRecovery(
                        await f.text(),
                        recoveryKey,
                      );
                      const fresh = await recoveredDevice(restored);
                      const response = await fetch(
                        (import.meta.env.VITE_API_URL || "") + "/api/recover",
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(publicDevice(fresh)),
                        },
                      );
                      if (!response.ok)
                        throw Error((await response.json()).error);
                      await saveIdentity(fresh);
                      close();
                    });
                }}
              />
            </>
          )}
          {sheet === "privacy" && (
            <>
              <label className="toggle">
                Отправлять подтверждения прочтения
                <input
                  type="checkbox"
                  checked={settings.receipts}
                  onChange={(e) => {
                    const v = { ...settings, receipts: e.target.checked };
                    setSettings(v);
                    store.set("settings", v);
                  }}
                />
              </label>
              <p className="muted">
                Присутствие и звонки доступны принятым контактам. Участники
                общих групп могут обмениваться событиями. Сервер видит профили,
                участников, размеры и время пакетов; содержимое сообщений и
                файлов зашифровано.
              </p>
            </>
          )}
          {sheet === "notifications" && (
            <>
              <p className="muted">
                Уведомления браузера доступны только пока приложение работает.
                Фоновый Web Push в этой версии не реализован.
              </p>
              <button
                className="primary"
                onClick={() =>
                  m.run(async () => {
                    if (!("Notification" in window))
                      throw Error("Этот браузер не поддерживает уведомления");
                    const result = await Notification.requestPermission();
                    const v = {
                      ...settings,
                      notifications: result === "granted",
                    };
                    setSettings(v);
                    await store.set("settings", v);
                    if (v.notifications)
                      new Notification("Welcome", {
                        body: "Уведомления разрешены",
                      });
                    else m.alert("Разрешение не предоставлено");
                  })
                }
              >
                Запросить разрешение
              </button>
            </>
          )}
          {sheet === "appearance" && (
            <>
              <h3>Графитовая тема</h3>
              <p className="muted">
                Тёмный фон, синий акцент. Анимации учитывают системную настройку
                уменьшения движения.
              </p>
              <label className="toggle">
                Компактный размер текста
                <input
                  type="checkbox"
                  onChange={(e) => {
                    document.documentElement.style.fontSize = e.target.checked
                      ? "14px"
                      : "16px";
                    store.set("compact", e.target.checked);
                  }}
                />
              </label>
            </>
          )}
          {sheet === "clear" && (
            <>
              <p>
                Удалить историю только на этом устройстве? Контакты и ключи
                сохранятся. На других устройствах сообщения останутся.
              </p>
              <button
                className="primary danger-bg"
                onClick={() =>
                  m.run(async () => {
                    await store.clearHistory();
                    location.reload();
                  })
                }
              >
                Удалить локальную историю
              </button>
            </>
          )}
          {sheet === "about" && (
            <>
              <div className="brand small-brand">W</div>
              <h3>Welcome · v0.1</h3>
              <p className="muted">
                React · Cloudflare · WebRTC · Web Crypto. Прикладное шифрование
                не проходило независимый аудит. Double Ratchet, MLS, push и
                импорт старой истории на новое устройство не реализованы.
              </p>
              <p className="muted">
                Чтобы установить PWA, используйте «Добавить на главный экран» в
                меню браузера.
              </p>
            </>
          )}
          {sheet === "call-devices" && (
            <>
              <button
                className="primary"
                onClick={() =>
                  m.run(async () =>
                    setOutputs(await navigator.mediaDevices.enumerateDevices()),
                  )
                }
              >
                Обновить список устройств
              </button>
              {outputs
                .filter(
                  (d) => d.kind === "audioinput" || d.kind === "videoinput",
                )
                .map((d) => (
                  <button
                    className="device-choice"
                    key={d.deviceId}
                    onClick={() =>
                      m.run(() =>
                        rtc!.replace(
                          d.kind === "audioinput" ? "audio" : "video",
                          { deviceId: { exact: d.deviceId } },
                        ),
                      )
                    }
                  >
                    {d.label || d.kind}
                  </button>
                ))}
              {outputs
                .filter((d) => d.kind === "audiooutput")
                .map((d) => (
                  <button
                    className="device-choice"
                    key={d.deviceId}
                    onClick={() =>
                      m.run(async () => {
                        const el = remoteVideo.current as HTMLVideoElement & {
                          setSinkId?: (id: string) => Promise<void>;
                        };
                        if (!el?.setSinkId)
                          throw Error(
                            "Выбор динамика не поддерживается браузером",
                          );
                        await el.setSinkId(d.deviceId);
                      })
                    }
                  >
                    {d.label || "Динамик"}
                  </button>
                ))}
            </>
          )}
        </Modal>
      )}
      {callVisible && rtc && (
        <div className="call-screen">
          <video
            className={"remote-video " + (!rtc.video ? "audio-only" : "")}
            ref={remoteVideo}
            autoPlay
            playsInline
            muted={mutedSpeaker}
          />
          {rtc.video && (
            <video
              className="local-video"
              ref={localVideo}
              autoPlay
              playsInline
              muted
            />
          )}
          <div className="call-info">
            <small>WELCOME</small>
            <h2>
              {m.contacts.find((p) => p.id === rtc.peer)?.name ||
                other?.name ||
                "Звонок"}
            </h2>
            <p>{labels[rtc.state]}</p>
            <small>WebRTC · DTLS-SRTP</small>
          </div>
          {!rtc.video && (
            <Avatar
              p={
                m.contacts.find((p) => p.id === rtc.peer) ||
                other || { name: "Звонок", avatar: "🌙" }
              }
              size="call-avatar"
            />
          )}
          {rtc.state === "incoming" ? (
            <div className="call-controls">
              <button
                className="hangup"
                onClick={() => rtc.end()}
                aria-label="Отклонить"
              >
                <PhoneOff />
              </button>
              <button
                className="answer"
                onClick={() => m.run(() => rtc.accept())}
                aria-label="Принять"
              >
                <Phone />
              </button>
            </div>
          ) : (
            <div className="call-controls">
              <button
                className="call-control"
                onClick={() => {
                  setMutedSpeaker((s) => !s);
                }}
              >
                <Volume2 />
                <small>{mutedSpeaker ? "Включить звук" : "Динамик"}</small>
              </button>
              <button className="call-control" onClick={() => rtc.mute()}>
                {rtc.local?.getAudioTracks()[0]?.enabled ? <Mic /> : <MicOff />}
                <small>Микрофон</small>
              </button>
              {rtc.video && (
                <button className="call-control" onClick={() => rtc.camera()}>
                  {rtc.local?.getVideoTracks()[0]?.enabled ? (
                    <Camera />
                  ) : (
                    <CameraOff />
                  )}
                  <small>Камера</small>
                </button>
              )}
              <button
                className="call-control"
                onClick={() => setSheet("call-more")}
              >
                <MoreVertical />
                <small>Ещё</small>
              </button>
              <button
                className="hangup"
                onClick={() => rtc.end()}
                aria-label="Завершить звонок"
              >
                <PhoneOff />
              </button>
            </div>
          )}
        </div>
      )}
      {sheet === "call-more" && (
        <Modal title="Звонок" close={close}>
          <div className="actions">
            <button
              onClick={() =>
                m.run(() =>
                  rtc!.replace("video", {
                    facingMode: {
                      ideal:
                        rtc!.local?.getVideoTracks()[0]?.getSettings()
                          .facingMode === "environment"
                          ? "user"
                          : "environment",
                    },
                  }),
                )
              }
            >
              <RefreshCw />
              Переключить камеру
            </button>
            <button onClick={() => m.run(() => rtc!.share())}>
              <Monitor />
              Показать экран
            </button>
            <button
              onClick={() => {
                setSheet("call-devices");
                m.run(async () =>
                  setOutputs(await navigator.mediaDevices.enumerateDevices()),
                );
              }}
            >
              <Settings />
              Выбрать устройства
            </button>
            {document.pictureInPictureEnabled && (
              <button
                onClick={() =>
                  m.run(() => remoteVideo.current!.requestPictureInPicture())
                }
              >
                <Video />
                Картинка в картинке
              </button>
            )}
          </div>
        </Modal>
      )}
      {m.toast && (
        <div className="toast" role="status">
          {m.toast}
        </div>
      )}
    </>
  );
}
function Media({
  attachment: a,
  api,
  alert,
}: {
  attachment: Attachment;
  api: <T = any>(p: string, m?: string, d?: unknown) => Promise<T>;
  alert: (s: string) => void;
}) {
  const [url, setUrl] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  async function load(save = false) {
    setLoading(true);
    try {
      const data = await api<ArrayBuffer>("/api/files/" + a.id);
      const decrypted = await decryptFile(data, a.key, a.iv),
        blob = new Blob([decrypted], { type: a.type });
      if (save) download(blob, a.name);
      else setUrl(URL.createObjectURL(blob));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="attachment">
      {url && a.type.startsWith("image/") ? (
        <img className="message-image" src={url} alt={a.name} />
      ) : url && a.type.startsWith("video/") ? (
        <video controls playsInline src={url} />
      ) : url && a.type.startsWith("audio/") ? (
        <audio controls src={url} />
      ) : (
        <button
          className="attachment-load"
          onClick={() => load(!/^(image|video|audio)\//.test(a.type))}
          disabled={loading}
        >
          <FileText size={30} />
          <span>
            <strong>{loading ? "Расшифровка…" : a.name}</strong>
            <small>
              {(a.size / 1024 / 1024).toFixed(2)} МБ · нажмите, чтобы открыть
            </small>
          </span>
          <Download size={17} />
        </button>
      )}
      {url && (
        <button className="quiet download-media" onClick={() => load(true)}>
          <Download size={13} />
          Сохранить
        </button>
      )}
    </div>
  );
}
