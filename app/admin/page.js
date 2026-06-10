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
  const [gate, setGate] = useState("checking"); // checking | locked | open
  const [configured, setConfigured] = useState(false);
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [books, setBooks] = useState([]);
  const [mode, setMode] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/books");
      if (res.status === 401) {
        setGate("locked");
        return;
      }
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
    (async () => {
      try {
        const res = await fetch("/api/admin/status");
        const d = await res.json();
        setConfigured(!!d.configured);
        if (d.configured && !d.authed) {
          setGate("locked");
        } else {
          setGate("open");
          load();
        }
      } catch {
        setGate("open");
        load();
      }
    })();
  }, [load]);

  async function login(e) {
    e?.preventDefault?.();
    setLoggingIn(true);
    setLoginErr("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword("");
        setGate("open");
        load();
      } else {
        const d = await res.json().catch(() => ({}));
        setLoginErr(d.error || "Incorrect password.");
      }
    } catch {
      setLoginErr("Something went wrong. Try again.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout() {
    try {
      await fetch("/api/admin/login", { method: "DELETE" });
    } catch {}
    setGate("locked");
    setBooks([]);
  }

  async function remove(book) {
    const ok = window.confirm(`Delete “${book.title || "Untitled"}” permanently? This cannot be undone.`);
    if (!ok) return;
    setBusyId(book.id);
    try {
      const res = await fetch(`/api/books/${book.id}`, { method: "DELETE" });
      if (res.status === 401) {
        setGate("locked");
        return;
      }
      setBooks((list) => list.filter((b) => b.id !== book.id));
    } catch {
      // leave it; user can retry
    } finally {
      setBusyId("");
    }
  }

  const Header = (
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
      <div className="admin-head-actions">
        {gate === "open" && configured && (
          <button className="btn btn-ghost" onClick={logout}>
            Lock
          </button>
        )}
        <Link href="/" className="btn btn-ghost">
          ← New book
        </Link>
      </div>
    </header>
  );

  if (gate === "checking") {
    return (
      <main className="admin">
        <div className="admin-inner">
          {Header}
          <div className="admin-empty">Loading…</div>
        </div>
      </main>
    );
  }

  if (gate === "locked") {
    return (
      <main className="admin">
        <div className="admin-inner">
          {Header}
          <form className="lock-card" onSubmit={login}>
            <div className="lock-title">This library is password-protected</div>
            <p className="lock-sub">Enter the admin password to view and manage all books.</p>
            <input
              type="password"
              className="text-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Admin password"
              autoFocus
              aria-label="Admin password"
            />
            {loginErr && <div className="lock-err">{loginErr}</div>}
            <button className="btn btn-primary" type="submit" disabled={loggingIn || !password}>
              {loggingIn ? "Unlocking…" : "Unlock"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="admin">
      <div className="admin-inner">
        {Header}

        {mode === "memory" && (
          <div className="banner warn-banner">
            Storage is in-memory only — this list resets when the server does. Connect an Upstash
            Redis store to persist books.
          </div>
        )}

        <p className="admin-note">
          {configured
            ? "Password-protected. Use “Lock” when you're done, especially on a shared device."
            : "Anyone with this link can open or delete any book — set an ADMIN_PASSWORD to protect it (see the README)."}
        </p>

        {status === "loading" && <div className="admin-empty">Loading…</div>}
        {status === "error" && <div className="admin-empty">Couldn't load the library.</div>}
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
                  <button className="btn btn-small" onClick={() => router.push(`/book/${b.id}`)}>
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
