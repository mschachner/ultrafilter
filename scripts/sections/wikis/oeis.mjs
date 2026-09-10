/**
 * OEIS tab: a few integer sequences a day. The OEIS has no random endpoint
 * and caps anonymous searches at their first hundred hits, so the build
 * draws random A-numbers (seeded by the date) and looks each one up by id
 * through the JSON search API, skipping dead or trivial entries and
 * preferring ones the editors flagged `nice` or `core`. The extract is the
 * sequence's first terms, rendered in the monospace face.
 */

import { fetchJson, seededRandom, firstSentence } from "../../lib.mjs";

const SKIP_KW = /\b(dead|dumb|obsc|less|unkn|uned|allocated|recycled)\b/;

function score(seq) {
  const kw = seq.keyword || "";
  return (/\bnice\b/.test(kw) ? 4 : 0) + (/\bcore\b/.test(kw) ? 3 : 0) +
    (/\beasy\b/.test(kw) ? 1 : 0) + Math.min(3, Math.log10(1 + (seq.references || 0)));
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
      const res = await fetchJson(`https://oeis.org/search?q=id:${id}&fmt=json`);
      const seq = Array.isArray(res) ? res[0] : res?.results?.[0];
      if (!seq || !seq.name || !seq.data || SKIP_KW.test(seq.keyword || "")) continue;
      found.push(seq);
    } catch (err) {
      console.log(`      oeis skip ${id} — ${err.message || err}`);
    }
  }
  if (found.length < 3) throw new Error(`only ${found.length} usable sequences after ${tried} lookups`);
  const items = found.sort((a, b) => score(b) - score(a)).slice(0, want).map(item);
  return { items, perPage: 3 };
}
