/**
 * Likes — the read side of the unified likes file, likes.json in the store.
 * The page (likes.js) is the writer: hearts on album cards, the artwork
 * plate, wiki entries, and blogroll posts commit to the `data` branch through
 * the GitHub contents API. The build reads the file back to bake each album's
 * listened/liked state into the album payloads, to publish a copy of the
 * whole file as data/likes.json (what token-less browsers see), and to
 * weight the sections' random draws towards what has been liked.
 *
 * Shape:
 *   { "version": 1, "items": [ item, ... ] }
 * where every item carries `kind` and `key` (unique together) plus what the
 * page recorded about it:
 *   album   key "artist::album" (normalized) — artist, album, listened
 *           (YYYY-MM-DD, the first mark), liked (boolean), genres?, when
 *   artwork key "Q…" — title, url, artist, artistId (Q-number), interest
 *           (the interest area's id), when
 *   wiki    key = url — source (tab id), title, url, topic? (Wikipedia's
 *           topic id), when
 *   post    key = url — title, url, feed, topics, when
 * Albums are the only kind with two states: an entry exists once the album
 * is marked listened, and `liked` is a flag on it. For every other kind the
 * entry's existence is the like; unliking removes it.
 *
 * The previous single-purpose file, listening_log.csv, is still read when
 * likes.json doesn't exist yet, so nothing is lost before the migration.
 *
 * A missing file (no likes yet) is an empty set. Any other failure returns
 * null, so the caller can keep currently-published state instead of wiping
 * it — a flaky GitHub moment must never strip hearts from the live site.
 */

import * as store from "../store.mjs";

export const PATH = "likes.json";

/** Normalized identity for an album; must match likes.js's albumKey. */
export function albumKey(artist, album) {
  const n = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${n(artist)}::${n(album)}`;
}

/** Minimal CSV parser handling quoted fields ("" escapes). */
export function parseCsv(text) {
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

/** listening_log.csv rows (artist,album,first_listened,liked) as like items. */
export function itemsFromListeningLog(text) {
  const rows = parseCsv(text);
  const header = rows.shift() || [];
  const col = name => header.indexOf(name);
  if (col("artist") === -1 || col("album") === -1) return [];
  return rows.map(r => ({
    kind: "album",
    key: albumKey(r[col("artist")], r[col("album")]),
    artist: r[col("artist")],
    album: r[col("album")],
    listened: r[col("first_listened")] || "",
    liked: r[col("liked")] === "true",
    when: r[col("first_listened")] || "",
  }));
}

/**
 * The likes set: { items, albums, of(kind) }. `albums` maps albumKey ->
 * { listened, liked }; `of(kind)` lists the items of one kind. Null on a
 * failure other than "no file".
 */
export async function load(config) {
  let items;
  try {
    const doc = await store.json(config, PATH);
    if (doc) {
      items = Array.isArray(doc.items) ? doc.items : [];
    } else {
      const csv = await store.text(config, "listening_log.csv");
      items = csv ? itemsFromListeningLog(csv) : [];
      if (csv) console.log("--    likes — no likes.json yet; reading listening_log.csv");
    }
  } catch (err) {
    console.log(`--    likes unavailable (${err.message || err}) — keeping published marks`);
    return null;
  }
  return wrap(items);
}

export function wrap(items) {
  const albums = new Map();
  for (const it of items) {
    if (it?.kind === "album" && it.key) albums.set(it.key, { listened: true, liked: Boolean(it.liked) });
  }
  return {
    items,
    albums,
    of: kind => items.filter(it => it?.kind === kind),
    /** How many liked items match a predicate — the weight a draw gives that facet. */
    count: (kind, pred) => items.filter(it => it?.kind === kind && (it.liked ?? true) && pred(it)).length,
  };
}

/** A likes set recovered from a published albums payload, for the fallback. */
export function fromPublishedAlbums(entries) {
  return wrap((entries || []).filter(a => a.listened).map(a => ({
    kind: "album", key: albumKey(a.artist, a.album), artist: a.artist, album: a.album,
    liked: Boolean(a.liked),
  })));
}

/**
 * Stamps listened/liked onto an album entry in place. With a null set (fetch
 * failure) existing flags are kept, defaulting absent ones to false.
 */
export function applyToAlbum(entry, likes) {
  if (!likes) {
    entry.listened = Boolean(entry.listened);
    entry.liked = Boolean(entry.liked);
    return entry;
  }
  const mark = likes.albums.get(albumKey(entry.artist, entry.album));
  entry.listened = Boolean(mark);
  entry.liked = Boolean(mark?.liked);
  return entry;
}

/**
 * Weighted choice, seeded: `weights` is [{ value, weight }]; returns the
 * value. Used by the daily draws to lean towards liked facets while staying
 * deterministic for the day.
 */
export function weightedPick(weights, rnd) {
  const total = weights.reduce((s, w) => s + Math.max(0, w.weight), 0);
  if (!total) return weights[0]?.value;
  let r = rnd() * total;
  for (const w of weights) {
    r -= Math.max(0, w.weight);
    if (r < 0) return w.value;
  }
  return weights[weights.length - 1].value;
}
