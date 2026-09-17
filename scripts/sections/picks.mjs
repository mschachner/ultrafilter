/**
 * The morning task's picks for the day — picks/latest.json in the store —
 * as far as the artwork and wikis builders are concerned. (The task's album
 * picks live in albums/latest.json, read by the albums builder directly.)
 *
 * The contract the task fulfils:
 *   {
 *     "date": "2026-09-18",
 *     "artwork": { "wikidata": "Q…", "title": "…" },       // one work
 *     "wikis": {
 *       "wikipedia": [ { "url": "https://en.wikipedia.org/wiki/…", "title": "…" }, … ],  // side picks
 *       "nlab":  { "url": "https://ncatlab.org/nlab/show/…", "title": "…" },             // the lead
 *       "sep":   { "url": "https://plato.stanford.edu/entries/…/", "title": "…" },
 *       "attic": { "url": "https://neugierde.github.io/cantors-attic/…", "title": "…" },
 *       "oeis":  { "url": "https://oeis.org/A…", "title": "…" },
 *       "mathoverflow": { "url": "https://mathoverflow.net/questions/…", "title": "…" }, // optional
 *       "arxiv": { "url": "https://arxiv.org/abs/…", "title": "…" }                      // optional
 *     }
 *   }
 * Every key is optional: a tab or the artwork with no pick falls back to its
 * random draw. Picks are only honoured on their own date — yesterday's file
 * must not pin today's page — and the builders resolve each URL with the
 * source's own extractor, so the text shown is the source's, not the task's.
 *
 * `null` means no usable picks (no file, wrong date, or unreadable): the
 * builders treat that exactly like an empty file. A read failure is logged
 * rather than thrown, because the picks are an overlay on the random draw,
 * not a dependency of it.
 */

import * as store from "../store.mjs";

export const PATH = "picks/latest.json";

export async function load(config, todayKey) {
  let doc;
  try {
    doc = await store.json(config, PATH);
  } catch (err) {
    console.log(`--    picks unavailable (${err.message || err})`);
    return null;
  }
  if (!doc) return null;
  if (doc.date !== todayKey) {
    console.log(`--    picks — ${PATH} is for ${doc.date}, not ${todayKey}; ignoring`);
    return null;
  }
  return {
    date: doc.date,
    artwork: doc.artwork && /^Q\d+$/.test(doc.artwork.wikidata || "") ? doc.artwork : null,
    wikis: doc.wikis && typeof doc.wikis === "object" ? doc.wikis : {},
  };
}

/** A tab's pick(s) as an array of { url, title } with usable URLs. */
export function forTab(picks, id) {
  const v = picks?.wikis?.[id];
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  return arr.filter(p => p && typeof p.url === "string" && /^https?:\/\//.test(p.url));
}

/** A stable fingerprint of a tab's picks, so a rebuild can tell whether the
 *  published payload already reflects them. */
export function fingerprint(picks, id) {
  return forTab(picks, id).map(p => p.url).join("\n");
}
