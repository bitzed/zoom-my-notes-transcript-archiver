// logger.js — structured logging (JSON Lines).
//
// This PoC treats logs as the deliverable, so this module is deliberately strict:
//   - Every structured log line is one JSON object with { ts, level, event, detail }.
//   - The same line is also printed to the console in a human-readable form.
//   - Raw Zoom WebSocket messages are written verbatim to raw-events.jsonl.
//
// Secrets policy:
//   - refresh_token / access_token / client_secret values must NEVER be logged.
//     Use redactToken() for URLs and log lengths only (e.g. "xxxx...(len=64)").
//   - BUT event data received from Zoom is recorded in full, unmasked (goals G2/G3).
import fs from "node:fs";
import path from "node:path";

const LOG_DIR = path.resolve("logs");
const APP_LOG = path.join(LOG_DIR, "app.jsonl");
const RAW_LOG = path.join(LOG_DIR, "raw-events.jsonl");

// Ensure the logs directory exists before anything tries to write to it.
fs.mkdirSync(LOG_DIR, { recursive: true });

// Emoji hints per log-event family, purely for console readability.
function iconFor(event) {
  if (event.startsWith("ws.")) return "🔌";
  if (event.startsWith("event.")) return "📩";
  if (event.startsWith("token.")) return "🔑";
  if (event.startsWith("api.")) return "🌐";
  if (event.startsWith("store.")) return "💾";
  if (event.startsWith("oauth.")) return "🙋";
  return "•";
}

/**
 * Write one structured log line to app.jsonl and echo a readable form to console.
 * @param {string} event  log kind, e.g. "event.received"
 * @param {object} detail arbitrary structured payload
 * @param {"debug"|"info"|"warn"|"error"} [level]
 * @param {{console?: boolean}} [opts] set console:false to keep a line file-only
 *   (used for routine noise like heartbeats — still recorded, just not printed).
 */
export function log(event, detail = {}, level = "info", opts = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    detail,
  };

  // Append as a single JSON line. Synchronous append keeps ordering simple and
  // guarantees the line is flushed even if the process crashes right after.
  try {
    fs.appendFileSync(APP_LOG, JSON.stringify(line) + "\n");
  } catch (err) {
    // Never throw from the logger; fall back to console so we still see it.
    console.error("logger failed to write app.jsonl:", err);
  }

  if (opts.console === false) return; // file-only: keep the console quiet

  const consoleFn =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  consoleFn(`${iconFor(event)} [${line.ts}] ${event}`, detail);
}

/**
 * Append a raw WebSocket message to raw-events.jsonl, unmodified.
 * We wrap it with a receive timestamp but keep the original string intact.
 * @param {string} raw the exact string received from the socket
 */
export function appendRawEvent(raw) {
  const line = JSON.stringify({ ts: new Date().toISOString(), raw }) + "\n";
  try {
    fs.appendFileSync(RAW_LOG, line);
  } catch (err) {
    console.error("logger failed to write raw-events.jsonl:", err);
  }
}

/**
 * Redact an access_token query parameter in a URL so it is safe to log.
 * Leaves everything else (including subscriptionId) intact.
 */
export function redactToken(url) {
  return String(url).replace(/(access_token=)[^&]+/i, (_, p1) => `${p1}xxxx...(redacted)`);
}
