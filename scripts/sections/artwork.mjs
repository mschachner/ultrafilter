/**
 * Artwork section: one work a day, drawn from Wikidata and described with
 * Wikipedia's own prose.
 *
 * Where the day's work comes from, in order:
 *   1. The morning task's pick (picks/latest.json in the store, `artwork.
 *      wikidata`), when there is one for today. The task chooses by
 *      judgment against the likes; this builder only resolves the Q-number
 *      — image, prose, and artist all come from Wikidata and Wikipedia, so
 *      the plate reads exactly as a random day's would.
 *   2. Otherwise a draw: an interest area chosen for the day with weights
 *      that lean towards liked areas (config `weight` plus the number of
 *      liked works in that area), then a work from the area.
 *
 * Candidates come from the Wikidata Query Service, filtered by the movements
 * (P135), genres (P136), and inception window (P571) configured per interest
 * area in `config.json` — and required to have an English Wikipedia article,
 * which is what guarantees there is real text to show about the work. The
 * article's lead paragraph (and the artist's, when the creator has an
 * article too) comes from the Wikipedia REST summary endpoint the Wikipedia
 * section already uses.
 *
 * The image comes from Commons (P18) when the work has one; otherwise the
 * article's own lead image is used. That fallback is what keeps interest
 * areas whose works are still in copyright (Abstract Expressionism, Pop
 * Art…) alive: those works can never have a free Commons image, but their
 * Wikipedia articles carry a fair-use reproduction. A work with neither
 * image is passed over for the next candidate in the day's order.
 *
 * Wikidata tags far more artists with a movement (P135) than it tags
 * individual works: Surrealism has some 55 paintings with an English article
 * tagged directly but around 280 by artists tagged as Surrealists. An
 * interest with `viaCreator: true` therefore also accepts a work whose
 * creator (P170) carries the movement, at the cost of some precision — a
 * late Picasso still life counts as Cubism because Picasso does.
 *
 * Within an area the pick is deterministic per day: candidates are ordered
 * by MD5(item ‖ date), so every rebuild on the same day lands on the same
 * work without stored state beyond the published payload itself. That
 * payload carries the Q-numbers of the last RECENT_PICKS works shown, and
 * today's candidates are filtered against them, so a small pool cycles
 * through its works rather than landing on the same few. When the
 * currently-published payload already carries today's date — and reflects
 * the same pick — it is reused verbatim.
 *
 * The page's reroll die redoes the draw client-side with a random seed —
 * index.html carries a mirror of sparqlFor(), so a change here means
 * changing it there too. The candidates script (scripts/candidates.mjs) the
 * morning task runs uses the exported functions below directly.
 */

import { fetchJson, todayIn, seededRandom } from "../lib.mjs";
import { weightedPick } from "./likes.mjs";

// Wikimedia asks API clients for an identifying User-Agent with contact info.
const WIKI_UA = "UltrafilterBuild/1.0 (https://github.com/mschachner/ultrafilter)";

const SPARQL = "https://query.wikidata.org/sparql";
const REST = "https://en.wikipedia.org/api/rest_v1";

// What counts as a "work" unless the interest says otherwise. Q3305213 is
// painting; an interest can override with e.g. ["Q3305213", "Q11060274"]
// (painting + print) for print-heavy traditions like ukiyo-e.
const DEFAULT_CLASSES = ["Q3305213"];

// How many past picks the payload remembers and the draw avoids. The query
// fetches enough rows that a pool larger than this still yields one — rows,
// not works: an item with several creators or locations comes back as
// several rows, so the margin is generous.
const RECENT_PICKS = 20;
const CANDIDATES = RECENT_PICKS + 20;

export const qid = v => /^Q\d+$/.test(v || "");

const SELECT = "SELECT ?item ?year ?image ?article ?creator ?creatorArticle ?creatorLabel ?locationLabel WHERE {";
const TAIL = `  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
  OPTIONAL {
    ?item wdt:P170 ?creator .
    OPTIONAL { ?creatorArticle schema:about ?creator ;
                               schema:isPartOf <https://en.wikipedia.org/> . }
  }
  OPTIONAL { ?item wdt:P276 ?location . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

export function sparqlFor(interest, dateKey, limit = CANDIDATES) {
  const classes = (interest.classes?.length ? interest.classes : DEFAULT_CLASSES)
    .filter(qid).map(q => `wd:${q}`).join(" ");
  // Within a list, values are alternatives (OR); listing both movements and
  // genres requires both — so movement: impressionism + genre: landscape
  // means Impressionist landscapes, not either. With viaCreator, a movement
  // also matches through the work's creator. An interest can instead name
  // `creators` (Q-numbers of artists): works by any of them.
  const movement = q => interest.viaCreator
    ? `{ { ?item wdt:P135 wd:${q} . } UNION { ?item wdt:P170/wdt:P135 wd:${q} . } }`
    : `{ ?item wdt:P135 wd:${q} . }`;
  const facets = [
    (interest.movements || []).filter(qid).map(movement),
    (interest.genres || []).filter(qid).map(q => `{ ?item wdt:P136 wd:${q} . }`),
    (interest.creators || []).filter(qid).map(q => `{ ?item wdt:P170 wd:${q} . }`),
  ].filter(list => list.length)
   .map(list => `{ ${list.join(" UNION ")} }`);
  if (!classes) throw new Error(`interest ${interest.id}: no valid classes`);

  // With a period configured, an inception date is required and filtered;
  // without one it's merely carried along for display when present.
  const from = interest.from != null ? Number(interest.from) : null;
  const to = interest.to != null ? Number(interest.to) : null;
  const inception =
    from != null || to != null
      ? `?item wdt:P571 ?inc . BIND(YEAR(?inc) AS ?year)
  ${from != null ? `FILTER(?year >= ${from})` : ""}
  ${to != null ? `FILTER(?year <= ${to})` : ""}`
      : `OPTIONAL { ?item wdt:P571 ?inc . BIND(YEAR(?inc) AS ?year) }`;

  return `${SELECT}
  VALUES ?class { ${classes} }
  ?item wdt:P31 ?class .
  OPTIONAL { ?item wdt:P18 ?image . }
  ${facets.join("\n  ")}
  ${inception}
${TAIL}
ORDER BY MD5(CONCAT(STR(?item), "${dateKey}"))
LIMIT ${limit}`;
}

/** The same columns for one known item, so a pick resolves like a draw. */
export function sparqlForItem(q) {
  if (!qid(q)) throw new Error(`not a Q-number: ${q}`);
  return `${SELECT}
  VALUES ?item { wd:${q} }
  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL { ?item wdt:P571 ?inc . BIND(YEAR(?inc) AS ?year) }
${TAIL}
LIMIT 8`;
}

export async function runSparql(query) {
  const doc = await fetchJson(`${SPARQL}?query=${encodeURIComponent(query)}&format=json`,
    { "User-Agent": WIKI_UA });
  // One row per item, first-seen order (i.e. the daily shuffle) — items with
  // several creators or locations come back as several rows.
  const byItem = new Map();
  for (const r of doc?.results?.bindings || []) {
    const id = r.item?.value;
    if (id && !byItem.has(id)) byItem.set(id, r);
  }
  return [...byItem.values()];
}

export const itemId = row => row.item.value.split("/").pop();

/** Wikipedia REST summary for an enwiki article URL. */
async function summaryFor(articleUrl) {
  const title = decodeURIComponent(new URL(articleUrl).pathname.replace("/wiki/", ""));
  const s = await fetchJson(`${REST}/page/summary/${encodeURIComponent(title)}`,
    { "User-Agent": WIKI_UA });
  return {
    title: s?.titles?.normalized || title.replace(/_/g, " "),
    description: s?.description || "",
    extract: s?.extract || "",
    url: s?.content_urls?.desktop?.page || articleUrl,
    // The article's lead image — for works with no free Commons image this
    // is usually the fair-use reproduction, and the only image there is.
    image: s?.originalimage?.source || s?.thumbnail?.source || null,
  };
}

/**
 * Walks candidate rows in order until one has a usable image — Commons
 * (P18) when it exists, else the article's own lead image — and returns the
 * full plate: { artwork, artist }. Null when no candidate qualifies.
 */
export async function describeFirst(candidates, log = () => {}) {
  let row = null, work = null;
  for (const cand of candidates) {
    let s;
    try {
      s = await summaryFor(cand.article.value);
    } catch (err) {
      log(`--    artwork — summary failed for ${cand.article.value} (${err.message || err})`);
      continue;
    }
    if (cand.image?.value || s.image) { row = cand; work = s; break; }
  }
  if (!row) return null;

  // The artist: their article's lead when they have one, else just the
  // label. The Q-number rides along so a like can record who made the work.
  const creatorName = qid(row.creatorLabel?.value) ? "" : row.creatorLabel?.value || "";
  const creatorId = row.creator?.value ? row.creator.value.split("/").pop() : null;
  let artist = creatorName || creatorId ? { name: creatorName, wikidata: creatorId } : null;
  if (row.creatorArticle?.value) {
    try {
      const s = await summaryFor(row.creatorArticle.value);
      artist = { name: creatorName || s.title, wikidata: creatorId, description: s.description,
                 extract: s.extract, url: s.url };
    } catch (err) {
      log(`FAIL  artwork artist — ${err.message || err}`);
    }
  }

  // P18 resolves through Special:FilePath, which honours a width parameter —
  // so the page can hotlink a sane size instead of a 40 MB scan. Fair-use
  // uploads are deliberately low-resolution already; one size serves both.
  let image, imageLarge;
  if (row.image?.value) {
    const base = row.image.value.replace(/^http:/, "https:");
    image = `${base}?width=1100`;
    imageLarge = `${base}?width=1800`;
  } else {
    image = work.image;
    imageLarge = work.image;
  }
  const location = qid(row.locationLabel?.value) ? "" : row.locationLabel?.value || "";

  return {
    artwork: {
      wikidata: itemId(row),
      title: work.title,
      description: work.description,
      extract: work.extract,
      url: work.url,
      year: row.year?.value != null ? Number(row.year.value) : null,
      location,
      image,
      imageLarge,
    },
    artist,
  };
}

/**
 * The day's interest area. Each area's weight is its configured `weight`
 * (default 1) plus the number of liked works recorded against it, so areas
 * that keep earning hearts come up more often; the choice is seeded by the
 * date so every rebuild agrees.
 */
export function interestForDay(interests, likes, dateKey) {
  const weights = interests.map(i => ({
    value: i,
    weight: Math.max(1, i.weight ?? 1) + (likes?.count("artwork", it => it.interest === i.id) ?? 0),
  }));
  return weightedPick(weights, seededRandom(`artwork:${dateKey}`));
}

export async function build(config, { published, likes, picks }) {
  const cfg = config.artwork;
  if (!cfg?.interests?.length) {
    console.log("skip  artwork — no artwork config");
    return { generated: new Date().toISOString(), status: "pending", error: "no artwork config" };
  }
  const today = todayIn(cfg.timezone || "UTC");
  const pick = picks?.artwork || null;
  const pickKey = pick?.wikidata || "";

  // Same local day, already built once, and built for the same pick (the
  // 8:17 run precedes the morning task; the 9:45 run must not reuse its
  // random draw once the task's pick exists) — keep it. The interest map
  // rides along so the page's reroll die always has the current config.
  if (published?.date === today.key && published.artwork && (published.pickKey || "") === pickKey) {
    console.log(`ok    artwork — reusing published payload for ${today.key}`);
    return { ...published, interests: cfg.interests };
  }

  // Don't repeat a recently shown work when there's a choice. Older payloads
  // carry no `recent` list; yesterday's pick still counts.
  const recent = [...(published?.recent || []), published?.artwork?.wikidata]
    .filter(Boolean).slice(-RECENT_PICKS);

  let plate = null, interest = null, picked = false;
  if (pick) {
    const rows = await runSparql(sparqlForItem(pick.wikidata));
    plate = rows.length ? await describeFirst(rows, console.log) : null;
    if (plate) {
      picked = true;
      interest = cfg.interests.find(i => i.id === pick.interest) || null;
      console.log(`ok    artwork (picked) — ${plate.artwork.title}`);
    } else {
      console.log(`--    artwork — pick ${pick.wikidata} unusable (no article or image); drawing instead`);
    }
  }

  if (!plate) {
    interest = interestForDay(cfg.interests, likes, today.key);
    let candidates = await runSparql(sparqlFor(interest, today.key));
    if (!candidates.length) throw new Error(`no candidates for interest "${interest.id}"`);
    if (recent.length) {
      const fresh = candidates.filter(r => !recent.includes(itemId(r)));
      if (fresh.length) candidates = fresh;
    }
    plate = await describeFirst(candidates, console.log);
    if (!plate) throw new Error(`no candidates with a usable image for interest "${interest.id}"`);
    console.log(`ok    artwork (${interest.id}) — ${plate.artwork.title}${plate.artist?.name ? ` · ${plate.artist.name}` : ""}`);
  }

  return {
    generated: new Date().toISOString(),
    date: today.key,
    interests: cfg.interests,   // the page's reroll die draws from these
    interestId: interest?.id || null,
    interestLabel: interest?.label || (picked ? "Today's pick" : "Artwork"),
    picked,
    pickKey,
    // Q-numbers of the last picks, oldest first, for tomorrow's draw to avoid.
    recent: [...recent, plate.artwork.wikidata].slice(-RECENT_PICKS),
    ...plate,
  };
}
