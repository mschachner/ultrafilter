/**
 * nLab tab: a handful of random nLab entries with their "Idea" sections.
 *
 * The nLab has no random-page endpoint and no API, but it does publish the
 * full list of page names at /nlab/all_pages (one long HTML page). The build
 * draws candidates from that list, shuffled with a seed fixed by the date so
 * the same day's rebuilds agree even before anything is published, then
 * fetches each page and keeps the ones that have a real Idea section and
 * aren't people, reference, or meta pages. ncatlab.org sends no CORS headers,
 * so the page can't re-roll against it: the build fetches a pool of several
 * entries and the die on the page cycles through that pool instead.
 */

import { fetchText, htmlToText, tex2text, shuffled, firstSentence } from "../../lib.mjs";

const BASE = "https://ncatlab.org";
const UA = "UltrafilterBuild/1.0 (https://github.com/mschachner/ultrafilter)";

// Page-name patterns that are never articles.
const SKIP_NAME = /( > history| > (comments|discussion)|^Sandbox|^HomePage$|^Home Page$|^nlab\b|\bSandbox\b|^Reference$|^Latest changes|^\d{4}$)/i;
const SKIP_CATEGORY = /^(people|reference|meta|redirect|empty|nlab|svg|maths and physics|joke)$/i;

async function allPages() {
  const html = await fetchText(`${BASE}/nlab/all_pages`, { "User-Agent": UA });
  const names = [];
  for (const m of html.matchAll(/href="\/nlab\/show\/([^"]+)"/g)) {
    let name;
    try { name = decodeURIComponent(m[1].replace(/\+/g, " ")); } catch { continue; }
    if (SKIP_NAME.test(name)) continue;
    names.push(name);
  }
  return [...new Set(names)];
}

/** The Idea section (falling back to Definition) as plain text, or null. */
function ideaText(page) {
  // The context sidebar carries its own h2s; the article proper starts at
  // the "Contents" heading when the page has one.
  const c = page.indexOf('<h1 id="contents">');
  const html = c === -1 ? page : page.slice(c);
  const heads = [...html.matchAll(/<h2[^>]*>\s*([^<]*)<\/h2>/g)];
  const pick = heads.find(h => /^idea$/i.test(h[1].trim()))
    || heads.find(h => /^(definition|statement|summary)s?$/i.test(h[1].trim()));
  if (!pick) return null;
  const start = pick.index + pick[0].length;
  const next = html.indexOf("<h2", start);
  const seg = html.slice(start, next === -1 ? undefined : next)
    .replace(/<div class="(un_defn|un_remark|un_example|un_theorem|un_prop)[\s\S]*?<\/div>/g, "")
    .replace(/<table[\s\S]*?<\/table>/g, "");
  // Paragraph by paragraph, so the extract stops at a sensible boundary.
  const paras = [...seg.matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .map(p => tex2text(htmlToText(p[1])))
    .filter(t => t.length > 30);
  if (!paras.length) return null;
  let text = "";
  for (const p of paras) {
    text += (text ? " " : "") + p;
    if (text.length > 500) break;
  }
  return text;
}

async function entry(name) {
  const url = `${BASE}/nlab/show/${encodeURIComponent(name).replace(/%20/g, "+")}`;
  const html = await fetchText(url, { "User-Agent": UA });
  const cat = html.match(/class="property">category:\s*(?:<a[^>]*>)?\s*([^<]+)/);
  if (cat && cat[1].split(/,\s*/).some(c => SKIP_CATEGORY.test(c.trim()))) return null;
  if (/This page is a redirect/i.test(html)) return null;
  const extract = ideaText(html);
  if (!extract || extract.length < 80) return null;
  const titleMatch = html.match(/<title>\s*([\s\S]*?)\s+in nLab\s*<\/title>/);
  const title = tex2text(htmlToText(titleMatch ? titleMatch[1] : name));
  return { title, description: firstSentence(extract), extract, url };
}

export async function build(cfg, { today }) {
  const want = cfg.poolSize ?? 12;
  const names = await allPages();
  if (names.length < 100) throw new Error(`all_pages listed only ${names.length} names`);
  const order = shuffled(names, `nlab:${today.key}`);
  const items = [];
  let tried = 0;
  for (const name of order) {
    if (items.length >= want || tried >= want * 4) break;
    tried++;
    try {
      const e = await entry(name);
      if (e) items.push(e);
    } catch (err) {
      console.log(`      nlab skip "${name}" — ${err.message || err}`);
    }
  }
  if (items.length < 3) throw new Error(`only ${items.length} usable entries after ${tried} pages`);
  return { items, perPage: 3, pool: names.length };
}
