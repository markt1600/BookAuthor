import { NextResponse } from "next/server";
import { getBook, saveBook } from "@/lib/store";
import { publicBook } from "@/lib/book";
import { redrawOutline } from "@/lib/generate";
import { bookUnlocked } from "@/lib/admin";
import { providerErrorMessage } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Redraw the rolling outline now, from where the story stands. Entries the
// author has pinned are kept and planned around. (The outline also redraws
// itself each time a chapter closes; this is the on-demand version.)
export async function POST(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  if (!bookUnlocked(request, book)) {
    return NextResponse.json({ error: "This book is locked." }, { status: 401 });
  }
  if (!(book.turns || []).length) {
    return NextResponse.json({ error: "Write something first — there's nothing to outline from yet." }, { status: 400 });
  }
  if (book.ended) {
    return NextResponse.json({ error: "This book is marked as ended — reopen it to outline further chapters." }, { status: 400 });
  }

  try {
    const changed = await redrawOutline(book);
    if (!changed) return NextResponse.json({ error: "Couldn't draw up an outline — try again." }, { status: 502 });
    // Save only the outline onto the latest copy, so a section written while
    // this ran is never overwritten.
    const latest = (await getBook(id)) || book;
    latest.outline = book.outline;
    await saveBook(latest);
    return NextResponse.json({ book: publicBook(latest) });
  } catch (err) {
    const msg = providerErrorMessage(err, "Couldn't draw up an outline — try again.");
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
