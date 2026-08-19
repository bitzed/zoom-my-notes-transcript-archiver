// config.js — load & validate environment variables.
// Fail fast: if a required value is missing, we want to know at startup,
// not halfway through an OAuth callback.
import "dotenv/config";

function required(name, ...aliases) {
  for (const key of [name, ...aliases]) {
    const value = process.env[key];
    if (value && value.trim() !== "") return value.trim();
  }
  const tried = [name, ...aliases].join(" / ");
  throw new Error(`Missing required env var: ${tried}`);
}

function optional(name, fallback) {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

// Loopback (RFC 8252) redirects register without a fixed port (e.g.
// http://127.0.0.1/callback) and the client may use any port at request time.
// The browser must land back on THIS server, so inject the live port when the
// registered value has none. Host/path are preserved so the authorization
// server's loopback match (which ignores the port) still succeeds.
function withPort(uri, port) {
  const u = new URL(uri);
  if (!u.port) u.port = String(port);
  return u.toString();
}

const port = Number(optional("PORT", "3000"));

export const config = {
  // App A: S2S OAuth (WebSocket subscription) — confidential client.
  s2sClientId: required("S2S_CLIENT_ID"),
  s2sClientSecret: required("S2S_CLIENT_SECRET"),
  wsSubscriptionId: required("WS_SUBSCRIPTION_ID"),
  wsUrl: optional("WS_URL", "wss://ws.zoom.us/ws"),

  // App B: General App (Public Client / PKCE, per-user OAuth).
  // Public clients have NO secret; the token endpoint is called with client_id
  // in the body and PKCE code_verifier instead of Basic auth.
  oauthClientId: required("PUBLIC_CLIENT_ID", "OAUTH_CLIENT_ID"),
  oauthRedirectUri: withPort(optional("OAUTH_REDIRECT_URI", "http://127.0.0.1/callback"), port),

  // Local
  port,
  dataDir: optional("DATA_DIR", "./data"),
  logLevel: optional("LOG_LEVEL", "debug"),
};
