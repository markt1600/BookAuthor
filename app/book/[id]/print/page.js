"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import CoverArt from "@/components/CoverArt";
import { segmentQuotes, LARGE_PAGE_SCALE } from "@/lib/book";

// Trim and margins in inches, plus the cover-band height. "Larger page" scales
// all of these by LARGE_PAGE_SCALE while the body font size is unchanged, so the
// printed page keeps its shape but holds more words (matching the on-screen reader).
const PAGE_DIMS = {
  portrait: { w: 6, h: 9, my: 0.85, mx: 0.8, coverH: 8.3 },
  square: { w: 8, h: 8, my: 0.9, mx: 0.9, coverH: 7 },
  landscape: { w: 9, h: 6, my: 0.7, mx: 0.9, coverH: 5.6 },
};

function pageDims(format, large) {
  const d = PAGE_DIMS[format] || PAGE_DIMS.portrait;
  const k = large ? LARGE_PAGE_SCALE : 1;
  const r = (n) => Math.round(n * k * 1000) / 1000;
  return {
    size: `${r(d.w)}in ${r(d.h)}in`,
    margin: `${r(d.my)}in ${r(d.mx)}in`,
    coverH: `${r(d.coverH)}in`,
  };
}

const FONT_STACK = {
  serif: '"Spectral", Georgia, serif',
  sans: '"Inter", system-ui, sans-serif',
  mono: '"Spline Sans Mono", monospace',
  storybook: '"Sorts Mill Goudy", Georgia, serif',
  cursive: '"Dancing Script", "Segoe Script", cursive',
};

const MATERIAL_BG = {
  paper: { bg: "#fbfaf8", ink: "#1c1b18" },
  parchment: { bg: "#f1e6cc", ink: "#3a2f1c" },
  linen: { bg: "#f5f4ef", ink: "#232323" },
  newsprint: { bg: "#e9e6dd", ink: "#26241f" },
  midnight: { bg: "#14171e", ink: "#d9dae0" },
};

function paragraphs(text) {
  return String(text).split(/\n{2,}/);
}

export default function PrintView() {
  const params = useParams();
  const id = params.id;
  const [book, setBook] = useState(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/books/${id}`);
        if (!res.ok) return alive && setStatus("error");
        const { book } = await res.json();
        if (!alive) return;
        setBook(book);
        setStatus("ready");
      } catch {
        if (alive) setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // Auto-open the print dialog once content + fonts have settled.
  useEffect(() => {
    if (status !== "ready") return;
    const t = setTimeout(() => {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => window.print());
      } else {
        window.print();
      }
    }, 400);
    return () => clearTimeout(t);
  }, [status]);

  if (status === "loading") return <div style={{ padding: 40, fontFamily: "var(--ui)" }}>Preparing your book…</div>;
  if (status === "error" || !book) return <div style={{ padding: 40, fontFamily: "var(--ui)" }}>Could not load this book.</div>;

  const s = book.settings;
  const dims = pageDims(s.format, s.largePage);
  const mat = MATERIAL_BG[s.material] || MATERIAL_BG.paper;
  const font = FONT_STACK[s.font] || FONT_STACK.serif;

  const coverInk = ["minimal", "parchment"].includes(s.cover) ? "#1c1b18" : "#f4efe6";
  const ink = s.inkColor || mat.ink;
  const chapterByStart = {};
  (book.chapters || []).forEach((c, i) => {
    chapterByStart[c.startTurn] = { num: i + 1, title: c.title || "" };
  });

  const css = `
    @page { size: ${dims.size}; margin: ${dims.margin}; }
    html, body { margin: 0; padding: 0; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .pv-root { background: ${mat.bg}; color: ${ink}; font-family: ${font}; }
    .pv-toolbar {
      position: fixed; top: 0; left: 0; right: 0;
      display: flex; gap: 12px; align-items: center; justify-content: center;
      padding: 12px; background: #1a1d24; color: #e9e3d6;
      font-family: "Inter", system-ui, sans-serif; font-size: 13px; z-index: 5;
    }
    .pv-toolbar button {
      background: #c0913f; color: #1a1407; border: none; border-radius: 4px;
      padding: 8px 16px; font-weight: 600; cursor: pointer; font: inherit;
    }
    .pv-toolbar a { color: #99a0ac; }
    .pv-page { padding-top: 64px; }

    .pv-cover {
      position: relative; height: ${dims.coverH};
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      text-align: center; color: ${coverInk}; overflow: hidden; border-radius: 2px;
      break-after: page; page-break-after: always;
    }
    .pv-cover .cover-art { position: absolute; inset: 0; }
    .pv-cover-inner { position: relative; z-index: 2; padding: 0 14%; }
    .pv-cover h1 { font-family: ${font}; font-weight: 600; font-size: 34pt; line-height: 1.1; margin: 0 0 18px; }
    .pv-cover .pv-by { font-style: italic; font-size: 14pt; opacity: 0.92; }

    .pv-body { font-size: ${s.fontSize}px; line-height: 1.6; }
    .pv-body p { margin: 0 0 0.9em; orphans: 2; widows: 2; white-space: pre-wrap; }
    .pv-body .print-quote { margin: 0 0 0.9em; padding-left: 1.6em; white-space: pre-wrap; border-left: 2px solid rgba(0,0,0,0.3); }
    .print-the-end { text-align: center; margin: 2.4em 0 1.2em; font-variant: small-caps; letter-spacing: 0.18em; }
    .pv-turn { margin-bottom: 6px; }
    .pv-marker { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 26px 0 18px; break-after: avoid; }
    .pv-marker[data-hide="1"] { display: none; }
    .pv-marker:first-child { margin-top: 0; }
    .pv-marker .rule { width: 34px; height: 2px; }
    .pv-marker .lab {
      font-family: "Spline Sans Mono", monospace; font-size: 8pt; letter-spacing: 0.18em;
      text-transform: uppercase; opacity: 0.55;
    }
    .pv-marker[data-author="user"] .rule { background: #3b5bdb; }
    .pv-marker[data-author="claude"] .rule { background: #2f8069; }
    .pv-colophon { margin-top: 30px; padding-top: 14px; border-top: 1px solid rgba(127,127,127,0.3); font-family: "Spline Sans Mono", monospace; font-size: 8pt; opacity: 0.6; text-align: center; }
    .pv-chapter { break-before: page; page-break-before: always; text-align: center; padding: 1.4in 0 0.5in; }
    .pv-chapter:first-child { break-before: auto; page-break-before: auto; }
    .pv-chapter .pv-ch-eyebrow { font-family: "Spline Sans Mono", monospace; font-size: 9pt; letter-spacing: 0.24em; text-transform: uppercase; opacity: 0.55; margin-bottom: 14px; }
    .pv-chapter .pv-ch-title { font-family: ${font}; font-size: 24pt; line-height: 1.15; margin: 0 0 18px; }
    .pv-chapter .pv-ch-rule { width: 48px; height: 2px; background: currentColor; opacity: 0.4; margin: 0 auto; }

    @media print {
      .pv-toolbar { display: none !important; }
      .pv-page { padding-top: 0; }
    }
  `;

  return (
    <div className="pv-root">
      <style>{css}</style>

      <div className="pv-toolbar">
        <span>If the dialog didn’t appear, click Print and choose “Save as PDF.”</span>
        <button onClick={() => window.print()}>Print / Save as PDF</button>
        <a href={`/book/${id}`}>← Back to the book</a>
      </div>

      <div className="pv-page">
        <section className="pv-cover">
          <CoverArt cover={s.cover} />
          <div className="pv-cover-inner">
            <h1>{book.title}</h1>
            <div className="pv-by">by {book.author}</div>
          </div>
        </section>

        <div className="pv-body">
          {book.turns.map((t, ti) => (
            <div className="pv-turn" key={t.id}>
              {chapterByStart[ti] && (
                <div className="pv-chapter">
                  <div className="pv-ch-eyebrow">Chapter {chapterByStart[ti].num}</div>
                  <div className="pv-ch-title">{chapterByStart[ti].title?.trim() || "Untitled"}</div>
                  <div className="pv-ch-rule" />
                </div>
              )}
              <div className="pv-marker" data-author={t.author} data-hide={book.mode === "guide" || t.merged ? "1" : undefined}>
                <span className="rule" />
                <span className="lab">{t.author === "user" ? book.author : "AI Author"}</span>
                <span className="rule" />
              </div>
              {segmentQuotes(t.text).map((p, i) =>
                p.quote ? (
                  <blockquote className="print-quote" key={i}>
                    {p.text}
                  </blockquote>
                ) : (
                  <p key={i}>{p.text}</p>
                )
              )}
            </div>
          ))}

          {book.ended && <div className="print-the-end">The End</div>}

          <div className="pv-colophon">
            Woven on Loom · {book.author} &amp; an AI author · {book.turns.length} turns
          </div>
        </div>
      </div>
    </div>
  );
}
