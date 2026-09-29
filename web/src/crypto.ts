import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  canonical,
  enc,
  b64,
  unb64,
  randomId,
  certPayload,
  type PublicDevice,
  type Profile,
  type Envelope,
} from "../../shared/protocol";
import { store } from "./storage";
export type Identity = {
  id: string;
  name: string;
  avatar: string;
  rootPrivate: JsonWebKey;
  rootPublic: JsonWebKey;
  device: string;
  label: string;
  signPrivate: JsonWebKey;
  signPublic: JsonWebKey;
  encPrivate: JsonWebKey;
  encPublic: JsonWebKey;
  certificate: string;
  registered: boolean;
};
const signKey = (jwk: JsonWebKey, privateKey = false) =>
  crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    [privateKey ? "sign" : "verify"],
  );
export async function sign(jwk: JsonWebKey, data: string) {
  return b64(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      await signKey(jwk, true),
      enc.encode(data),
    ),
  );
}
export async function verify(jwk: JsonWebKey, sig: string, data: string) {
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    await signKey(jwk),
    unb64(sig),
    enc.encode(data),
  );
}
async function pair(name: "ECDSA" | "ECDH") {
  const keys = await crypto.subtle.generateKey(
    { name, namedCurve: "P-256" },
    true,
    name === "ECDSA" ? ["sign", "verify"] : ["deriveBits"],
  );
  return {
    private: await crypto.subtle.exportKey("jwk", keys.privateKey),
    public: await crypto.subtle.exportKey("jwk", keys.publicKey),
  };
}
export async function makeIdentity(name: string, avatar: string) {
  const root = await pair("ECDSA"),
    s = await pair("ECDSA"),
    e = await pair("ECDH");
  const i: Identity = {
    id: randomId(),
    name,
    avatar,
    rootPrivate: root.private,
    rootPublic: root.public,
    device: randomId(),
    label: navigator.userAgent.includes("Android")
      ? "Android"
      : navigator.userAgent.includes("iPhone")
        ? "iPhone"
        : "Браузер",
    signPrivate: s.private,
    signPublic: s.public,
    encPrivate: e.private,
    encPublic: e.public,
    certificate: "",
    registered: false,
  };
  i.certificate = await sign(
    root.private,
    certPayload(i.id, i.device, i.signPublic, i.encPublic),
  );
  return i;
}
export const publicDevice = (i: Identity) => ({
  id: i.device,
  user_id: i.id,
  label: i.label,
  sign_key: i.signPublic,
  enc_key: i.encPublic,
  certificate: i.certificate,
  created: Date.now(),
  revoked: 0,
});
export async function checkProfile(p: Profile) {
  for (const d of p.devices) {
    if (
      !(await verify(
        p.root_key,
        d.certificate,
        certPayload(p.id, d.id, d.sign_key, d.enc_key),
      ))
    )
      throw Error("Сертификат устройства недействителен");
  }
  const pinned = await store.get<string>("pin:" + p.id),
    finger = canonical(p.root_key);
  if (pinned && pinned !== finger)
    throw Error("Ключ контакта изменился. Сверьте отпечаток лично.");
  if (!pinned) await store.set("pin:" + p.id, finger);
}
export async function fingerprint(key: JsonWebKey) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(canonical(key)),
  );
  return Array.from(new Uint8Array(hash))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")
    .match(/.{1,4}/g)!
    .join(" ");
}
async function derive(priv: JsonWebKey, pub: JsonWebKey, salt: string) {
  const own = await crypto.subtle.importKey(
      "jwk",
      priv,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    ),
    peer = await crypto.subtle.importKey(
      "jwk",
      pub,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peer },
    own,
    256,
  );
  const hk = await crypto.subtle.importKey("raw", bits, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode(salt),
      info: enc.encode("Welcome envelope v1"),
    },
    hk,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(
  i: Identity,
  to: PublicDevice,
  payload: unknown,
  chat: string,
  id = randomId(),
): Promise<Envelope> {
  const ephemeral = await pair("ECDH");
  const header = {
    v: 1 as const,
    id,
    chat,
    from: i.id,
    device: i.device,
    to: to.id,
    time: Date.now(),
    ephemeral: ephemeral.public,
    iv: b64(crypto.getRandomValues(new Uint8Array(12))),
  };
  const key = await derive(ephemeral.private, to.enc_key, id);
  const ciphertext = b64(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: unb64(header.iv),
        additionalData: enc.encode(canonical(header)),
      },
      key,
      enc.encode(JSON.stringify(payload)),
    ),
  );
  const unsigned = { ...header, ciphertext };
  return {
    ...unsigned,
    signature: await sign(i.signPrivate, canonical(unsigned)),
  };
}
export async function open<T>(
  i: Identity,
  e: Envelope,
  p: Profile,
): Promise<T> {
  if (e.v !== 1 || e.to !== i.device || e.from !== p.id)
    throw Error("Неверный адресат");
  await checkProfile(p);
  const sender = p.devices.find((d) => d.id === e.device);
  if (!sender) throw Error("Устройство отправителя отозвано");
  const { signature, ...unsigned } = e;
  if (!(await verify(sender.sign_key, signature, canonical(unsigned))))
    throw Error("Неверная подпись");
  const { ciphertext, ...header } = unsigned;
  const key = await derive(i.encPrivate, e.ephemeral, e.id);
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: unb64(e.iv),
          additionalData: enc.encode(canonical(header)),
        },
        key,
        unb64(ciphertext),
      ),
    ),
  );
}
export async function encryptFile(file: Blob) {
  const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    ),
    iv = crypto.getRandomValues(new Uint8Array(12));
  return {
    blob: await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      await file.arrayBuffer(),
    ),
    key: b64(await crypto.subtle.exportKey("raw", key)),
    iv: b64(iv),
  };
}
export async function decryptFile(blob: ArrayBuffer, key: string, iv: string) {
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) },
    await crypto.subtle.importKey("raw", unb64(key), "AES-GCM", false, [
      "decrypt",
    ]),
    blob,
  );
}
export async function exportRecovery(i: Identity) {
  const key = crypto.getRandomValues(new Uint8Array(32)),
    iv = crypto.getRandomValues(new Uint8Array(12)),
    aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
      "encrypt",
    ]);
  return {
    key: b64(key),
    file: JSON.stringify({
      v: 1,
      iv: b64(iv),
      data: b64(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          aes,
          enc.encode(JSON.stringify(i)),
        ),
      ),
    }),
  };
}
export const recoveryPhrase = (key: string) =>
  entropyToMnemonic(unb64(key), wordlist);
export const recoveryKeyFromInput = (value: string) =>
  value.trim().includes(" ")
    ? b64(mnemonicToEntropy(value.trim().toLowerCase(), wordlist))
    : value.trim();
export async function importRecovery(
  file: string,
  key: string,
): Promise<Identity> {
  const f = JSON.parse(file);
  if (f.v !== 1) throw Error("Неизвестный recovery формат");
  const aes = await crypto.subtle.importKey(
    "raw",
    unb64(recoveryKeyFromInput(key)),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: unb64(f.iv) },
        aes,
        unb64(f.data),
      ),
    ),
  );
}
export async function pairingDraft() {
  const s = await pair("ECDSA"),
    e = await pair("ECDH");
  return {
    id: randomId(),
    label: navigator.userAgent.includes("Android") ? "Android" : "Браузер",
    signPrivate: s.private,
    sign_key: s.public,
    encPrivate: e.private,
    enc_key: e.public,
    nonce: randomId(),
    expires: Date.now() + 600000,
  };
}

export async function recoveredDevice(i: Identity): Promise<Identity> {
  if (!i.rootPrivate.d)
    throw Error(
      "Для восстановления нужен recovery-файл исходного устройства с root-ключом",
    );
  const s = await pair("ECDSA"),
    e = await pair("ECDH");
  const next = {
    ...i,
    device: randomId(),
    label: "Восстановленный браузер",
    signPrivate: s.private,
    signPublic: s.public,
    encPrivate: e.private,
    encPublic: e.public,
    certificate: "",
    registered: true,
  };
  next.certificate = await sign(
    i.rootPrivate,
    certPayload(i.id, next.device, next.signPublic, next.encPublic),
  );
  return next;
}
