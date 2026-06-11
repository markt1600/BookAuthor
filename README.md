# Loom — a co-writing studio

Loom is a studio for writing a novel with an AI author, two ways. **Write together** and you trade passages — you write, and the AI answers in your voice, at about the same length, matching the genre and tone you've established. Or **guide the story** and you direct while the AI writes every line, section by section, from your instructions. Either way the book is woven into one voice and read as a real, page-turning manuscript.

## Two ways to write

When you start a book, Loom asks how you want to make it:

- **Write together (participate)** — you and the AI author trade passages in one shared voice. You write; it continues in your style and at your length.
- **Guide the story (guide)** — you direct, the AI author writes. You describe what should happen next and it writes the next ~275-word section. Instead of a paper/material choice, the setup offers a **writing style** (Literary, Cinematic, Cozy, Noir, Whimsical, Adventure, Gothic, Minimalist), plus **point of view**, **tense**, **creative latitude**, and — for adult books — an **adult-audiences** toggle with **violence/gore, explicitness, and language** intensity sliders (off by default; all characters written as adults). The reader's notes (genre, prose voice, synopsis, story memory, craft) update as the story develops, the page-based reading/navigation is identical, and each section shows the direction that produced it. After the first section, the next direction box is **pre-filled with a suggested direction** the AI proposes — accept it to continue the arc, or rewrite it to steer your own way. **Section length** is adjustable from 150–400 words (default 275). Both the writing style and these guide options stay editable later from Settings. In guide mode the **Craft** note is relabeled **Story & direction** and scores the story and your directorial choices — not the prose, since the AI writes it and shouldn't grade its own writing.

## What's inside

- **Title page setup** — name the book and author, pick a cover, page format, material, typeface (serif, sans, mono, storybook, or **cursive**), **ink color**, and reading size. A **live preview** updates as you choose, both here and in **Settings**, so you see the page before you commit. Sensible defaults are pre-selected, so you can just begin. Everything is editable later, on any page.
- **Writing & directing** — in *participate* mode, write your passage and hand it to the AI author; it continues for roughly the same number of words, in the same style. In *guide* mode, write a direction and the AI writes the next section. When a reply lands, the view jumps to where the new text begins and it's "written in" with a brief reveal animation.
- **Real-book pages** — the manuscript flows into fixed-size pages like a printed book (text reflows and splits across pages exactly to fit). In participate mode a translucent inset box and a "spine ledger" show which hand wrote which thread; in guide mode the prose reads as one continuous voice. Turning pages plays a 3D page-flip animation, and on touch you can swipe between pages.
- **Reader's notes** — the AI author keeps a live read on the prose voice, the genre, a running synopsis, story memory (cast, places, facts, open threads), and a craft/story score, updated after every exchange.
- **Navigate & fork** — page back and forth through the book. "Edit from here" pulls a passage (or a direction) back into the editor and discards everything after it — the book forks at that point.
- **Chapters** — mark a new chapter while you write, or manage them later from the **Chapters** panel: add, rename, remove, and jump to any chapter. Chapters open on a fresh page, with a heading, both on screen and in the PDF.
- **Shareable URL** — every book lives at its own link; return to it later or share it.
- **Read aloud** — narrate the book with one tap: it starts from the current page and auto-advances, turning pages as it goes, until the end of the story or you stop. Uses ElevenLabs text-to-speech (set `ELEVENLABS_API_KEY`; optional `ELEVENLABS_VOICE_ID` / `ELEVENLABS_MODEL_ID`).
- **PDF export** — exports through a print view that honors your cover, format, material, typeface, and size.
- **Library** — an `admin · all books` view lists every book with its word count and last-edited time, where you can open or delete any book. It can be protected with an optional admin password.
