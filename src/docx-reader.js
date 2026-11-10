// DOCX is read locally. Only body text, headings, and colored run annotations enter HL.
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const presets = {
  yellow: "#ffff00",
  green: "#00ff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  blue: "#0000ff",
  red: "#ff0000",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  darkGray: "#808080",
  lightGray: "#c0c0c0",
  black: "#000000",
  white: "#ffffff",
};
const value = (node, key = "val") =>
  node?.getAttributeNS(W, key) ?? node?.getAttribute("w:" + key) ?? null;
const kids = (node, name) =>
  [...(node?.children || [])].filter(
    (x) => x.namespaceURI === W && x.localName === name,
  );
const kid = (node, name) => kids(node, name)[0] || null;
const on = (node) =>
  node
    ? !["0", "false", "off"].includes(
        String(value(node) || "true").toLowerCase(),
      )
    : null;
function xml(text, label) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw Error(
      "This DOCX contains an unsupported XML declaration. Save a fresh DOCX copy from Docs or Word.",
    );
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw Error("The " + label + " part of this DOCX could not be read.");
  return doc;
}
function runProps(node) {
  const p = kid(node, "rPr");
  if (!p) return {};
  const h = kid(p, "highlight"),
    shd = kid(p, "shd"),
    fill = value(shd, "fill");
  let color;
  if (h) color = presets[value(h)] || null;
  else if (fill && /^[a-f\d]{6}$/i.test(fill)) color = "#" + fill.toLowerCase();
  if (color === "#ffffff") color = null;
  return { bold: on(kid(p, "b")), italic: on(kid(p, "i")), color };
}
function mergeProps(...layers) {
  const out = { bold: false, italic: false, color: null };
  for (const layer of layers)
    for (const [key, v] of Object.entries(layer || {}))
      if ((v !== undefined && v !== null) || (key === "color" && v === null))
        out[key] = v;
  return out;
}
function stylesFrom(document) {
  const styles = new Map();
  for (const el of document?.getElementsByTagNameNS(W, "style") || []) {
    const props = kid(el, "pPr"),
      outline = value(kid(props, "outlineLvl"));
    styles.set(value(el, "styleId"), {
      name: value(kid(el, "name")),
      base: value(kid(el, "basedOn")),
      outline: outline === null ? null : Number(outline),
      ...runProps(el),
    });
  }
  const chain = (id) => {
    const result = [],
      seen = new Set();
    while (id && styles.has(id) && !seen.has(id)) {
      seen.add(id);
      const s = styles.get(id);
      result.unshift(s);
      id = s.base;
    }
    return result;
  };
  return { chain };
}
function headingLevel(p, styles) {
  const props = kid(p, "pPr"),
    direct = value(kid(props, "outlineLvl"));
  if (direct !== null)
    return ["0", "1"].includes(direct) ? Number(direct) + 1 : 0;
  const styleId = value(kid(props, "pStyle")),
    chain = styles.chain(styleId);
  for (const s of chain.slice().reverse()) {
    if (s.outline !== null)
      return s.outline === 0 || s.outline === 1 ? s.outline + 1 : 0;
    const n = String(s.name || "")
      .replace(/[ _-]/g, "")
      .toLowerCase();
    if (n === "heading1" || n === "heading2") return Number(n.at(-1));
  }
  const match = /^heading[ _-]?([12])$/i.exec(styleId || "");
  return match ? Number(match[1]) : 0;
}
function isTitle(p, styles) {
  const id = value(kid(kid(p, "pPr"), "pStyle"));
  return (
    id === "Title" ||
    styles.chain(id).some((s) => String(s.name).toLowerCase() === "title")
  );
}
function bodyParagraphs(body) {
  const out = [];
  function visit(node) {
    for (const child of node.children || []) {
      if (child.namespaceURI !== W) continue;
      if (
        ["del", "moveFrom", "drawing", "pict", "txbxContent"].includes(
          child.localName,
        )
      )
        continue;
      if (child.localName === "p") out.push(child);
      else visit(child);
    }
  }
  visit(body);
  return out;
}
function readParagraph(p, styles) {
  const runs = [],
    base = mergeProps(...styles.chain(value(kid(kid(p, "pPr"), "pStyle"))));
  function append(text, props) {
    if (text)
      runs.push({
        text,
        color: props.color,
        style: props.bold
          ? props.italic
            ? "bold-italic"
            : "bold"
          : props.italic
            ? "italic"
            : "normal",
      });
  }
  function visit(node, props) {
    if (node.nodeType === 3) return;
    if (node.namespaceURI === W) {
      const name = node.localName;
      if (
        [
          "del",
          "moveFrom",
          "drawing",
          "pict",
          "object",
          "txbxContent",
          "instrText",
          "pPr",
          "rPr",
        ].includes(name)
      )
        return;
      if (name === "r") {
        const style = value(kid(kid(node, "rPr"), "rStyle"));
        props = mergeProps(props, ...styles.chain(style), runProps(node));
      }
      if (name === "t") {
        append(node.textContent, props);
        return;
      }
      if (name === "tab") {
        append("\t", props);
        return;
      }
      if (name === "br" || name === "cr") {
        append("\n", props);
        return;
      }
      if (name === "noBreakHyphen") {
        append("\u2011", props);
        return;
      }
      if (name === "softHyphen") {
        append("\u00ad", props);
        return;
      }
    }
    for (const child of node.childNodes || []) visit(child, props);
  }
  visit(p, base);
  return runs;
}
function headingName(raw) {
  // Remove only this app's own exported number label, retaining authored heading text.
  const own = /^\s*(\d+(?:\.\d+)*)\s*·\s*(.+)$/u.exec(raw);
  const named =
    /^\s*(?:chapter|section|cap[ií]tulo)\s+(\d+(?:\.\d+)*)(?:\b|\s|[:.\-–—])/iu.exec(
      raw,
    );
  return {
    name: (own ? own[2] : raw).trim(),
    sourceNumber: own?.[1] || named?.[1] || null,
  };
}
export function parseDocxParts(documentXml, stylesXml = null) {
  const doc = xml(documentXml, "document"),
    styles = stylesFrom(stylesXml ? xml(stylesXml, "styles") : null),
    body = doc.getElementsByTagNameNS(W, "body")[0];
  if (!body) throw Error("This file does not contain a Word document body.");
  if (doc.getElementsByTagNameNS(W, "altChunk").length)
    throw Error(
      "This DOCX contains embedded document content. Save a new DOCX copy from Docs or Word first.",
    );
  const sections = [],
    warnings = [];
  let current = null,
    parent = null,
    title = "";
  const create = (name, level, sourceNumber = null) => {
    const section = {
      key: "section-" + sections.length,
      name,
      level,
      parentKey: level === 2 ? parent?.key || null : null,
      sourceNumber,
      text: "",
      marks: [],
    };
    sections.push(section);
    current = section;
    if (level === 1) parent = section;
    return section;
  };
  for (const p of bodyParagraphs(body)) {
    const runs = readParagraph(p, styles),
      text = runs.map((r) => r.text).join(""),
      level = headingLevel(p, styles);
    if (level && text.trim()) {
      if (level === 2 && !parent)
        throw Error(
          "A Heading 2 appears before the first Heading 1. Add its parent chapter heading and import again.",
        );
      const heading = headingName(text);
      if (!heading.name) throw Error("A chapter heading has no title.");
      create(heading.name, level, heading.sourceNumber);
      continue;
    }
    if (!sections.length && isTitle(p, styles)) {
      if (text.trim()) title = text.trim();
      continue;
    }
    if (!current) {
      if (!text.trim()) continue;
      create("Introduction", 1);
      warnings.push(
        "Text before the first Heading 1 is included as Introduction.",
      );
    }
    if (current.hasParagraph) current.text += "\n";
    for (const run of runs) {
      const from = current.text.length;
      current.text += run.text;
      if (run.color && run.text.trim())
        current.marks.push({
          from,
          to: current.text.length,
          color: run.color,
          style: run.style,
        });
    }
    current.hasParagraph = true;
    if (current.text.length > 2 * 1024 * 1024)
      throw Error("A chapter is larger than the 2 MB script-text limit.");
  }
  if (!sections.length)
    throw Error("No chapter text or headings were found in this DOCX.");
  const usedHeadings =
    sections.some((s) => s.sourceNumber) ||
    bodyParagraphs(body).some((p) => headingLevel(p, styles));
  if (!usedHeadings && sections.length === 1) {
    sections[0].name = title || "Imported chapter";
    const i = warnings.indexOf(
      "Text before the first Heading 1 is included as Introduction.",
    );
    if (i >= 0) warnings.splice(i, 1);
    warnings.push(
      "No Heading 1/2 styles were found; the body will be imported as one chapter.",
    );
  }
  for (const section of sections) {
    section.text = section.text.replace(/(?:\n[ \t]*)+$/u, "");
    const end = section.text.length;
    section.marks = section.marks
      .filter((m) => m.from < end)
      .map((m) => ({ ...m, to: Math.min(m.to, end) }));
    delete section.hasParagraph;
  }
  if (sections.length > 1000)
    throw Error("This DOCX contains more than 1000 chapters/subchapters.");
  if (
    doc.getElementsByTagNameNS(W, "drawing").length ||
    doc.getElementsByTagNameNS(W, "pict").length
  )
    warnings.push(
      "Embedded pictures are not imported into script text. Storyboard drawings stay separate.",
    );
  if (doc.getElementsByTagNameNS(W, "footnoteReference").length)
    warnings.push("Footnotes are not included in the script body.");
  if (doc.getElementsByTagNameNS(W, "numPr").length)
    warnings.push(
      "Lists keep their paragraph text; Word’s automatic list markers are not imported.",
    );
  return { title, sections, warnings: [...new Set(warnings)] };
}
function crc32(bytes) {
  let crc = -1;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
export async function readDocx(file) {
  if (!/\.docx$/i.test(file.name))
    throw Error("Choose a .docx file exported from Docs or Word.");
  if (file.size > 50 * 1024 * 1024)
    throw Error("Choose a DOCX smaller than 50 MB.");
  if (!globalThis.JSZip)
    throw Error("The DOCX reader did not load. Reopen the test app.");
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw Error(
      "This DOCX could not be opened. It may be damaged or password protected.",
    );
  }
  async function part(name, limit, required = false) {
    const entry = zip.file(name);
    if (!entry) {
      if (required) throw Error("This file is missing " + name + ".");
      return null;
    }
    const data = entry._data;
    if (data?.uncompressedSize > limit)
      throw Error("The document is too large to import safely.");
    const bytes = await entry.async("uint8array");
    if (bytes.length > limit)
      throw Error("The document is too large to import.");
    if (data?.crc32 !== undefined && crc32(bytes) !== data.crc32 >>> 0)
      throw Error("This DOCX contains a damaged document part.");
    const encoding =
      bytes[0] === 255 && bytes[1] === 254
        ? "utf-16le"
        : bytes[0] === 254 && bytes[1] === 255
          ? "utf-16be"
          : "utf-8";
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      throw Error("This DOCX contains unreadable text encoding.");
    }
  }
  return parseDocxParts(
    await part("word/document.xml", 12 * 1024 * 1024, true),
    await part("word/styles.xml", 4 * 1024 * 1024),
  );
}
