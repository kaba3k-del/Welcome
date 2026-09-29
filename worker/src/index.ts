import { DurableObject } from "cloudflare:workers";
import {
  canonical,
  enc,
  unb64,
  b64,
  randomId,
  certPayload,
  type Envelope,
} from "../../shared/protocol";
interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  HUB: DurableObjectNamespace<UserHub>;
  APP_ORIGIN: string;
  TURN_KEY_ID?: string;
  TURN_KEY_TOKEN?: string;
}
type Actor = { user: string; device: string };
const json = (data: unknown, status = 200) => Response.json(data, { status });
function fail(message: string, status = 400): never {
  throw new ApiError(message, status);
}
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const now = () => Date.now();
async function verify(key: JsonWebKey, signature: string, data: string) {
  try {
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      await crypto.subtle.importKey(
        "jwk",
        key,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      ),
      unb64(signature),
      enc.encode(data),
    );
  } catch {
    return false;
  }
}
async function sha(bytes: ArrayBuffer) {
  return b64(await crypto.subtle.digest("SHA-256", bytes));
}
async function rate(env: Env, bucket: string, max: number, window = 60000) {
  const t = now();
  await env.DB.prepare(
    "INSERT INTO limits(bucket,count,expires) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<? THEN ? ELSE expires END",
  )
    .bind(bucket, t + window, t, t, t + window)
    .run();
  const row = await env.DB.prepare("SELECT count FROM limits WHERE bucket=?")
    .bind(bucket)
    .first<{ count: number }>();
  if (row!.count > max) fail("Слишком много запросов", 429);
}
async function auth(req: Request, env: Env, body: ArrayBuffer): Promise<Actor> {
  const device = req.headers.get("X-Device") || "",
    stamp = req.headers.get("X-Time") || "",
    nonce = req.headers.get("X-Nonce") || "",
    signature = req.headers.get("X-Signature") || "";
  if (
    !Number.isFinite(Number(stamp)) ||
    Math.abs(now() - Number(stamp)) > 60000 ||
    nonce.length < 16 ||
    nonce.length > 80
  )
    fail("Неверное время или nonce", 401);
  const row = await env.DB.prepare(
    "SELECT user_id,sign_key FROM devices WHERE id=? AND revoked=0",
  )
    .bind(device)
    .first<{ user_id: string; sign_key: string }>();
  if (!row) fail("Устройство не авторизовано", 401);
  const url = new URL(req.url);
  const data = [
    req.method,
    url.pathname + url.search,
    stamp,
    nonce,
    await sha(body),
  ].join("\n");
  if (!(await verify(JSON.parse(row!.sign_key), signature, data)))
    fail("Неверная подпись", 401);
  try {
    await env.DB.prepare("INSERT INTO nonces(nonce,expires) VALUES(?,?)")
      .bind(nonce, now() + 120000)
      .run();
  } catch {
    fail("Повторный запрос", 401);
  }
  await rate(env, "api:" + device, 240);
  return { user: row!.user_id, device };
}
async function profile(env: Env, id: string) {
  const p = await env.DB.prepare("SELECT * FROM users WHERE id=?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!p) fail("Профиль не найден", 404);
  const d = await env.DB.prepare(
    "SELECT * FROM devices WHERE user_id=? AND revoked=0",
  )
    .bind(id)
    .all<Record<string, unknown>>();
  return {
    ...p,
    root_key: JSON.parse(p!.root_key as string),
    devices: d.results.map((x) => ({
      ...x,
      sign_key: JSON.parse(x.sign_key as string),
      enc_key: JSON.parse(x.enc_key as string),
    })),
  };
}
async function member(env: Env, chat: string, user: string) {
  return !!(await env.DB.prepare(
    "SELECT 1 FROM members WHERE chat_id=? AND user_id=?",
  )
    .bind(chat, user)
    .first());
}
async function permitted(env: Env, a: string, b: string) {
  if (a === b) return true;
  const blocked = await env.DB.prepare(
    "SELECT 1 FROM contacts WHERE ((owner=? AND peer=?) OR (owner=? AND peer=?)) AND state='blocked'",
  )
    .bind(a, b, b, a)
    .first();
  if (blocked) return false;
  return !!(await env.DB.prepare(
    "SELECT 1 FROM contacts WHERE owner=? AND peer=? AND state='accepted' UNION SELECT 1 FROM members a JOIN members b ON a.chat_id=b.chat_id WHERE a.user_id=? AND b.user_id=? LIMIT 1",
  )
    .bind(a, b, a, b)
    .first());
}
async function notify(env: Env, user: string, data: unknown) {
  await env.HUB.get(env.HUB.idFromName(user)).fetch("https://internal/event", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
async function chatView(env: Env, id: string) {
  const c = await env.DB.prepare("SELECT * FROM conversations WHERE id=?")
    .bind(id)
    .first();
  const ms = await env.DB.prepare(
    "SELECT user_id,role FROM members WHERE chat_id=?",
  )
    .bind(id)
    .all<{ user_id: string; role: string }>();
  return {
    ...c,
    members: await Promise.all(
      ms.results.map(async (m) => ({
        ...(await profile(env, m.user_id)),
        role: m.role,
      })),
    ),
  };
}
function text(v: unknown, max = 200) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    fail("Некорректное поле");
  return v as string;
}
function publicKey(v: JsonWebKey) {
  if (!v || v.kty !== "EC" || v.crv !== "P-256" || v.d || !v.x || !v.y)
    fail("Некорректный публичный ключ");
}
async function certValid(user: string, root: JsonWebKey, d: any) {
  publicKey(d.sign_key);
  publicKey(d.enc_key);
  return verify(
    root,
    d.certificate,
    certPayload(user, d.id, d.sign_key, d.enc_key),
  );
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin");
    const cors = {
      "Access-Control-Allow-Origin": env.APP_ORIGIN,
      Vary: "Origin",
      "Access-Control-Allow-Headers":
        "Content-Type,X-Device,X-Time,X-Nonce,X-Signature",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    };
    try {
      if (origin && origin !== env.APP_ORIGIN) fail("Origin запрещён", 403);
      if (req.method === "OPTIONS")
        return new Response(null, { headers: cors });
      const response = await route(req, env);
      if (response.status === 101) return response;
      Object.entries(cors).forEach(([k, v]) => response.headers.set(k, v));
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    } catch (e) {
      const r = json(
        { error: e instanceof ApiError ? e.message : "Ошибка сервера" },
        e instanceof ApiError ? e.status : 500,
      );
      Object.entries(cors).forEach(([k, v]) => r.headers.set(k, v));
      return r;
    }
  },
  async scheduled(_c: ScheduledController, env: Env) {
    await env.DB.batch(
      [
        "DELETE FROM nonces WHERE expires<?",
        "DELETE FROM tickets WHERE expires<?",
        "DELETE FROM mailbox WHERE expires<?",
        "DELETE FROM invitations WHERE expires<?",
        "DELETE FROM limits WHERE expires<?",
      ].map((sql) => env.DB.prepare(sql).bind(now())),
    );
    const expired = await env.DB.prepare(
      "SELECT id FROM blobs WHERE expires<? LIMIT 1000",
    )
      .bind(now())
      .all<{ id: string }>();
    for (const b of expired.results) {
      await env.FILES.delete(b.id);
      await env.DB.prepare("DELETE FROM blobs WHERE id=?").bind(b.id).run();
    }
  },
} satisfies ExportedHandler<Env>;
async function route(req: Request, env: Env): Promise<Response> {
  const u = new URL(req.url),
    p = u.pathname,
    m = req.method;
  const size = Number(req.headers.get("Content-Length") || 0);
  if (size > 26 * 1024 * 1024) fail("Лимит файла 25 МБ", 413);
  const raw = p === "/api/ws" ? new ArrayBuffer(0) : await req.arrayBuffer();
  if (raw.byteLength > 26 * 1024 * 1024) fail("Слишком большой запрос", 413);
  let data: any = {};
  if (
    raw.byteLength &&
    req.headers.get("Content-Type")?.includes("application/json")
  ) {
    if (raw.byteLength > 256000) fail("Слишком большой JSON", 413);
    try {
      data = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      fail("Неверный JSON");
    }
  }
  if (p === "/api/health") return json({ ok: true });
  if (p === "/api/register" && m === "POST") {
    await rate(
      env,
      "register:" + (req.headers.get("CF-Connecting-IP") || "local"),
      10,
      3600000,
    );
    text(data.id, 80);
    text(data.name, 60);
    text(data.avatar, 100);
    publicKey(data.root_key);
    text(data.device.id, 80);
    text(data.device.label, 80);
    if (!(await certValid(data.id, data.root_key, data.device)))
      fail("Неверный сертификат", 401);
    try {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO users(id,name,avatar,root_key,created) VALUES(?,?,?,?,?)",
        ).bind(
          data.id,
          data.name,
          data.avatar,
          canonical(data.root_key),
          now(),
        ),
        env.DB.prepare(
          "INSERT INTO devices(id,user_id,label,sign_key,enc_key,certificate,created) VALUES(?,?,?,?,?,?,?)",
        ).bind(
          data.device.id,
          data.id,
          data.device.label,
          canonical(data.device.sign_key),
          canonical(data.device.enc_key),
          data.device.certificate,
          now(),
        ),
      ]);
    } catch {
      fail("ID уже существует", 409);
    }
    return json(await profile(env, data.id), 201);
  }
  if (p === "/api/recover" && m === "POST") {
    await rate(
      env,
      "recovery:" + (req.headers.get("CF-Connecting-IP") || "local"),
      10,
      3600000,
    );
    const owner = await profile(env, text(data.user_id, 80));
    text(data.id, 80);
    text(data.label, 80);
    if (!(await certValid(data.user_id as string, owner.root_key, data)))
      fail("Неверный recovery-сертификат", 401);
    await env.DB.prepare(
      "INSERT INTO devices(id,user_id,label,sign_key,enc_key,certificate,created) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(
        data.id,
        data.user_id,
        data.label,
        canonical(data.sign_key),
        canonical(data.enc_key),
        data.certificate,
        now(),
      )
      .run();
    return json({ ok: true }, 201);
  }
  if (p.startsWith("/api/profile/") && m === "GET") {
    await rate(
      env,
      "profile:" + (req.headers.get("CF-Connecting-IP") || "local"),
      120,
    );
    return json(await profile(env, decodeURIComponent(p.split("/").pop()!)));
  }
  if (p === "/api/ws") {
    const ticket = u.searchParams.get("ticket") || "";
    const t = await env.DB.prepare(
      "DELETE FROM tickets WHERE id=? AND expires>? RETURNING user_id,device_id",
    )
      .bind(ticket, now())
      .first<{ user_id: string; device_id: string }>();
    if (!t) fail("Ticket истёк", 401);
    if (
      !(await env.DB.prepare("SELECT 1 FROM devices WHERE id=? AND revoked=0")
        .bind(t!.device_id)
        .first())
    )
      fail("Отозвано", 401);
    return env.HUB.get(env.HUB.idFromName(t!.user_id)).fetch(
      "https://internal/connect",
      {
        headers: {
          Upgrade: "websocket",
          "X-User": t!.user_id,
          "X-Device": t!.device_id,
        },
      },
    );
  }
  const a = await auth(req, env, raw);
  if (p === "/api/me" && m === "GET") return json(await profile(env, a.user));
  if (p === "/api/me" && m === "PUT") {
    await env.DB.prepare("UPDATE users SET name=?,avatar=? WHERE id=?")
      .bind(text(data.name, 60), text(data.avatar, 100), a.user)
      .run();
    return json(await profile(env, a.user));
  }
  if (p === "/api/presence" && m === "GET") {
    const rows = await env.DB.prepare(
      "SELECT peer FROM contacts WHERE owner=? AND state='accepted'",
    )
      .bind(a.user)
      .all<{ peer: string }>();
    const statuses: Record<string, boolean> = {};
    for (const row of rows.results)
      if (await permitted(env, a.user, row.peer)) {
        const r = await env.HUB.get(env.HUB.idFromName(row.peer)).fetch(
          "https://internal/status",
        );
        statuses[row.peer] = ((await r.json()) as { online: boolean }).online;
      }
    return json(statuses);
  }
  if (p === "/api/ticket" && m === "POST") {
    const id = randomId();
    await env.DB.prepare("INSERT INTO tickets VALUES(?,?,?,?)")
      .bind(id, a.user, a.device, now() + 30000)
      .run();
    return json({ ticket: id });
  }
  if (p === "/api/contacts" && m === "GET") {
    const rows = await env.DB.prepare(
      "SELECT peer,state,requested_by FROM contacts WHERE owner=?",
    )
      .bind(a.user)
      .all<{ peer: string; state: string; requested_by: string }>();
    return json(
      await Promise.all(
        rows.results.map(async (c) => ({
          ...(await profile(env, c.peer)),
          state: c.state,
          requested_by: c.requested_by,
        })),
      ),
    );
  }
  if (p === "/api/contacts/request" && m === "POST") {
    const peer = text(data.peer, 80);
    if (peer === a.user) fail("Это ваш профиль");
    await profile(env, peer);
    const existing = await env.DB.prepare(
      "SELECT state FROM contacts WHERE owner=? AND peer=?",
    )
      .bind(peer, a.user)
      .first<{ state: string }>();
    if (existing?.state === "blocked") fail("Контакт недоступен", 403);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO contacts VALUES(?,?,?,'pending',?)",
      ).bind(a.user, peer, a.user, now()),
      env.DB.prepare(
        "INSERT OR IGNORE INTO contacts VALUES(?,?,?,'pending',?)",
      ).bind(peer, a.user, a.user, now()),
    ]);
    await notify(env, peer, { type: "contacts" });
    return json({ ok: true });
  }
  if (p === "/api/contacts/accept" && m === "POST") {
    const peer = text(data.peer, 80);
    if (
      !(await env.DB.prepare(
        "SELECT 1 FROM contacts WHERE owner=? AND peer=? AND state='pending' AND requested_by!=? AND NOT EXISTS (SELECT 1 FROM contacts WHERE owner=? AND peer=? AND state='blocked')",
      )
        .bind(a.user, peer, a.user, peer, a.user)
        .first())
    )
      fail("Нет запроса", 404);
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE contacts SET state='accepted' WHERE owner=? AND peer=?",
      ).bind(a.user, peer),
      env.DB.prepare(
        "UPDATE contacts SET state='accepted' WHERE owner=? AND peer=? AND state!='blocked'",
      ).bind(peer, a.user),
    ]);
    await notify(env, peer, { type: "contacts" });
    return json({ ok: true });
  }
  if (p === "/api/contacts/block" && m === "POST") {
    await env.DB.prepare(
      "INSERT INTO contacts VALUES(?,?,?,'blocked',?) ON CONFLICT(owner,peer) DO UPDATE SET state='blocked'",
    )
      .bind(a.user, text(data.peer, 80), a.user, now())
      .run();
    return json({ ok: true });
  }
  if (p === "/api/chats" && m === "GET") {
    const rows = await env.DB.prepare(
      "SELECT chat_id FROM members WHERE user_id=?",
    )
      .bind(a.user)
      .all<{ chat_id: string }>();
    return json(
      await Promise.all(rows.results.map((c) => chatView(env, c.chat_id))),
    );
  }
  if (p === "/api/chats" && m === "POST") {
    const kind = data.kind === "group" ? "group" : "direct";
    const peers = [...new Set<string>(data.peers || [])].filter(
      (x) => x !== a.user,
    );
    if (
      peers.length < 1 ||
      peers.length > 199 ||
      (kind === "direct" && peers.length !== 1)
    )
      fail("Некорректные участники");
    for (const peer of peers)
      if (!(await permitted(env, a.user, peer)))
        fail("Сначала примите контакт", 403);
    const id =
      kind === "direct"
        ? "dm_" + [a.user, peers[0]].sort().join("_")
        : randomId();
    if (
      !(await env.DB.prepare("SELECT 1 FROM conversations WHERE id=?")
        .bind(id)
        .first())
    ) {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO conversations VALUES(?,?,?,?,?)").bind(
          id,
          kind,
          kind === "group" ? text(data.title, 80) : "",
          a.user,
          now(),
        ),
        ...[a.user, ...peers].map((x) =>
          env.DB.prepare("INSERT INTO members VALUES(?,?,?)").bind(
            id,
            x,
            x === a.user ? "owner" : "member",
          ),
        ),
      ]);
      for (const peer of peers) await notify(env, peer, { type: "chats" });
    }
    return json(await chatView(env, id));
  }
  if (p.match(/^\/api\/chats\/[^/]+\/members$/) && m === "POST") {
    const id = p.split("/")[3];
    const row = await env.DB.prepare(
      "SELECT owner,kind FROM conversations WHERE id=?",
    )
      .bind(id)
      .first<{ owner: string; kind: string }>();
    const role = await env.DB.prepare(
      "SELECT role FROM members WHERE chat_id=? AND user_id=?",
    )
      .bind(id, a.user)
      .first<{ role: string }>();
    if (
      !row ||
      row.kind !== "group" ||
      !["owner", "admin"].includes(role?.role || "")
    )
      fail("Нет прав управления", 403);
    const peer = text(data.peer, 80);
    if (data.role) {
      if (
        row.owner !== a.user ||
        !["admin", "member"].includes(data.role) ||
        peer === row.owner
      )
        fail("Только владелец меняет роли", 403);
      await env.DB.prepare(
        "UPDATE members SET role=? WHERE chat_id=? AND user_id=?",
      )
        .bind(data.role, id, peer)
        .run();
      await notify(env, peer, { type: "chats" });
      return json(await chatView(env, id));
    }
    if (data.remove) {
      if (peer === row.owner) fail("Нельзя удалить владельца", 403);
      if (role?.role === "admin") {
        const target = await env.DB.prepare(
          "SELECT role FROM members WHERE chat_id=? AND user_id=?",
        )
          .bind(id, peer)
          .first<{ role: string }>();
        if (target?.role !== "member")
          fail("Админ может удалять только участников", 403);
      }
      await env.DB.prepare("DELETE FROM members WHERE chat_id=? AND user_id=?")
        .bind(id, peer)
        .run();
    } else {
      if (!(await permitted(env, a.user, peer)))
        fail("Сначала примите контакт", 403);
      const count = await env.DB.prepare(
        "SELECT COUNT(*) n FROM members WHERE chat_id=?",
      )
        .bind(id)
        .first<{ n: number }>();
      if (count!.n >= 200) fail("Лимит 200 участников");
      await env.DB.prepare("INSERT OR IGNORE INTO members VALUES(?,?,'member')")
        .bind(id, peer)
        .run();
    }
    await notify(env, peer, { type: "chats" });
    return json(await chatView(env, id));
  }
  if (p === "/api/mailbox" && m === "GET") {
    const rows = await env.DB.prepare(
      "SELECT envelope FROM mailbox WHERE recipient_device=? AND expires>? ORDER BY created LIMIT 100",
    )
      .bind(a.device, now())
      .all<{ envelope: string }>();
    return json(rows.results.map((r) => JSON.parse(r.envelope)));
  }
  if (p === "/api/mailbox/ack" && m === "POST") {
    if (!Array.isArray(data.ids) || data.ids.length > 100) fail("Неверный ack");
    await env.DB.batch(
      data.ids.map((id: string) =>
        env.DB.prepare(
          "DELETE FROM mailbox WHERE id=? AND recipient_device=?",
        ).bind(id, a.device),
      ),
    );
    return json({ ok: true });
  }
  if (p === "/api/messages" && m === "POST") {
    const e = data as Envelope;
    if (
      e.v !== 1 ||
      e.from !== a.user ||
      e.device !== a.device ||
      !(await member(env, e.chat, a.user))
    )
      fail("Неверный отправитель", 403);
    if (typeof e.ciphertext !== "string" || e.ciphertext.length > 120000)
      fail("Пакет слишком большой");
    const d = await env.DB.prepare(
      "SELECT user_id FROM devices WHERE id=? AND revoked=0",
    )
      .bind(e.to)
      .first<{ user_id: string }>();
    if (
      !d ||
      !(await member(env, e.chat, d.user_id)) ||
      !(await permitted(env, a.user, d.user_id))
    )
      fail("Получатель недоступен", 403);
    const sender = await env.DB.prepare(
      "SELECT sign_key FROM devices WHERE id=?",
    )
      .bind(a.device)
      .first<{ sign_key: string }>();
    const { signature, ...unsigned } = e;
    if (
      !(await verify(
        JSON.parse(sender!.sign_key),
        signature,
        canonical(unsigned),
      ))
    )
      fail("Неверная подпись сообщения", 401);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO mailbox VALUES(?,?,?,?,?,?,?,?)",
    )
      .bind(
        e.id,
        e.to,
        a.user,
        a.device,
        e.chat,
        canonical(e),
        now(),
        now() + 30 * 86400000,
      )
      .run();
    await notify(env, d!.user_id, { type: "mail", envelope: e });
    return json({ ok: true });
  }
  if (p === "/api/files" && m === "POST") {
    const chat = u.searchParams.get("chat") || "";
    if (!(await member(env, chat, a.user))) fail("Нет доступа", 403);
    if (
      req.headers.get("Content-Type") !== "application/octet-stream" ||
      raw.byteLength < 16 ||
      raw.byteLength > 25 * 1024 * 1024
    )
      fail("Нужен зашифрованный blob до 25 МБ");
    await rate(env, "upload:" + a.user, 100, 86400000);
    const id = randomId();
    await env.FILES.put(id, raw, {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    await env.DB.prepare("INSERT INTO blobs VALUES(?,?,?,?,?,?)")
      .bind(id, a.user, chat, raw.byteLength, now(), now() + 30 * 86400000)
      .run();
    return json({ id });
  }
  if (p.startsWith("/api/files/") && m === "GET") {
    const id = p.split("/").pop()!;
    const b = await env.DB.prepare(
      "SELECT chat_id FROM blobs WHERE id=? AND expires>?",
    )
      .bind(id, now())
      .first<{ chat_id: string }>();
    if (!b || !(await member(env, b.chat_id, a.user)))
      fail("Файл недоступен", 404);
    const blob = await env.FILES.get(id);
    return blob
      ? new Response(blob.body, {
          headers: { "Content-Type": "application/octet-stream" },
        })
      : json({ error: "Файл удалён" }, 404);
  }
  if (p === "/api/devices" && m === "GET") {
    return json((await profile(env, a.user)).devices);
  }
  if (p.startsWith("/api/devices/") && m === "DELETE") {
    const id = p.split("/").pop()!;
    if (id === a.device) fail("Нельзя отозвать текущее устройство");
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE devices SET revoked=1 WHERE id=? AND user_id=?",
      ).bind(id, a.user),
      env.DB.prepare(
        "DELETE FROM mailbox WHERE recipient_device=? AND recipient_device IN (SELECT id FROM devices WHERE user_id=?)",
      ).bind(id, a.user),
    ]);
    await notify(env, a.user, { type: "revoked", device: id });
    return json({ ok: true });
  }
  if (p === "/api/pair" && m === "POST") {
    text(data.id, 80);
    if (!(await certValid(a.user, (await profile(env, a.user)).root_key, data)))
      fail("Неверный сертификат", 401);
    await env.DB.prepare(
      "INSERT INTO devices(id,user_id,label,sign_key,enc_key,certificate,created) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(
        data.id,
        a.user,
        text(data.label, 80),
        canonical(data.sign_key),
        canonical(data.enc_key),
        data.certificate,
        now(),
      )
      .run();
    return json({ ok: true });
  }
  if (p === "/api/ice" && m === "POST") {
    await rate(env, "turn:" + a.device, 20, 3600000);
    if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN)
      return json({
        iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
        turn: false,
      });
    const r = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.TURN_KEY_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 3600 }),
      },
    );
    if (!r.ok) fail("TURN недоступен", 502);
    return json({ ...((await r.json()) as object), turn: true });
  }
  fail("Маршрут не найден", 404);
  return json({});
}
export class UserHub extends DurableObject<Env> {
  async fetch(req: Request) {
    const path = new URL(req.url).pathname;
    if (path === "/status")
      return json({ online: this.ctx.getWebSockets().length > 0 });
    if (path === "/connect") {
      const user = req.headers.get("X-User")!,
        device = req.headers.get("X-Device")!;
      const pair = new WebSocketPair();
      pair[1].serializeAttachment({ user, device, count: 0, start: now() });
      this.ctx.acceptWebSocket(pair[1], [device]);
      await this.presence(user, true);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (path === "/event") {
      const data = (await req.json()) as any;
      for (const s of this.ctx.getWebSockets()) {
        const a = s.deserializeAttachment() as Actor;
        if (data.type === "revoked" && data.device === a.device) {
          s.close(4001, "Device revoked");
          continue;
        }
        if (data.type === "mail" && data.envelope.to !== a.device) continue;
        s.send(JSON.stringify(data));
      }
      return json({ ok: true });
    }
    return json({}, 404);
  }
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    try {
      if (typeof message !== "string" || message.length > 160000) return;
      const a = socket.deserializeAttachment() as Actor & {
        count: number;
        start: number;
      };
      if (
        !(await this.env.DB.prepare(
          "SELECT 1 FROM devices WHERE id=? AND revoked=0",
        )
          .bind(a.device)
          .first())
      ) {
        socket.close(4001, "Revoked");
        return;
      }
      if (now() - a.start > 60000) {
        a.start = now();
        a.count = 0;
      }
      if (++a.count > 120) {
        socket.close(4008, "Rate limit");
        return;
      }
      socket.serializeAttachment(a);
      const e = JSON.parse(message);
      if (e.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (
        e.type === "signal" &&
        typeof e.peer === "string" &&
        (await permitted(this.env, a.user, e.peer))
      ) {
        const d = await this.env.DB.prepare(
          "SELECT user_id FROM devices WHERE id=? AND revoked=0",
        )
          .bind(e.envelope?.to)
          .first<{ user_id: string }>();
        if (
          d?.user_id !== e.peer ||
          e.envelope.from !== a.user ||
          e.envelope.device !== a.device
        )
          return;
        const sender = await this.env.DB.prepare(
          "SELECT sign_key FROM devices WHERE id=?",
        )
          .bind(a.device)
          .first<{ sign_key: string }>();
        const { signature, ...unsigned } = e.envelope;
        if (
          !(await verify(
            JSON.parse(sender!.sign_key),
            signature,
            canonical(unsigned),
          ))
        )
          return;
        await notify(this.env, e.peer, {
          type: "signal",
          from: a.user,
          envelope: e.envelope,
        });
      }
    } catch {
      socket.send(
        JSON.stringify({ type: "error", error: "Некорректное событие" }),
      );
    }
  }
  async presence(user: string, online: boolean) {
    const rows = await this.env.DB.prepare(
      "SELECT peer FROM contacts WHERE owner=? AND state='accepted'",
    )
      .bind(user)
      .all<{ peer: string }>();
    for (const c of rows.results)
      if (await permitted(this.env, user, c.peer))
        await notify(this.env, c.peer, { type: "presence", user, online });
  }
  async webSocketClose(s: WebSocket) {
    const a = s.deserializeAttachment() as Actor;
    if (!this.ctx.getWebSockets().some((x) => x !== s))
      await this.presence(a.user, false);
  }
  async webSocketError(s: WebSocket) {
    s.close(1011, "Socket error");
  }
}
