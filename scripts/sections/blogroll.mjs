/**
 * Blogroll section: fetches every feed in the roll and produces the posts
 * payload. Runs on a server (GitHub Actions), so there is no CORS problem and
 * we can send a real browser User-Agent — which is what gets us past the
 * publishers that reject anonymous fetchers.
 *
 * The roll — which blogs, and whether each is pinned, on trial, or archived
 * — is blogroll.json in the store (see ../roll.mjs); config.json keeps the
 * topics and the fetch and rotation settings. The payload republishes the
 * whole roll, archive included, so the page's blogroll menu has it even
 * when the live copy can't be fetched.
 */

import { XMLParser } from "fast-xml-parser";
import { fetchText } from "../lib.mjs";
import * as roll from "../roll.mjs";

const FEED_ACCEPT =
  "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  // Some feeds put HTML in titles; keep it as text and strip later.
  processEntities: true,
});

/* ------------------------------- helpers ------------------------------- */

const arr = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** fast-xml-parser gives either a string or {"#text": ...} depending on attrs. */
function text(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object") {
    if (typeof node["#text"] === "string") return node["#text"];
    if (typeof node["@_href"] === "string") return node["@_href"];
  }
  return "";
}

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", middot: "·", laquo: "«", raquo: "»",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", dagger: "†", sect: "§",
  deg: "°", times: "×", copy: "©", reg: "®", trade: "™", prime: "′",
  eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç",
  iacute: "í", icirc: "î", oacute: "ó", ocirc: "ô", uacute: "ú", ucirc: "û",
  auml: "ä", ouml: "ö", uuml: "ü", ntilde: "ñ", aring: "å", oslash: "ø",
  aelig: "æ", szlig: "ß",
};

/**
 * Two passes because WordPress double-encodes: a feed title of
 * "STC, Writing &amp;#038; Me" needs &amp; -> & first, then &#038; -> &.
 */
function decodeEntities(s) {
  let out = String(s);
  for (let i = 0; i < 2; i++) {
    out = out
      .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  }
  return out;
}

function stripTags(s) {
  return decodeEntities(
    String(s)
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
  ).trim();
}

/** Atom <link> handling: prefer rel="alternate", fall back to first href. */
function atomLink(entry) {
  const links = arr(entry.link);
  let fallback = "";
  for (const l of links) {
    if (typeof l === "string") { if (!fallback) fallback = l; continue; }
    const href = l["@_href"];
    if (!href) continue;
    const rel = l["@_rel"] || "alternate";
    if (rel === "alternate") return href;
    if (!fallback) fallback = href;
  }
  return fallback;
}

function toDate(raw) {
  if (!raw) return null;
  const d = new Date(String(raw).trim());
  return isNaN(d) ? null : d;
}

/** Normalizes one RSS <item> or Atom <entry> into our shape. */
function normalizeEntry(node, isAtom) {
  const title = stripTags(text(node.title)) || "(untitled)";
  const link = isAtom
    ? atomLink(node)
    : text(node["feedburner:origLink"]) || text(node.link) || text(node.guid);
  const date = toDate(
    text(node.pubDate) ||
      text(node.published) ||
      text(node.updated) ||
      text(node["dc:date"]) ||
      text(node.date)
  );
  return { title, link: String(link || "").trim(), date };
}

/** Exported for testing: turns feed XML into an array of entries. */
export function parseFeedXml(xml) {
  const doc = parser.parse(xml);
  const channel = doc?.rss?.channel ?? doc?.["rdf:RDF"] ?? null;
  const atomFeed = doc?.feed ?? null;

  let nodes = [];
  let isAtom = false;

  if (channel) {
    nodes = arr(channel.item);
    if (!nodes.length && doc?.["rdf:RDF"]) nodes = arr(doc["rdf:RDF"].item);
  }
  if (!nodes.length && atomFeed) {
    nodes = arr(atomFeed.entry);
    isAtom = true;
  }
  if (!nodes.length) throw new Error("no <item> or <entry> elements found");

  return nodes.map(n => normalizeEntry(n, isAtom)).filter(e => e.link);
}

/**
 * What a feed says about itself — title, site, author — for prefilling a
 * roll entry. Tolerant: any field may come back empty.
 */
export function feedInfo(xml) {
  const doc = parser.parse(xml);
  const channel = doc?.rss?.channel ?? doc?.["rdf:RDF"]?.channel ?? null;
  const atom = doc?.feed ?? null;
  const top = channel || atom || {};
  const title = stripTags(text(top.title));
  let site = "";
  if (channel) site = text(channel.link);
  else if (atom) site = atomLink(atom);
  let author = "";
  const editor = text(top.managingEditor);          // RSS: "mail@x.org (Name)"
  if (editor) author = (editor.match(/\(([^)]+)\)/) || [])[1] || "";
  if (!author && top.author) author = text(arr(top.author)[0]?.name) || text(arr(top.author)[0]);
  if (!author) author = text(top["dc:creator"]);
  return { title, site: String(site || "").trim(), author: stripTags(author) };
}

/**
 * Fetches and parses one feed URL exactly as the build would — direct, then
 * the proxies. Resolves to { entries, source, info }; rejects with every
 * source's failure joined by " | ".
 */
export async function probe(url, { proxies = true } = {}) {
  const { entries, source, body } = await fetchAnySource({ feed: url, proxyFallback: proxies });
  let info = { title: "", site: "", author: "" };
  if (body) { try { info = feedInfo(body); } catch {} }
  return { entries, source, info };
}

/**
 * The address may be the feed itself, or a page that links to one, or a
 * site that keeps its feed at a well-known path. Resolves to
 * { feed, entries, source, info } for the first candidate that parses.
 */
export async function discover(input) {
  const problems = [];
  try { return { feed: input, ...(await probe(input)) }; }
  catch (err) { problems.push(`${shortUrl(input)}: ${err.message || err}`); }
  // Not a feed: a page, then. Its <link rel="alternate"> candidates come
  // first; the well-known paths are tried even when the page won't load.
  let page = "";
  try { page = await fetchText(input, { Accept: "text/html,*/*;q=0.8" }); }
  catch (err) { problems.push(`page: ${err.message || err}`); }
  // Declared feeds get the full treatment (proxies included); the guessed
  // paths are tried directly only, or a blog with no feed would take minutes.
  const cands = [];
  for (const m of page.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?alternate/i.test(tag) || !/(rss|atom)\+xml/i.test(tag)) continue;
    const href = (tag.match(/href\s*=\s*["']([^"']+)/i) || [])[1];
    if (href) { try { cands.push({ url: new URL(href, input).href, proxies: true }); } catch {} }
  }
  const root = input.endsWith("/") ? input : input + "/";
  for (const g of ["feed/", "feed.xml", "rss", "rss.xml", "atom.xml", "index.xml", "feed"]) cands.push({ url: root + g, proxies: false });
  const seen = new Set([input]);
  for (const c of cands) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    try { return { feed: c.url, ...(await probe(c.url, { proxies: c.proxies })) }; }
    catch (err) { problems.push(`${shortUrl(c.url)}: ${err.message || err}`); }
  }
  throw new Error(`no feed found at ${input} (${problems.join(" | ")})`);
}

/**
 * Tries, in order: the primary feed URL, any altFeeds, and finally
 * read-through proxies. The proxies exist for publishers that reject this
 * runner outright — a 403 with a browser User-Agent usually means the block
 * is on the IP range (CI runners live in well-known cloud ranges that many
 * firewalls reject), and fetching from somewhere else is the only way past.
 *
 * Each source must both FETCH and PARSE to count as a success. A 200 that
 * turns out to be a challenge page, or a proxy that rewrites the XML, is
 * just another failure to fall through — not a reason to give up on the
 * remaining sources.
 *
 * The very last resort is Feedly's public API: their crawler has already
 * fetched and parsed the feed, so publisher-side blocks and encoding quirks
 * don't apply. The trade-off is that we get Feedly's copy, not the
 * publisher's — at worst a crawl-interval stale.
 */
async function fetchAnySource(feed) {
  const candidates = [
    { url: feed.feed, source: "direct", label: shortUrl(feed.feed) },
    ...(feed.altFeeds || []).map(u => ({ url: u, source: "alt", label: shortUrl(u) })),
  ];

  if (feed.proxyFallback !== false) {
    candidates.push(
      {
        url: "https://r.jina.ai/" + feed.feed,
        source: "proxy",
        label: "proxy(jina)",
        // Jina Reader converts everything to markdown by default, which
        // destroys the XML. Both header spellings ask for the raw document
        // (the accepted name has changed across versions; extras are ignored).
        headers: { "X-Return-Format": "html", "X-Respond-With": "html" },
      },
      {
        url: "https://api.allorigins.win/raw?url=" + encodeURIComponent(feed.feed),
        source: "proxy",
        label: "proxy(allorigins)",
      },
      {
        url:
          "https://cloud.feedly.com/v3/streams/contents?streamId=" +
          encodeURIComponent("feed/" + feed.feed) +
          "&count=20",
        source: "feedly",
        label: "feedly",
        parse: parseFeedlyJson,
      }
    );
  }

  const problems = [];
  for (const c of candidates) {
    try {
      const body = await fetchText(c.url, { Accept: FEED_ACCEPT, ...(c.headers || {}) });
      return { entries: (c.parse || parseFeedXml)(body), source: c.source, body: c.parse ? null : body };
    } catch (err) {
      problems.push(`${c.label}: ${err.message || err}`);
    }
  }

  throw new Error(problems.join(" | "));
}

/** Feedly stream JSON -> the same entry shape parseFeedXml produces. */
export function parseFeedlyJson(body) {
  const doc = JSON.parse(body);
  const items = Array.isArray(doc.items) ? doc.items : [];
  if (!items.length) throw new Error("no items in Feedly stream");
  return items
    .map(i => ({
      title: stripTags(i.title || "") || "(untitled)",
      link: String(
        i.alternate?.[0]?.href ||
          i.canonicalUrl ||
          (typeof i.originId === "string" && i.originId.startsWith("http") ? i.originId : "")
      ).trim(),
      date: i.published ? new Date(i.published) : null,
    }))
    .filter(e => e.link);
}

function shortUrl(u) {
  try {
    const { host, pathname, search } = new URL(u);
    return host + pathname + search;
  } catch {
    return u;
  }
}

function meta(feed) {
  return {
    name: feed.name,
    author: feed.author,
    site: feed.site,
    topics: feed.topics,
    rollStatus: feed.status,
    added: feed.added || null,
    addedBy: feed.addedBy || null,
  };
}

/* --------------------------------- build ------------------------------- */

/**
 * Builds the blogroll payload. Throws if the roll can't be read (so the
 * published copy is kept) or if every feed failed — a couple of stubborn
 * publishers shouldn't take the section down.
 */
export async function build(config) {
  const cfg = config.blogroll;
  const perFeed = cfg.itemsPerFeed ?? 8;
  const cutoff = cfg.maxAgeDays ? Date.now() - cfg.maxAgeDays * 86400000 : null;

  const { roll: theRoll, source: rollSource } = await roll.load(config);
  const feeds = theRoll.feeds.filter(roll.inRoll);
  const archived = theRoll.feeds.length - feeds.length;
  console.log(`      roll — ${feeds.length} in the roll (${theRoll.feeds.filter(f => f.status === "pinned").length} pinned), ${archived} archived; from ${rollSource}`);
  if (!feeds.length) throw new Error(`the roll is empty (no ${roll.policy(config).path} in the store and no feeds in config.json)`);

  const report = [];
  const posts = [];

  for (const feed of feeds) {
    try {
      const { entries: parsed, source } = await fetchAnySource(feed);
      const entries = parsed.slice(0, perFeed);
      let kept = 0;
      for (const e of entries) {
        if (cutoff && e.date && e.date.getTime() < cutoff) continue;
        posts.push({
          title: e.title,
          link: e.link,
          date: e.date ? e.date.toISOString() : null,
          feed: feed.name,
          topics: feed.topics,
        });
        kept++;
      }
      report.push({ ...meta(feed), status: "ok", count: kept, source, error: null });
      console.log(`ok    ${feed.name} — ${kept} posts${source === "direct" ? "" : ` (via ${source})`}`);
    } catch (err) {
      const msg = String(err?.message || err);
      report.push({ ...meta(feed), status: "failed", count: 0, error: msg });
      console.log(`FAIL  ${feed.name} — ${msg}`);
    }
  }

  // De-duplicate by link, newest first, undated last.
  const seen = new Set();
  const deduped = posts.filter(p => !seen.has(p.link) && seen.add(p.link));
  deduped.sort((a, b) => {
    const ta = a.date ? Date.parse(a.date) : -Infinity;
    const tb = b.date ? Date.parse(b.date) : -Infinity;
    return tb - ta;
  });

  const okCount = report.filter(r => r.status === "ok").length;
  if (okCount === 0) throw new Error("every feed failed");

  const p = roll.policy(config);
  return {
    generated: new Date().toISOString(),
    topics: cfg.topics,
    policy: { targetSize: p.targetSize, trialDays: p.trialDays },
    roll: { updated: theRoll.updated, source: rollSource, feeds: theRoll.feeds },
    feedsTotal: report.length,
    feedsOk: okCount,
    feeds: report,
    posts: deduped,
  };
}
