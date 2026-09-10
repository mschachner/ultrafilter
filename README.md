# Ultrafilter

A personal daily feed on GitHub Pages, in five sections: a hand-picked
blogroll, the weather, a tabbed wikis section (Wikipedia's featured
article and quality picks, and a few entries a day from the nLab, the
Stanford Encyclopedia of Philosophy, Cantor's Attic, and the OEIS, plus the
week's MathOverflow questions and the newest arXiv listings), the day's
three album picks, and a daily artwork.

The architecture is one-directional. A scheduled GitHub Action builds every
section's data file and deploys the site (page + data) straight to Pages —
nothing is committed back to the repository, so `main` only ever contains
your own commits. Editorial content comes from outside: a scheduled Claude
task researches the album picks each morning and commits them to a separate
private data repository, which the build then reads with a read-only token.
The task writes data; the Action is the only thing that publishes. Weather
is the one exception to build-time fetching — the page queries Open-Meteo
directly on load, so the temperature on screen is current rather than
build-time.

Each section's data is built independently, and a section whose build fails
falls back to the copy currently published on the live site, so one flaky
upstream can't blank the rest of the page. The same mechanism keeps the
daily sections stable: a rebuild that finds today's wikis payload
already published reuses it instead of re-rolling the picks.

## Sections

### Blogroll

Link-only: titles, dates, and links out to the original — no reader view.
The page shows the newest 15 posts; a *Show more* button reveals the rest.
Fetching happens on GitHub's servers rather than in your browser, which
solves two problems a browser version would have: no CORS restrictions, and
requests can carry a normal browser `User-Agent`, which gets past publishers
that reject anonymous fetchers.

Two optional per-feed keys in `config.json` help with awkward publishers:

- `"altFeeds": ["https://example.org/?feed=rss2"]` — other URLs to try if the
  primary one fails. Useful when a site exposes the same feed at more than one
  path and a firewall only guards one of them.
- `"proxyFallback": false` — skip the indirect sources for this feed. By
  default, a feed that fails every direct URL is retried via `r.jina.ai` and
  `api.allorigins.win` (read-through proxies), and finally via Feedly's
  public API, whose crawler has already fetched and parsed the feed —
  immune to publisher-side blocks, at the cost of being Feedly's copy rather
  than the publisher's. The ledger marks these as `via proxy` / `via feedly`.

A source only counts as working if its response actually parses as a feed —
a `200` that turns out to be a challenge page (or a proxy that rewrites the
XML) falls through to the next source like any other failure.

### Weather

Fetched client-side from [Open-Meteo](https://open-meteo.com/) (free, no
API key) and rendered in the masthead next to the date. The build only
passes the `weather` block of `config.json` through to the page: place
name, coordinates, timezone, units (`temperatureUnit`, `windSpeedUnit`),
forecast days. Note that the coordinates are readable by anyone who finds
the page.

### Wikis

One section, several tabs — one per source — sharing a layout: a lead
entry (title, a one-line description, the opening of the entry) beside a
short column of further picks. The tab strip remembers the last tab chosen
per browser (`ultrafilter:wikiTab`). All tabs are built into one file,
`data/wikis.json`, but each tab builds and fails independently: a tab whose
source is down keeps its previously published contents (marked `stale` in
the heading and in the ledger, which counts fresh tabs and names the
others), so one dead site never blanks the rest. The order of tabs, and
which are built at all, is `wikis.tabs` in `config.json`; per-tab settings
sit beside it under the tab's id.

The random-draw tabs are keyed to the local date and re-rolled once a day,
however often the build runs. Only Wikipedia answers browser requests, so
only its die fetches anew; the other sources' die pages through a pool
the build fetched (`poolSize` entries per tab), three at a time.

- **Wikipedia.** The featured article comes from Wikimedia's featured-content
  API. The picks are random members of English Wikipedia's **Good articles**
  category, filtered by `articletopic:` (the ORES topic taxonomy) to the
  interest areas in `config.json`; which areas are drawn from rotates with
  the day of the year. Each entry in `wikipedia.topics` maps an interest area
  to one or more
  [articletopic values](https://www.mediawiki.org/wiki/Help:CirrusSearch#articletopic);
  add or reweight areas there. The die re-rolls three picks live.
- **nLab.** The nLab has no random page and no API, but it does list every
  page name at `/nlab/all_pages`. The build shuffles that list with a seed
  fixed by the date, fetches pages in that order, and keeps the ones with a
  real *Idea* section (falling back to *Definition*), skipping people,
  reference, and meta pages. Formulas come through as their TeX, rendered
  down to Unicode where it's just Greek letters and common symbols.
- **SEP.** Entries from the Stanford Encyclopedia of Philosophy's table of
  contents, shuffled the same way; the extract is the entry's preamble and
  the description its publication line.
- **Cantor's Attic.** The original wiki at cantorsattic.info now sits behind
  a Cloudflare challenge; the maintained copy is a static site built from
  [neugierde/cantors-attic](https://github.com/neugierde/cantors-attic), one
  Markdown file per page. The build lists those through the GitHub tree API
  and reads each page's raw Markdown (front matter for the title, first
  paragraph for the extract); links go to the rendered site.
- **OEIS.** Random A-numbers, looked up one at a time through the JSON search
  API (anonymous search can't page past its first hundred hits, so there is
  no other way to sample the whole database). Dead and trivial entries are
  skipped and the draw prefers sequences the editors flagged `nice` or
  `core`. `maxNumber` is the top of the range to draw from — nudge it up as
  the OEIS grows. The extract is the first terms, in the monospace face.
- **MathOverflow.** The most-voted questions of the past `days` under the
  configured `tags`, via the Stack Exchange API; a quiet week widens the
  window until there are at least `minimum` questions. Rebuilt every run.
- **arXiv.** The newest submissions in `categories`, from the arXiv API's
  Atom feed — sorted by submission date, so cross-lists and replacements
  appear alongside genuinely new papers. Rebuilt every run.

Adding a source means a small builder module in `scripts/sections/wikis/`
returning `{ items: [{ title, description, extract, url }], perPage }`, an
entry in the `TABS` table of `scripts/sections/wikis.mjs`, and its id in
`wikis.tabs`; the page renders any tab of that shape without changes.

### Artwork

One work a day, picked from Wikidata and described with Wikipedia's own
prose. Candidates are works matching the movements (`P135` values), genres
(`P136` values), and optional inception window configured per interest
area in `config.json` — and they must have an English Wikipedia article,
which is what guarantees there's real text to show about the work. The
image comes from Commons (`P18`) when the work has one; otherwise the
article's own lead image is used — usually the fair-use reproduction,
which is the only image that exists for movements whose works are still
in copyright (Abstract Expressionism, Pop Art…), since those can never
carry a free Commons image. A work with neither image is passed over for
the next candidate in the day's order. The article's lead paragraph (and the artist's, when
the creator has an article) comes from the same REST summary endpoint the
Wikipedia tab uses. Which interest area supplies the day rotates with
the day of the year; within it the pick is deterministic — candidates are
ordered by a hash of the item and the date — so rebuilds on the same day
agree without any stored state, and yesterday's work is avoided when
there's a choice. The die beside the plate re-rolls client-side, exactly
like the Wikipedia tab's picks: a random interest area with a fresh seed,
straight from the browser (both APIs answer anonymous CORS requests; the
page carries a mirror of the builder's query, so changes to one mean
changes to the other). Commons images hotlink through `Special:FilePath`
at a bounded width, so the page never pulls a full-resolution scan
(fair-use images from Wikipedia are deliberately low-resolution to begin
with and hotlink as-is); clicking the image opens a larger view.

Each entry in `artwork.interests` looks like:

```jsonc
{
  "id": "implandscape",
  "label": "Impressionist landscapes",  // shown above the plate
  "movements": ["Q40415"],              // P135 values — alternatives (OR)
  "genres": ["Q191163"],                // P136 values — alternatives (OR)
  "from": 1860, "to": 1930,             // optional inception window (P571)
  "weight": 3,                          // optional slots in the rotation (default 1)
  "classes": ["Q3305213", "Q11060274"], // optional; the default is painting
  "viaCreator": true                    // optional; movements also match through the artist
}
```

Wikidata tags far more artists with a movement than it tags individual
works — Surrealism has around 55 paintings with an English article tagged
directly, but around 280 by artists tagged as Surrealists. `viaCreator`
accepts a work whose creator (P170) carries the movement too, which is
what keeps small movements from repeating; the cost is a little precision
(a late Picasso still life counts as Cubism because Picasso does). The
published payload also remembers the last 20 picks and the day's draw
skips them when it has a choice.

Within `movements` (and within `genres`) the values are alternatives, but
listing *both* keys requires both to match — the example above means
Impressionist landscapes, not either. `weight` gives favourite areas more
days in the rotation (and more rolls of the die). To add an area, find the
movement or genre on wikidata.org (search for "cubism", say — the Q-number
is right in the page title) and list it. Check which property Wikidata
actually uses for it before deciding between `movements` and `genres`:
ukiyo-e, for instance, is attached to works as a genre (P136), never as a
movement, so listing it under `movements` matches nothing and the section
goes stale on that day. An interest whose tradition isn't mainly paintings
can widen `classes`, as the ukiyo-e default does to include prints,
woodblock and woodcut prints, and print series; a `classes`-only interest
(no movements or genres) works too — the sculpture default is just every
notable sculpture from 1900 on.

### Albums

The "Daily album recommendations" Claude task publishes its three picks —
with blurbs — as `albums/latest.json` (plus a dated copy) in the private
`spotify-recs` repository, next to the recommendation-history CSV it
already keeps. The build fetches that file via the GitHub contents API
using the `SPOTIFY_RECS_TOKEN` secret, then adds cover art to each entry
from Spotify's public oEmbed endpoint (no auth; a missing cover just
renders as a text-only card). On desktop browsers, album links first try
the Spotify app via its `spotify:` URI and fall back to the web player if
nothing answers within a beat — installation can't be detected outright. No secret configured, or no file yet: the
section quietly reads `pending` in the ledger. Transient fetch failures
keep the previous day's picks, marked `stale`.

The archive of every pick lives on its own page, `albums.html` ("All
albums"), linked under the daily cards: sortable by recommendation
date, release year, or artist, and filterable by category, genre, and
search. Its data file, `data/archive.json`, is built by merging the dated
`albums/*.json` files with `recommendation_history.csv` — picks from
before the JSON era appear with facts and cover but no notes. The build
uses the currently-published archive as a cache, so it only reads what's
new. The two pages duplicate the theme CSS; a theme change means editing
both.

#### Listening log

Every album card carries a "Listened" checkbox, and a checked card grows a
heart for marking the album liked — on the daily cards, in the archive's
detail overlay, and as small badges on the archive tiles. The marks live in
`listening_log.csv` in the same private data repository
(`artist,album,first_listened,liked`, one row per listened album), which
makes them the one deliberate exception to the site's one-directional
architecture: the page *writes* as well as reads. `listening.js` (shared by
both pages) commits the file through the GitHub contents API using a
fine-grained PAT with read-and-write **Contents** access to the data
repository — offered for pasting on your first mark, reopenable by
shift-clicking any checkbox, and kept in that browser's localStorage
(separately from the add-a-blog dialog's token, though a single PAT granted
access to both repositories can be pasted into both). The morning album
task reads the same file and lets liked albums lightly tilt its picks.

Marks work without a token too — they just stay in that browser. With one,
state travels: the page reads the log live on load, the build bakes each
entry's `listened`/`liked` flags into `albums.json` and `archive.json`
(which are as public as the rest of the deployed site — bear that in mind),
and a mark made anywhere shows up everywhere after the next build, or
immediately on any browser holding a token. Local marks are kept until
their commit succeeds, so an offline like isn't lost — it lands next time
the page is open.

The contract the task fulfills:

```jsonc
{
  "date": "2026-07-29",
  "title": "Three albums for 29 July",
  "albums": [
    {
      "category": "focus",          // focus | familiar_artist | new_artist
      "header": "Focus",            // Focus | Enjoy | Explore
      "artist": "…",
      "album": "…",
      "year": 1974,
      "genres": ["…"],
      "spotify_url": "https://open.spotify.com/album/…",
      "link_is_search": false,      // true when only a search link could be verified
      "blurb": "…",                 // the bulletin's info paragraph
      "reception": "…"              // the verified reception sentence
    }
    // … three entries, in Focus, Enjoy, Explore order
  ]
}
```

## Themes

Fourteen theme families ship in `index.html`, each in a light *and* a dark
variant — mostly organic, calming palettes (Moss, Flax, Clay, Tidepool,
Dune) with a few that branch out (Cartographer, Observatory, Zine),
alongside the original faces (Broadsheet, the default; Preprint; Gallery;
Slate; Nocturne; Console). The palette button in the masthead picks the
family and a Light/Dark switch picks the mode; both persist per browser via
`localStorage` (`ultrafilter:theme`, `ultrafilter:mode`), and a first visit
follows the system's light/dark preference. All faces are system fonts;
some families lay a faint tiling texture over the ground colour, loaded
from [transparenttextures.com](https://www.transparenttextures.com/) — the
one external request theming makes, and if it can't be reached the plain
colour simply shows.

## Setup

1. **Create a repository** and copy these files into it (push to `main`).

2. **Turn on Pages.** Settings → Pages → Source: *GitHub Actions*. Your page
   will be at `https://<username>.github.io/<repo>/`.

3. **Add the albums token** (skip if you don't use the albums section):
   a fine-grained PAT with read-only **Contents** access to the data
   repository, saved as the `SPOTIFY_RECS_TOKEN` Actions secret
   (Settings → Secrets and variables → Actions). The listening log's
   write token is separate and never stored in the repo — the page asks
   for it in the browser (see *Listening log* above).

4. **Run it once by hand** (or just push). Actions tab → *Build and deploy* →
   *Run workflow*. Every run builds all sections and deploys the site with
   fresh data; until the first one finishes there's nothing at the URL.

After that it refreshes every two hours on its own, plus once at 9:45 UTC to
pick up the morning's albums shortly after the Claude task lands them.

### Putting it inside an existing site instead

The workflow deploys its build as the *entire* Pages site, so it wants a repo
of its own. To embed this page in a site repo you already have, don't reuse
the workflow as-is — it would replace your whole site. Either have your
site's own build pipeline run `scripts/build.mjs` and include the output
in its deploy, or fall back to committing `data/` to the branch your site
deploys from.

## Search engines

`index.html` carries `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">`.
Google and other major engines honor this and will keep the page out of their
results.

Two caveats worth being clear about:

- **This is not privacy.** A GitHub Pages site is publicly readable by anyone
  who knows the URL. `noindex` prevents listing, not access. If you need actual
  privacy, GitHub Pages is the wrong host — you'd want a private server with
  authentication, or just run the build locally and open the file from disk.
- **Don't add a `robots.txt` `Disallow` rule for this page.** It sounds like
  belt-and-braces but is counterproductive: `Disallow` stops crawlers from
  *fetching* the page, so they never see the `noindex` tag, and the URL can
  still appear in results if a link to it is discovered elsewhere. Allowing the
  crawl and serving `noindex` is the reliable combination.

## Maintaining it

Everything lives in `config.json`: the blogroll's topics and feeds, the
weather location, the Wikipedia interest areas and the other wikis tabs'
settings, the artwork interest areas, and the albums data source.
Adding a blogroll topic means adding an entry to `blogroll.topics` and
referencing its `id` from any feed; the filter chips and dot colors follow
automatically. `site` is the deployed URL, which the build uses to recover
the currently-published data when a section's fresh build fails.

Any push to `main` redeploys the site with freshly built data, so a config
change takes effect as soon as its push lands.

### Adding a blog from the page

The **+** button next to the Blogroll heading adds a feed without leaving the
site. Paste the blog's address and the dialog finds the feed itself — as the
feed URL directly, via the page's `<link rel="alternate">`, or by probing
common paths (`/feed/`, `/atom.xml`, …), falling back to the same
read-through proxies the build uses when the publisher doesn't send CORS
headers. A source only counts once it actually parses as a feed, and the
name, author, and site prefill from it. Committing goes through the GitHub
contents API: the entry is spliced into `config.json` textually (so the
file's hand formatting survives), and the push triggers the normal
build-and-deploy — the new blog is on the page a few minutes later.
Duplicates are refused by feed or site URL.

One-time setup per browser: the dialog asks for a fine-grained PAT with
read-and-write **Contents** permission on this repository only, kept in
`localStorage` (`ultrafilter:ghToken`) — it never travels anywhere but
api.github.com. Off GitHub Pages (localhost, a custom domain) the dialog
also asks which repository to commit to, since it can't be read off the URL.

## Reading the ledger

The ledger in the page footer reports the last build: one entry per
section, with the per-feed detail expanding under the Blogroll entry. When
a feed fails, the error tells you what to do:

| What it says | What it means |
| --- | --- |
| `HTTP 404` | The feed URL is wrong or the blog moved. Find the new one. |
| `HTTP 403` | The publisher blocks automated fetching — frequently by IP range, since CI runners sit in cloud ranges that firewalls reject. The build retries such feeds through a read-through proxy automatically. |
| `no <item> or <entry> elements found` | That URL returned something that isn't a feed (a web page, or a proxy's rewrite of one). Each failed source is listed with its own error, separated by `\|`. |
| `HTTP 5xx` / `timeouts` | The blog's server had a bad moment. It'll likely fix itself. |
| `stale · <date>` | That section's fresh build failed, so the previously published data is still being served. |
| `pending` | The albums section has no token configured, or the task hasn't published a file yet. |

During the build, the job fails loudly only if the blogroll ends up with no
posts from any source — a couple of stubborn publishers won't turn the whole
run red. A run that fails at that stage deploys nothing, so the previously
published site stays up untouched.

There is one deliberate exception: once a day, the 9:45 UTC run finishes
with a freshness check (`scripts/check-freshness.mjs`) *after* the deploy.
If the artwork or albums section, or any wikis tab, had to fall back to
stale data, that run is marked failed — the page has already updated with everything that did build;
the red run exists purely so GitHub's run-failed email tells you a daily
section is quietly stuck (a failing Wikidata query, an expired
`SPOTIFY_RECS_TOKEN`) instead of it rotting unnoticed.

## Running it locally

```sh
npm ci
node scripts/build.mjs         # writes data/*.json
python3 -m http.server 8123    # then open http://localhost:8123/
```

Locally the albums section needs `SPOTIFY_RECS_TOKEN` in the environment to
build fresh; without it the builder falls back to whatever the live site is
serving. Opening `index.html` directly from disk works in Safari but not
Chrome, which blocks `fetch` of local files; the tiny server above sidesteps
that.

## A note on scheduled workflows

GitHub disables cron-triggered workflows in repositories with no commits for
60 days, and emails you when it does. Since the build job deliberately never
commits, this *will* come up if you go two months without pushing anything:
the schedule pauses until you re-enable the workflow from the Actions tab (or
push again). The email is the tell; re-enabling is one click.
