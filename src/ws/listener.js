// listener.js — the entry point for event reception.
//
// Steps:
//   1. Get an access token via the client_credentials grant (Basic auth with the
//      S2S client id/secret; NO account_id). Token lives ~1 hour.
//   2. Connect to {WS_URL}?subscriptionId=...&access_token=...
//   3. Every 30s send {"module":"heartbeat"} (mandatory; Zoom drops idle conns).
//   4. On disconnect, reconnect with exponential backoff (1s -> 2s -> ... -> 60s),
//      re-fetching the token each time.
//   5. Every received message is written verbatim to raw-events.jsonl and passed
//      to router.js.
import WebSocket from "ws";
import { config } from "../config.js";
import { log, appendRawEvent, redactToken } from "../logger.js";
import { routeMessage } from "./router.js";

const HEARTBEAT_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

let ws = null;
let heartbeatTimer = null;
let reconnectDelay = 1_000;

function base64(s) {
  return Buffer.from(s).toString("base64");
}

// Obtain a WebSocket access token via client_credentials.
// NOTE: this is NOT the account_credentials grant used for normal S2S API calls.
async function getS2SAccessToken() {
  const resp = await fetch("https://zoom.us/oauth/token?grant_type=client_credentials", {
    method: "POST",
    headers: {
      Authorization: "Basic " + base64(`${config.s2sClientId}:${config.s2sClientSecret}`),
    },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`client_credentials token failed: ${resp.status} ${body}`);
  }
  const json = await resp.json();
  return json.access_token;
}

function clearHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function scheduleReconnect() {
  clearHeartbeat();
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_BACKOFF_MS);
  log("ws.reconnect", { inMs: delay });
  setTimeout(() => {
    connect().catch((err) => {
      log("ws.error", { stage: "reconnect", error: String(err?.stack || err) }, "error");
      scheduleReconnect();
    });
  }, delay);
}

export async function connect() {
  // Fresh token on every (re)connect — tokens expire and reconnects may be late.
  const token = await getS2SAccessToken();
  const url = `${config.wsUrl}?subscriptionId=${config.wsSubscriptionId}&access_token=${token}`;
  log("ws.connecting", { url: redactToken(url) });

  ws = new WebSocket(url);

  ws.on("open", () => {
    log("ws.open", {});
    // Reset backoff only after a successful open.
    reconnectDelay = 1_000;

    // Heartbeat is mandatory: Zoom closes idle connections.
    clearHeartbeat();
    heartbeatTimer = setInterval(() => {
      try {
        ws.send(JSON.stringify({ module: "heartbeat" }));
        // Keep a file-only record; heartbeats are routine, so stay off-console.
        log("ws.heartbeat", { direction: "sent" }, "debug", { console: false });
      } catch (err) {
        log("ws.error", { stage: "heartbeat_send", error: String(err) }, "error");
      }
    }, HEARTBEAT_MS);
  });

  ws.on("message", (data) => {
    const raw = data.toString();
    appendRawEvent(raw); // raw-events.jsonl, unmodified
    log("ws.raw_message", { raw });
    try {
      routeMessage(raw);
    } catch (err) {
      // routeMessage should handle its own errors, but never let one escape.
      log("event.parse_failed", { stage: "listener", raw, error: String(err?.stack || err) }, "error");
    }
  });

  ws.on("close", (code, reason) => {
    log("ws.close", { code, reason: reason?.toString() });
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    // Let the close handler drive reconnection; just record here.
    log("ws.error", { error: String(err?.message || err) }, "error");
  });
}

export function startListener() {
  connect().catch((err) => {
    log("ws.error", { stage: "initial", error: String(err?.stack || err) }, "error");
    scheduleReconnect();
  });
}
