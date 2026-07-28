/**
 * Wikipedia section: today's featured article, plus a few random quality
 * articles drawn from the configured interest areas.
 *
 * The picks come from CirrusSearch — `incategory:"Good articles"` intersected
 * with `articletopic:` filters (the ORES topic taxonomy) and sorted randomly.
 * Which interest areas get picked rotates with the day of the year, so over a
 * week every area comes up. Content is keyed to the local date: when the
 * currently-published payload already carries today's date, it is reused
 * verbatim, so the mid-day rebuilds (which exist for the blogroll's sake)
 * don't re-roll the picks.
 */

import { fetchJson, todayIn } from "../lib.mjs";

// Wikimedia asks API clients for an identifying User-Agent with contact info.
const WIKI_UA = "UltrafilterBuild/1.0 (https://github.com/mschachner/ultrafilter)";

const API = "https://en.wikipedia.org/w/api.php";
const REST = "https://en.wikipedia.org/api/rest_v1";

function pagePayload(p) {
  return {
    title: p?.titles?.normalized || p?.title || "",
    description: p?.description || "",
    extract: p?.extract || "",
    url: p?.content_urls?.desktop?.page || "",
    thumbnail: p?.thumbnail?.source || null,
  };
}

async function featuredArticle(dateKey) {
  const [y, m, d] = dateKey.split("-");
  const doc = await fetchJson(`${REST}/feed/featured/${y}/${m}/${d}`, { "User-Agent": WIKI_UA });
  if (!doc?.tfa) throw new Error("no tfa in featured feed");
  return pagePayload(doc.tfa);
}

/** One random Good article matching any of the topic's articletopic values. */
async function randomPick(topic, exclude) {
  const search =
    `incategory:"Good articles" articletopic:${topic.articleTopics.join("|")}`;
  const url =
    `${API}?action=query&list=search&format=json&formatversion=2` +
    `&srsearch=${encodeURIComponent(search)}&srsort=random&srlimit=5&srprop=`;
  const doc = await fetchJson(url, { "User-Agent": WIKI_UA });
  if (doc.error) throw new Error(`search API: ${doc.error.info || doc.error.code}`);
  const hit = (doc?.query?.search || []).find(r => !exclude.has(r.title));
  if (!hit) throw new Error(`no results for ${topic.id}`);

  const summary = await fetchJson(
    `${REST}/page/summary/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
    { "User-Agent": WIKI_UA }
  );
  return {
    topicId: topic.id,
    topicLabel: topic.label,
    ...pagePayload(summary),
    title: pagePayload(summary).title || hit.title,
  };
}

export async function build(config, { published }) {
  const cfg = config.wikipedia;
  const today = todayIn(cfg.timezone || "UTC");

  // Same local day, already built once — keep it. Re-rolling random picks on
  // every six-hourly rebuild would defeat the point of a daily section.
  if (published?.date === today.key && (published.tfa || published.picks?.length)) {
    console.log(`ok    wikipedia — reusing published payload for ${today.key}`);
    // The topic map rides along so the page's "another three" re-roll always
    // has it, even when the content itself is reused.
    return { ...published, topics: cfg.topics };
  }

  let tfa = null;
  try {
    tfa = await featuredArticle(today.key);
    console.log(`ok    wikipedia tfa — ${tfa.title}`);
  } catch (err) {
    console.log(`FAIL  wikipedia tfa — ${err.message || err}`);
  }

  // Rotate which interest areas are drawn from, by day of year.
  const topics = cfg.topics || [];
  const count = Math.min(cfg.picksPerDay ?? 3, topics.length);
  const doy = Math.floor(Date.parse(today.key) / 86400000);
  const chosen = Array.from({ length: count }, (_, i) => topics[(doy + i) % topics.length]);

  const exclude = new Set(
    [tfa?.title, ...(published?.picks || []).map(p => p.title)].filter(Boolean)
  );
  const picks = [];
  for (const topic of chosen) {
    try {
      const pick = await randomPick(topic, exclude);
      exclude.add(pick.title);
      picks.push(pick);
      console.log(`ok    wikipedia pick (${topic.id}) — ${pick.title}`);
    } catch (err) {
      console.log(`FAIL  wikipedia pick (${topic.id}) — ${err.message || err}`);
    }
  }

  if (!tfa && !picks.length) throw new Error("featured article and every pick failed");

  return {
    generated: new Date().toISOString(),
    date: today.key,
    topics: cfg.topics,
    tfa,
    picks,
  };
}
