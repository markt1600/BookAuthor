# BookAuthor on the GPD

This branch runs the original Loom writing studio locally. `LOOM_OFFLINE=1` is
the default, even if cloud credentials happen to be present. Books, settings,
cast, canon, chapter notes and revision snapshots are stored in SQLite on the GPD.
The existing writing prompts and improvement pipeline are preserved. No extra
content filter is added; model behavior still depends on the selected weights.

## Open it

Launch **BookAuthor Offline** from Ubuntu's application menu, or open
http://127.0.0.1:3000 on the GPD. It starts when you log in.

The home page links to **Local writing models** and **Your library**. Prose,
analysis and revision can use separate installed model IDs. They run serially
because the local inference router loads one large model at a time. Model
choices persist across restarts. Start with `qwen36-huihui`; compare the other
abliterated models as their downloads and validation finish. Different models
are not guaranteed to match Claude's prose, factuality, instruction following,
or critique quality. A voice sample and the existing quality controls help.
New books enable planning, second takes and polishing by default to prioritize
quality. You can turn them off in Settings for faster generation.

From Windows, leave this terminal running:

```powershell
ssh -N -L 13000:127.0.0.1:3000 markt1600@192.168.1.82
```

Then visit http://127.0.0.1:13000. The server listens on loopback, not the LAN.

## Features retained

Both writing modes, streamed passages, autopilot, style/POV/tense/maturity
settings, canon, voice samples, cast, plans, second takes, polish, prose and
dialogue tells, section-shape memory, imagery memory, chapter summaries, cold
reads, setups/payoffs, scoring, consistency checks, rewrites, full manuscript
revision, manual editing, chapters, forks, revision history, bookmarks, search,
book design, pagination, EPUB and print-to-PDF remain in the app.

The GPD's normal model presets use 32,768-token context. The two largest
experimental models retain 4,096-token contexts and are not suitable for the
full BookAuthor analysis pipeline without further configuration. Layered
chapter memory is recommended for long books. Full-context mode is bounded by
the selected model's configured context; oversized requests report an error,
not silent truncation. Longer context and larger models require more memory.
Requests have a 30-minute transport timeout to accommodate local inference.

Cloud narration/audiobook synthesis and reMarkable cloud pairing/sync are
disabled offline. Browser read-aloud uses only locally installed voices, when
available. EPUB/PDF can be transferred by USB. Read-only reader URLs work
locally but are not public internet links. These were deprioritized for this
installation. Fonts are bundled; no Google Fonts connection is required.

## Installation and recovery

One-time installation needs internet for source code, npm packages and models.
Daily writing does not, once the chosen models have downloaded. Install Node.js
24 LTS and a local llama.cpp server with its OpenAI-compatible endpoint at
http://127.0.0.1:8080/v1. Then run:

```bash
git clone --branch gpd-offline https://github.com/markt1600/BookAuthor.git
cd BookAuthor
bash scripts/install-gpd.sh
```

The installer builds the app and creates a user service and desktop launcher.
It preserves an existing `.env.local`. See `.env.offline.example` for settings.
The model server and its downloads are managed separately under `~/local-ai`.
An explicit `LOOM_OFFLINE=0` restores the original cloud backend behavior.

Data lives at `~/.local/share/bookauthor/loom.sqlite` in this installation.
SQLite uses WAL and FULL synchronization. To back it up safely while running:

```bash
~/.local/node/bin/node scripts/backup.mjs /path/to/backup/bookauthor.sqlite
```

Store backups on another device. To restore, stop `bookauthor`, move the current
data directory aside (including WAL/SHM files), create a fresh data directory,
copy the backup to `loom.sqlite`, and restart the service. Never overwrite only
the main database while its service is running. Browser-only drafts/bookmarks
remain in that browser's local storage, as in the original app; back up your
browser profile if you need those too. Existing cloud books are not imported
automatically by this branch.

```bash
systemctl --user status bookauthor
journalctl --user -u bookauthor -n 50
systemctl --user restart bookauthor
npm test
```

The tests cover persistent storage, lock ownership, book password behavior,
loopback-only AI endpoints, prompt preservation and interrupted/truncated SSE.
Next.js and inherited dependencies are updated to patched compatible versions.
