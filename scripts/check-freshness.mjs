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
    ? `stale — still showing picks from ${d.date}; the data-repo fetch is failing (check the SPOTIFY_RECS_TOKEN secret first)`
    : d.status === "failed"
      ? `failed — ${d.error}`
      : null
);

if (problems.length) {
  // ::error:: makes each problem a run annotation, which is what the
  // notification email surfaces.
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}
console.log("Freshness check: artwork and albums built fresh.");
