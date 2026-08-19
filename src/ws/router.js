// router.js — unwrap the WebSocket envelope and dispatch My Notes events.
//
// Envelope (confirmed on the wire): event frames arrive as
//   {"module":"message","content":"<stringified webhook JSON>","header":{...}}
// i.e. the real event is DOUBLE-encoded inside `content`. Control frames
// (heartbeat / build_connection acks) use module !== "message" and carry a
// plain status string in `content`.
//
// My Notes events seen firing: my_notes.note_generated (on note creation) and
// my_notes.transcript_generated (when the transcript is ready). Only the latter
// is fetched: note_generated can arrive before the transcript exists, and
// storage dedups by note_id, so fetching on it would store a transcript-less
// note and block the good copy. (my_notes.note_completed is offered in the
// subscription UI but was never observed firing.)
import { log } from "../logger.js";
import { processNoteEvent } from "../runtime/processor.js";

const FETCH_EVENT = "my_notes.transcript_generated";

/**
 * Route a single raw WebSocket message string.
 * @param {string} raw the exact string received from the socket
 */
export function routeMessage(raw) {
  let outer;
  try {
    outer = JSON.parse(raw);
  } catch (e) {
    log("event.parse_failed", { raw, stage: "outer", error: String(e) }, "error");
    return;
  }

  // Control frames (heartbeat / build_connection acks): keep a quiet, file-only
  // record so the console stays clean.
  if (outer.module && outer.module !== "message") {
    log(
      "ws.control",
      { module: outer.module, success: outer.success, content: outer.content },
      "debug",
      { console: false },
    );
    return;
  }

  // Event frame: unwrap the double-encoded JSON in `content`.
  let msg = outer;
  if (typeof outer.content === "string") {
    try {
      msg = JSON.parse(outer.content);
    } catch (e) {
      log("event.parse_failed", { raw, stage: "content", error: String(e) }, "error");
      return;
    }
  }

  if (!msg.event) {
    log("event.unknown", { raw, parsed: msg, reason: "no event field" }, "warn");
    return;
  }

  // Record every parsed event in full (unmasked).
  log("event.received", { event: msg.event, payload: msg.payload });

  // Fetch only when the transcript is ready. Other My Notes events (e.g.
  // note_generated) are already recorded above and need no further action.
  if (msg.event === FETCH_EVENT) {
    processNoteEvent(msg.event, msg.payload).catch((err) => {
      log("event.parse_failed", {
        stage: "router.dispatch",
        event: msg.event,
        error: String(err?.stack || err),
      }, "error");
    });
  }
}
