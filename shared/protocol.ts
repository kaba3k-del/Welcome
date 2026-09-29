export type PublicDevice = {
  id: string;
  user_id: string;
  label: string;
  sign_key: JsonWebKey;
  enc_key: JsonWebKey;
  certificate: string;
  created: number;
  revoked: number;
};
export type Profile = {
  id: string;
  name: string;
  avatar: string;
  root_key: JsonWebKey;
  devices: PublicDevice[];
  role?: "owner" | "admin" | "member";
};
export type Chat = {
  id: string;
  kind: "direct" | "group";
  title: string;
  owner: string;
  members: Profile[];
};
export type Attachment = {
  id: string;
  key: string;
  iv: string;
  name: string;
  type: string;
  size: number;
};
export type Event = {
  id: string;
  chat: string;
  from: string;
  device: string;
  time: number;
  type: "message" | "edit" | "delete" | "reaction" | "pin" | "receipt";
  text?: string;
  target?: string;
  emoji?: string;
  reply?: string;
  attachment?: Attachment;
  expires?: number;
  read?: boolean;
  forwarded?: boolean;
  active?: boolean;
};
export type Envelope = {
  v: 1;
  id: string;
  chat: string;
  from: string;
  device: string;
  to: string;
  time: number;
  ephemeral: JsonWebKey;
  iv: string;
  ciphertext: string;
  signature: string;
};
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value as object)
      .sort()
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonical((value as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}
export const enc = new TextEncoder();
export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const a = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < a.length; i += 8192)
    s += String.fromCharCode(...a.subarray(i, i + 8192));
  return btoa(s);
}
export function unb64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
export const randomId = () =>
  b64(crypto.getRandomValues(new Uint8Array(18)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
export const certPayload = (
  user: string,
  id: string,
  sign: JsonWebKey,
  key: JsonWebKey,
) => canonical({ user, id, sign, key });
