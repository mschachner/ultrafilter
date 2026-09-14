/**
 * arXiv tab: the latest announcement in the configured categories. Rebuilt
 * every run.
 *
 * Source is the listing feed at rss.arxiv.org (the day's announcement: new
 * submissions first, then cross-lists, then replacements), not the search API
 * at export.arxiv.org. The API rate-limits by IP, and GitHub's runners share
 * theirs, so from Actions it answered 429 or hung for days at a stretch
 * (2026-09-12 to 14). The feed is built for polling and served separately.
 * The API remains as a fallback for a day the feed is missing or empty (it is
 * rewritten each announcement, so a brief gap is possible).
 */

import { XMLParser } from "fast-xml-parser";
import { fetchText, tex2text } from "../../lib.mjs";

const FEED = "https://rss.arxiv.org/atom/";
const API = "https://export.arxiv.org/api/query";

const squash = s => String(s ?? "").replace(/\s+/g, " ").trim();
const parse = xml =>
  new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml);
const entriesOf = doc => {
  const e = doc?.feed?.entry || [];
  return Array.isArray(e) ? e : [e];
};

// LaTeX accent commands that appear in arXiv metadata outside math
// (Fra\"iss\'e, G\"odel, \v{C}ech). Applied before tex2text, which handles
// the math-mode symbols.
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
const clean = s => tex2text(accents(squash(s)));

function clip(extract) {
  return extract.length > 480 ? extract.slice(0, 479).replace(/\s+\S*$/, "") + "…" : extract;
}

function fromFeed(xml, cats, count) {
  const entries = entriesOf(parse(xml));
  if (!entries.length) throw new Error("no entries in the arXiv listing feed");
  const KIND = { new: "", cross: "cross-list", replace: "replacement", "replace-cross": "replacement" };
  return entries.slice(0, count).map(e => {
    const authors = squash(e["dc:creator"]).split(/,\s*/).map(accents).filter(Boolean);
    const who = authors.length > 3 ? `${authors.slice(0, 3).join(", ")} et al.` : authors.join(", ");
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
      extract: clip(clean(summary)),
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
    const who = authors.length > 3 ? `${authors.slice(0, 3).join(", ")} et al.` : authors.join(", ");
    const links = [].concat(e.link || []);
    const abs = links.find(l => l["@_rel"] === "alternate")?.["@_href"] || String(e.id || "");
    const primary = e["arxiv:primary_category"]?.["@_term"];
    const when = String(e.published || "").slice(0, 10);
    const other = primary && !cats.includes(primary) ? `cross-list from ${primary}` : "";
    return {
      title: clean(e.title),
      description: [who, when, other].filter(Boolean).join(" · "),
      extract: clip(clean(e.summary)),
      url: abs.replace(/^http:/, "https:"),
      when,
    };
  });
}

export async function build(cfg) {
  const cats = cfg.categories?.length ? cfg.categories : ["math.LO"];
  const count = cfg.count ?? 10;

  let items, feedErr;
  try {
    const xml = await fetchText(`${FEED}${cats.join("+")}`, { Accept: "application/atom+xml" });
    items = fromFeed(xml, cats, count);
  } catch (err) {
    feedErr = err;
    console.log(`      wikis/arxiv — listing feed failed (${err?.message || err}); trying the API`);
  }

  if (!items) {
    const query = cats.map(c => `cat:${c}`).join("+OR+");
    try {
      const xml = await fetchText(
        `${API}?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=${count}`,
        { Accept: "application/atom+xml" }
      );
      items = fromApi(xml, cats);
    } catch (err) {
      throw new Error(`listing feed: ${feedErr?.message || feedErr}; API: ${err?.message || err}`);
    }
  }
  return { items, perPage: 5, daily: false };
}
