/**
 * Stanford Encyclopedia of Philosophy tab: random entries with their
 * preambles. The table of contents at /contents.html links every entry; the
 * build shuffles it with a date-fixed seed and fetches the first few, taking
 * each entry's title, the preamble (the untitled opening section before the
 * table of contents), and its publication line. plato.stanford.edu sends no
 * CORS headers, so the pool-and-die arrangement applies here too.
 *
 * `resolve(url)` turns an entry URL the morning task picked into the same
 * item shape; `candidates(n)` lists entries for it to choose from.
 */

import { fetchText, htmlToText, shuffled, firstSentence } from "../../lib.mjs";

const BASE = "https://plato.stanford.edu";

async function contents() {
  const html = await fetchText(`${BASE}/contents.html`);
  const seen = new Map();
  for (const m of html.matchAll(/href="entries\/([^"/]+)\/?"[^>]*>([\s\S]*?)<\/a>/g)) {
    const slug = m[1];
    if (!seen.has(slug)) seen.set(slug, htmlToText(m[2]));
  }
  return [...seen].map(([slug, title]) => ({ slug, title }));
}

function section(html, id) {
  const m = html.match(new RegExp(`<div id="${id}">([\\s\\S]*?)</div>`));
  return m ? m[1] : "";
}

async function entry({ slug, title }) {
  const url = `${BASE}/entries/${slug}/`;
  const html = await fetchText(url);
  const pre = section(html, "preamble");
  const paras = [...pre.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(p => htmlToText(p[1])).filter(Boolean);
  if (!paras.length) return null;
  let extract = "";
  for (const p of paras) {
    extract += (extract ? " " : "") + p;
    if (extract.length > 500) break;
  }
  const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/);
  const pub = htmlToText(section(html, "pubinfo"))
    .replace(/First published\s+\w+\s+/i, "First published ")
    .replace(/substantive revision\s+\w+\s+/i, "revised ");
  return {
    title: h1 ? htmlToText(h1[1]) : title,
    description: pub || firstSentence(extract),
    extract,
    url,
  };
}

function slugFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "plato.stanford.edu") return null;
    const m = u.pathname.match(/^\/(?:archives\/[^/]+\/)?entries\/([^/]+)\/?$/);
    return m ? m[1] : null;
  } catch { return null; }
}

export async function resolve(url) {
  const slug = slugFromUrl(url);
  if (!slug) throw new Error(`not an SEP entry URL: ${url}`);
  const e = await entry({ slug, title: slug });
  if (!e) throw new Error(`entry "${slug}" has no preamble`);
  return e;
}

export async function candidates(n, seed) {
  const list = await contents();
  return shuffled(list, seed).slice(0, n).map(e => ({ title: e.title, url: `${BASE}/entries/${e.slug}/` }));
}

export async function build(cfg, { today }) {
  const want = cfg.poolSize ?? 9;
  const list = await contents();
  if (list.length < 100) throw new Error(`contents listed only ${list.length} entries`);
  const items = [];
  let tried = 0;
  for (const e of shuffled(list, `sep:${today.key}`)) {
    if (items.length >= want || tried >= want * 3) break;
    tried++;
    try {
      const it = await entry(e);
      if (it) items.push(it);
    } catch (err) {
      console.log(`      sep skip "${e.slug}" — ${err.message || err}`);
    }
  }
  if (items.length < 3) throw new Error(`only ${items.length} usable entries after ${tried}`);
  return { items, perPage: 3, pool: list.length };
}
