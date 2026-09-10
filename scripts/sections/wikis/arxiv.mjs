/**
 * arXiv tab: the newest submissions in the configured categories, from the
 * arXiv API's Atom feed (sorted by submission date, so replacements and
 * cross-lists ride along with the genuinely new). Rebuilt every run.
 */

import { XMLParser } from "fast-xml-parser";
import { fetchText, tex2text, firstSentence } from "../../lib.mjs";

const API = "https://export.arxiv.org/api/query";

const squash = s => String(s ?? "").replace(/\s+/g, " ").trim();

export async function build(cfg) {
  const cats = cfg.categories?.length ? cfg.categories : ["math.LO"];
  const count = cfg.count ?? 10;
  const query = cats.map(c => `cat:${c}`).join("+OR+");
  const xml = await fetchText(
    `${API}?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=${count}`,
    { Accept: "application/atom+xml" }
  );
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml);
  let entries = doc?.feed?.entry || [];
  if (!Array.isArray(entries)) entries = [entries];
  if (!entries.length) throw new Error("no entries in the arXiv feed");

  const items = entries.map(e => {
    const authors = [].concat(e.author || []).map(a => squash(a.name)).filter(Boolean);
    const who = authors.length > 3 ? `${authors.slice(0, 3).join(", ")} et al.` : authors.join(", ");
    const links = [].concat(e.link || []);
    const abs = links.find(l => l["@_rel"] === "alternate")?.["@_href"] || String(e.id || "");
    const primary = e["arxiv:primary_category"]?.["@_term"];
    const extract = tex2text(squash(e.summary));
    const when = String(e.published || "").slice(0, 10);
    const other = primary && !cats.includes(primary) ? `cross-list from ${primary}` : "";
    return {
      title: tex2text(squash(e.title)),
      description: [who, when, other].filter(Boolean).join(" · "),
      extract: extract.length > 480 ? extract.slice(0, 479).replace(/\s+\S*$/, "") + "…" : extract,
      url: abs.replace(/^http:/, "https:"),
      when,
    };
  });
  return { items, perPage: 5, daily: false };
}
