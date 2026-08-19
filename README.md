# Zoom My Notes → Local Transcript Archiver (PoC)

**English** | [日本語版 (Japanese)](./README.ja.md)

> ⚠️ The following sample application is a personal, open-source project shared by the app creator and not an officially supported Zoom Communications, Inc. sample application. Zoom Communications, Inc., its employees and affiliates are not responsible for the use and maintenance of this application. Please use this sample application for inspiration, exploration and experimentation at your own risk and enjoyment. You may reach out to the app creator and broader Zoom Developer community on https://devforum.zoom.us/ for technical discussion and assistance, but understand there is no service level agreement support for this application. Thank you and happy coding!

> ⚠️ このサンプルのアプリケーションは、Zoom Communications, Inc.の公式にサポートされているものではなく、アプリ作成者が個人的に公開しているオープンソースプロジェクトです。Zoom Communications, Inc.とその従業員、および関連会社は、本アプリケーションの使用や保守について責任を負いません。このサンプルアプリケーションは、あくまでもインスピレーション、探求、実験のためのものとして、ご自身の責任と楽しみの範囲でご活用ください。技術的な議論やサポートが必要な場合は、アプリ作成者やZoom開発者コミュニティ（ https://devforum.zoom.us/ ）にご連絡いただけますが、このアプリケーションにはサービスレベル契約に基づくサポートがないことをご理解ください。

Subscribe to Zoom **My Notes** events over a **WebSocket** connection, and when a
note's transcript becomes ready, fetch it with the note owner's OAuth token and
save it to disk as JSON.

This is a proof-of-concept. It stores everything locally (no cloud) and keeps
verbose logs. The local loopback + PKCE onboarding here is a **testing
convenience** — a real deployment needs server-side OAuth and an allowlist. See
[From PoC to production](#from-poc-to-production).

---

## How it works

```
Zoom  ──(WebSocket: my_notes.* events)──▶  listener ─▶ router ─▶ processor
                                                                    │
                              refresh user's access token (PKCE) ◀──┤
                              GET /my_notes/notes/{id}/content   ────┤
                              save raw JSON to data/transcripts/  ◀──┘
```

Two separate Zoom apps are required, because the responsibilities are
asymmetric:

| | **App A** — event reception | **App B** — data retrieval |
| --- | --- | --- |
| Type | Server-to-Server OAuth | General App (**Public Client / PKCE**) |
| Grant | `client_credentials` | Authorization Code + PKCE |
| Purpose | Open the WebSocket, receive events | Fetch each user's note content |
| Token | account-level access token | **per-user** refresh token |
| Secret | Client ID **+ Secret** | **Public Client ID only (no secret)** |

Why two apps: My Notes content can only be read with the **owner's own
User-managed OAuth token** — an Admin/S2S token cannot fetch it. But the event
subscription is account-level and uses the S2S app. That split is the core of
the design.

---

## Prerequisites

- **Node.js 18+** (developed on Node 22). No other runtime is needed.
- Two apps created on the [Zoom App Marketplace](https://marketplace.zoom.us/).
- Because the OAuth redirect is a **loopback address** (`127.0.0.1`), you do
  **not** need ngrok or any public endpoint.

---

## 1. Create the two Zoom apps

### App A — Server-to-Server OAuth (WebSocket subscription)

1. Marketplace → **Develop → Build App → Server-to-Server OAuth**.
2. Copy the **Client ID** and **Client Secret**.
3. Open **Feature → Event Subscription**, add a subscription of type
   **WebSocket**, and subscribe to the My Notes events:
   - *My Note generated*
   - *My Note transcript generated*
   - *Note completed*
4. Copy the **Subscription ID** shown for that WebSocket subscription.

> The WebSocket token is obtained with the `client_credentials` grant (Basic
> auth with Client ID/Secret). No `account_id` is required for this grant.

### App B — General App (Public Client / PKCE, per-user OAuth)

1. Marketplace → **Develop → Build App → General App**.
2. Under **OAuth**, enable the **Public Client ID** (PKCE). A public client has
   **no client secret** — the token endpoint is called with the client id in the
   request body plus a PKCE `code_verifier`.
3. Set the **OAuth Redirect URL** to a loopback address, per RFC 8252:
   ```
   http://127.0.0.1/callback
   ```
   The port may be omitted at registration; loopback redirects match on
   host/path and allow any runtime port, so the app appends the live port
   (e.g. `http://127.0.0.1:3000/callback`) automatically.
4. Add the scopes:
   - `my_notes:read:content`
   - `docs:read:list_children`
5. Copy the **Public Client ID**.

---

## 2. Configure environment

Copy the template and fill in the values:

```bash
cp .env.example .env
```

```ini
# --- App A: S2S OAuth (WebSocket subscription) ---
S2S_CLIENT_ID=            # App A Client ID
S2S_CLIENT_SECRET=        # App A Client Secret
WS_SUBSCRIPTION_ID=       # App A WebSocket Subscription ID
WS_URL=wss://ws.zoom.us/ws

# --- App B: General App (Public Client / PKCE) ---
PUBLIC_CLIENT_ID=         # App B Public Client ID (NO secret)
OAUTH_REDIRECT_URI=http://127.0.0.1/callback

# --- Local ---
PORT=3000
DATA_DIR=./data
LOG_LEVEL=debug
```

---

## 3. Install & run

```bash
npm install
npm start
```

`npm start` launches the onboarding HTTP server (bound to `127.0.0.1`) and the
WebSocket listener together. On a healthy start you'll see `ws.open` in the
console; heartbeats are muted (they are still recorded in the log file).

---

## 4. Onboard the note owners

For **each** user whose notes you want to archive, open the connect URL in a
browser signed in as that user and grant consent:

```
http://127.0.0.1:3000/connect
```

> Use separate browser profiles / incognito windows to onboard multiple users.
> Use `127.0.0.1` (not `localhost`) so it resolves to the loopback the server is
> bound to.

After consent you'll get an "Onboarded" page, and `data/tokens.json` will have
an entry for that user's email.

## 5. Generate a note

In a Zoom meeting, create/complete **My Notes** as an onboarded user. When Zoom
emits `my_notes.transcript_generated`, the app refreshes that user's token,
fetches the note content, and writes the transcript to disk.

A successful run logs roughly:

```
event.received  (my_notes.transcript_generated)
token.refresh_start → token.rotated → token.refresh_ok
api.fetch_start → api.fetch_ok
store.saved
```

---

## Where things are saved

| Path | Contents |
| --- | --- |
| `data/tokens.json` | Per-user refresh tokens (rotated on every use). **Secret — gitignored.** |
| `data/transcripts/{email}/{note_id}.json` | The raw My Notes API response, saved as-is. Re-deliveries are skipped (never overwritten). |
| `logs/raw-events.jsonl` | Every raw WebSocket message, unmodified — one JSON per line. |
| `logs/app.jsonl` | Structured application logs (JSON Lines). Heartbeats/control frames are recorded here but kept off the console. |

A stored transcript looks like:

```json
{
  "note_id": "…",
  "note_name": "…'s notes 2026-08-19 13:19(GMT+9:00)",
  "note_url": "https://…docs.zoom.us/doc/…",
  "manual_note_content": "",
  "generated_note_content": null,
  "transcript": {
    "items": [
      { "text": "…", "start_time": "…", "end_time": "…", "speaker_id": "1" }
    ]
  }
}
```

---

## Observed behavior (findings)

- **Events that fire:** `my_notes.note_generated` (on note creation) and
  `my_notes.transcript_generated` (when the transcript is ready).
  `my_notes.note_completed` is offered in the subscription UI but was **not**
  observed firing.
- **Fetch trigger:** only `my_notes.transcript_generated`. `note_generated` can
  precede transcript availability; since storage dedups by `note_id`, fetching
  on it would save a transcript-less note and block the good copy.
- **WebSocket envelope:** events arrive double-encoded —
  `{"module":"message","content":"<stringified event JSON>"}`. Control frames
  use `module: "heartbeat"` / `module: "build_connection"`.
- **Event payload fields:** `operator` (owner email), `operator_id`,
  `account_id`, `object.note_id`, `object.note_link`, `object.meeting_id`,
  `event_ts`.

---

## Security notes

- App B is a **public client**: it uses PKCE and has **no secret**. Refresh
  tokens rotate on every use and are stored in plaintext (PoC only) under
  `data/` — never commit that directory.
- Secrets (client secret, access/refresh tokens) are **never** written to logs;
  only their lengths are recorded. Raw Zoom event data, however, is logged in
  full for observability.

---

## Token handling (refresh-token rotation)

Zoom **rotates the refresh token on every use**: each refresh call returns a
brand-new refresh token and immediately invalidates the previous one. Losing the
new value means the user can no longer be refreshed and must re-onboard, so the
app treats persistence as critical:

- The rotated `refresh_token` is written to `data/tokens.json` **atomically**
  (temp file → `rename`) and the refresh is not considered complete until that
  write succeeds.
- Refreshes for the same user are **serialized**, so two concurrent events can't
  each rotate the token and invalidate the other's result.
- A `400 invalid_grant` marks the user `needs_reonboarding` and is logged; the
  fix is to run `/connect` again for that user.

> **Not implemented (PoC):** a *keep-alive* that periodically refreshes idle
> tokens. Zoom expires a refresh token that goes unused for too long, so in a
> long-lived deployment you must refresh on a schedule. For this short-lived PoC,
> if a token expires from inactivity, just re-onboard the user.

---

## From PoC to production

The onboarding flow here uses a **public client (PKCE) with a loopback redirect
(`127.0.0.1`)**. That is ideal for a local PoC — no secret to manage and no
public endpoint required — but it is **only a testing convenience** and is
**not** how a deployed service should authenticate users. A production build
differs on several points:

- **Server-side OAuth with a confidential client.** Register App B as a
  confidential client (**Client ID + Client Secret**) and use a **server-hosted
  HTTPS redirect URL** (e.g. `https://your-service.example.com/callback`) instead
  of `http://127.0.0.1/callback`. The authorization-code exchange then runs on
  your server with Basic auth (`client_id:client_secret`), keeping the secret off
  end-user devices. Loopback/PKCE is for native/local apps; a hosted service
  should not rely on it.
- **Allowlist filtering.** Maintain an approved list of target users (e.g. a
  CSV/spreadsheet of coordinator emails). On each event, archive the transcript
  **only if `payload.operator` is on the list**, and drop everything else. This
  PoC intentionally skips the allowlist and archives every onboarded user.
- **Refresh-token keep-alive.** Refresh idle tokens on a schedule so they don't
  expire (see the section above).
- **Durable, secured storage.** Replace local disk with cloud object storage
  (e.g. GCS) and encrypt the stored refresh tokens at rest rather than keeping
  them in plaintext under `data/`.
