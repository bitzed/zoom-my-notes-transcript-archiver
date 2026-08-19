// zoomApi.js — fetch My Notes content with the user's own access token.
//
// My Notes content is only retrievable with the owner's User-managed OAuth
// token (not Admin/S2S). The raw response is returned as-is; storage decides
// how to persist it.
import { log } from "../logger.js";

/**
 * Fetch a note's content including transcript.
 * @param {string} noteId
 * @param {string} accessToken the owner's access token
 * @returns {Promise<object>} raw API JSON response
 */
export async function fetchTranscript(noteId, accessToken) {
  const url = `https://api.zoom.us/v2/my_notes/notes/${encodeURIComponent(
    noteId,
  )}/content?include=transcript`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    const body = await resp.text();
    log("api.fetch_failed", { noteId, status: resp.status, body }, "error");
    throw new Error(`fetch failed: ${resp.status}`);
  }

  return await resp.json();
}
