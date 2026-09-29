# Validation record

Checked in the build environment on 2026-09-30.

## Passed

- React frontend TypeScript + Vite production build.
- Worker TypeScript check.
- Local D1 migration applied successfully.
- Simulated DOM UI test: onboarding, key generation, navigation to chats and settings.
- Five cryptographic tests: canonical serialization/binary encoding, encrypted envelope roundtrip plus tampering/wrong-recipient rejection, encrypted file roundtrip plus wrong-key/tampering rejection, recovery file + 24-word BIP39 roundtrip, distinct device keys after recovery.
- Live local Wrangler integration against D1/R2/Durable Objects: account creation without unique names, recipient-only contact acceptance, direct/group chat creation, encrypted mailbox receive/ACK deletion, nonmember send rejection, forged signatures, file access control and encrypted file byte roundtrip, membership removal, authenticated WebSocket ping, device certificate pairing and revocation, root recovery/new independent device, forged recovery rejection, nonce replay rejection, admin role restrictions and blocked-contact send rejection.

## Not verified

- An earlier escalated Chromium command was rejected by automatic approval review because it accessed the system Playwright directory. After user authorization, the available Cloud Chrome blocked both localhost and 127.0.0.1 (ERR_BLOCKED_BY_CLIENT). No visual browser QA or responsive screenshot verification is claimed.
- Real audio/video streams, camera/microphone permissions, NAT traversal, Cloudflare TURN, speaker output switching, screen sharing and PiP across actual mobile devices.
- Production Cloudflare deployment, custom domains, billing/quotas, performance under load, background behavior, external security audit.

The successful local backend integration does not replace these checks. Follow ACCEPTANCE.md before public use.
