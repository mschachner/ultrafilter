/**
 * Wikipedia tab: today's featured article as the lead, plus three side
 * picks — the morning task's when it has published them for today, and
 * otherwise random quality articles drawn from the configured interest
 * areas.
 *
 * The task's picks arrive as article URLs (picks/latest.json, `wikis.
 * wikipedia`); each is resolved through the REST summary endpoint so the
 * description and extract are Wikipedia's own. A pick may name the
 * interest area it belongs to (`topic`, an id from `wikipedia.topics`),
 * which gives the row its icon and lets a like of it count towards that
 * area. Picks that fail to resolve are dropped and the gap is filled by the
 * random draw.
 *
 * The random draw comes from CirrusSearch — `incategory:"Good articles"`
 * intersected with `articletopic:` filters (the ORES topic taxonomy) and
 * sorted randomly. Which interest areas are drawn from is a weighted choice
 * seeded by the date: an area's weight is 1 plus the number of liked
 * Wikipedia entries recorded against it, so areas that earn hearts come up
 * more often, and every rebuild on the same day agrees. Content is keyed to
 * the local date: when the currently-published payload already carries
 * today's date and the same picks, it is reused verbatim, so mid-day
 * rebuilds don't re-roll.
 */

import { fetchJson, todayIn, seededRandom } from "../lib.mjs";
import { weightedPick } from "./likes.mjs";
import * as picksFile from "./picks.mjs";

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

/** The article title an enwiki URL points at, or null for anything else. */
export function titleFromUrl(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)wikipedia\.org$/.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/wiki\/(.+)$/);
    return m ? decodeURIComponent(m[1]).replace(/_/g, " ") : null;
  } catch { return null; }
}

/** One article by title, in the picks' shape. */
export async function resolve(url, topic) {
  const title = titleFromUrl(url);
  if (!title) throw new Error(`not a Wikipedia article URL: ${url}`);
  const summary = await fetchJson(
    `${REST}/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    { "User-Agent": WIKI_UA }
  );
  if (summary?.type === "disambiguation" || !summary?.extract) throw new Error(`no article summary for "${title}"`);
  return {
    topicId: topic?.id || null,
    topicLabel: topic?.label || null,
    ...pagePayload(summary),
    title: pagePayload(summary).title || title,
    picked: true,
  };
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

/**
 * `count` interest areas for the day, weighted 1 + liked entries in the
 * area, drawn without replacement with a date-seeded generator.
 */
export function topicsForDay(topics, likes, dateKey, count) {
  const rnd = seededRandom(`wikipedia:${dateKey}`);
  let pool = topics.map(t => ({
    value: t,
    weight: 1 + (likes?.count("wiki", it => it.source === "wikipedia" && it.topic === t.id) ?? 0),
  }));
  const out = [];
  while (out.length < count && pool.length) {
    const t = weightedPick(pool, rnd);
    out.push(t);
    pool = pool.filter(p => p.value !== t);
  }
  return out;
}

export async function build(config, { published, likes, picks }) {
  const cfg = config.wikipedia;
  const today = todayIn(cfg.timezone || "UTC");
  const pickKey = picksFile.fingerprint(picks, "wikipedia");

  // Same local day, already built once, for the same picks — keep it.
  // Re-rolling random picks on every rebuild would defeat the point of a
  // daily section; but a build made before the task published must be
  // redone once the picks exist.
  if (published?.date === today.key && (published.tfa || published.picks?.length) &&
      (published.pickKey || "") === pickKey) {
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

  const topics = cfg.topics || [];
  const count = Math.min(cfg.picksPerDay ?? 3, Math.max(topics.length, 3));
  const exclude = new Set(
    [tfa?.title, ...(published?.picks || []).map(p => p.title)].filter(Boolean)
  );
  const out = [];

  // The task's picks first.
  for (const p of picksFile.forTab(picks, "wikipedia").slice(0, count)) {
    try {
      const topic = topics.find(t => t.id === p.topic) || null;
      const pick = await resolve(p.url, topic);
      if (exclude.has(pick.title)) continue;
      exclude.add(pick.title);
      out.push(pick);
      console.log(`ok    wikipedia pick (picked${topic ? `, ${topic.id}` : ""}) — ${pick.title}`);
    } catch (err) {
      console.log(`FAIL  wikipedia pick ${p.url} — ${err.message || err}`);
    }
  }

  // Then the random draw for whatever slots remain.
  if (out.length < count && topics.length) {
    for (const topic of topicsForDay(topics, likes, today.key, count - out.length)) {
      try {
        const pick = await randomPick(topic, exclude);
        exclude.add(pick.title);
        out.push(pick);
        console.log(`ok    wikipedia pick (${topic.id}) — ${pick.title}`);
      } catch (err) {
        console.log(`FAIL  wikipedia pick (${topic.id}) — ${err.message || err}`);
      }
    }
  }

  if (!tfa && !out.length) throw new Error("featured article and every pick failed");

  return {
    generated: new Date().toISOString(),
    date: today.key,
    topics: cfg.topics,
    pickKey,
    tfa,
    picks: out,
  };
}
