import JSZip from "jszip";
import { getBook } from "@/lib/store";

export const dynamic = "force-dynamic";

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slug(s, fallback) {
  const out = String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return out || fallback;
}

// Group turns into chapters by start index, ensuring Chapter 1 opens the book.
function buildChapters(book) {
  const turns = book.turns || [];
  const marks = [...(book.chapters || [])].sort((a, b) => a.startTurn - b.startTurn);
  if (!marks.length || marks[0].startTurn !== 0) marks.unshift({ startTurn: 0, title: "" });
  return marks
    .map((c, i) => {
      const start = c.startTurn;
      const end = i + 1 < marks.length ? marks[i + 1].startTurn : turns.length;
      const text = turns
        .slice(start, end)
        .map((t) => t.text)
        .join("\n\n");
      return { num: i + 1, title: (c.title || "").trim(), paras: text.split(/\n{2,}/).filter((p) => p.trim()) };
    })
    .filter((c) => c.paras.length);
}

const CSS = `body{font-family:Georgia,'Times New Roman',serif;line-height:1.6;margin:0;padding:1.2em 1.1em;}
h1.book-title{font-size:1.9em;text-align:center;margin:1.2em 0 0.2em;}
.byline{text-align:center;font-style:italic;color:#555;margin-bottom:2em;}
.ch-eyebrow{text-align:center;letter-spacing:0.18em;text-transform:uppercase;font-size:0.72em;color:#888;margin:0 0 0.3em;}
h2.ch-title{text-align:center;font-size:1.3em;margin:0 0 1.4em;font-weight:600;}
p{margin:0 0 0.85em;text-align:justify;text-indent:1.3em;}
p.first{text-indent:0;}`;

export async function GET(request, { params }) {
  const { id } = await params;
  const book = await getBook(id);
  if (!book) return new Response("Book not found", { status: 404 });

  const title = book.title || "Untitled";
  const author = book.author || "Anonymous";
  const lang = "en";
  const uid = `urn:loom:${book.id}`;
  const chapters = buildChapters(book);

  const xmlHead = '<?xml version="1.0" encoding="UTF-8"?>';
  const page = (titleText, bodyInner) =>
    `${xmlHead}
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>${esc(titleText)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${bodyInner}</body>
</html>`;

  const titlePage = page(
    title,
    `<h1 class="book-title">${esc(title)}</h1><div class="byline">${esc(author)}</div>`
  );

  const chapterFiles = chapters.map((c) => {
    const heading = `<div class="ch-eyebrow">Chapter ${c.num}</div>${
      c.title ? `<h2 class="ch-title">${esc(c.title)}</h2>` : '<h2 class="ch-title">&#160;</h2>'
    }`;
    const body =
      heading +
      c.paras.map((p, i) => `<p${i === 0 ? ' class="first"' : ""}>${esc(p)}</p>`).join("\n");
    return { name: `chapter-${c.num}.xhtml`, label: c.title || `Chapter ${c.num}`, num: c.num, xhtml: page(c.title || `Chapter ${c.num}`, body) };
  });

  const manifestItems = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
    ...chapterFiles.map(
      (c) => `<item id="ch${c.num}" href="${c.name}" media-type="application/xhtml+xml"/>`
    ),
  ].join("\n    ");

  const spineItems = [
    '<itemref idref="title"/>',
    ...chapterFiles.map((c) => `<itemref idref="ch${c.num}"/>`),
  ].join("\n    ");

  const opf = `${xmlHead}
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${esc(uid)}</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
    <dc:creator>${esc(author)}</dc:creator>
    <dc:language>${lang}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`;

  const navList = chapterFiles
    .map((c) => `<li><a href="${c.name}">${esc(c.label)}</a></li>`)
    .join("\n      ");
  const nav = page(
    "Contents",
    `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops" id="toc"><h1>Contents</h1><ol>
      ${navList}
    </ol></nav>`
  );

  const navPoints = chapterFiles
    .map(
      (c, i) =>
        `<navPoint id="np${c.num}" playOrder="${i + 1}"><navLabel><text>${esc(
          c.label
        )}</text></navLabel><content src="${c.name}"/></navPoint>`
    )
    .join("\n    ");
  const ncx = `${xmlHead}
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${lang}">
  <head>
    <meta name="dtb:uid" content="${esc(uid)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${esc(title)}</text></docTitle>
  <navMap>
    ${navPoints}
  </navMap>
</ncx>`;

  const container = `${xmlHead}
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const zip = new JSZip();
  // mimetype MUST be first and stored (uncompressed).
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", container);
  const o = zip.folder("OEBPS");
  o.file("content.opf", opf);
  o.file("nav.xhtml", nav);
  o.file("toc.ncx", ncx);
  o.file("style.css", CSS);
  o.file("title.xhtml", titlePage);
  for (const c of chapterFiles) o.file(c.name, c.xhtml);

  const buf = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  const filename = `${slug(title, "book")}.epub`;
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
