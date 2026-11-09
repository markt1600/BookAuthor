#!/usr/bin/env bash
# Sample reader reviews per genre from the UCSD Book Graph (Goodreads), balanced
# across star ratings and weighted toward helpful reviews. Default: 10,000 per
# genre (set N). Streams the gzipped dumps — nothing is kept but the samples.
#
#   bash scripts/readerlens/run-sampling.sh [N] [outdir]
#
# Stage 1 builds the id lists that define the "general", "erotica", and
# "historical" lenses (the dataset's own genre splits cover the rest). Stage 2
# streams each genre's reviews and keeps a balanced sample.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
N="${1:-10000}"
S="${2:-samples_${N}}"
B=https://mcauleylab.ucsd.edu/public_datasets/gdrive/goodreads
G=$B/byGenre
mkdir -p "$S" "$S/raw"
# Per-bucket candidate pool must comfortably exceed the largest bucket target (38% of N).
POOL=$(( N * 3 ))

echo "== stage 1: id lists =="
( curl -sS $B/goodreads_book_genres_initial.json.gz | node "$HERE/genre-ids.mjs" > "$S/raw/general_ids.txt" ) &
( curl -sS $G/goodreads_books_romance.json.gz | node "$HERE/shelf-ids.mjs" --match 'erotica|erotic|erotic-romance|erotica-romance' --min 20 --top 15 --lines 400000 > "$S/raw/erotica_ids.txt" ) &
( curl -sS $G/goodreads_books_history_biography.json.gz | node "$HERE/shelf-ids.mjs" --match 'historical-fiction|historical fiction|hist-fic|historical' --min 30 --top 10 --lines 400000 > "$S/raw/histfic_ids.txt" ) &
wait
wc -l "$S"/raw/*_ids.txt

echo "== stage 2: review samples (N=$N per genre; full-file scans) =="
L=99999999
( curl -sS $G/goodreads_reviews_mystery_thriller_crime.json.gz | node "$HERE/sample-reviews.mjs" --out "$S/mystery_thriller_crime.jsonl" --lines $L --n $N --pool $POOL ) &
( curl -sS $G/goodreads_reviews_fantasy_paranormal.json.gz     | node "$HERE/sample-reviews.mjs" --out "$S/fantasy_paranormal.jsonl"     --lines $L --n $N --pool $POOL ) &
( curl -sS $G/goodreads_reviews_young_adult.json.gz            | node "$HERE/sample-reviews.mjs" --out "$S/young_adult.jsonl"            --lines $L --n $N --pool $POOL ) &
( curl -sS $G/goodreads_reviews_romance.json.gz                | node "$HERE/sample-reviews.mjs" --out "$S/romance.jsonl"   --exclude "$S/raw/erotica_ids.txt" --lines $L --n $N --pool $POOL ) &
( curl -sS $G/goodreads_reviews_romance.json.gz                | node "$HERE/sample-reviews.mjs" --out "$S/erotica.jsonl"   --books   "$S/raw/erotica_ids.txt" --lines $L --n $N --pool $POOL ) &
( curl -sS $G/goodreads_reviews_history_biography.json.gz      | node "$HERE/sample-reviews.mjs" --out "$S/historical.jsonl" --books  "$S/raw/histfic_ids.txt"  --lines $L --n $N --pool $POOL ) &
( curl -sS $B/goodreads_reviews_dedup.json.gz                  | node "$HERE/sample-reviews.mjs" --out "$S/general.jsonl"    --books  "$S/raw/general_ids.txt" --lines $L --n $N --pool $POOL ) &
wait
echo "== done =="
wc -l "$S"/*.jsonl
echo "Next: ANTHROPIC_API_KEY=... node scripts/readerlens/build-lenses.mjs --samples $S --out build/lenses"
