# Welcome architecture

Pages serves React/PWA. Worker validates signed, nonce-bound device requests. D1 contains public profiles/root keys, root-signed device certificates, contact approvals, group membership, replay nonces and per-device ciphertext mailboxes. R2 contains only application-encrypted octet streams. One hibernating Durable Object per user routes authenticated sockets; every cross-user event rechecks accepted contact / shared-group membership and device revocation. No global presence feed.

Clients store identities, private keys, local contacts, pinned public keys, event logs and settings in IndexedDB. Message envelopes use ephemeral P-256 ECDH, HKDF-SHA256 and AES-256-GCM with authenticated routing headers; ECDSA-P256 signs each envelope. This is an application envelope format built from standard primitives, not Signal/MLS. See SECURITY.md for its limits.

Direct and group messages fan out to every non-revoked recipient device including the sender's other devices. Ciphertext is persisted before delivery; receiver deletes only after authenticated decryption and durable local storage. Group membership changes affect future fanout. DataChannel opportunistically carries the same encrypted envelope; durable mailbox remains the fallback. Duplicate event IDs are ignored. Files have fresh AES keys and IVs; key/name/type are inside encrypted messages.

WebRTC media/signaling: signed device envelopes carry offer/answer/candidates over DO sockets. WebRTC performs ICE, prefers direct candidates, falls back to server-issued short-lived TURN credentials. DTLS-SRTP protects media. Calls do not work when the app is closed; no push service or background native ringing is claimed.

Root authority is held locally and can certify new independent device keys. QR pairing conveys only a temporary device invitation/public keys; existing trusted device signs the certificate after explicit approval. Recovery exports encrypt the root and current device material with a random 256-bit recovery key; restoration generates and certifies a fresh independent device. Device revocation removes API, websocket, mailbox and future envelope access; it cannot erase already downloaded content.

## Cloudflare references

- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- https://developers.cloudflare.com/realtime/turn/generate-credentials/
- https://developers.cloudflare.com/realtime/turn/faq/
