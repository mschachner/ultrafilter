/**
 * Cantor's Attic tab. The original MediaWiki at cantorsattic.info now sits
 * behind a Cloudflare challenge; the maintained copy is a Jekyll site built
 * from github.com/neugierde/cantors-attic, one Markdown file per page under
 * docs/. The build lists those files through the GitHub tree API, shuffles
 * them with a date-fixed seed, and reads each page's raw Markdown: the front
 * matter gives the title and permalink, and the first paragraph is the
 * extract. Links point at the rendered site.
 */

import { fetchJson, fetchText, tex2text, shuffled, firstSentence, decodeEntities } from "../../lib.mjs";

const REPO = "neugierde/cantors-attic";
const SITE = "https://neugierde.github.io/cantors-attic/";
const RAW = `https://raw.githubusercontent.com/${REPO}/HEAD/`;

// Section indexes and housekeeping pages, not entries.
const SKIP = /^(Upper_attic|Middle_attic|Lower_attic|Parlour|Playroom|Library|Cellar|Cantor's_Attic|Community_portal|index|README|Main_Page|Help|Sandbox)/i;

async function pages() {
  const tree = await fetchJson(`https://api.github.com/repos/${REPO}/git/trees/HEAD?recursive=1`, {
    Accept: "application/vnd.github+json",
  });
  return (tree.tree || [])
    .map(e => e.path)
    .filter(p => /^docs\/[^/]+\.md$/.test(p) && !SKIP.test(p.slice(5)))
    .map(p => p.slice(5, -3));
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

/** Markdown + leftover wiki HTML to plain text. */
function mdToText(s) {
  return tex2text(decodeEntities(
    s.replace(/<a [^>]*>([\s\S]*?)<\/a>/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
  )).replace(/\s+/g, " ").trim();
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
    title: tex2text(meta.title || name.replace(/_/g, " ")),
    description: firstSentence(extract),
    extract: extract.length > 600 ? extract.slice(0, 599).replace(/\s+\S*$/, "") + "…" : extract,
    url: SITE + permalink,
  };
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
