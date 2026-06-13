import { getBook } from "@/lib/store";
import { segmentQuotes } from "@/lib/book";

export const dynamic = "force-dynamic";

const FONT = {
  serif: '"Spectral", Georgia, serif',
  sans: '"Inter", system-ui, sans-serif',
  mono: '"Spline Sans Mono", monospace',
  storybook: '"Sorts Mill Goudy", Georgia, serif',
  cursive: '"Dancing Script", "Segoe Script", cursive',
};

export async function generateMetadata({ params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book || !book.shared) return { title: "Loom" };
  return {
    title: `${book.title || "Untitled"} — ${book.author || "Anonymous"}`,
    description: (book.analysis && book.analysis.synopsis) || "A book woven on Loom.",
  };
}

// Group turns into chapters using the chapter start indices.
function buildChapters(book) {
  const turns = book.turns || [];
  const marks = [...(book.chapters || [])].sort((a, b) => a.startTurn - b.startTurn);
  if (!marks.length || marks[0].startTurn !== 0) {
    marks.unshift({ startTurn: 0, title: "" });
  }
  return marks.map((c, i) => {
    const start = c.startTurn;
    const end = i + 1 < marks.length ? marks[i + 1].startTurn : turns.length;
    const text = turns
      .slice(start, end)
      .map((t) => t.text)
      .join("\n\n");
    return { num: i + 1, title: (c.title || "").trim(), paras: text.split(/\n{2,}/).filter((p) => p.trim()) };
  });
}

export default async function ReadPage({ params }) {
  const { id } = await params;
  const book = await getBook(id);

  if (!book || !book.shared) {
    return (
      <div className="reader-shell">
        <div className="reader-unavailable">
          <h1>Not available</h1>
          <p>This book isn’t shared, or the link is no longer active.</p>
          <a className="reader-home" href="/">
            Loom
          </a>
        </div>
      </div>
    );
  }

  const s = book.settings || {};
  const font = FONT[s.font] || FONT.serif;
  const chapters = buildChapters(book);
  const hasText = (book.turns || []).some((t) => t.text && t.text.trim());

  return (
    <div className={`reader-shell mat-${s.material || "paper"}`}>
      <article className="reader" style={{ fontFamily: font, fontSize: `${s.fontSize || 19}px` }}>
        <header className="reader-title">
          <h1>{book.title || "Untitled"}</h1>
          <div className="reader-by">by {book.author || "Anonymous"}</div>
        </header>

        {!hasText ? (
          <p className="reader-empty">This book hasn’t been written yet.</p>
        ) : (
          chapters.map((c) =>
            c.paras.length ? (
              <section className="reader-chapter" key={c.num}>
                <div className="reader-ch-eyebrow">Chapter {c.num}</div>
                {c.title ? <h2 className="reader-ch-title">{c.title}</h2> : null}
                {segmentQuotes(c.paras.join("\n\n")).map((p, pi) =>
                  p.quote ? (
                    <blockquote className="reader-quote" key={pi}>
                      {p.text}
                    </blockquote>
                  ) : (
                    <p key={pi}>{p.text}</p>
                  )
                )}
              </section>
            ) : null
          )
        )}

        <footer className="reader-foot">
          <a className="reader-home" href="/">
            Woven on Loom
          </a>
        </footer>
      </article>
    </div>
  );
}
