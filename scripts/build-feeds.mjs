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

function stripTags(s) {
  return String(s)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

async function fetchFeed(url) {
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
      const xml = await fetchFeed(feed.feed);
      const entries = parseFeedXml(xml).slice(0, perFeed);
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
      report.push({ ...meta(feed), status: "ok", count: kept, error: null });
      console.log(`ok    ${feed.name} — ${kept} posts`);
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
