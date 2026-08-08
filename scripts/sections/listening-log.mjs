/**
 * Listening log: the one place the site writes as well as reads. The page
 * (listening.js) commits listening_log.csv to the private spotify-recs repo
 * via the GitHub contents API with a paste-once token; this helper is the
 * read side, used by both album builders to bake each entry's listened /
 * liked state into the published data so every device sees the same marks.
 *
 * Columns: artist,album,first_listened,liked — one row per album marked
 * listened; liked is "true" or "false". Absence of a row means unheard.
 *
 * A missing file (no marks yet) or any fetch failure degrades to an empty
 * log rather than failing the section — the marks are decoration on the
 * albums data, not part of its substance.
 */

import { fetchText } from "../lib.mjs";

/** Normalized identity for an album; must match listening.js's llKey. */
export function logKey(artist, album) {
  const n = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${n(artist)}::${n(album)}`;
}

/** Minimal CSV parser handling quoted fields ("" escapes). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(f => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f !== "")) rows.push(row);
  return rows;
}

/**
 * Map of logKey -> { listened: true, liked: boolean }. Never throws: a 404
 * (no marks yet) is an empty log, but any other failure returns null so the
 * caller can keep the currently-published flags instead of wiping them.
 */
export async function fetchListeningLog(cfg, token) {
  try {
    const text = await fetchText(
      `https://api.github.com/repos/${cfg.repo}/contents/${cfg.listeningPath || "listening_log.csv"}`,
      {
        Accept: "application/vnd.github.raw+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      }
    );
    const rows = parseCsv(text);
    const header = rows.shift() || [];
    const col = name => header.indexOf(name);
    if (col("artist") === -1 || col("album") === -1) return new Map();
    return new Map(rows.map(r => [
      logKey(r[col("artist")], r[col("album")]),
      { listened: true, liked: r[col("liked")] === "true" },
    ]));
  } catch (err) {
    if (err.status === 404) return new Map();
    console.log(`--    listening log unavailable (${err.message || err}) — keeping published marks`);
    return null;
  }
}

/**
 * Stamps listened/liked onto an entry in place. With a null log (fetch
 * failure) existing flags are kept, defaulting absent ones to false.
 */
export function applyLog(entry, log) {
  if (!log) {
    entry.listened = Boolean(entry.listened);
    entry.liked = Boolean(entry.liked);
    return entry;
  }
  const mark = log.get(logKey(entry.artist, entry.album));
  entry.listened = Boolean(mark);
  entry.liked = Boolean(mark?.liked);
  return entry;
}
