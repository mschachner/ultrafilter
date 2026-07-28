#!/usr/bin/env node
/**
 * Fetches every feed in feeds.config.json and writes data/posts.json.
 *
 * Runs on a server (GitHub Actions), so there is no CORS problem and we can
 * send a real browser User-Agent — which is what gets us past the publishers
 * that reject anonymous fetchers.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = resolve(ROOT, "feeds.config.json");
const OUT_PATH = resolve(ROOT, "data/posts.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TIMEOUT_MS = 25000;
const ATTEMPTS = 3;

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
      const body = await fetchFeed(c.url, c.headers);
      return { entries: (c.parse || parseFeedXml)(body), source: c.source };
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

async function fetchFeed(url, extraHeaders = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "User-Agent": UA,
          Accept:
            "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          ...extraHeaders,
        },
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        // 4xx (except 429) is a settled answer — retrying won't change it.
        err.permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
        throw err;
      }
      const body = await res.text();
      if (!body.trim()) throw new Error("empty response body");
      return body;
    } catch (err) {
      lastErr = err;
      if (err.permanent || attempt === ATTEMPTS) break;
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

/* --------------------------------- main -------------------------------- */

export async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const perFeed = config.itemsPerFeed ?? 8;
  const cutoff = config.maxAgeDays
    ? Date.now() - config.maxAgeDays * 86400000
    : null;

  const report = [];
  const posts = [];

  for (const feed of config.feeds) {
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
  const out = {
    generated: new Date().toISOString(),
    topics: config.topics,
    feedsTotal: report.length,
    feedsOk: okCount,
    feeds: report,
    posts: deduped,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out, null, 1) + "\n", "utf8");

  console.log(
    `\nWrote ${deduped.length} posts from ${okCount}/${report.length} feeds -> data/posts.json`
  );

  // Fail the job only if essentially everything broke — a couple of stubborn
  // publishers shouldn't turn the whole build red.
  if (okCount === 0) {
    console.error("Every feed failed; refusing to publish an empty file.");
    process.exit(1);
  }
}

function meta(feed) {
  return {
    name: feed.name,
    author: feed.author,
    site: feed.site,
    topics: feed.topics,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
