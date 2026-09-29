import { b64, enc, randomId } from "../../shared/protocol";
import { sign, type Identity } from "./crypto";
export const API = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
export class Client {
  constructor(public identity: Identity) {}
  async request<T = any>(
    path: string,
    method = "GET",
    data?: unknown,
    raw = false,
  ): Promise<T> {
    const body =
      data === undefined
        ? undefined
        : raw
          ? (data as ArrayBuffer)
          : enc.encode(JSON.stringify(data));
    const time = String(Date.now()),
      nonce = randomId();
    const hash = b64(
      await crypto.subtle.digest("SHA-256", body || new ArrayBuffer(0)),
    );
    const signature = await sign(
      this.identity.signPrivate,
      [method, path, time, nonce, hash].join("\n"),
    );
    const r = await fetch(API + path, {
      method,
      headers: {
        "X-Device": this.identity.device,
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
      body: body as BodyInit,
    });
    if (!r.ok) {
      let message = "Запрос не выполнен";
      try {
        message = (await r.json()).error;
      } catch {}
      throw Error(message);
    }
    return (
      r.headers.get("Content-Type")?.includes("application/json")
        ? await r.json()
        : await r.arrayBuffer()
    ) as T;
  }
  async register() {
    const i = this.identity;
    const r = await fetch(API + "/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: i.id,
        name: i.name,
        avatar: i.avatar,
        root_key: i.rootPublic,
        device: {
          id: i.device,
          label: i.label,
          sign_key: i.signPublic,
          enc_key: i.encPublic,
          certificate: i.certificate,
        },
      }),
    });
    if (!r.ok) throw Error((await r.json()).error);
    return r.json();
  }
  async socket() {
    const { ticket } = await this.request("/api/ticket", "POST", {});
    return new WebSocket(
      (API || location.origin).replace(/^http/, "ws") +
        "/api/ws?ticket=" +
        ticket,
    );
  }
}
