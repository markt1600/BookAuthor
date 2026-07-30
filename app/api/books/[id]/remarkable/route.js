import { getBook, getRemarkableAuth, setRemarkableAuth } from "@/lib/store";
import { buildEpub } from "@/lib/epub";
import { sendEpub, RemarkableError } from "@/lib/remarkable";

export const dynamic = "force-dynamic";

// Send the book's CURRENT text to the paired reMarkable as an EPUB. Built
// fresh on every click, so the tablet always receives the latest version.
export async function POST(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return Response.json({ error: "Book not found." }, { status: 404 });
  if (!(book.turns || []).length) {
    return Response.json({ error: "There's no text to send yet." }, { status: 400 });
  }

  const auth = await getRemarkableAuth();
  if (!auth || !auth.deviceToken) {
    // 428 Precondition Required → the client opens the pairing dialog.
    return Response.json(
      { error: "Not paired with a reMarkable yet.", code: "not_paired" },
      { status: 428 }
    );
  }

  try {
    const { buf, title } = await buildEpub(book);
    await sendEpub({ deviceToken: auth.deviceToken, name: title, buf });
    return Response.json({ ok: true, title });
  } catch (err) {
    if (err instanceof RemarkableError && err.code === "unpaired") {
      // The stored token is dead (device removed from the account, etc.) —
      // clear it so the next click goes straight to the pairing dialog.
      await setRemarkableAuth(null);
      return Response.json({ error: err.message, code: "not_paired" }, { status: 428 });
    }
    return Response.json(
      { error: (err && err.message) || "Could not send to reMarkable." },
      { status: 502 }
    );
  }
}
