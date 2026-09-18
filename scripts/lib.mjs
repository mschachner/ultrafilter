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

/* ------------------------- text helpers (wikis) ------------------------- */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…" };

/** Decodes the HTML entities that show up in page text and API strings. */
export function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/**
 * Plain text from an HTML fragment. MathML is reduced to its TeX annotation
 * (nLab's pages carry one per formula) so formulas read as `$Sh(X)$` rather
 * than as the rendered tokens repeated twice; everything else is untagged.
 */
export function htmlToText(html) {
  return decodeEntities(
    String(html ?? "")
      .replace(/<math[\s\S]*?<\/math>/g, m => {
        const a = m.match(/<annotation[^>]*>([\s\S]*?)<\/annotation>/);
        return a ? `$${a[1].trim()}$` : m.replace(/<[^>]+>/g, "");
      })
      .replace(/<(script|style)[\s\S]*?<\/\1>/g, "")
      .replace(/<br\s*\/?>/g, " ")
      .replace(/<[^>]+>/g, "")
  ).replace(/\s+/g, " ").trim();
}

const GREEK = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η",
  theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π",
  rho: "ρ", varrho: "ϱ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ",
  omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
  Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω", aleph: "ℵ", beth: "ℶ", infty: "∞", in: "∈",
  notin: "∉", subseteq: "⊆", subset: "⊂", supseteq: "⊇", cup: "∪", cap: "∩", setminus: "∖",
  emptyset: "∅", varnothing: "∅", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒",
  iff: "⇔", Leftrightarrow: "⇔", mapsto: "↦", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠",
  times: "×", cdot: "·", circ: "∘", forall: "∀", exists: "∃", neg: "¬", lnot: "¬", wedge: "∧",
  land: "∧", vee: "∨", lor: "∨", vdash: "⊢", models: "⊨", equiv: "≡", cong: "≅", simeq: "≃",
  sim: "∼", approx: "≈", prec: "≺", succ: "≻", sum: "∑", prod: "∏", int: "∫", partial: "∂",
  nabla: "∇", sqrt: "√", langle: "⟨", rangle: "⟩", ldots: "…", cdots: "⋯", dots: "…", pm: "±",
  oplus: "⊕", otimes: "⊗", top: "⊤", bot: "⊥", ell: "ℓ", hbar: "ℏ", Box: "□", Diamond: "◇",
  restriction: "↾", upharpoonright: "↾", bigcup: "⋃", bigcap: "⋂", prime: "′",
};
const BB = { N: "ℕ", Z: "ℤ", Q: "ℚ", R: "ℝ", C: "ℂ", P: "ℙ" };

/**
 * Readable plain text from light inline TeX — Greek letters and common
 * symbols become Unicode, wrappers like \mathrm{} and \text{} are unwrapped,
 * and the dollar signs go. Anything it doesn't know is left as written, so the
 * worst case is a TeX command in the middle of a sentence rather than a hole.
 */
export function tex2text(s) {
  return String(s ?? "")
    .replace(/\\\\/g, "\\")
    .replace(/\$\$?([^$]*)\$\$?/g, (_, t) => texInner(t))
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, t) => texInner(t));
}

function texInner(t) {
  let out = t
    // Symbols first, so that unwrapping \mathsf{AC} can't glue "AC" onto a
    // preceding \neg and hide it from the lookup below.
    .replace(/\\([A-Za-z]+)/g, (m, n) => GREEK[n] ?? m)
    .replace(/\\(mathbb|Bbb)\{([A-Z])\}/g, (_, __, l) => BB[l] || l)
    .replace(/\\(mathrm|mathbf|mathit|mathsf|mathcal|mathfrak|text|textrm|textit|textbf|operatorname|mathscr)\{([^{}]*)\}/g, "$2")
    .replace(/\\(left|right|,|;|!|quad|qquad|displaystyle)\b/g, "")
    .replace(/\\colon\b/g, ":")
    .replace(/\^\{([^{}]*)\}/g, "^$1")
    .replace(/_\{([^{}]*)\}/g, "_$1")
    .replace(/[{}]/g, "")
    .replace(/\s*([→←⇒⇔↦])\s*/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
  return out;
}

/** A 32-bit string hash and a seeded PRNG, for day-stable shuffles. */
export function hashString(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function seededRandom(seed) {
  let a = hashString(seed) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffled(arr, seed) {
  const rnd = seed == null ? Math.random : seededRandom(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The first sentence or so of a passage, for one-line descriptions. */
/** The first sentence of `text`, whole. Only text with no sentence boundary
 *  at all is cut, at `max` characters, since it would otherwise run on
 *  indefinitely; the page wraps long one-liners rather than ellipsizing them. */
export function firstSentence(text, max = 400) {
  const t = String(text ?? "").trim();
  const m = t.match(/^[\s\S]{20,}?[.!?](?=\s|$)/);
  if (m) return m[0];
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : t;
}
