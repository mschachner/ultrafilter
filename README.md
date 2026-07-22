# spotify-recs

Data store for Mark's daily album-recommendation task (Claude Cowork scheduled task "Daily album recommendations", 5:00 AM Eastern, Sunday–Friday).

Each run clones this repo, reads the library and history, picks three albums (Focus / Enjoy / Explore), appends three rows to `recommendation_history.csv`, and pushes the commit. Git history doubles as an audit log of every day's picks.

## Files

- `Liked_Songs.csv` — raw Spotify liked-songs export (2026-07-13 snapshot).
- `library_albums.csv` — the library aggregated by artist and album with liked-track counts; this is what runs actually parse. Columns: `Artist Name(s)` (semicolon-separated), `Album Name`, `Liked Track Count`.
- `recommendation_history.csv` — one row per recommendation: `date,category,artist,album,release_year,spotify_url`, category ∈ focus | familiar_artist | new_artist. Runs never repeat an album and space featured artists out by 90 days.
- `taste_profile.md` — genre/decade summary used for context.

## Maintenance

- **Refresh the library:** replace `Liked_Songs.csv` with a newer export and delete or regenerate `library_albums.csv` — runs prefer a raw `Liked_Songs.csv` when its data is newer, and will aggregate it themselves.
- **Token:** runs authenticate with a fine-grained PAT scoped to this repo (Contents: read/write). When it expires, generate a new one and ask Claude to update the scheduled task.
