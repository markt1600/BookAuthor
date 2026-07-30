import { getBook } from "@/lib/store";
import { buildEpub } from "@/lib/epub";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return new Response("Book not found", { status: 404 });

  const { buf, filename } = await buildEpub(book);
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
