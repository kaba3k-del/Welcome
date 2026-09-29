# Security model and release limitations

This release is an engineering baseline, **not an audited production messenger**. Do not claim Signal-grade security. Commission protocol/security review before handling sensitive real-world traffic.

## Implemented

- Each device has P-256 signing and ECDH keys; root ECDSA authority certifies the device public keys.
- AES-256-GCM envelopes bind routing metadata as additional authenticated data. Per-envelope ephemeral ECDH + HKDF-SHA256 derives keys; recipient private key decrypts.
- Sender ECDSA signatures are checked before decryption. Root certificates and local TOFU key pins reject changed roots. Users can compare SHA-256 fingerprints out of band.
- Attachments use independent random AES keys and 96-bit IVs, encrypted before upload. R2 only receives ciphertext. File names, MIME types and keys travel inside message envelopes.
- Signed HTTP requests bind method, full path/query, timestamp, single-use nonce and body digest. Revoked devices cannot authenticate. WebSocket upgrades use single-use 30-second tickets.
- A receiver ACKs only after decrypting/authenticating and persisting the event. Duplicate event IDs are ignored.
- Contact acceptance, chat membership and blocking guard routes. Rate limits, request-size limits, API no-store and CSP are present.

## Explicit limitations

- No Double Ratchet, X3DH, MLS, post-compromise security or recipient-side forward secrecy. Compromise of a recipient's long-term ECDH key can decrypt captured historical envelopes. Adding ephemeral sender keys does not fix this.
- This uses a custom application envelope and TOFU directory, not a standardized audited messaging protocol. The server can substitute a root key on first lookup. Fingerprint verification is needed for meaningful peer authenticity.
- Local private key JWKs are exportable and stored in IndexedDB; XSS, compromised origin/dependencies, malicious extensions or local browser access can steal them. No claim of secure enclave protection or encrypted history at rest.
- Metadata (profile, group title/membership, routing, time, size, IP) is visible to infrastructure. Avatars are emoji rather than private uploaded photos in this release.
- Group encryption is per-device fanout; owner/admin/member permissions exist; no efficient group ratchet is implemented.
- Recovery export retains the root authority. Restore certifies a new independent device key and does not recover chat history. A leaked root backup can authorize new devices even when an old device has been revoked. Root rotation is not implemented. Treat the recovery key as highly sensitive. The 24-word recovery phrase uses BIP39 encoding of the same random 256-bit key.
- Pairing adds distinct independent keys. UI supports camera/image QR scanning and copy/paste. Root-authority transfer to paired devices is not implemented. Pairing approval must happen on the root-holding device. New devices receive future messages, not historical messages.
- Presence is transient; it is not a reliable “last seen.” No push or background incoming calls. Browser permissions and capability support constrain speaker routing, PiP, camera selection and screen sharing.
- WebRTC encrypts media via DTLS-SRTP. Signaling envelopes authenticate offer/answer. ICE can expose network addresses to accepted peers; TURN relays can observe traffic metadata.
- Disappearing messages expire from UI; expired event records are purged on startup and periodic sync. Copies exported or held in memory are not securely erased. Mailbox and R2 expiration is 30 days independent of UI duration. No secure erasure or screenshot prevention claim.
- Worker cannot mathematically prove an uploaded byte stream is ciphertext; frontend encrypts it by construction. Upload endpoint never accepts an image/multipart MIME path.
- File encryption/decryption is whole-file and capped at 24 MiB in UI/25 MiB encrypted at backend; not streaming.
- Device revocation cannot erase keys/content already copied. Local outbox persistence supports reconnect retry but simultaneous tabs are not coordinated by a cross-tab leader.
- TURN usage, R2 operations/storage and Cloudflare plan limits can cost money. No promise of unlimited free service.

## Operational requirements

Use HTTPS, exact APP_ORIGIN, separate dev/prod databases and private R2 buckets. Keep TURN token exclusively in Worker secrets. Restrict CSP connect-src to your actual API/WSS origin for production. Set per-account quotas/abuse protections and monitoring before public launch. Maintain a responsible disclosure address and dependency updates. Do not log request bodies, recovery exports or private keys.
