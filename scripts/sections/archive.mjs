/**
 * Archive section: every album the daily task has ever recommended, for the
 * record-crate page (albums.html).
 *
 * Two sources in the private spotify-recs repo, merged by (date, category):
 *   - albums/YYYY-MM-DD.json — full entries with blurbs, from the era when
 *     the task started publishing JSON;
 *   - recommendation_history.csv — every pick since the beginning; rows with
 *     no matching JSON become fact-only entries (no blurb or genres).
 *
 * The currently-published archive is used as a cache: dated files already
 * represented aren't refetched, and known covers are reused, so a build does
 * O(new picks) work rather than rereading the whole history every six hours.
 */

import { fetchJson, fetchText } from "../lib.mjs";
import { fetchListeningLog, applyLog, logKey } from "./listening-log.mjs";

const CATEGORY_HEADERS = { focus: "Focus", familiar_artist: "Enjoy", new_artist: "Explore" };
const CATEGORY_ORDER = { focus: 0, familiar_artist: 1, new_artist: 2 };

function pending(note) {
  console.log(`--    archive — ${note}`);
  return { generated: new Date().toISOString(), status: "pending", note };
}

function gh(token) {
  return {
    Accept: "application/vnd.github.raw+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
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

async function coverFor(url, known) {
  if (!url || !/open\.spotify\.com\/album\//.test(url)) return null;
  if (known.has(url)) return known.get(url);
  try {
    const res = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await res.json();
    const cover = typeof doc.thumbnail_url === "string" ? doc.thumbnail_url : null;
    known.set(url, cover);
    return cover;
  } catch {
    return null;
  }
}

export async function build(config, { published } = {}) {
  const cfg = config.albums;
  const token = process.env[cfg.tokenEnv];
  if (!token) return pending(`no ${cfg.tokenEnv} in the environment`);
  const base = `https://api.github.com/repos/${cfg.repo}/contents`;

  // What the live site already knows.
  const have = new Map((published?.entries || []).map(e => [`${e.rec_date}|${e.category}`, e]));
  const knownCovers = new Map(
    (published?.entries || []).filter(e => e.spotify_url && e.cover).map(e => [e.spotify_url, e.cover])
  );

  // Dated JSON files, skipping any date fully represented in the cache.
  let files = [];
  try {
    const listing = await fetchJson(`${base}/${cfg.dir || "albums"}`, gh(token));
    files = (Array.isArray(listing) ? listing : [])
      .map(f => f.name)
      .filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n));
  } catch (err) {
    if (err.status !== 404) throw err;   // no albums/ dir yet -> CSV only
  }

  const entries = new Map(have);
  for (const name of files) {
    const date = name.replace(".json", "");
    if (["focus", "familiar_artist", "new_artist"].every(c => entries.has(`${date}|${c}`))) continue;
    try {
      const doc = await fetchJson(`${base}/${cfg.dir || "albums"}/${name}`, gh(token));
      for (const a of doc?.albums || []) {
        if (!a?.artist || !a?.album) continue;
        entries.set(`${date}|${a.category}`, {
          rec_date: date,
          category: a.category || null,
          header: a.header || CATEGORY_HEADERS[a.category] || "",
          artist: a.artist,
          album: a.album,
          year: a.year ?? null,
          genres: Array.isArray(a.genres) ? a.genres : [],
          spotify_url: a.spotify_url || null,
          link_is_search: Boolean(a.link_is_search),
          blurb: a.blurb || null,
          reception: a.reception || null,
          cover: null,
        });
      }
      console.log(`ok    archive — read ${name}`);
    } catch (err) {
      console.log(`FAIL  archive — ${name}: ${err.message || err}`);
    }
  }

  // The CSV is the complete record; rows without a JSON become fact-only entries.
  const csv = parseCsv(await fetchText(`${base}/${cfg.historyPath || "recommendation_history.csv"}`, gh(token)));
  const header = csv.shift() || [];
  const col = name => header.indexOf(name);
  if (col("date") === -1 || col("artist") === -1) throw new Error("unrecognized history CSV header");
  for (const row of csv) {
    const key = `${row[col("date")]}|${row[col("category")]}`;
    if (entries.has(key)) continue;
    const url = row[col("spotify_url")] || null;
    entries.set(key, {
      rec_date: row[col("date")],
      category: row[col("category")],
      header: CATEGORY_HEADERS[row[col("category")]] || "",
      artist: row[col("artist")],
      album: row[col("album")],
      year: Number(row[col("release_year")]) || null,
      genres: [],
      spotify_url: url,
      link_is_search: Boolean(url && !/open\.spotify\.com\/album\//.test(url)),
      blurb: null,
      reception: null,
      cover: null,
    });
  }

  const out = [...entries.values()].sort((a, b) =>
    a.rec_date === b.rec_date
      ? (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9)
      : (a.rec_date < b.rec_date ? 1 : -1)
  );
  for (const e of out) {
    if (!e.cover && !e.link_is_search) e.cover = await coverFor(e.spotify_url, knownCovers);
  }

  // Listened/liked marks are re-applied to every entry on every build, so
  // cached entries never carry stale state. A failed fetch (null) falls back
  // to the currently-published marks rather than wiping them.
  const log = await fetchListeningLog(cfg, token) ??
    new Map((published?.entries || []).filter(e => e.listened)
      .map(e => [logKey(e.artist, e.album), { listened: true, liked: Boolean(e.liked) }]));
  out.forEach(e => applyLog(e, log));

  if (!out.length) return pending("history is empty");
  console.log(`ok    archive — ${out.length} entries (${out.filter(e => e.cover).length} covers, ${out.filter(e => e.blurb).length} with notes)`);
  return { generated: new Date().toISOString(), status: "ok", entries: out };
}
