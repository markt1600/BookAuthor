# Loom — a turn-based co-writing studio

You write a passage. Claude answers in your voice, at about the same length, matching the genre and tone you've established. The book is woven from two hands — and you can always see which hand wrote which thread.

## What's inside

- **Title page setup** — name the book and author, pick a cover, page format, material, typeface, and reading size. Sensible defaults are pre-selected, so you can just press **Continue**. Everything is editable later from **Settings**, on any page.
- **Turn-based writing** — write your turn, hand it to Claude, and Claude continues the story for roughly the same number of words, in the same style. Live counters show words on the page, in the turn, and in the whole book.
- **Two-ink attribution** — your passages and Claude's are clearly marked, and the "spine ledger" across the top shows the whole collaboration at a glance.
- **Reader's notes** — Claude keeps a live read on your writing style, the genre, a running synopsis, and a craft score, updated after every exchange.
- **Navigate & fork** — page back and forth through the book. "Edit from here" pulls a passage back into the editor and discards everything after it — the book forks at that point.
- **Saved server-side + shareable URL** — every book lives at `/book/<id>`. Copy the link to return later or share it.
- **PDF export** — exports through a print view that honors your cover, format, material, typeface, and size.

## Run it locally

```bash
npm install
cp .env.example .env.local      # add your ANTHROPIC_API_KEY
npm run dev                     # http://localhost:3000
```

Locally, books are kept in an **in-memory store** if no KV credentials are set — fine for trying it out, but it does **not** persist across restarts. For real persistence, set up KV (below).

## Deploy to Vercel

1. Push this folder to a Git repo and import it into Vercel (it auto-detects Next.js).
2. **Environment variables** → add `ANTHROPIC_API_KEY` (and optionally `CLAUDE_MODEL`).
3. **Storage** → add the **Upstash Redis** integration from the Vercel Marketplace and connect it to the project. It injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically (Upstash's own `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work).
4. Deploy. That's it.

> Production needs a KV store. Vercel's serverless functions don't share memory between invocations, so the in-memory fallback won't persist there.

## How a turn works

1. The browser sends your text to `POST /api/books/:id/turn`.
2. The server commits your turn, then asks Claude (server-side, key never exposed) to continue — with the recent passage as context and your word count as the target length.
3. The server runs a second, low-temperature pass to refresh the style / genre / synopsis / craft notes.
4. The updated book is saved to KV and returned. If Claude fails, your text is rolled back so you can retry cleanly.

## Project layout

```
app/
  page.js                     # title-page setup + create book
  book/[id]/page.js           # the writing studio
  book/[id]/print/page.js     # design-aware PDF/print view
  api/books/route.js          # POST create
  api/books/[id]/route.js     # GET load · PUT patch/fork
  api/books/[id]/turn/route.js# POST submit turn -> Claude continues + analyzes
lib/
  book.js                     # model, word counts, defaults, fork helpers
  store.js                    # Upstash Redis with in-memory dev fallback
  claude.js                   # server-only Anthropic calls
components/
  DesignControls.js · SettingsDrawer.js · CoverArt.js
```

## Notes & tradeoffs

- **PDF export** uses the browser's print-to-PDF so page size, fonts, and material backgrounds render exactly. Enable **"Background graphics"** in the print dialog to keep the material color and cover. (This avoids shipping a heavyweight PDF renderer and keeps fonts faithful.)
- **Forking** keeps it simple: editing snaps to the nearest *your-turn* boundary, so Claude always regenerates its response to whatever you submit. The discarded tail is gone, as intended.
- **Cost/latency**: each turn is two Claude calls (continuation + analysis). Set `CLAUDE_MODEL=claude-haiku-4-5-20251001` for faster/cheaper turns, or `claude-opus-4-8` for the most capable prose.
