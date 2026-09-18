Create Mark's daily album recommendations and today's artwork and wiki picks for his Ultrafilter site. Your final response must be the finished bulletin described in step 7 — it is delivered to Mark, so do not pad it with process narration.

DATA STORE — this session's repository, mschachner/ultrafilter, is already cloned into the working directory on its main branch (the site's code). Everything editorial lives on its orphan `data` branch, the store. Set it up first, without re-cloning:

  git fetch origin data && git worktree add store data

Then every data file is under store/ and every commit is made there (cd store). The repository is public; the store contains:

- store/library_albums.csv — Mark's Spotify liked-songs library aggregated by album. Columns: "Artist Name(s)" (semicolon-separated credited artists), "Album Name", "Liked Track Count".
- store/Liked_Songs.csv — the raw Spotify export the aggregate was built from. If its last commit is NEWER than library_albums.csv's (check with git log -1 --format=%ct -- <file>, run inside store/), Mark has refreshed his library: aggregate liked-track counts per artist-and-album pair from the raw export yourself instead of using the stale aggregate.
- store/recommendation_history.csv — the full recommendation history, one row per pick: date,category,artist,album,release_year,spotify_url, category values focus | familiar_artist | new_artist.
- store/taste_profile.md — a genre and decade summary of the library.
- store/likes.json — everything Mark has marked on the site: { "version": 1, "items": [ ... ] }, each item with a "kind" and "key". kind "album" items are the listening log (artist, album, genres, listened date, liked true/false); kind "artwork" items record liked works (title, artist, artistId as a Wikidata Q-number, interest area id); kind "wiki" items record liked wiki entries (source tab id, title, url, topic for Wikipedia); kind "post" items record liked blogroll posts (title, feed, topics). The file may not exist yet; treat absence as empty.
- store/blogroll.json — the roll: which blogs the site's blogroll fetches, each with a status (pinned, active, or archived). Only scripts/roll-cli.mjs touches it (step 6).
- store/albums/ and store/picks/ — what this task has published before (dated JSON files plus latest.json in each).
  `node scripts/candidates.mjs likes` (run from the repository root, not store/) prints a digest of likes.json — counts per interest area, artist, topic, feed and liked-album genre, every liked item, and everything already picked — which is the quickest way to read it.

If the repository contents are missing or unreadable, deliver the bulletin anyway using your best judgment of Mark's taste from taste_profile.md if available, lean away from flagship albums of well-known artists, skip steps 5, 6 and 8, and append this warning as the bulletin's final line: "⚠ The data repo was unreadable this run: repeat-prevention was not checked and today's picks were not recorded."

On every run:

1. Read the full library, recommendation_history.csv, and likes.json if it exists. Normalize comparisons case-insensitively, trim whitespace, and split semicolon-separated values in "Artist Name(s)" so each credited artist counts individually. Use the liked-track counts for each normalized artist-and-album pair. Do this parsing programmatically in bash/python, not by eyeballing.

2. Use web research to verify each album candidate's artist, album title, release year, genre, album status, discography context, critical and/or commercial reception, strictly instrumental status where applicable, and Spotify album URL. Prefer authoritative or reputable sources such as the artist, label, official discography, Bandcamp, AllMusic, Discogs, established music publications, official charts, or awards organizations. Do not invent facts or links.

3. Select exactly three full-length albums, with three different artists:

   - Focus: A strictly instrumental album suitable for focused work. The entire album must contain no sung vocals, wordless vocals, spoken word, or vocal-led tracks. Rotate among styles compatible with the library, including jazz, jazz fusion, funk, bossa nova, ambient, electronic, lo-fi, and adjacent instrumental music.
   - Enjoy: An album by an artist with at least one liked song in the library. The album may contain one or two liked songs, but exclude it if three or more of its tracks are already liked.
   - Explore: An album by an artist whose normalized name does not appear among any credited artists in the library. Choose from musical territory consistent with the library's patterns without simply repeating its most common genre.
     Let the album items in likes.json lightly inform these choices: albums marked liked (and their recorded genres) are a soft signal of current taste, so when candidates are otherwise comparable, lean toward artists, styles, or eras adjacent to recently liked albums. Albums marked listened but not liked are neutral, not a negative signal. Keep this influence gentle — it must never override the category rules, repeat-prevention, or rotation below, and the picks should keep ranging widely rather than clustering around recent likes.

4. Never recommend an album already present in recommendation_history.csv. Do not feature any artist who appeared in the history during the previous 90 days. Keep the three choices distinct from one another, rotate genres and eras, and avoid three albums that occupy nearly identical musical territory.

5. Choose today's artwork and wiki picks. The site build resolves each pick itself — image, prose and metadata come from the source — so you only supply identifiers. Use the candidates script from the repository root; it prints JSON and needs no npm install:

   - Artwork: `node scripts/candidates.mjs artwork --interest <id>` lists works with an English Wikipedia article in one interest area from config.json (ids: modern, implandscape, abex, surrealism, ukiyoe, popart, contemporary, sculpture), in a fresh random order, excluding works picked before; `--creator Q…` lists works by one artist. Choose which area or artist to draw from by judgment against the likes digest — lean toward areas and artists Mark has liked, but keep rotating so every area comes up and no artist dominates; on a day with no artwork likes, rotate areas. Prefer candidates with hasImage true. Pick one work.
   - Wikis: `node scripts/candidates.mjs wikis --count 10` lists random entries for the wikipedia, nlab, sep, attic and oeis tabs (title and URL; for Wikipedia, Good articles per interest area with a topic id). Pick three Wikipedia articles (three different topics unless the likes clearly favour one) and one lead entry each for nlab, sep, attic and oeis, judged against the likes: liked wiki entries show which sources and topics Mark responds to. Set theory, mathematical logic, category theory, philosophy of mathematics and art history are safe bets when the likes say nothing. Skip a tab whose candidates all fail to load rather than inventing a URL. MathOverflow and arXiv leads are optional: include one only if you happen to know of a clearly relevant current question or paper, with its real URL.

6. Maintain the blogroll. The roll — which blogs the site's blogroll fetches — is store/blogroll.json, and scripts/roll-cli.mjs (run from the repository root) is the only way you change it. Every entry has a status: pinned (Mark's choice, permanent), active (on trial), or archived (rotated out, or removed by Mark — never propose an archived blog again).

   a. `node scripts/roll-cli.mjs status` prints the roll as JSON: the policy (targetSize, trialDays), the free slots, every blog with its days in the roll, liked posts and last build result, the blogs due for rotation, and the archive.
   b. `node scripts/roll-cli.mjs rotate` archives every active blog that has been in the roll for trialDays with no liked post. This is mechanical: run it every time, and never archive or un-archive a blog any other way.
   c. If slotsFree is above zero after rotating, add exactly one blog. Use web research to find a blog with a working RSS or Atom feed that fits Mark's interests as the likes show them — the feeds and topics of liked posts, the sources and topics of liked wiki entries, and the roll's topic ids from config.json (math, sci, arthist, arts, climate), spread across the topics over the weeks rather than clustering on one. Prefer blogs that are still posting (something within the last few months), written by a person or a small group rather than an institution's press feed, and not already in the roll or the archive. Verify it: run `npm ci` once (the feed parser), then `node scripts/roll-cli.mjs check <blog or feed URL>` — it must print a parsed feed with recent entries and `duplicateOf: null`. If it fails, try a different blog (up to three) rather than adding one unverified. Then `node scripts/roll-cli.mjs add <url> --topics <ids> --by task --note "<one plain line on why this blog>"`, passing --name and --author when the feed's own are poor. Never add more than one blog per run; when the roll is full, add none.
   d. Nothing here needs judgment about Mark's existing blogs: do not pin, unpin or remove anything.
   e. If scripts/roll-cli.mjs is missing from the checkout or `status` reports the roll's source is not "store", the roll has not been set up yet: skip this step and report "Blogroll: not set up yet" in the bulletin.

7. Output a compact editorial bulletin headed "Three albums for [D Month]" (today's date). Use the section headers exactly "Focus", "Enjoy", and "Explore", in that order. For each section, include:

   - Artist — Album (release year)
   - One or two accurate genre labels
   - A direct Spotify album link; if a direct album URL cannot be verified, use a Spotify search link clearly labeled as such
   - A concise paragraph of useful information, not a recommendation rationale: introduce the artist when Mark is unlikely to know them, explain the album's place in the artist's discography, and add historical context when genuinely relevant
   - One verified sentence about the album's critical and/or commercial reception. Prefer a concrete fact such as a contemporary review assessment, a year-end-list placement, an award or nomination, chart performance, sales milestone, breakout status, or a sourced comparison with adjacent albums. Do not call an album "acclaimed" or make comparative claims without evidence.
     Do not append explanatory qualifiers to the three section headers. Do not include a starter track. Do not explain why Mark will like the album. Do not add extra recommendations.
   After the three sections, add one short line "Also today:" naming the artwork (title, artist) and the wiki leads (tab: title) you picked — titles only, no commentary — and then "Blogroll: added <name> (<topics>); rotated out <names>", or "Blogroll: no change", as the case may be.

8. After finalizing the selections, record them in the store (all paths relative to store/):
   a. Append exactly three rows for today to recommendation_history.csv (columns date,category,artist,album,release_year,spotify_url; category values focus, familiar_artist, new_artist for the Focus, Enjoy, Explore sections respectively). Quote CSV fields correctly when they contain commas or quotation marks. Do not rewrite or delete prior rows.
   b. Write the day's album content as JSON to albums/<today YYYY-MM-DD>.json and copy that same file to albums/latest.json (latest.json must be an exact copy of the dated file). The site build consumes albums/latest.json, so follow this schema exactly:
   {
     "date": "<today YYYY-MM-DD>",
     "title": "Three albums for <D Month>",
     "albums": [
    {
      "category": "focus",
      "header": "Focus",
      "artist": "<artist>",
      "album": "<album>",
      "year": <release year, as a JSON number>,
      "genres": ["<genre>", "<genre>"],
      "spotify_url": "<the same link as the bulletin>",
      "link_is_search": false,
      "blurb": "<the section's concise information paragraph, exactly as it appears in the bulletin>",
      "reception": "<the section's verified reception sentence, exactly as it appears in the bulletin>"
    },
    ...three entries total, in Focus, Enjoy, Explore order
     ]
   }
   The three entries carry category values focus, familiar_artist, new_artist (matching the CSV) and header values Focus, Enjoy, Explore respectively. genres holds the same one or two genre labels as the bulletin. Set link_is_search to true only when the link is a search link rather than a verified album URL.
   c. Write the artwork and wiki picks as JSON to picks/<today YYYY-MM-DD>.json and copy it to picks/latest.json (create picks/ if it does not exist). Schema — every key besides date is optional, and the URLs must be exactly the ones the candidates script printed:
   {
     "date": "<today YYYY-MM-DD>",
     "artwork": { "wikidata": "<Q-number>", "title": "<title>", "interest": "<interest id, when drawn from an area>" },
     "wikis": {
       "wikipedia": [ { "url": "<article URL>", "title": "<title>", "topic": "<topic id>" }, ... three entries ],
       "nlab":  { "url": "<page URL>", "title": "<title>" },
       "sep":   { "url": "<entry URL>", "title": "<title>" },
       "attic": { "url": "<page URL>", "title": "<title>" },
       "oeis":  { "url": "<sequence URL>", "title": "<title>" },
       "mathoverflow": { "url": "...", "title": "..." },
       "arxiv": { "url": "...", "title": "..." }
     }
   }
   Validate that both files parse as JSON (e.g. with python3 -m json.tool) before committing. Then, inside store/, commit directly on the data branch — do not create a claude/ branch — and push:

   cd store
   git add recommendation_history.csv albums/ picks/ blogroll.json
   git commit -m "Add picks for <today YYYY-MM-DD>"
   git push origin data

   If the push is rejected (non-fast-forward), run git pull --rebase origin data and push again. If pushing still fails after 3 further attempts spaced about a minute apart, deliver the bulletin anyway but clearly warn at the end that repeat prevention was not recorded and that today's picks will not appear on the site. Never commit or push to main.
