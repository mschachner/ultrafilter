# Ultrafilter

A personal daily feed on GitHub Pages, in four sections: a hand-picked
blogroll, the weather, Wikipedia (the day's featured article plus a few
quality articles from chosen interest areas), and the day's three album
picks.

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
daily sections stable: a rebuild that finds today's Wikipedia payload
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

### Wikipedia

The featured article comes from Wikimedia's featured-content API. The picks
are random members of English Wikipedia's **Good articles** category,
filtered by `articletopic:` (the ORES topic taxonomy) to the interest areas
in `config.json`; which areas are drawn from rotates with the day of the
year. Both are keyed to the local date and re-rolled once a day, however
often the build runs.

Each entry in `wikipedia.topics` maps an interest area to one or more
[articletopic values](https://www.mediawiki.org/wiki/Help:CirrusSearch#articletopic);
add or reweight areas there.

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

The archive of every pick lives on its own page, `albums.html` ("The
record crate"), linked under the daily cards: sortable by recommendation
date, release year, or artist, and filterable by category, genre, and
search. Its data file, `data/archive.json`, is built by merging the dated
`albums/*.json` files with `recommendation_history.csv` — picks from
before the JSON era appear with facts and cover but no notes. The build
uses the currently-published archive as a cache, so it only reads what's
new. The two pages duplicate the theme CSS; a theme change means editing
both.

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

Six presets ship in `index.html` — three light (Broadsheet, the default;
Preprint; Gallery) and three dark (Slate, Console, Nocturne), each with its
own faces. The palette button in the masthead switches; the choice persists
per browser via `localStorage`. All faces are system fonts, so theming adds
no external requests.

## Setup

1. **Create a repository** and copy these files into it (push to `main`).

2. **Turn on Pages.** Settings → Pages → Source: *GitHub Actions*. Your page
   will be at `https://<username>.github.io/<repo>/`.

3. **Add the albums token** (skip if you don't use the albums section):
   a fine-grained PAT with read-only **Contents** access to the data
   repository, saved as the `SPOTIFY_RECS_TOKEN` Actions secret
   (Settings → Secrets and variables → Actions).

4. **Run it once by hand** (or just push). Actions tab → *Build and deploy* →
   *Run workflow*. Every run builds all sections and deploys the site with
   fresh data; until the first one finishes there's nothing at the URL.

After that it refreshes every six hours on its own, plus once at 9:45 UTC to
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
weather location, the Wikipedia interest areas, and the albums data source.
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

The job fails loudly only if the blogroll ends up with no posts from any
source — a couple of stubborn publishers won't turn the whole run red. A
failed run deploys nothing, so the previously published site stays up
untouched.

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
