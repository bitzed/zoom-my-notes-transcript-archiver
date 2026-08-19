// oauth.js — App B (General App, Public Client / PKCE) helpers.
//
// Public client => NO client_secret, NO Basic auth. The token endpoint receives
// client_id in the body plus the PKCE code_verifier (RFC 7636). This is the
// RFC 8252 native-app flow, so a loopback (127.0.0.1) redirect and a local HTTP
// server are all we need — no public endpoint / ngrok.
//
// Flow: generatePkce -> buildAuthorizeUrl(state, challenge) -> user consents
//   -> exchangeCode(code, verifier) -> resolveUserEmail -> persist refresh token.
import crypto from "node:crypto";
import { config } from "../config.js";

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a PKCE verifier/challenge pair (S256). */
export function generatePkce() {
  const verifier = base64url(crypto.randomBytes(32)); // 43-char high-entropy string
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Build the consent URL. `state` is echoed back for CSRF checks; `challenge`
 * binds this request to the verifier we keep server-side.
 */
export function buildAuthorizeUrl(state, challenge) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.oauthClientId,
    redirect_uri: config.oauthRedirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://zoom.us/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange the authorization code for tokens (public client).
 * No Authorization header — everything goes in the form body.
 */
export async function exchangeCode(code, codeVerifier) {
  const resp = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.oauthClientId,
      redirect_uri: config.oauthRedirectUri,
      code_verifier: codeVerifier,
    }),
  });
  if (!resp.ok) {
    throw new Error(`token exchange failed: ${resp.status} ${await resp.text()}`);
  }
  return await resp.json(); // { access_token, refresh_token, expires_in, ... }
}

/** Identify which user a token belongs to via /users/me. Returns lowercased email. */
export async function resolveUserEmail(accessToken) {
  const resp = await fetch("https://api.zoom.us/v2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`/users/me failed: ${resp.status} ${await resp.text()}`);
  }
  const json = await resp.json();
  if (!json.email) throw new Error("/users/me returned no email");
  return json.email.toLowerCase();
}
