"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import CoverArt from "@/components/CoverArt";

const PAGE_DIMS = {
  portrait: { size: "6in 9in", margin: "0.85in 0.8in" },
  square: { size: "8in 8in", margin: "0.9in 0.9in" },
  landscape: { size: "9in 6in", margin: "0.7in 0.9in" },
};

const FONT_STACK = {
  serif: '"Spectral", Georgia, serif',
  sans: '"Inter", system-ui, sans-serif',
  mono: '"Spline Sans Mono", monospace',
  storybook: '"Sorts Mill Goudy", Georgia, serif',
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
  const dims = PAGE_DIMS[s.format] || PAGE_DIMS.portrait;
  const mat = MATERIAL_BG[s.material] || MATERIAL_BG.paper;
  const font = FONT_STACK[s.font] || FONT_STACK.serif;

  const coverInk = ["minimal", "parchment"].includes(s.cover) ? "#1c1b18" : "#f4efe6";

  const css = `
    @page { size: ${dims.size}; margin: ${dims.margin}; }
    html, body { margin: 0; padding: 0; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .pv-root { background: ${mat.bg}; color: ${mat.ink}; font-family: ${font}; }
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
      position: relative; height: ${s.format === "landscape" ? "5.6in" : s.format === "square" ? "7in" : "8.3in"};
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
    .pv-turn { margin-bottom: 6px; }
    .pv-marker {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      margin: 26px 0 18px; break-after: avoid;
    }
    .pv-marker:first-child { margin-top: 0; }
    .pv-marker .rule { width: 34px; height: 2px; }
    .pv-marker .lab {
      font-family: "Spline Sans Mono", monospace; font-size: 8pt; letter-spacing: 0.18em;
      text-transform: uppercase; opacity: 0.55;
    }
    .pv-marker[data-author="user"] .rule { background: #3b5bdb; }
    .pv-marker[data-author="claude"] .rule { background: #2f8069; }
    .pv-colophon { margin-top: 30px; padding-top: 14px; border-top: 1px solid rgba(127,127,127,0.3); font-family: "Spline Sans Mono", monospace; font-size: 8pt; opacity: 0.6; text-align: center; }

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
          {book.turns.map((t) => (
            <div className="pv-turn" key={t.id}>
              <div className="pv-marker" data-author={t.author}>
                <span className="rule" />
                <span className="lab">{t.author === "user" ? book.author : "Claude"}</span>
                <span className="rule" />
              </div>
              {paragraphs(t.text).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          ))}

          <div className="pv-colophon">
            Woven on Loom · {book.author} &amp; Claude · {book.turns.length} turns
          </div>
        </div>
      </div>
    </div>
  );
}
