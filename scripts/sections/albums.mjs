/**
 * Albums section: reads the day's picks from the private spotify-recs repo,
 * where the "Daily album recommendations" scheduled task publishes them
 * (albums/latest.json, alongside its recommendation-history CSV).
 *
 * This builder only reads; the scheduled task is the sole writer. Access is a
 * fine-grained read-only PAT provided via the environment (see config
 * albums.tokenEnv). Distinct outcomes:
 *   - no token configured  -> "pending" payload; the page keeps the section hidden
 *   - file not there (404) -> "pending" payload; the task simply hasn't published yet
 *   - transient failure    -> throws, so the orchestrator falls back to the
 *                             currently-published payload (yesterday's picks)
 */

import { fetchJson } from "../lib.mjs";

function pending(note) {
  console.log(`--    albums — ${note}`);
  return { generated: new Date().toISOString(), status: "pending", note };
}

export async function build(config) {
  const cfg = config.albums;
  const token = process.env[cfg.tokenEnv];
  if (!token) return pending(`no ${cfg.tokenEnv} in the environment`);

  let doc;
  try {
    doc = await fetchJson(
      `https://api.github.com/repos/${cfg.repo}/contents/${cfg.path}`,
      {
        Accept: "application/vnd.github.raw+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      }
    );
  } catch (err) {
    // A 404 just means the scheduled task hasn't published a file yet. (A bad
    // token also reads as 404 on a private repo — if the section stays
    // pending after the first morning run, check the secret first.)
    if (err.status === 404) return pending(`${cfg.path} not found in ${cfg.repo}`);
    throw err;
  }

  const albums = Array.isArray(doc?.albums) ? doc.albums : [];
  const complete = albums.filter(a => a && a.artist && a.album && a.blurb);
  if (!doc?.date || !complete.length) {
    throw new Error(`malformed albums payload in ${cfg.repo}/${cfg.path}`);
  }

  console.log(`ok    albums — ${complete.length} picks for ${doc.date}`);
  return {
    generated: new Date().toISOString(),
    status: "ok",
    date: doc.date,
    title: doc.title || null,
    albums: complete.map(a => ({
      category: a.category || null,
      header: a.header || a.category || "",
      artist: a.artist,
      album: a.album,
      year: a.year ?? null,
      genres: Array.isArray(a.genres) ? a.genres : [],
      spotify_url: a.spotify_url || null,
      link_is_search: Boolean(a.link_is_search),
      blurb: a.blurb,
      reception: a.reception || null,
    })),
  };
}
