// processor.js — the main pipeline for a My Notes event.
//
// Order is strict:
//   1. Extract owner email + note_id from the payload. Do NOT guess: if the
//      documented fields are missing, record it (G3 evidence) and stop.
//   2. Check the user is onboarded; if not, log token.not_onboarded and stop.
//   3. Refresh the user's access token (rotation-safe).
//   4. Fetch the note content.
//   5. Store the raw response.
//
// Nothing here is fabricated or filled in on failure — we observe reality.
import { log } from "../logger.js";
import * as tokens from "../store/tokens.js";
import { refreshAccessToken } from "./zoomAuth.js";
import { fetchTranscript } from "./zoomApi.js";
import { storeTranscript } from "./storage.js";

/**
 * @param {string} eventName e.g. "my_notes.note_generated"
 * @param {object} payload the event payload (shape observed, not assumed)
 */
export async function processNoteEvent(eventName, payload) {
  // Documented shape: payload.operator (email), payload.object.note_id.
  const email = (payload?.operator || "").toLowerCase();
  const noteId = payload?.object?.note_id;

  if (!email || !noteId) {
    log(
      "event.parse_failed",
      {
        stage: "processor",
        event: eventName,
        payload,
        reason: "missing operator or object.note_id",
      },
      "error",
    );
    return;
  }

  // Only users who completed OAuth onboarding can be fetched.
  if (!(await tokens.has(email))) {
    log("token.not_onboarded", { email, event: eventName, noteId }, "warn");
    return;
  }

  try {
    const accessToken = await refreshAccessToken(email);

    log("api.fetch_start", { email, noteId });
    const note = await fetchTranscript(noteId, accessToken);
    log("api.fetch_ok", {
      email,
      noteId,
      hasTranscript: Boolean(note?.transcript),
      itemCount: note?.transcript?.items?.length ?? null,
    });

    await storeTranscript(email, noteId, note);
  } catch (err) {
    // Never swallow: record the full error. The step-specific logs above
    // (token.refresh_failed / api.fetch_failed) already captured detail.
    log("event.parse_failed", {
      stage: "processor.pipeline",
      event: eventName,
      email,
      noteId,
      error: String(err?.stack || err),
    }, "error");
  }
}
