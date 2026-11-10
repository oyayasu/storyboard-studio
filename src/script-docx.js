import {
  textPieces,
  highlightInk,
  isSpokenPiece,
} from "./highlighter-model.js";
const xml = (s) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c],
    );
const encoder = new TextEncoder();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const chunks = [],
    central = [];
  let offset = 0,
    size = 0;
  for (const [name, content] of Object.entries(files)) {
    const n = encoder.encode(name),
      b = encoder.encode(content),
      crc = crc32(b),
      header = new Uint8Array(30 + n.length),
      v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint16(12, 0x21, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, b.length, true);
    v.setUint32(22, b.length, true);
    v.setUint16(26, n.length, true);
    header.set(n, 30);
    const c = new Uint8Array(46 + n.length),
      cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, b.length, true);
    cv.setUint32(24, b.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    c.set(n, 46);
    chunks.push(header, b);
    central.push(c);
    offset += header.length + b.length;
    size += c.length;
  }
  const end = new Uint8Array(22),
    v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, central.length, true);
  v.setUint16(10, central.length, true);
  v.setUint32(12, size, true);
  v.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
function run(text, category) {
  const props = category
    ? `<w:rPr><w:shd w:val="clear" w:color="auto" w:fill="${category.color.slice(1)}"/><w:color w:val="${highlightInk(category.color).slice(1)}"/>${category.style.includes("italic") ? "<w:i/>" : ""}${category.style.includes("bold") ? "<w:b/>" : ""}</w:rPr>`
    : "";
  return `<w:r>${props}${text
    .split("\t")
    .map(
      (part, i) =>
        (i ? "<w:tab/>" : "") + `<w:t xml:space="preserve">${xml(part)}</w:t>`,
    )
    .join("")}</w:r>`;
}
export function buildAnnotatedDocx(
  project,
  chapterLabel = (c) => c.name,
  view = "all",
) {
  const categories = project.highlighter.categories;
  let body = `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run(project.name)}</w:p>`;
  const chapters = project.chapters.filter((c) => !c.unused);
  for (let index = 0; index < chapters.length; index++) {
    const ch = chapters[index];
    if (index)
      body +=
        '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>'.repeat(
          2,
        );
    body += `<w:p><w:pPr><w:pStyle w:val="${ch.parentId ? "Heading2" : "Heading1"}"/></w:pPr>${run(chapterLabel(ch))}</w:p>`;
    let paragraph = "";
    for (const piece of textPieces(project, ch)) {
      if (view === "spoken" && !isSpokenPiece(project, piece)) continue;
      const parts = piece.text.split("\n"),
        category = categories.find((c) => c.id === piece.mark?.categoryId);
      for (let i = 0; i < parts.length; i++) {
        if (i) {
          body += `<w:p>${paragraph}</w:p>`;
          paragraph = "";
        }
        if (parts[i]) paragraph += run(parts[i], category);
      }
    }
    body += `<w:p>${paragraph}</w:p>`;
  }
  return zip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/_rels/document.xml.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`,
    "word/styles.xml":
      '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria" w:eastAsia="Cambria" w:cs="Cambria"/><w:sz w:val="24"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="000000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="260" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="000000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="000000"/></w:rPr></w:style></w:styles>',
  });
}
export async function exportAnnotatedDocx(project, chapterLabel, view = "all") {
  const { saveBlob, safe } = await import("./media.js");
  return saveBlob(
    buildAnnotatedDocx(project, chapterLabel, view),
    `${safe(project.name)}_${view === "spoken" ? "spoken" : "annotated"}.docx`,
  );
}
