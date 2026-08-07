/**
 * Artwork section: one work a day, drawn from Wikidata and described with
 * Wikipedia's own prose.
 *
 * Candidates come from the Wikidata Query Service, filtered by the movements
 * (P135), genres (P136), and inception window (P571) configured per interest
 * area in `config.json` — and required to have both an image on Commons (P18)
 * and an English Wikipedia article, which is what guarantees there is real
 * text to show about the work. The article's lead paragraph (and the
 * artist's, when the creator has an article too) comes from the Wikipedia
 * REST summary endpoint the Wikipedia section already uses.
 *
 * Which interest area is drawn from rotates with the day of the year. Within
 * it, the pick is deterministic per day: candidates are ordered by
 * MD5(item ‖ date), so every rebuild on the same day lands on the same work
 * without any stored state. As with the Wikipedia section, when the
 * currently-published payload already carries today's date it is reused
 * verbatim.
 *
 * The page's reroll die redoes this draw client-side with a random seed —
 * index.html carries a mirror of sparqlFor(), so a change here means
 * changing it there too.
 */

import { fetchJson, todayIn } from "../lib.mjs";

// Wikimedia asks API clients for an identifying User-Agent with contact info.
const WIKI_UA = "UltrafilterBuild/1.0 (https://github.com/mschachner/ultrafilter)";

const SPARQL = "https://query.wikidata.org/sparql";
const REST = "https://en.wikipedia.org/api/rest_v1";

// What counts as a "work" unless the interest says otherwise. Q3305213 is
// painting; an interest can override with e.g. ["Q3305213", "Q11060274"]
// (painting + print) for print-heavy traditions like ukiyo-e.
const DEFAULT_CLASSES = ["Q3305213"];

const qid = v => /^Q\d+$/.test(v || "");

function sparqlFor(interest, dateKey) {
  const classes = (interest.classes?.length ? interest.classes : DEFAULT_CLASSES)
    .filter(qid).map(q => `wd:${q}`).join(" ");
  // Within a list, values are alternatives (OR); listing both movements and
  // genres requires both — so movement: impressionism + genre: landscape
  // means Impressionist landscapes, not either.
  const facets = [
    (interest.movements || []).filter(qid).map(q => `{ ?item wdt:P135 wd:${q} . }`),
    (interest.genres || []).filter(qid).map(q => `{ ?item wdt:P136 wd:${q} . }`),
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

  return `SELECT ?item ?year ?image ?article ?creatorArticle ?creatorLabel ?locationLabel WHERE {
  VALUES ?class { ${classes} }
  ?item wdt:P31 ?class ; wdt:P18 ?image .
  ${facets.join("\n  ")}
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
  ${inception}
  OPTIONAL {
    ?item wdt:P170 ?creator .
    OPTIONAL { ?creatorArticle schema:about ?creator ;
                               schema:isPartOf <https://en.wikipedia.org/> . }
  }
  OPTIONAL { ?item wdt:P276 ?location . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY MD5(CONCAT(STR(?item), "${dateKey}"))
LIMIT 8`;
}

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
  };
}

export async function build(config, { published }) {
  const cfg = config.artwork;
  if (!cfg?.interests?.length) {
    console.log("skip  artwork — no artwork config");
    return { generated: new Date().toISOString(), status: "pending", error: "no artwork config" };
  }
  const today = todayIn(cfg.timezone || "UTC");

  // Same local day, already built once — keep it (the pick is deterministic
  // anyway, but reusing skips the queries on mid-day rebuilds). The interest
  // map rides along so the page's reroll die always has the current config,
  // even when the content itself is reused.
  if (published?.date === today.key && published.artwork) {
    console.log(`ok    artwork — reusing published payload for ${today.key}`);
    return { ...published, interests: cfg.interests };
  }

  // Rotate which interest area is drawn from, by day of year. An interest
  // can carry `weight` (default 1): it takes that many slots in the
  // rotation, so favourites come up more often.
  const doy = Math.floor(Date.parse(today.key) / 86400000);
  const rotation = cfg.interests.flatMap(i => Array(Math.max(1, i.weight ?? 1)).fill(i));
  const interest = rotation[doy % rotation.length];

  const query = sparqlFor(interest, today.key);
  const doc = await fetchJson(`${SPARQL}?query=${encodeURIComponent(query)}&format=json`,
    { "User-Agent": WIKI_UA });

  // One row per item, first-seen order (i.e. the daily shuffle) — items with
  // several creators or locations come back as several rows.
  const byItem = new Map();
  for (const r of doc?.results?.bindings || []) {
    const id = r.item?.value;
    if (id && !byItem.has(id)) byItem.set(id, r);
  }
  let candidates = [...byItem.values()];
  if (!candidates.length) throw new Error(`no candidates for interest "${interest.id}"`);

  // Don't repeat yesterday's work when there's a choice.
  const prev = published?.artwork?.wikidata;
  if (prev && candidates.length > 1) {
    candidates = candidates.filter(r => r.item.value.split("/").pop() !== prev);
  }
  const row = candidates[0];

  const work = await summaryFor(row.article.value);

  // The artist: their article's lead when they have one, else just the label.
  const creatorName = qid(row.creatorLabel?.value) ? "" : row.creatorLabel?.value || "";
  let artist = creatorName ? { name: creatorName } : null;
  if (row.creatorArticle?.value) {
    try {
      const s = await summaryFor(row.creatorArticle.value);
      artist = { name: creatorName || s.title, description: s.description,
                 extract: s.extract, url: s.url };
    } catch (err) {
      console.log(`FAIL  artwork artist — ${err.message || err}`);
    }
  }

  // P18 resolves through Special:FilePath, which honours a width parameter —
  // so the page can hotlink a sane size instead of a 40 MB scan.
  const image = row.image.value.replace(/^http:/, "https:");
  const location = qid(row.locationLabel?.value) ? "" : row.locationLabel?.value || "";

  console.log(`ok    artwork (${interest.id}) — ${work.title}${artist?.name ? ` · ${artist.name}` : ""}`);
  return {
    generated: new Date().toISOString(),
    date: today.key,
    interests: cfg.interests,   // the page's reroll die draws from these
    interestId: interest.id,
    interestLabel: interest.label,
    artwork: {
      wikidata: row.item.value.split("/").pop(),
      title: work.title,
      description: work.description,
      extract: work.extract,
      url: work.url,
      year: row.year?.value != null ? Number(row.year.value) : null,
      location,
      image: `${image}?width=1100`,
      imageLarge: `${image}?width=1800`,
    },
    artist,
  };
}
