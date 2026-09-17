#!/usr/bin/env bash
# One-shot: fold the spotify-recs repository into this one as the `data`
# branch (the store), history and all, and convert its listening log into
# likes.json. Run once, from the root of this repository, with credentials
# that can read spotify-recs and push here:
#
#   scripts/migrate-store.sh [https://github.com/mschachner/spotify-recs.git]
#
# Afterwards `store/` is a worktree on the `data` branch (gitignored), the
# branch is on origin, and the workflow can run. spotify-recs itself is left
# untouched — archive or delete it once the scheduled task has been
# repointed at this repository and has run successfully.
set -euo pipefail
cd "$(dirname "$0")/.."   # always run from the repository root, wherever invoked from

SRC=${1:-https://github.com/mschachner/spotify-recs.git}

if git show-ref --verify --quiet refs/heads/data; then
  echo "a local 'data' branch already exists — nothing to do (delete it to redo the migration)" >&2
  exit 1
fi
if [ -e store ]; then
  echo "store/ already exists — move it aside first" >&2
  exit 1
fi

echo "== fetching spotify-recs's main as branch 'data'"
git fetch "$SRC" main:refs/heads/data

echo "== checking the store out into store/"
git worktree add store data

echo "== likes.json from listening_log.csv"
node scripts/migrate-likes.mjs store
(
  cd store
  git add likes.json
  if [ -f listening_log.csv ]; then git rm -q listening_log.csv; fi
  git commit -q -m "Store: likes.json replaces listening_log.csv"
)

echo "== pushing"
git push -u origin data

echo
echo "Done. The store is at store/ (branch 'data', pushed to origin)."
echo "Next: push main, then repoint the 'Daily album recommendations' task's"
echo "repository at this one (its prompt is in the project doc) and run the workflow once by hand."
