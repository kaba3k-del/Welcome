import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import {
  makeIdentity,
  recoveredDevice,
  sign,
  seal,
  publicDevice,
  open,
  encryptFile,
  decryptFile,
} from "../web/src/crypto.ts";
import {
  b64,
  enc,
  randomId,
  certPayload,
  type Chat,
} from "../shared/protocol.ts";
const base = process.env.WELCOME_TEST_API || "http://127.0.0.1:8787";
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Integration" },
  configurable: true,
});
async function register(i: any) {
  const r = await fetch(base + "/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: i.id,
      name: i.name,
      avatar: i.avatar,
      root_key: i.rootPublic,
      device: publicDevice(i),
    }),
  });
  assert.equal(r.status, 201, await r.text());
}
async function request(
  i: any,
  path: string,
  method = "GET",
  data?: any,
  raw = false,
  expected = 200,
) {
  const body =
    data === undefined
      ? undefined
      : raw
        ? data
        : enc.encode(JSON.stringify(data));
  const time = String(Date.now()),
    nonce = randomId();
  const signature = await sign(
    i.signPrivate,
    [
      method,
      path,
      time,
      nonce,
      b64(await crypto.subtle.digest("SHA-256", body || new ArrayBuffer(0))),
    ].join("\n"),
  );
  const r = await fetch(base + path, {
    method,
    headers: {
      "X-Device": i.device,
      "X-Time": time,
      "X-Nonce": nonce,
      "X-Signature": signature,
      ...(body
        ? {
            "Content-Type": raw
              ? "application/octet-stream"
              : "application/json",
          }
        : {}),
    },
    body,
  });
  const result = r.headers.get("Content-Type")?.includes("json")
    ? await r.json()
    : await r.arrayBuffer();
  assert.equal(r.status, expected, JSON.stringify(result));
  return result;
}
const a = await makeIdentity("Same name", "🌊"),
  b = await makeIdentity("Same name", "🌙"),
  eve = await makeIdentity("Eve", "🌲");
await register(a);
await register(b);
await register(eve);
await request(a, "/api/contacts/request", "POST", { peer: b.id });
await request(a, "/api/contacts/accept", "POST", { peer: b.id }, false, 404);
await request(b, "/api/contacts/accept", "POST", { peer: a.id });
const chat = (await request(a, "/api/chats", "POST", {
  kind: "direct",
  peers: [b.id],
})) as Chat;
const id = randomId(),
  payload = {
    id,
    chat: chat.id,
    from: a.id,
    device: a.device,
    time: Date.now(),
    type: "message",
    text: "offline secret",
  };
const e = await seal(a, publicDevice(b), payload, chat.id, id);
await request(a, "/api/messages", "POST", e);
const mail = await request(b, "/api/mailbox");
assert.equal(mail.length, 1);
const profile = await (await fetch(base + "/api/profile/" + a.id)).json();
assert.deepEqual(await open(b, mail[0], profile), payload);
await request(b, "/api/mailbox/ack", "POST", { ids: [id] });
assert.equal((await request(b, "/api/mailbox")).length, 0);
await request(
  eve,
  "/api/messages",
  "POST",
  { ...e, from: eve.id, device: eve.device },
  false,
  403,
);
await request(
  a,
  "/api/messages",
  "POST",
  { ...e, signature: "AAAA" },
  false,
  401,
);
const f = await encryptFile(new Blob(["encrypted attachment"]));
const uploaded = await request(
  a,
  "/api/files?chat=" + chat.id,
  "POST",
  f.blob,
  true,
);
await request(eve, "/api/files/" + uploaded.id, "GET", undefined, false, 404);
const downloaded = await request(b, "/api/files/" + uploaded.id);
assert.equal(
  new TextDecoder().decode(await decryptFile(downloaded, f.key, f.iv)),
  "encrypted attachment",
);
const group = await request(a, "/api/chats", "POST", {
  kind: "group",
  title: "Study",
  peers: [b.id],
});
await request(
  b,
  "/api/chats/" + group.id + "/members",
  "POST",
  { peer: eve.id },
  false,
  403,
);
await request(a, "/api/chats/" + group.id + "/members", "POST", {
  peer: b.id,
  remove: true,
});
await request(b, "/api/files?chat=" + group.id, "POST", f.blob, true, 403);
const ticket = await request(a, "/api/ticket", "POST", {});
const ws = new WebSocket(
  base.replace("http", "ws") + "/api/ws?ticket=" + ticket.ticket,
);
await new Promise<void>((res, rej) => {
  ws.onopen = () => res();
  ws.onerror = () => rej(Error("WebSocket failed"));
  setTimeout(() => rej(Error("Socket timeout")), 4000).unref();
});
ws.send(JSON.stringify({ type: "ping" }));
await new Promise<void>((res, rej) => {
  ws.onmessage = (e) => {
    assert.equal(JSON.parse(e.data).type, "pong");
    res();
  };
  setTimeout(() => rej(Error("Pong timeout")), 4000).unref();
});
ws.close();
const restored = await recoveredDevice(a);
const recoveryResponse = await fetch(base + "/api/recover", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(publicDevice(restored)),
});
assert.equal(recoveryResponse.status, 201);
await request(restored, "/api/me");
const forged = await recoveredDevice(b);
const forgedResponse = await fetch(base + "/api/recover", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...publicDevice(forged), user_id: a.id }),
});
assert.equal(forgedResponse.status, 401);
const extra = await makeIdentity("Extra", "🌙");
const certificate = await sign(
  a.rootPrivate,
  certPayload(a.id, extra.device, extra.signPublic, extra.encPublic),
);
const paired = { ...extra, id: a.id, certificate };
await request(a, "/api/pair", "POST", { ...publicDevice(paired) });
await request(paired, "/api/me");
await request(a, "/api/devices/" + paired.device, "DELETE");
await request(paired, "/api/me", "GET", undefined, false, 401);
const stamp = String(Date.now()),
  nonce = randomId(),
  path = "/api/me";
const signature = await sign(
  a.signPrivate,
  [
    "GET",
    path,
    stamp,
    nonce,
    b64(await crypto.subtle.digest("SHA-256", new ArrayBuffer(0))),
  ].join("\n"),
);
const headers = {
  "X-Device": a.device,
  "X-Time": stamp,
  "X-Nonce": nonce,
  "X-Signature": signature,
};
assert.equal((await fetch(base + path, { headers })).status, 200);
assert.equal((await fetch(base + path, { headers })).status, 401);
await request(a, "/api/chats/" + group.id + "/members", "POST", { peer: b.id });
await request(a, "/api/chats/" + group.id + "/members", "POST", {
  peer: b.id,
  role: "admin",
});
await request(
  b,
  "/api/chats/" + group.id + "/members",
  "POST",
  { peer: a.id, remove: true },
  false,
  403,
);
await request(b, "/api/contacts/block", "POST", { peer: a.id });
await request(a, "/api/messages", "POST", e, false, 403);
console.log(
  "PASS: registration, request ownership, contacts, ciphertext mailbox + ACK, unauthorized send, tampering, R2 encryption/ACL, group authorization/removal, authenticated WebSocket, device pairing/revocation/root recovery, nonce replay rejection, admin permissions, blocking",
);
