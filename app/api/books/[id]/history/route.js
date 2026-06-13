import { NextResponse } from "next/server";
import { getBook, saveBook, listSnapshots, getSnapshot, saveSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

// List the saved snapshots (metadata only) for a book, newest first.
export async function GET(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  const snapshots = await listSnapshots(id);
  return NextResponse.json({ snapshots });
}

// Restore a snapshot. The current state is snapshotted first, so a restore is
// itself reversible.
export async function POST(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const snapId = String(body.restore || "");
  if (!snapId) return NextResponse.json({ error: "No snapshot specified." }, { status: 400 });

  const snap = await getSnapshot(id, snapId);
  if (!snap) return NextResponse.json({ error: "That version is no longer available." }, { status: 404 });

  await saveSnapshot(book, "Before restoring an earlier version");
  // Keep identity/sharing on the live record; restore the manuscript content.
  const restored = {
    ...snap,
    id: book.id,
    createdAt: book.createdAt,
    shared: book.shared,
  };
  await saveBook(restored);
  return NextResponse.json({ book: restored });
}
