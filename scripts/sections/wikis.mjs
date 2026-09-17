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
 * The morning task's picks (picks/latest.json in the store) overlay the
 * draws. For every tab but Wikipedia the pick is the lead entry: it is
 * resolved through the tab's own extractor and placed first in `items`,
 * marked `picked: true`; the pool fetched by the random draw follows, and
 * the page's die draws the side picks from that pool. A tab's published
 * payload is reused on the same day only when it reflects the same picks
 * (`pickKey`), so the 9:45 run picks up what the task published after the
 * earlier run. Wikipedia keeps its own shape — the featured article leads,
 * and the picks are its side picks (see wikipedia.mjs).
 *
 * Tab payload contract (the page renders all of them the same way):
 *   { id, label, date, generated, stale?, pickKey?, items: [ { title,
 *     description, extract, url, mono?, picked? } ], perPage }
 */

import { todayIn } from "../lib.mjs";
import * as picksFile from "./picks.mjs";
import * as wikipedia from "./wikipedia.mjs";
import * as nlab from "./wikis/nlab.mjs";
import * as sep from "./wikis/sep.mjs";
import * as attic from "./wikis/attic.mjs";
import * as oeis from "./wikis/oeis.mjs";
import * as mathoverflow from "./wikis/mathoverflow.mjs";
import * as arxiv from "./wikis/arxiv.mjs";

export const TABS = {
  wikipedia:    { label: "Wikipedia", daily: true, module: wikipedia,
                  build: (cfg, ctx) => wikipedia.build(ctx.config, ctx) },
  nlab:         { label: "nLab",      daily: true,  module: nlab, build: nlab.build },
  sep:          { label: "SEP",       daily: true,  module: sep, build: sep.build },
  attic:        { label: "Cantor's Attic", daily: true, module: attic, build: attic.build },
  oeis:         { label: "OEIS",      daily: true,  module: oeis, build: oeis.build },
  mathoverflow: { label: "MathOverflow", daily: false, module: mathoverflow, build: mathoverflow.build },
  arxiv:        { label: "arXiv",     daily: false, module: arxiv, build: arxiv.build },
};

const usable = t => t && (t.items?.length || t.tfa || t.picks?.length);

/** The task's lead for a tab, resolved; null when there is none or it fails. */
async function resolveLead(id, def, tabCfg, picks) {
  const [pick] = picksFile.forTab(picks, id);
  if (!pick || typeof def.module.resolve !== "function") return null;
  try {
    const item = await def.module.resolve(pick.url, tabCfg);
    console.log(`ok    wikis/${id} lead (picked) — ${item.title}`);
    return { ...item, picked: true };
  } catch (err) {
    console.log(`FAIL  wikis/${id} lead ${pick.url} — ${err.message || err}; random lead instead`);
    return null;
  }
}

export async function build(config, { published, likes, picks }) {
  const cfg = config.wikis || {};
  const today = todayIn(cfg.timezone || config.wikipedia?.timezone || "UTC");
  const order = (cfg.tabs || Object.keys(TABS)).filter(id => TABS[id]);
  const tabs = {};

  for (const id of order) {
    const def = TABS[id];
    const tabCfg = { ...(cfg[id] || {}) };
    const label = tabCfg.label || def.label;
    const prev = published?.tabs?.[id];
    const pickKey = picksFile.fingerprint(picks, id);
    const ctx = { config, published: prev, today, likes, picks };

    // Same local day, already built, for the same picks — keep it (the
    // random draws are meant to change once a day, not every two hours).
    if (def.daily && prev?.date === today.key && usable(prev) && !prev.stale &&
        (prev.pickKey || "") === pickKey) {
      console.log(`ok    wikis/${id} — reusing published payload for ${today.key}`);
      tabs[id] = id === "wikipedia"
        ? { ...(await def.build(tabCfg, ctx)), id, label }
        : { ...prev, id, label };
      continue;
    }

    try {
      const built = await def.build(tabCfg, ctx);
      if (id !== "wikipedia") {
        const lead = await resolveLead(id, def, tabCfg, picks);
        if (lead) built.items = [lead, ...(built.items || []).filter(i => i.url !== lead.url)];
      }
      tabs[id] = { ...built, id, label, pickKey, date: built.date || today.key, generated: new Date().toISOString() };
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
