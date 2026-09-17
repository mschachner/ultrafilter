/**
 * Albums section: reads the day's picks from the store (albums/latest.json
 * on the `data` branch, where the "Daily album recommendations" scheduled
 * task publishes them alongside its recommendation-history CSV), then
 * enriches each pick with cover art from Spotify's public oEmbed endpoint.
 *
 * This builder only reads; the scheduled task is the sole writer of the
 * picks. Distinct outcomes:
 *   - file not there       -> "pending" payload; the task simply hasn't published yet
 *   - transient failure    -> throws, so the orchestrator falls back to the
 *                             currently-published payload (yesterday's picks)
 */

import * as store from "../store.mjs";
import * as likes from "./likes.mjs";

function pending(note) {
  console.log(`--    albums — ${note}`);
  return { generated: new Date().toISOString(), status: "pending", note };
}

/**
 * Cover art via Spotify's oEmbed endpoint (public, no auth). One attempt,
 * short timeout — a missing cover just renders as a text-only card. Covers
 * already present in the currently-published payload for the same URL are
 * reused rather than re-fetched on every rebuild.
 */
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
    return typeof doc.thumbnail_url === "string" ? doc.thumbnail_url : null;
  } catch (err) {
    console.log(`--    albums — no cover for ${url} (${err.message || err})`);
    return null;
  }
}

export async function build(config, { published } = {}) {
  const cfg = config.albums || {};
  const path = cfg.path || "albums/latest.json";

  const doc = await store.json(config, path);
  if (!doc) return pending(`${path} not in the store yet`);

  const albums = Array.isArray(doc?.albums) ? doc.albums : [];
  const complete = albums.filter(a => a && a.artist && a.album && a.blurb);
  if (!doc?.date || !complete.length) {
    throw new Error(`malformed albums payload in ${path}`);
  }

  const knownCovers = new Map(
    (published?.albums || [])
      .filter(a => a.spotify_url && a.cover)
      .map(a => [a.spotify_url, a.cover])
  );

  // A failed likes read (null) falls back to the currently-published marks,
  // so a flaky GitHub moment can't strip hearts from the live site.
  const marks = await likes.load(config) ?? likes.fromPublishedAlbums(published?.albums);

  const out = [];
  for (const a of complete) {
    out.push(likes.applyToAlbum({
      category: a.category || null,
      header: a.header || a.category || "",
      artist: a.artist,
      album: a.album,
      year: a.year ?? null,
      genres: Array.isArray(a.genres) ? a.genres : [],
      spotify_url: a.spotify_url || null,
      link_is_search: Boolean(a.link_is_search),
      cover: a.link_is_search ? null : await coverFor(a.spotify_url, knownCovers),
      blurb: a.blurb,
      reception: a.reception || null,
    }, marks));
  }

  console.log(`ok    albums — ${out.length} picks for ${doc.date} (${out.filter(a => a.cover).length} covers)`);
  return {
    generated: new Date().toISOString(),
    status: "ok",
    date: doc.date,
    title: doc.title || null,
    albums: out,
  };
}
