// Screen cards and exported pages share the same measured text and pagination.
import { cardScriptRuns, highlightInk } from "./highlighter-model.js";
const cache = new Map();
let context;
const canvasContext = () =>
  (context ||= document.createElement("canvas").getContext("2d"));
function font(style, size) {
  return `${(style.includes("italic") ? "italic " : "") + (style.includes("bold") ? "bold " : "")}${size}px Georgia, 'Times New Roman', serif`;
}
function glyphWidth(char, style, size) {
  const key = size + "|" + style + "|" + char;
  if (cache.has(key)) return cache.get(key);
  const cx = canvasContext();
  cx.font = font(style, size);
  const w = cx.measureText(char).width;
  cache.set(key, w);
  return w;
}
export function wrapRuns(runs, width, size, categories = []) {
  const lines = [];
  let spans = [],
    used = 0;
  function flush(separator = "") {
    lines.push({ spans, width: used, separator });
    spans = [];
    used = 0;
  }
  function append(text, category) {
    const last = spans.at(-1),
      style = category?.style || "normal",
      color = category?.color || null;
    if (last && last.style === style && last.color === color) last.text += text;
    else spans.push({ text, style, color });
    for (const ch of text) used += glyphWidth(ch, style, size);
  }
  for (const run of runs) {
    const c = categories.find((c) => c.id === run.mark?.categoryId),
      style = c?.style || "normal";
    for (const token of run.text.match(/\n|[^\S\n]+|[^\s]+/gu) || []) {
      if (token === "\n") {
        flush("\n");
        continue;
      }
      const tokenWidth = [...token].reduce(
        (n, ch) => n + glyphWidth(ch, style, size),
        0,
      );
      if (used && used + tokenWidth > width) {
        flush(" ");
        if (!token.trim()) continue;
      }
      if (tokenWidth <= width) {
        if (used || token.trim()) append(token, c);
        continue;
      }
      for (const char of token) {
        if (used && used + glyphWidth(char, style, size) > width) flush();
        append(char, c);
      }
    }
  }
  if (spans.length) flush();
  return lines;
}
function linesToRuns(lines, categories) {
  return lines.flatMap((line) => [
    ...line.spans.map((span) => ({
      text: span.text,
      mark: span.color
        ? {
            categoryId: categories.find(
              (c) => c.color === span.color && c.style === span.style,
            )?.id,
          }
        : null,
    })),
    { text: line.separator || "", mark: null },
  ]);
}
export function drawLines(cx, lines, x, y, size, lineHeight) {
  cx.save();
  cx.textBaseline = "top";
  for (const line of lines) {
    let left = x;
    for (const span of line.spans) {
      cx.font = font(span.style, size);
      const w = cx.measureText(span.text).width;
      if (span.color) {
        cx.fillStyle = span.color;
        cx.fillRect(left, y, w, lineHeight);
      }
      cx.fillStyle = span.color ? highlightInk(span.color) : "#25272b";
      cx.fillText(span.text, left, y + 1);
      left += w;
    }
    y += lineHeight;
  }
  cx.restore();
}
function content(
  project,
  card,
  options,
  width,
  side = false,
  cellHeight = Infinity,
) {
  const aspect =
    project.ratio === "9:16"
      ? 9 / 16
      : project.ratio === "4:3"
        ? 4 / 3
        : 16 / 9;
  const categories = project.highlighter.categories;
  const artW = side
    ? Math.min(width * 0.42, cellHeight * aspect, options.thumb || Infinity)
    : Math.min(width, options.thumb || Infinity);
  const artH = artW / aspect;
  const textX = side ? artW + options.gap : 0,
    textW = width - textX;
  const script =
    options.script === "none"
      ? []
      : wrapRuns(
          cardScriptRuns(project, card.id, options.script),
          Math.max(12, textW - 12),
          options.scriptFont,
          categories,
        );
  const note =
    options.notes && card.note
      ? wrapRuns(
          [{ text: card.note }],
          Math.max(12, textW - 16),
          options.noteFont,
        )
      : [];
  const numberH = options.numbers ? 18 : 0;
  const scriptH = script.length
    ? script.length * options.scriptFont * 1.45 + 12
    : 0;
  const noteH = note.length ? note.length * options.noteFont * 1.45 + 16 : 0;
  const textH = numberH + scriptH + noteH;
  return {
    card,
    artW,
    artH,
    textX,
    textW,
    numberH,
    script,
    note,
    scriptH,
    noteH,
    height: side ? Math.max(artH, textH) : artH + textH + 4,
    side,
  };
}
export function layoutCards(project, cards, width, height, options = {}) {
  const opt = {
    cols: 3,
    rows: 4,
    gap: 14,
    script: "all",
    scriptFont: 14,
    noteFont: 12,
    notes: false,
    numbers: true,
    ...options,
  };
  const hasText =
    opt.script !== "none" &&
    cards.some((c) =>
      cardScriptRuns(project, c.id, opt.script).some((r) => r.text.trim()),
    );
  const baseRows =
    !opt.fillRows && (hasText || opt.notes)
      ? Math.max(1, Math.min(opt.rows, Math.ceil(opt.rows / 2)))
      : opt.rows;
  const candidates = [];
  for (let rows = baseRows; rows >= 1; rows--)
    candidates.push({ cols: opt.cols, rows, side: false });
  for (let cols = Math.min(2, opt.cols); cols >= 1; cols--)
    candidates.push({ cols, rows: 1, side: true });
  const pages = [];
  let offset = 0;
  while (offset < cards.length) {
    let best = null;
    for (const candidate of candidates) {
      const { cols, rows, side } = candidate,
        cellW = (width - opt.gap * (cols - 1)) / cols,
        cellH = (height - opt.gap * (rows - 1)) / rows;
      let count = 0,
        items = [];
      for (const card of cards.slice(offset, offset + cols * rows)) {
        const item = content(project, card, opt, cellW, side, cellH);
        if (item.height > cellH + 0.1) break;
        items.push(item);
        count++;
      }
      if (count && (!best || count > best.items.length))
        best = { ...candidate, cellW, cellH, items };
    }
    if (!best) {
      // An oversized passage remains readable; only print splits it into continuation pages.
      const item = content(project, cards[offset], opt, width, true, height);
      if (!opt.continuations) {
        best = {
          cols: 1,
          rows: 1,
          side: true,
          cellW: width,
          cellH: Math.max(height, item.height),
          items: [item],
        };
      } else {
        const first = item;
        let script = first.script.slice(),
          note = first.note.slice(),
          initial = true;
        while (initial || script.length || note.length) {
          const numberH = opt.numbers ? 18 : 0,
            available = height - numberH - 24;
          const scriptCount = Math.min(
            script.length,
            Math.max(0, Math.floor(available / (opt.scriptFont * 1.45))),
          );
          const scriptPart = script.splice(0, scriptCount),
            used = scriptPart.length
              ? scriptPart.length * opt.scriptFont * 1.45 + 12
              : 0;
          const noteCount = Math.min(
            note.length,
            Math.max(0, Math.floor((available - used) / (opt.noteFont * 1.45))),
          );
          const notePart = note.splice(0, noteCount);
          if (!scriptPart.length && !notePart.length && !initial)
            throw Error("Print area is too small for readable text.");
          const part = {
            ...first,
            textX: initial ? first.textX : 0,
            textW: initial ? first.textW : width,
            script: scriptPart,
            note: notePart,
            scriptH: used,
            noteH: notePart.length
              ? notePart.length * opt.noteFont * 1.45 + 16
              : 0,
            continuation: !initial,
            artW: initial ? first.artW : 0,
            artH: initial ? first.artH : 0,
          };
          pages.push({
            cols: 1,
            rows: 1,
            side: true,
            cellW: width,
            cellH: height,
            items: [part],
            offset,
          });
          if (initial) {
            script = wrapRuns(
              linesToRuns(script, project.highlighter.categories),
              width - 12,
              opt.scriptFont,
              project.highlighter.categories,
            );
            note = wrapRuns(linesToRuns(note, []), width - 16, opt.noteFont);
          }
          initial = false;
        }
        offset++;
        continue;
      }
    }
    best.offset = offset;
    pages.push(best);
    offset += best.items.length;
  }
  if (!pages.length)
    pages.push({
      cols: opt.cols,
      rows: baseRows,
      side: false,
      cellW: (width - opt.gap * (opt.cols - 1)) / opt.cols,
      cellH: (height - opt.gap * (baseRows - 1)) / baseRows,
      items: [],
      offset: 0,
    });
  return pages;
}
