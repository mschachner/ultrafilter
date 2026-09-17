#!/usr/bin/env node
/**
 * Post-deploy freshness check, run once a day by the workflow's 9:45 UTC
 * schedule. A daily section that had to fall back to previously-published
 * data (`stale: true`, or a bare `status: "failed"`) fails the run — after
 * the deploy, so the page still updates with whatever did build — which
 * makes GitHub send its run-failed email instead of the section going
 * quietly stale for days.
 *
 * Reads the assembled site (_site/data), i.e. exactly what was deployed.
 */

import { readFile } from "node:fs/promises";

const problems = [];

async function check(name, describe) {
  let doc;
  try {
    doc = JSON.parse(await readFile(`_site/data/${name}.json`, "utf8"));
  } catch {
    problems.push(`${name}: no data file in the assembled site`);
    return;
  }
  const msg = describe(doc);
  if (msg) problems.push(`${name}: ${msg}`);
}

await check("artwork", d =>
  d.stale
    ? `stale — still showing ${d.date}'s pick; the day's Wikidata query has been failing`
    : d.status === "failed"
      ? `failed — ${d.error}`
      : null
);

await check("albums", d =>
  d.stale
    ? `stale — still showing picks from ${d.date}; the store read is failing (is the data branch checked out into store/?)`
    : d.status === "failed"
      ? `failed — ${d.error}`
      : null
);

await check("likes", d =>
  d.stale ? "stale — likes.json couldn't be read from the store; the published copy is being served" : null
);

await check("wikis", d => {
  if (d.status === "failed") return `failed — ${d.error}`;
  const bad = (d.order || []).filter(id => d.tabs?.[id]?.stale || d.tabs?.[id]?.status === "failed")
    .map(id => `${id} (${d.tabs[id].error || "stale"})`);
  return bad.length ? `tabs not built fresh: ${bad.join("; ")}` : null;
});

if (problems.length) {
  // ::error:: makes each problem a run annotation, which is what the
  // notification email surfaces.
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
console.log("Freshness check: artwork, albums, likes, and every wikis tab built fresh.");
