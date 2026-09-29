# Welcome

One monorepo for a mobile-first encrypted web messenger: React/Vite/TypeScript frontend on Cloudflare Pages, Worker API, D1, per-user hibernating Durable Objects, private R2 and WebRTC. Graphite surfaces and restrained blue accent follow the supplied reference. No fake sample chats or simulated remote replies.

**Release status:** working implementation baseline with documented limitations; not a complete audited production release. Read [docs/SECURITY.md](docs/SECURITY.md) before deployment. UI truthfully identifies missing push/history migration/audited ratchet functionality.

## Structure

```
web/src/             React UI, IndexedDB, crypto, API, messaging, WebRTC
web/public/          PWA manifest, service worker, Pages routing/headers
worker/src/          signed API, mailbox, authorization, per-user Durable Object
worker/migrations/   complete D1 schema
shared/              typed envelopes/events and canonical serialization
tests/               crypto tests, simulated DOM UI test and live Worker integration tests
docs/                architecture, security and manual acceptance checks
.github/workflows/   CI build/typecheck/tests
```

## Local run (Node 22+)

```sh
npm ci
cp web/.env.example web/.env.local
cp worker/.dev.vars.example worker/.dev.vars
npm run migrate:local -w worker
npm run dev:worker
# second terminal:
npm run dev
```

Open http://localhost:5173 in two different browser profiles/incognito windows. Create a separate identity in each. Share the /u/ link; request a contact on A, accept on B, then use “Написать.” The frontend attempts registration when the server is reachable and persists an outbox for reconnect.

A phone accessing a LAN HTTP address cannot use microphone/Web Crypto/service worker reliably: use HTTPS or local localhost testing. Development API URL must be reachable from the phone.

## GitHub

Create a repository and push this complete folder. No GitHub/Cloudflare secrets are bundled.

```sh
git init
git add .
git commit -m "Initial Welcome messenger"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/welcome.git
git push -u origin main
```

## Cloudflare provision

```sh
npx wrangler login
npx wrangler d1 create welcome
npx wrangler r2 bucket create welcome-encrypted-files
```

Put the real D1 database_id in worker/wrangler.toml. Set APP_ORIGIN to your exact Pages HTTPS origin. R2 remains private; never enable a public bucket endpoint.

```sh
npm run migrate:remote -w worker
npm run deploy -w worker
```

The deployed Worker URL is the API URL. Configure Cloudflare Pages Git integration:

- root directory: repository root
- build command: `npm ci && npm run build -w web`
- output directory: `web/dist`
- environment variable: `VITE_API_URL=https://welcome-api.YOUR_SUBDOMAIN.workers.dev`

Use the exact final Pages/custom origin for APP_ORIGIN, then redeploy Worker. SPA redirects preserve /u/<id> navigation. Preview deployments need a separate configured API origin/environment; arbitrary preview origins are not allowed.

## TURN

Create a Cloudflare Realtime TURN key. Set Worker secrets from the worker directory:

```sh
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_TOKEN
```

The /api/ice route generates short-lived credentials server-side. Without these secrets the app clearly reports STUN-only availability. TURN/R2/DO usage may exceed free allowances; inspect your account billing/limits. No SFU is used. Calls are 1:1 only.

## Checks

```sh
npm run check
# optional live backend integration (Worker must run):
npm run test:integration
```

For UI and real-media checks follow docs/ACCEPTANCE.md. DOM testing verifies interactions without visual layout. Local builds do not establish real production connectivity or prove security. CI does not deploy secrets automatically.

## Feature coverage

Implemented paths: identity without phone/email, profile link/QR, approved contacts/blocking, direct/group chats, per-device encryption, ciphertext mailbox/ACK/outbox, R2 encrypted attachments, voice recording/playback, reply/edit/delete/reaction/forward/pin, local search, media per chat, expiration filtering, transient typing/presence, delivery/read receipts, 1:1 media calls and call controls, device certificates/revocation, camera/image QR pairing, BIP39 recovery key/phrase export/import, mobile/desktop layout, PWA shell cache.

Limits: no historical device sync, group calls, push notifications, streaming large-file transfer, audited ratchet, physical secure erasure, offline full-text history encryption, or app-store/native background integration. These are real remaining work, not decorative controls.
