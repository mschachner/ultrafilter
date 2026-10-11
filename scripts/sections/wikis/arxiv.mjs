/**
 * arXiv tab: the latest announcement in the configured categories. Rebuilt
 * every run.
 *
 * Source is the listing feed at rss.arxiv.org (the day's announcement: new
 * submissions first, then cross-lists, then replacements), not the search API
 * at export.arxiv.org. The API rate-limits by IP, and GitHub's runners share
 * theirs, so from Actions it answered 429 or hung for days at a stretch
 * (2026-09-12 to 14). The feed is built for polling and served separately.
 *
 * The feed is empty on days with no announcement. arXiv announces Sunday
 * through Thursday evenings, so Saturday's and Sunday's feeds are empty, as
 * are holidays'. An empty feed is not a failure: the latest announcement is
 * still the listing already published, so the tab carries that listing
 * forward (as a fresh build) for up to CARRY_DAYS after it was fetched. Every
 * weekend run used to fall back to the API instead, and the API timed out
 * from Actions on 2026-10-11. The API is now used only when the feed fails
 * outright, or is empty with no recent listing to carry.
 *
 * `listed` on the payload records when its items were fetched from arXiv; a
 * carried listing keeps the original time.
 *
 * `resolve(url)` reads one paper the morning task picked. It is found in
 * the day's listing feed first, then in the published listing (no API call
 * at all); only a paper in neither costs one `id_list` API request.
 */

import { XMLParser } from "fast-xml-parser";
import { fetchText } from "../../lib.mjs";

const FEED = "https://rss.arxiv.org/atom/";
// How long an empty feed may carry the published listing forward: a weekend
// plus a holiday or two.
const CARRY_DAYS = 5;
const API = "https://export.arxiv.org/api/query";

const squash = s => String(s ?? "").replace(/\s+/g, " ").trim();
const parse = xml =>
  new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml);
const entriesOf = doc => {
  const e = doc?.feed?.entry || [];
  return Array.isArray(e) ? e : [e];
};

// LaTeX accent commands that appear in arXiv metadata outside math
// (Fra\"iss\'e, G\"odel, \v{C}ech). Math is left as TeX for the page to
// typeset.
const ACCENTS = {
  "'": "́", "`": "̀", "^": "̂", '"': "̈", "~": "̃",
  "=": "̄", ".": "̇", u: "̆", v: "̌", H: "̋", c: "̧", k: "̨",
};
function accents(s) {
  return String(s ?? "")
    .replace(/\\(['`^"~=.]|[uvHck](?![A-Za-z]))\s*\{?([A-Za-z])\}?/g, (_, cmd, ch) => (ch + ACCENTS[cmd]).normalize("NFC"))
    .replace(/\\(ss|o|O|l|L|ae|AE|oe|OE|aa|AA)\b\{?\}?/g, (_, n) =>
      ({ ss: "ß", o: "ø", O: "Ø", l: "ł", L: "Ł", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", aa: "å", AA: "Å" })[n]);
}
const clean = s => accents(squash(s));

/** The feed's entries as tab items; [] on a day with no announcement. */
function fromFeed(xml, cats, count) {
  const entries = entriesOf(parse(xml));
  const KIND = { new: "", cross: "cross-list", replace: "replacement", "replace-cross": "replacement" };
  return entries.slice(0, count).map(e => {
    const authors = squash(e["dc:creator"]).split(/,\s*/).map(accents).filter(Boolean);
    const who = authors.join(", ");
    const links = [].concat(e.link || []);
    const abs = links.find(l => l["@_rel"] === "alternate")?.["@_href"] ||
      `https://arxiv.org/abs/${String(e.id || "").replace(/^oai:arXiv\.org:/, "").replace(/v\d+$/, "")}`;
    const terms = [].concat(e.category || []).map(c => c["@_term"]).filter(Boolean);
    const primary = terms[0];
    const type = squash(e["arxiv:announce_type"]);
    const when = String(e.published || "").slice(0, 10);
    const summary = squash(e.summary).replace(/^arXiv:\S+\s+Announce Type:\s*\S+\s*Abstract:\s*/i, "");
    const notes = [
      KIND[type] ?? type,
      primary && !cats.includes(primary) ? `from ${primary}` : "",
    ].filter(Boolean).join(" ");
    return {
      title: clean(e.title),
      description: [who, when, notes].filter(Boolean).join(" · "),
      extract: clean(summary),
      url: abs.replace(/^http:/, "https:"),
      when,
    };
  });
}

function fromApi(xml, cats) {
  const entries = entriesOf(parse(xml));
  if (!entries.length) throw new Error("no entries in the arXiv API feed");
  return entries.map(e => {
    const authors = [].concat(e.author || []).map(a => accents(squash(a.name))).filter(Boolean);
    const who = authors.join(", ");
    const links = [].concat(e.link || []);
    const abs = links.find(l => l["@_rel"] === "alternate")?.["@_href"] || String(e.id || "");
    const primary = e["arxiv:primary_category"]?.["@_term"];
    const when = String(e.published || "").slice(0, 10);
    const other = primary && !cats.includes(primary) ? `cross-list from ${primary}` : "";
    return {
      title: clean(e.title),
      description: [who, when, other].filter(Boolean).join(" · "),
      extract: clean(e.summary),
      url: abs.replace(/^http:/, "https:"),
      when,
    };
  });
}

const paperId = url => {
  const m = String(url).match(/arxiv\.org\/(?:abs|pdf)\/([\w.\-/]+?)(?:v\d+)?(?:\.pdf)?$/);
  return m ? m[1] : null;
};

/** The published listing, if it is recent enough to carry forward. */
function carried(prev) {
  const items = (prev?.items || []).map(({ picked, ...item }) => item);
  const listed = prev?.listed || prev?.generated;
  if (!items.length || !(Date.now() - Date.parse(listed) < CARRY_DAYS * 864e5)) return null;
  return { items, listed };
}

export async function resolve(url, cfg = {}, published = null) {
  const id = paperId(url);
  if (!id) throw new Error(`not an arXiv paper URL: ${url}`);
  const cats = cfg.categories?.length ? cfg.categories : ["math.LO"];
  const inListing = items => items.find(i => paperId(i.url) === id);
  try {
    const xml = await fetchText(`${FEED}${cats.join("+")}`, { Accept: "application/atom+xml" });
    const hit = inListing(fromFeed(xml, cats, 1000));
    if (hit) return hit;
  } catch {}
  const kept = inListing((published?.items || []).map(({ picked, ...item }) => item));
  if (kept) return kept;
  const xml = await fetchText(`${API}?id_list=${encodeURIComponent(id)}&max_results=1`,
    { Accept: "application/atom+xml" });
  const hit = fromApi(xml, cats)[0];
  if (!hit?.title) throw new Error(`paper ${id} not found`);
  return hit;
}

export async function build(cfg, { published } = {}) {
  const cats = cfg.categories?.length ? cfg.categories : ["math.LO"];
  const count = cfg.count ?? 10;
  const tab = (items, listed) => ({ items, perPage: 5, daily: false, listed });

  let feedErr;
  try {
    const xml = await fetchText(`${FEED}${cats.join("+")}`, { Accept: "application/atom+xml" });
    const items = fromFeed(xml, cats, count);
    if (items.length) return tab(items, new Date().toISOString());
    const last = carried(published);
    if (last) {
      console.log(`      wikis/arxiv — no announcement today; keeping the listing fetched ${last.listed}`);
      return tab(last.items, last.listed);
    }
    feedErr = new Error(`no entries in the arXiv listing feed, and no listing from the last ${CARRY_DAYS} days to keep`);
  } catch (err) {
    feedErr = err;
  }
  console.log(`      wikis/arxiv — listing feed failed (${feedErr?.message || feedErr}); trying the API`);

  const query = cats.map(c => `cat:${c}`).join("+OR+");
  try {
    const xml = await fetchText(
      `${API}?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=${count}`,
      { Accept: "application/atom+xml" }
    );
    const items = fromApi(xml, cats);
    return tab(items, new Date().toISOString());
  } catch (err) {
    throw new Error(`listing feed: ${feedErr?.message || feedErr}; API: ${err?.message || err}`);
  }
}
