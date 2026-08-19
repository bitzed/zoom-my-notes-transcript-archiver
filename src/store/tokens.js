// tokens.js — read/write per-user refresh tokens in data/tokens.json.
//
// Refresh tokens rotate on every use: writing the new value is critical, and a
// botched write means the user must re-onboard. So every write is atomic
// (temp file -> rename) and all file access is serialized through a single
// in-process queue to avoid concurrent read-modify-write clobbering.
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const TOKENS_FILE = path.join(path.resolve(config.dataDir), "tokens.json");

// A simple promise chain acting as a global mutex for the tokens file.
// Every mutating operation loads fresh, mutates, and writes atomically while
// holding this lock, so no two writers interleave.
let queue = Promise.resolve();
function withLock(fn) {
  const run = queue.then(fn, fn);
  // Keep the chain alive even if fn rejects; swallow here, surface to caller.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function loadAll() {
  try {
    const text = await fs.readFile(TOKENS_FILE, "utf8");
    return JSON.parse(text);
  } catch (err) {
    if (err.code === "ENOENT") return {}; // first run: no file yet
    throw err;
  }
}

// Atomic write: write to a temp file in the same dir, then rename over the target.
async function writeAll(all) {
  await fs.mkdir(path.dirname(TOKENS_FILE), { recursive: true });
  const tmp = `${TOKENS_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(all, null, 2));
  await fs.rename(tmp, TOKENS_FILE);
}

/** Return the stored entry for an email, or undefined. */
export function get(email) {
  return withLock(async () => {
    const all = await loadAll();
    return all[email];
  });
}

/** Whether we have an entry for this email. */
export function has(email) {
  return withLock(async () => {
    const all = await loadAll();
    return Object.prototype.hasOwnProperty.call(all, email);
  });
}

/**
 * Upsert a user's refresh token (rotation-safe atomic write).
 * @param {string} email
 * @param {string} refreshToken the freshly issued refresh token
 * @param {"active"|"needs_reonboarding"} [status]
 */
export function put(email, refreshToken, status = "active") {
  return withLock(async () => {
    const all = await loadAll();
    all[email] = {
      refresh_token: refreshToken,
      updated_at: new Date().toISOString(),
      status,
    };
    await writeAll(all);
  });
}

/** Mark a user as needing re-onboarding (e.g. after invalid_grant). */
export function markNeedsReonboarding(email) {
  return withLock(async () => {
    const all = await loadAll();
    if (all[email]) {
      all[email].status = "needs_reonboarding";
      all[email].updated_at = new Date().toISOString();
      await writeAll(all);
    }
  });
}
