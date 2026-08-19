// server.js — minimal onboarding server. Two routes only.
//
//   GET /connect  -> issue state + PKCE, redirect to Zoom's consent screen
//   GET /callback -> receive code, exchange (with verifier), persist token
//
// Each user runs /connect once (use separate browsers/profiles for user A & B).
// Bound to 127.0.0.1 so the loopback redirect (RFC 8252) lands back here.
import express from "express";
import crypto from "node:crypto";
import { config } from "../config.js";
import { log } from "../logger.js";
import { buildAuthorizeUrl, exchangeCode, resolveUserEmail, generatePkce } from "./oauth.js";
import * as tokens from "../store/tokens.js";

// Pending flows we issued: state -> { verifier }. In-memory is fine for a
// short-lived local PoC.
const pending = new Map();

export function createServer() {
  const app = express();

  app.get("/connect", (_req, res) => {
    const state = crypto.randomUUID();
    const { verifier, challenge } = generatePkce();
    pending.set(state, { verifier });
    const url = buildAuthorizeUrl(state, challenge);
    log("oauth.connect_start", { state });
    res.redirect(url);
  });

  app.get("/callback", async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      log("oauth.callback_error", { error, description: req.query.error_description }, "error");
      return res.status(400).send(`Authorization error: ${error}`);
    }
    if (!state || !pending.has(state)) {
      log("oauth.callback_bad_state", { state }, "warn");
      return res.status(400).send("Invalid or unknown state");
    }
    const { verifier } = pending.get(state);
    pending.delete(state);

    if (!code) {
      log("oauth.callback_no_code", {}, "warn");
      return res.status(400).send("Missing code");
    }

    try {
      const token = await exchangeCode(code, verifier);
      const email = await resolveUserEmail(token.access_token);
      // Persist the refresh token atomically. status defaults to "active".
      await tokens.put(email, token.refresh_token);
      log("oauth.onboarded", { email, refreshTokenLen: String(token.refresh_token ?? "").length });
      res.send(
        `<h2>✅ Onboarded</h2><p>${email} is now connected. You can close this tab.</p>`,
      );
    } catch (err) {
      log("oauth.callback_failed", { error: String(err?.stack || err) }, "error");
      res.status(500).send("Onboarding failed — check the logs.");
    }
  });

  app.get("/", (_req, res) => {
    res.send('<h2>My Notes Archiver (PoC)</h2><p><a href="/connect">Connect a Zoom account</a></p>');
  });

  return app;
}

export function startServer() {
  const app = createServer();
  return new Promise((resolve) => {
    // Bind to loopback explicitly (RFC 8252 recommends 127.0.0.1 over localhost).
    const server = app.listen(config.port, "127.0.0.1", () => {
      log("oauth.server_listening", {
        port: config.port,
        connectUrl: `http://127.0.0.1:${config.port}/connect`,
        redirectUri: config.oauthRedirectUri,
      });
      resolve(server);
    });
  });
}
