import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, b64, unb64, certPayload } from "../shared/protocol.ts";
// Install only the browser metadata used by identity generation.
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "test" },
  configurable: true,
});
import {
  makeIdentity,
  recoveredDevice,
  seal,
  open,
  publicDevice,
  encryptFile,
  decryptFile,
  exportRecovery,
  importRecovery,
  recoveryPhrase,
} from "../web/src/crypto.ts";
// IndexedDB shim is injected below before the lazily opened database is used.
test("canonical JSON stable ordering and binary roundtrip", () => {
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
  const bytes = crypto.getRandomValues(new Uint8Array(64000));
  assert.deepEqual(unb64(b64(bytes)), bytes);
});
test("device envelope roundtrip, tampering and wrong recipient rejected", async () => {
  const a = await makeIdentity("Alice", "🌊"),
    b = await makeIdentity("Bob", "🌙"),
    c = await makeIdentity("Eve", "🌲");
  const profile = {
    id: a.id,
    name: a.name,
    avatar: a.avatar,
    root_key: a.rootPublic,
    devices: [publicDevice(a)],
  };
  const envelope = await seal(a, publicDevice(b), { text: "secret" }, "test");
  assert.deepEqual(await open(b, envelope, profile), { text: "secret" });
  await assert.rejects(() => open(c, envelope, profile));
  await assert.rejects(() =>
    open(b, { ...envelope, chat: "tampered" }, profile),
  );
  await assert.rejects(() =>
    open(
      b,
      { ...envelope, ciphertext: envelope.ciphertext.slice(0, -4) + "AAAA" },
      profile,
    ),
  );
  assert.ok(certPayload(a.id, a.device, a.signPublic, a.encPublic));
});
test("file encryption detects modifications and wrong keys", async () => {
  const f = await encryptFile(new Blob(["secret file"]));
  assert.equal(
    new TextDecoder().decode(await decryptFile(f.blob, f.key, f.iv)),
    "secret file",
  );
  const broken = new Uint8Array(f.blob);
  broken[0] ^= 1;
  await assert.rejects(() => decryptFile(broken.buffer, f.key, f.iv));
  await assert.rejects(() =>
    decryptFile(f.blob, b64(crypto.getRandomValues(new Uint8Array(32))), f.iv),
  );
});
test("recovery is encrypted and rejects wrong recovery key", async () => {
  const i = await makeIdentity("Test", "🌊");
  const r = await exportRecovery(i);
  assert.ok(!r.file.includes(i.signPrivate.d!));
  assert.deepEqual(await importRecovery(r.file, r.key), i);
  assert.equal(recoveryPhrase(r.key).split(" ").length, 24);
  assert.deepEqual(await importRecovery(r.file, recoveryPhrase(r.key)), i);
  await assert.rejects(() =>
    importRecovery(r.file, b64(crypto.getRandomValues(new Uint8Array(32)))),
  );
});

test("recovery generates independent device keys under original root", async () => {
  const a = await makeIdentity("Root", "🌊"),
    b = await recoveredDevice(a);
  assert.equal(a.id, b.id);
  assert.notEqual(a.device, b.device);
  assert.notDeepEqual(a.signPublic, b.signPublic);
  assert.notDeepEqual(a.encPublic, b.encPublic);
});
