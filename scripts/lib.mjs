/**
 * Shared plumbing for the section builders: HTTP fetching with retries, and
 * the fallback that recovers a section's currently-published JSON from the
 * live site when a fresh build of that section fails.
 */

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TIMEOUT_MS = 25000;
const ATTEMPTS = 3;

/**
 * Fetches a URL as text, retrying transient failures. A 4xx (except 429) is a
 * settled answer and is not retried. Throws the last error on exhaustion; the
 * thrown error carries `status` when the failure was an HTTP status.
 */
export async function fetchText(url, extraHeaders = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "User-Agent": UA,
          "Accept-Language": "en-US,en;q=0.9",
          ...extraHeaders,
        },
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        // 4xx (except 429) is a settled answer — retrying won't change it.
        err.permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
        throw err;
      }
      const body = await res.text();
      if (!body.trim()) throw new Error("empty response body");
      return body;
    } catch (err) {
      lastErr = err;
      if (err.permanent || attempt === ATTEMPTS) break;
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

export async function fetchJson(url, extraHeaders = {}) {
  const body = await fetchText(url, { Accept: "application/json", ...extraHeaders });
  return JSON.parse(body);
}

/**
 * Retrieves the currently-published copy of a data file from the live site.
 * Used two ways: as the last-good fallback when a section's build fails, and
 * by daily sections to notice that today's content already exists and should
 * not be re-rolled mid-day. Returns null when unavailable (first deploy,
 * local runs before any deploy, network trouble).
 */
export async function loadPublished(siteUrl, name) {
  if (!siteUrl) return null;
  try {
    const url = new URL(`data/${name}.json`, siteUrl).href;
    return await fetchJson(`${url}?t=${Date.now()}`, { "Cache-Control": "no-cache" });
  } catch {
    return null;
  }
}

/** Today's date parts in a named timezone: { key: "2026-07-28", day, month, monthName }. */
export function todayIn(timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  const key = `${get("year")}-${get("month")}-${get("day")}`;
  const monthName = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, month: "long" })
    .format(new Date());
  return { key, day: Number(get("day")), month: Number(get("month")), monthName };
}
