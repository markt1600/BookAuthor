# Loom — a turn-based co-writing studio

You write a passage. An AI author answers in your voice, at about the same length, matching the genre and tone you've established. The book is woven from two hands — and you can always see which hand wrote which thread.

## Two ways to write

When you start a book, Loom asks how you want to make it:

- **Write together (participate)** — you and the AI author trade passages in one shared voice. You write; it continues in your style and at your length.
- **Guide the story (guide)** — you direct, the AI author writes. You describe what should happen next and it writes the next ~275-word section. Instead of a paper/material choice, the setup offers a **writing style** (Literary, Cinematic, Cozy, Noir, Whimsical, Adventure, Gothic, Minimalist), plus **point of view**, **tense**, **creative latitude**, and — for adult books — an **adult-audiences** toggle with **violence/gore, sexual content, and language** intensity sliders (off by default; all characters written as adults). The reader's notes (genre, prose voice, synopsis, story memory, craft) update as the story develops, the page-based reading/navigation is identical, and each section shows the direction that produced it. After the first section, the next direction box is **pre-filled with a suggested direction** the AI proposes — accept it to continue the arc, or rewrite it to steer your own way. **Section length** is adjustable from 150–400 words (default 275). Both the writing style and these guide options stay editable later from Settings.

## What's inside

- **Title page setup** — name the book and author, pick a cover, page format, material, typeface (serif, sans, mono, storybook, or **cursive**), **ink color**, and reading size. A **live preview** updates as you choose, both here and in **Settings**, so you see the page before you commit. Sensible defaults are pre-selected, so you can just press **Continue**. Everything is editable later, on any page.
- **Turn-based writing** — write your turn, hand it to the AI author, and it continues the story for roughly the same number of words, in the same style. When the reply lands, the view jumps to where the AI began and the new text is "written in" with a brief reveal animation. Live counters show words on the page, in the turn, and in the whole book.
- **Real-book pages & two-ink attribution** — the manuscript flows into fixed-size pages like a printed book (text reflows and splits across pages exactly to fit), so a single page can hold both hands. Your prose reads as the plain manuscript; the AI author's passages sit in a translucent inset box, and a passage can run across several pages. Turning pages plays a 3D page-flip animation. The "spine ledger" across the top shows the whole collaboration at a glance.
- **Reader's notes** — the AI author keeps a live read on your writing style, the genre, a running synopsis, and a craft score, updated after every exchange.
- **Navigate & fork** — page back and forth through the book. "Edit from here" pulls a passage back into the editor and discards everything after it — the book forks at that point.
- **Chapters** — mark a new chapter while you write (a toggle on the writing page), or manage them later from the **Chapters** panel: add, rename, remove, and jump to any chapter. Chapters open on a fresh page, with a heading, both on screen and in the PDF.
- **Saved server-side + shareable URL** — every book lives at `/book/<id>`. Copy the link to return later or share it.
- **PDF export** — exports through a print view that honors your cover, format, material, typeface, and size.
- **Admin / library** — a small `admin · all books` link on the landing page opens `/admin`, listing every book with its word count and last-edited time. From there you can **Open** any book (you enter as its author) or **Delete** it. This page is unauthenticated, so don't share its URL publicly — see the security note below.

## Run it locally

```bash
npm install
cp .env.example .env.local      # add your ANTHROPIC_API_KEY
npm run dev                     # http://localhost:3000
```

Locally, books are kept in an **in-memory store** if no KV credentials are set — fine for trying it out, but it does **not** persist across restarts. For real persistence, set up Redis (below).

## Deploy to Vercel

1. Push this folder to a Git repo and import it into Vercel (it auto-detects Next.js).
2. **Environment variables** → add `ANTHROPIC_API_KEY` (and optionally `CLAUDE_MODEL`).
3. **Storage** → add the **Upstash Redis** integration from the Vercel Marketplace and connect it to the project. It injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically (Upstash's own `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work).
4. Deploy. That's it.

> **Production needs a persistent store.** Vercel's serverless functions don't share memory between invocations, so the in-memory fallback won't persist there.

### Troubleshooting: "Book not found" right after creating a book

This almost always means **no persistent storage is configured**. Without Redis, Loom falls back to an in-memory store; on Vercel each request can land on a different worker, so the book you just created isn't there when the next request loads it. The landing page shows a warning banner when it detects this mode. The fix is to connect an Upstash Redis store (step 3 above). Locally with `npm run dev` it works within a single session because it's one process, but it still resets on restart.

### Security note on `/admin`

Set an **`ADMIN_PASSWORD`** environment variable to protect `/admin` (and its listing/delete endpoints) with a simple password gate: visitors get a lock screen, and on the correct password an http-only cookie is set for 12 hours (use **Lock** to sign out). Normal book reading, writing, and shareable `/book/<id>` links are unaffected. If `ADMIN_PASSWORD` is left unset, `/admin` stays open — fine for a private instance, but don't share that link publicly. This is lightweight protection suitable for a personal deployment, not a full auth system; for stricter needs, add Vercel password protection or an auth provider.

## How a turn works

1. The browser sends your text to `POST /api/books/:id/turn`.
2. The server commits your turn, then asks the AI author (server-side, key never exposed) to continue. For continuity it sends a cumulative **story-memory record** (cast, places, key facts, open threads), the book's **opening**, and the most **recent passages** — plus your word count as the target length. This keeps early characters and details alive on a long book without resending the entire manuscript every turn.
3. The server runs a second, low-temperature pass to refresh the style / genre / synopsis / craft notes.
4. The updated book is saved to the store and returned. If the model fails, your text is rolled back so you can retry cleanly.

## Project layout

```
app/
  page.js                     # title-page setup + live preview + create book
  admin/page.js               # library: list / open / delete every book
  book/[id]/page.js           # the writing studio
  book/[id]/print/page.js     # design-aware PDF/print view
  api/books/route.js          # POST create · GET list (admin)
  api/books/[id]/route.js     # GET load · PUT patch/fork · DELETE
  api/books/[id]/turn/route.js# POST submit turn -> AI continues + analyzes
  api/health/route.js         # reports storage mode (drives the warning banner)
lib/
  book.js                     # model, word counts, defaults, fork helpers
  store.js                    # Upstash Redis with in-memory dev fallback
  claude.js                   # server-only Anthropic calls
components/
  DesignControls.js · SettingsDrawer.js · ChaptersDrawer.js · CoverArt.js · BookPreview.js
```

## Notes & tradeoffs

- **PDF export** uses the browser's print-to-PDF so page size, fonts, and material backgrounds render exactly. Enable **"Background graphics"** in the print dialog to keep the material color and cover. (This avoids shipping a heavyweight PDF renderer and keeps fonts faithful.)
- **Forking** keeps it simple: editing snaps to the nearest *your-turn* boundary, so the AI author always regenerates its response to whatever you submit. The discarded tail is gone, as intended.
- **Long-range memory**: the continuation does not receive the whole book each turn (that would grow cost without bound and eventually exceed the context window). Instead it gets a running continuity record that the analysis pass updates every turn — carried forward even when older material scrolls out of the recent window — together with the opening and the recent text. The record is shown in the reader's notes as "Story memory."
  A per-book **"Send the whole book each turn"** toggle in Settings switches to full-manuscript context for maximum fidelity (best for shorter books; it automatically falls back to the layered context if a book grows past ~90k words so it can't overflow the model).
- **Cost/latency**: each turn is two model calls (continuation + analysis). Set `CLAUDE_MODEL=claude-haiku-4-5-20251001` for faster/cheaper turns, or `claude-opus-4-8` for the most capable prose. (The model name is never shown in the UI — it refers to itself only as "the AI author".)
