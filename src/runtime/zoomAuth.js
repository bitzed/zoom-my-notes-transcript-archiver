// zoomAuth.js — refresh a user's access token (App B, User-managed OAuth).
//
// Refresh tokens rotate on every use: the response carries a NEW refresh_token
// and the old one is immediately invalid. So we MUST persist the new value
// before considering the refresh complete. Persistence failure = unrecoverable
// user (needs re-onboarding), so we never treat a refresh as done until the
// atomic write of tokens.json succeeds.
import { config } from "../config.js";
import { log } from "../logger.js";
import * as tokens from "../store/tokens.js";

// Serialize refreshes per email: two concurrent refreshes for the same user
// would each rotate the token and invalidate the other's result.
const inFlight = new Map(); // email -> Promise<string>

/**
 * Refresh and return a valid access token for the given user.
 * Side effect: persists the rotated refresh_token atomically.
 * @param {string} email
 * @returns {Promise<string>} access_token
 */
export function refreshAccessToken(email) {
  if (inFlight.has(email)) return inFlight.get(email);
  const p = doRefresh(email).finally(() => inFlight.delete(email));
  inFlight.set(email, p);
  return p;
}

async function doRefresh(email) {
  const entry = await tokens.get(email);
  if (!entry || !entry.refresh_token) {
    throw new Error(`no stored refresh_token for ${email}`);
  }

  log("token.refresh_start", { email });

  // Public client refresh: no Basic auth / no secret; client_id goes in the body
  // (RFC 6749 §6). NOTE: Zoom's public docs do not explicitly spell out the
  // public-client refresh shape, so this is the RFC-standard form — confirm
  // against the real response during testing.
  const resp = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: entry.refresh_token,
      client_id: config.oauthClientId,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    log("token.refresh_failed", { email, status: resp.status, body }, "error");
    // invalid_grant means the refresh token is dead -> user must re-onboard.
    if (resp.status === 400) {
      await tokens.markNeedsReonboarding(email);
    }
    throw new Error(`refresh failed for ${email}: ${resp.status}`);
  }

  const token = await resp.json();

  // Persist the rotated refresh_token FIRST. If this throws, the caller sees a
  // failure and we have not lost the (now-invalid) old token silently.
  await tokens.put(email, token.refresh_token);
  log("token.rotated", { email, tokenLen: String(token.refresh_token ?? "").length });
  log("token.refresh_ok", { email });

  return token.access_token;
}
