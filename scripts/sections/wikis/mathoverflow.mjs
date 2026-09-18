/**
 * MathOverflow tab: the most-voted recent questions under the configured
 * tags, via the Stack Exchange API (anonymous, 300 requests a day, more than
 * enough for a build every two hours). The window widens when a quiet week
 * yields too few questions. Not a daily section — it rebuilds every run.
 *
 * `resolve(url)` reads one question the morning task picked, by id.
 */

import { fetchJson, htmlToText, tex2text, decodeEntities } from "../../lib.mjs";

const API = "https://api.stackexchange.com/2.3/questions";

async function questions(tags, days, count) {
  const from = Math.floor(Date.now() / 1000) - days * 86400;
  const url = `${API}?site=mathoverflow&order=desc&sort=votes&fromdate=${from}` +
    `&tagged=${encodeURIComponent(tags.join(";"))}&pagesize=${count}&filter=withbody`;
  const doc = await fetchJson(url);
  if (doc.error_message) throw new Error(`SE API: ${doc.error_message}`);
  return doc.items || [];
}

function item(q, tags) {
  const extract = tex2text(htmlToText(q.body || ""));
  const answers = q.answer_count === 1 ? "1 answer" : `${q.answer_count} answers`;
  const extra = (q.tags || []).filter(t => !tags.includes(t)).slice(0, 3).join(", ");
  return {
    title: tex2text(decodeEntities(q.title || "")),
    description: [`▲ ${q.score}`, q.is_answered ? `${answers} ✓` : answers, extra].filter(Boolean).join(" · "),
    extract,
    url: q.link,
    when: new Date(q.creation_date * 1000).toISOString().slice(0, 10),
  };
}

export async function resolve(url, cfg = {}) {
  const m = String(url).match(/mathoverflow\.net\/(?:questions|q)\/(\d+)/);
  if (!m) throw new Error(`not a MathOverflow question URL: ${url}`);
  const doc = await fetchJson(`${API}/${m[1]}?site=mathoverflow&filter=withbody`);
  if (doc.error_message) throw new Error(`SE API: ${doc.error_message}`);
  const q = doc.items?.[0];
  if (!q) throw new Error(`question ${m[1]} not found`);
  return item(q, cfg.tags?.length ? cfg.tags : ["set-theory"]);
}

export async function build(cfg) {
  const tags = cfg.tags?.length ? cfg.tags : ["set-theory"];
  const count = cfg.count ?? 8;
  const min = cfg.minimum ?? 4;
  let days = cfg.days ?? 7;
  let qs = await questions(tags, days, count);
  while (qs.length < min && days < 120) {
    days *= 2;
    qs = await questions(tags, days, count);
  }
  if (!qs.length) throw new Error(`no questions tagged ${tags.join(", ")} in ${days} days`);
  return { items: qs.map(q => item(q, tags)), perPage: 5, window: days, daily: false };
}
