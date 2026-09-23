/**
 * Cantor's Attic tab. The original MediaWiki at cantorsattic.info now sits
 * behind a Cloudflare challenge; the maintained copy is a Jekyll site built
 * from github.com/neugierde/cantors-attic, one Markdown file per page under
 * docs/. The build lists pages by scraping the rendered site's section
 * indexes (the GitHub tree API needs authenticated, repo-scoped access in
 * some environments, so it is avoided), shuffles them with a date-fixed
 * seed, and reads each page's raw Markdown: the front matter gives the
 * title and permalink, and the first paragraph is the extract. Links point
 * at the rendered site.
 *
 * `resolve(url)` turns a page URL the morning task picked into the same
 * item shape (the URL's path is tried as the Markdown file name first, then
 * matched against permalinks in the tree); `candidates(n)` lists pages.
 */

import { fetchText, shuffled, firstSentence, decodeEntities } from "../../lib.mjs";

const REPO = "neugierde/cantors-attic";
const SITE = "https://neugierde.github.io/cantors-attic/";
const RAW = `https://raw.githubusercontent.com/${REPO}/HEAD/`;

// Section indexes and housekeeping pages, not entries.
const SKIP = /^(Upper_attic|Middle_attic|Lower_attic|Parlour|Playroom|Library|Cellar|Cantor's_Attic|Community_portal|index|README|Main_Page|Help|Sandbox)/i;

const SECTIONS = ["Upper_attic", "Middle_attic", "Lower_attic", "Parlour", "Playroom", "Library", "Cellar"];

async function pages() {
  const names = new Set();
  for (const section of SECTIONS) {
    const html = await fetchText(SITE + section);
    // Entry links are relative hrefs ("Measurable", "Con_ZFC#..."); absolute
    // paths and full URLs are assets, navigation, or external links.
    for (const m of html.matchAll(/href="([^"/:#?][^":]*)"/g)) {
      const name = decodeURIComponent(m[1].replace(/[?#].*$/, ""));
      if (name && !SKIP.test(name)) names.add(name);
    }
  }
  return [...names];
}

function frontMatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  const out = {};
  if (m) for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta: out, body: m ? md.slice(m[0].length) : md };
}

// The Markdown was converted from MediaWiki with every backslash doubled
// ($\\kappa$ for $\kappa$); this undoes that, leaving TeX the page can typeset.
const untex = s => String(s ?? "").replace(/\\\\/g, "\\");

/** Markdown + leftover wiki HTML to text, with its $…$ TeX kept. Emphasis,
 *  link and code marks come off outside math only: inside $…$ an asterisk
 *  is TeX. */
function mdToText(s) {
  const text = untex(decodeEntities(
    s.replace(/<a [^>]*>([\s\S]*?)<\/a>/g, "$1").replace(/<[^>]+>/g, "")));
  return text.split(/(\$\$?[^$]*\$\$?)/).map((part, i) => i % 2 ? part : part
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1"))
    .join("").replace(/\s+/g, " ").trim();
}

function firstParagraph(body) {
  const blocks = body.split(/\n\s*\n/);
  for (const b of blocks) {
    const t = b.trim();
    if (!t || t.startsWith("#") || t.startsWith("<!--") || t.startsWith("{") || /^[|:-]+$/.test(t)) continue;
    if (/^(\*|-|\d+\.)\s/.test(t)) continue;      // lists before the prose: keep looking
    const text = mdToText(t);
    if (text.length > 40) return text;
  }
  return null;
}

async function entry(name) {
  const md = await fetchText(`${RAW}docs/${encodeURIComponent(name)}.md`);
  const { meta, body } = frontMatter(md);
  const extract = firstParagraph(body);
  if (!extract) return null;
  const permalink = meta.permalink || name;
  return {
    title: untex(meta.title || name.replace(/_/g, " ")),
    description: firstSentence(extract),
    extract,
    url: SITE + permalink,
  };
}

function pathFromUrl(url) {
  try {
    const u = new URL(url);
    if (!url.startsWith(SITE) && u.hostname !== "cantorsattic.info") return null;
    const rel = url.startsWith(SITE) ? url.slice(SITE.length) : u.pathname.replace(/^\/index\.php\//, "").replace(/^\//, "");
    return decodeURIComponent(rel.replace(/[?#].*$/, "").replace(/\/$/, ""));
  } catch { return null; }
}

export async function resolve(url) {
  const path = pathFromUrl(url);
  if (!path) throw new Error(`not a Cantor's Attic page URL: ${url}`);
  // The Markdown file is usually named after the permalink; when it isn't,
  // fall through to the rendered page's title and first paragraph.
  try {
    const e = await entry(path);
    if (e) return { ...e, url: SITE + path };
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  const html = await fetchText(url);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const paras = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(p => mdToText(p[1])).filter(t => t.length > 40);
  if (!h1 || !paras.length) throw new Error(`couldn't read a title and paragraph from ${url}`);
  const extract = paras[0];
  return {
    title: mdToText(h1[1]),
    description: firstSentence(extract),
    extract,
    url,
  };
}

export async function candidates(n, seed) {
  const list = await pages();
  return shuffled(list, seed).slice(0, n).map(name => ({ title: name.replace(/_/g, " "), url: SITE + name }));
}

export async function build(cfg, { today }) {
  const want = cfg.poolSize ?? 9;
  const list = await pages();
  if (list.length < 20) throw new Error(`tree listed only ${list.length} pages`);
  const items = [];
  let tried = 0;
  for (const name of shuffled(list, `attic:${today.key}`)) {
    if (items.length >= want || tried >= want * 3) break;
    tried++;
    try {
      const it = await entry(name);
      if (it) items.push(it);
    } catch (err) {
      console.log(`      attic skip "${name}" — ${err.message || err}`);
    }
  }
  if (items.length < 3) throw new Error(`only ${items.length} usable pages after ${tried}`);
  return { items, perPage: 3, pool: list.length };
}
