/**
 * Wikis section: one payload, several tabs — Wikipedia (the original
 * section, unchanged underneath), nLab, the Stanford Encyclopedia of
 * Philosophy, Cantor's Attic, the OEIS, MathOverflow, and arXiv.
 *
 * Every tab builds independently and falls back on its own: a tab whose
 * fresh build fails keeps its currently-published payload (marked stale),
 * exactly as whole sections do in build.mjs, so one dead site never blanks
 * the others. Daily tabs (the random draws) are keyed to the local date and
 * reused verbatim on the same day's rebuilds; the two "current" tabs
 * (MathOverflow, arXiv) rebuild every run. Tab order is `wikis.tabs` in
 * config.json; a tab left out of that list isn't built.
 *
 * Tab payload contract (the page renders all of them the same way):
 *   { id, label, date, generated, stale?, items: [ { title, description,
 *     extract, url, mono? } ], perPage }
 * Wikipedia is the exception and keeps its own shape (tfa, picks, topics),
 * since the page re-rolls it live against Wikipedia's APIs.
 */

import { todayIn } from "../lib.mjs";
import * as wikipedia from "./wikipedia.mjs";
import * as nlab from "./wikis/nlab.mjs";
import * as sep from "./wikis/sep.mjs";
import * as attic from "./wikis/attic.mjs";
import * as oeis from "./wikis/oeis.mjs";
import * as mathoverflow from "./wikis/mathoverflow.mjs";
import * as arxiv from "./wikis/arxiv.mjs";

const TABS = {
  wikipedia:    { label: "Wikipedia", daily: true,  build: (cfg, ctx) => wikipedia.build(ctx.config, { published: ctx.published }) },
  nlab:         { label: "nLab",      daily: true,  build: nlab.build },
  sep:          { label: "SEP",       daily: true,  build: sep.build },
  attic:        { label: "Cantor's Attic", daily: true, build: attic.build },
  oeis:         { label: "OEIS",      daily: true,  build: oeis.build },
  mathoverflow: { label: "MathOverflow", daily: false, build: mathoverflow.build },
  arxiv:        { label: "arXiv",     daily: false, build: arxiv.build },
};

const usable = t => t && (t.items?.length || t.tfa || t.picks?.length);

export async function build(config, { published }) {
  const cfg = config.wikis || {};
  const today = todayIn(cfg.timezone || config.wikipedia?.timezone || "UTC");
  const order = (cfg.tabs || Object.keys(TABS)).filter(id => TABS[id]);
  const tabs = {};

  for (const id of order) {
    const def = TABS[id];
    const tabCfg = { ...(cfg[id] || {}) };
    const label = tabCfg.label || def.label;
    const prev = published?.tabs?.[id];

    // Same local day, already built — keep it (the random draws are meant to
    // change once a day, not every two hours).
    if (def.daily && prev?.date === today.key && usable(prev) && !prev.stale) {
      console.log(`ok    wikis/${id} — reusing published payload for ${today.key}`);
      tabs[id] = id === "wikipedia"
        ? { ...(await def.build(tabCfg, { config, published: prev, today })), id, label }
        : { ...prev, id, label };
      continue;
    }

    try {
      const built = await def.build(tabCfg, { config, published: prev, today });
      tabs[id] = { ...built, id, label, date: built.date || today.key, generated: new Date().toISOString() };
      delete tabs[id].stale;
      const n = built.items?.length ?? ((built.tfa ? 1 : 0) + (built.picks?.length ?? 0));
      console.log(`ok    wikis/${id} — ${n} entries${built.pool ? ` from a pool of ${built.pool}` : ""}`);
    } catch (err) {
      const msg = String(err?.message || err);
      if (usable(prev)) {
        tabs[id] = { ...prev, id, label, stale: true, error: msg };
        console.log(`FAIL  wikis/${id} — ${msg}; keeping published data (${prev.date})`);
      } else {
        tabs[id] = { id, label, status: "failed", error: msg };
        console.log(`FAIL  wikis/${id} — ${msg}; nothing published to fall back on`);
      }
    }
  }

  if (!order.some(id => usable(tabs[id]))) throw new Error("every tab failed");
  return { generated: new Date().toISOString(), date: today.key, order, tabs };
}
