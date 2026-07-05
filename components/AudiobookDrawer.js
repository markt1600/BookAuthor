"use client";

import { useEffect, useState } from "react";
import { countWords } from "@/lib/book";

// Audiobook export: one narrated MP3 per chapter, synthesized server-side with
// the same ElevenLabs voice as read-aloud. Downloads run through fetch so a
// server error surfaces as a message instead of a JSON page.
export default function AudiobookDrawer({ book, onClose }) {
  const [ttsOk, setTtsOk] = useState(null); // null = checking
  const [busyIdx, setBusyIdx] = useState(-1);
  const [err, setErr] = useState("");

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setTtsOk(!(d && d.tts === false)))
      .catch(() => setTtsOk(true)); // uncertain — let the download attempt decide
  }, []);

  const turns = book.turns || [];
  const chapters = (book.chapters || []).length ? book.chapters : [{ title: "", startTurn: 0 }];
  const rows = chapters.map((c, i) => {
    const start = c.startTurn;
    const end = chapters[i + 1] ? chapters[i + 1].startTurn : turns.length;
    const words = turns.slice(start, end).reduce((n, t) => n + (t.words || countWords(t.text)), 0);
    return { index: i, title: c.title || "", words };
  });

  async function download(row) {
    if (busyIdx >= 0) return;
    setBusyIdx(row.index);
    setErr("");
    try {
      const res = await fetch(`/api/books/${book.id}/audiobook?chapter=${row.index}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || "The chapter export failed — try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const m = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
      a.download = m ? m[1] : `chapter-${row.index + 1}.mp3`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {
      setErr("Network error during the export — try again.");
    } finally {
      setBusyIdx(-1);
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Audiobook export">
        <div className="drawer-head">
          <h3>Audiobook</h3>
          <button className="btn btn-ghost x" onClick={onClose} aria-label="Close">
            Done
          </button>
        </div>

        <p className="arc-help">
          Export each chapter as a narrated MP3, in the same natural voice as read-aloud. Long
          chapters are synthesized in parts and stitched — a big chapter can take a minute or
          two, and each export spends ElevenLabs characters.
        </p>

        {ttsOk === false && (
          <div className="pw-err" style={{ marginBottom: 14 }}>
            The natural voice isn't configured on this server (ELEVENLABS_API_KEY) — audiobook
            export needs it. Read-aloud's on-device voice can't produce files.
          </div>
        )}
        {err && (
          <div className="pw-err" style={{ marginBottom: 14 }}>
            {err}
          </div>
        )}

        <div className="ab-list">
          {rows.map((row) => (
            <div className="ab-row" key={row.index}>
              <div className="ab-meta">
                <div className="ab-title">
                  Chapter {row.index + 1}
                  {row.title ? ` — ${row.title}` : ""}
                </div>
                <div className="ab-words">{row.words.toLocaleString()} words</div>
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => download(row)}
                disabled={busyIdx >= 0 || ttsOk === false || row.words === 0}
              >
                {busyIdx === row.index ? "Narrating…" : "↓ MP3"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
