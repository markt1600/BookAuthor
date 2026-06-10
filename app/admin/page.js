"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import CoverArt from "@/components/CoverArt";

function when(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Admin() {
  const router = useRouter();
  const [books, setBooks] = useState([]);
  const [mode, setMode] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/books");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setBooks(data.books || []);
      setMode(data.storageMode);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(book) {
    const ok = window.confirm(
      `Delete “${book.title || "Untitled"}” permanently? This cannot be undone.`
    );
    if (!ok) return;
    setBusyId(book.id);
    try {
      await fetch(`/api/books/${book.id}`, { method: "DELETE" });
      setBooks((list) => list.filter((b) => b.id !== book.id));
    } catch {
      // leave it in the list; user can retry
    } finally {
      setBusyId("");
    }
  }

  return (
    <main className="admin">
      <div className="admin-inner">
        <header className="admin-head">
          <div>
            <div className="mark mark-sm">
              <span className="mark-weave" aria-hidden="true">
                <i /><i /><i /><i /><i />
              </span>
              <span className="mark-name">Loom</span>
            </div>
            <h1 className="admin-title">All books</h1>
          </div>
          <Link href="/" className="btn btn-ghost">
            ← New book
          </Link>
        </header>

        {mode === "memory" && (
          <div className="banner warn-banner">
            Storage is in-memory only — this list resets when the server does.
            Connect an Upstash Redis store to persist books.
          </div>
        )}

        <p className="admin-note">
          Anyone with this link can open or delete any book. Don't share it
          publicly.
        </p>

        {status === "loading" && <div className="admin-empty">Loading…</div>}
        {status === "error" && (
          <div className="admin-empty">Couldn't load the library.</div>
        )}
        {status === "ready" && books.length === 0 && (
          <div className="admin-empty">
            No books yet. <Link href="/">Start one →</Link>
          </div>
        )}

        {status === "ready" && books.length > 0 && (
          <ul className="book-list">
            {books.map((b) => (
              <li key={b.id} className="book-row">
                <span className="book-row-cover">
                  <CoverArt cover={b.cover} />
                </span>
                <span className="book-row-main">
                  <span className="book-row-title">{b.title || "Untitled"}</span>
                  <span className="book-row-by">by {b.author || "Unknown"}</span>
                </span>
                <span className="book-row-meta">
                  {b.words.toLocaleString()} words · {b.turns} turns
                  <br />
                  <span className="book-row-time">updated {when(b.updatedAt)}</span>
                </span>
                <span className="book-row-actions">
                  <button
                    className="btn btn-small"
                    onClick={() => router.push(`/book/${b.id}`)}
                  >
                    Open
                  </button>
                  <button
                    className="btn btn-small btn-danger"
                    onClick={() => remove(b)}
                    disabled={busyId === b.id}
                  >
                    {busyId === b.id ? "Deleting…" : "Delete"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
