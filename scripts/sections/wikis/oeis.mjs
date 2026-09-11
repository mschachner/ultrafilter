/**
 * OEIS tab: a few integer sequences a day. The OEIS has no random endpoint,
 * caps anonymous searches at their first hundred hits, and returns 403 to
 * oeis.org requests from GitHub's runners, so the build reads entries from
 * the OEIS's own git mirror (github.com/oeis/oeisdata) instead: one file per
 * sequence in the internal format (%S data, %N name, %K keywords, %A author).
 * It draws random A-numbers (seeded by the date), skips missing, dead or
 * trivial entries, and prefers ones the editors flagged `nice` or `core`.
 * The extract is the sequence's first terms, rendered in the monospace face.
 */

import { fetchText, seededRandom } from "../../lib.mjs";

const RAW = "https://raw.githubusercontent.com/oeis/oeisdata/HEAD/seq/";
const SKIP_KW = /\b(dead|dumb|obsc|less|unkn|uned|allocated|recycled)\b/;

/** Parses the internal format into { number, data, name, keyword, author, links }. */
function parseSeq(text, number) {
  const seq = { number, data: "", name: "", keyword: "", author: "", links: 0 };
  for (const line of text.split("\n")) {
    const m = /^%(\w) A\d+ ?(.*)$/.exec(line);
    if (!m) continue;
    const [, tag, rest] = m;
    if (tag === "S" || tag === "T" || tag === "U") seq.data += rest.trim();
    else if (tag === "N" && !seq.name) seq.name = rest.trim();
    else if (tag === "K") seq.keyword = rest.trim();
    else if (tag === "A" && !seq.author) seq.author = rest.trim();
    else if (tag === "H") seq.links++;
  }
  return seq;
}

function score(seq) {
  const kw = seq.keyword || "";
  return (/\bnice\b/.test(kw) ? 4 : 0) + (/\bcore\b/.test(kw) ? 3 : 0) +
    (/\beasy\b/.test(kw) ? 1 : 0) + Math.min(3, Math.log10(1 + (seq.links || 0)));
}

function item(seq) {
  const num = String(seq.number).padStart(6, "0");
  const terms = (seq.data || "").split(",").filter(Boolean);
  let shown = "";
  for (const t of terms) {
    if (shown.length + t.length > 110) { shown += ", …"; break; }
    shown += (shown ? ", " : "") + t;
  }
  const kw = (seq.keyword || "").split(",").filter(k => /^(nice|core|easy|hard|hear|look|fini|full|tabl|walk|word)$/.test(k));
  const author = (seq.author || "").replace(/_/g, "").replace(/,.*$/, "").trim();
  return {
    title: seq.name || `A${num}`,
    description: [`A${num}`, author, ...kw].filter(Boolean).join(" · "),
    extract: shown,
    mono: true,
    url: `https://oeis.org/A${num}`,
  };
}

export async function build(cfg, { today }) {
  const want = cfg.poolSize ?? 6;
  const max = cfg.maxNumber ?? 395000;
  const rnd = seededRandom(`oeis:${today.key}`);
  const found = [];
  let tried = 0;
  while (found.length < want * 2 && tried < want * 5) {
    tried++;
    const n = 1 + Math.floor(rnd() * max);
    const id = `A${String(n).padStart(6, "0")}`;
    try {
      const text = await fetchText(`${RAW}${id.slice(0, 4)}/${id}.seq`);
      const seq = parseSeq(text, n);
      if (!seq.name || !seq.data || SKIP_KW.test(seq.keyword)) continue;
      found.push(seq);
    } catch (err) {
      console.log(`      oeis skip ${id} — ${err.message || err}`);
    }
  }
  if (found.length < 3) throw new Error(`only ${found.length} usable sequences after ${tried} lookups`);
  const items = found.sort((a, b) => score(b) - score(a)).slice(0, want).map(item);
  return { items, perPage: 3 };
}
