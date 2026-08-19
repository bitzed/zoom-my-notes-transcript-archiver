// storage.js — save the raw API response as-is (no transformation).
//
// The filename uses the note_id we already extracted from the event payload,
// NOT a field guessed out of the API response (whose shape is still unverified,
// goal G3). Content is written verbatim.
//
// Idempotency: if the file already exists we skip (do not overwrite) and log it,
// so re-delivered events are observable.
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { log } from "../logger.js";

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist a fetched note to data/transcripts/{email}/{noteId}.json.
 * @param {string} email owner email (already lowercased)
 * @param {string} noteId note id from the event payload
 * @param {object} note raw API response JSON
 */
export async function storeTranscript(email, noteId, note) {
  const dir = path.join(path.resolve(config.dataDir), "transcripts", email);
  const file = path.join(dir, `${noteId}.json`);
  await fs.mkdir(dir, { recursive: true });

  if (await fileExists(file)) {
    log("store.skipped_duplicate", { email, noteId, file });
    return;
  }

  await fs.writeFile(file, JSON.stringify(note, null, 2));
  log("store.saved", { email, noteId, file });
}
