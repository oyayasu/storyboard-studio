// Text is an immutable chapter snapshot. All positions are UTF-16 string offsets.
const id = (prefix) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
const clone = (value) => structuredClone(value);
export const DEFAULT_CATEGORIES = [
  { id: "action", name: "Action", color: "#e4eabf" },
  { id: "explanation", name: "Explanation", color: "#cfe6f1" },
  { id: "character", name: "Character", color: "#e4d7f0" },
  { id: "emotion", name: "Emotion", color: "#f0d4db" },
  { id: "pose", name: "Existing pose", color: "#d1e8db" },
  { id: "image", name: "Image", color: "#f4dfbb" },
  { id: "image-drawing", name: "Image + drawing", color: "#d8dcf2" },
  { id: "note", name: "Note / not spoken", color: "#dededb" },
].map((c) => ({ ...c, style: "normal", spoken: false }));

export function ensureProject(project) {
  project.viewPrefs ||= {};
  for (const key of [
    "stories",
    "unassigned",
    "lost",
    "archived",
    "stickyNotes",
    "archivedStickies",
    "customTags",
    "assets",
  ])
    if (!Array.isArray(project[key])) project[key] = [];
  project.highlighter ||= { version: 1, categories: clone(DEFAULT_CATEGORIES) };
  const h = project.highlighter;
  if (!Array.isArray(h.categories)) h.categories = clone(DEFAULT_CATEGORIES);
  const seen = new Set();
  h.categories = h.categories
    .filter(
      (c) => c && typeof c.id === "string" && !seen.has(c.id) && seen.add(c.id),
    )
    .map((c) => ({
      id: c.id,
      name: String(c.name || "Category").slice(0, 80),
      color: /^#[a-f\d]{6}$/i.test(c.color) ? c.color : "#dededb",
      style: ["normal", "italic", "bold", "bold-italic"].includes(c.style)
        ? c.style
        : "normal",
      spoken: c.spoken === true,
    }));
  for (const chapter of project.chapters || [])
    ensureChapter(chapter, h.categories);
  return h;
}

export function ensureChapter(chapter, categories = DEFAULT_CATEGORIES) {
  chapter.highlighter ||= {
    text: null,
    marks: [],
    assignments: [],
    importedAt: null,
  };
  const h = chapter.highlighter;
  if (h.text !== null && typeof h.text !== "string") h.text = null;
  const length = h.text?.length || 0;
  h.pauses = (Array.isArray(h.pauses) ? h.pauses : []).filter(
    (p) =>
      p &&
      p.manual &&
      typeof p.id === "string" &&
      Number.isInteger(p.offset) &&
      p.offset >= 0 &&
      p.offset <= length,
  );
  const valid = (r) =>
    r &&
    Number.isInteger(r.from) &&
    Number.isInteger(r.to) &&
    r.from >= 0 &&
    r.to > r.from &&
    r.to <= length;
  const categoryIds = new Set(categories.map((c) => c.id));
  h.marks = coalesce(
    (Array.isArray(h.marks) ? h.marks : []).filter(
      (r) => valid(r) && categoryIds.has(r.categoryId),
    ),
  );
  h.assignments = cleanRanges(
    h.text || "",
    (Array.isArray(h.assignments) ? h.assignments : []).filter(
      (r) => valid(r) && typeof r.cardId === "string",
    ),
  ).sort((a, b) => a.from - b.from);
  // Reject overlapping imported assignments deterministically instead of drawing ambiguous links.
  let end = -1;
  h.assignments = h.assignments.filter((r) => {
    if (r.from < end) return false;
    end = r.to;
    r.id ||= id("link");
    return true;
  });
  return h;
}

export function setChapterText(chapter, text) {
  const h = ensureChapter(chapter);
  if (h.text !== null)
    throw Error(
      "This chapter already has read-only text. Add text to an empty chapter.",
    );
  const normalized = String(text).replace(/\r\n?/g, "\n");
  if (!normalized.trim()) throw Error("Paste some chapter text first.");
  h.text = normalized;
  h.marks = [];
  h.assignments = [];
  h.pauses = [];
  h.importedAt = new Date().toISOString();
  return h;
}

export function trimRange(text, from, to) {
  from = Math.max(0, Math.min(text.length, from));
  to = Math.max(from, Math.min(text.length, to));
  while (from < to && /\s/u.test(text[from])) from++;
  while (to > from && /\s/u.test(text[to - 1])) to--;
  if (from === to) throw Error("Select some text first.");
  return { from, to };
}
const overlaps = (a, b) => a.from < b.to && b.from < a.to;
function subtract(r, cut) {
  if (!overlaps(r, cut)) return [r];
  const out = [];
  if (r.from < cut.from) out.push({ ...r, to: cut.from });
  if (r.to > cut.to)
    out.push({ ...r, from: cut.to, id: r.id ? id("link") : undefined });
  return out;
}
function coalesce(ranges) {
  const out = [];
  for (const r of ranges.slice().sort((a, b) => a.from - b.from)) {
    const previous = out.at(-1);
    if (
      previous &&
      r.from < previous.to &&
      r.categoryId !== previous.categoryId
    )
      continue;
    if (
      previous &&
      previous.categoryId === r.categoryId &&
      r.from <= previous.to
    )
      previous.to = Math.max(previous.to, r.to);
    else out.push({ ...r });
  }
  return out;
}

export function colorRange(
  project,
  chapter,
  from,
  to,
  categoryId,
  remove = false,
) {
  const categories = ensureProject(project).categories,
    h = ensureChapter(chapter, categories);
  const category = categories.find((c) => c.id === categoryId);
  if (!category) throw Error("Choose a category.");
  const range = trimRange(h.text || "", from, to);
  h.marks = coalesce(
    h.marks.flatMap((m) =>
      remove && m.categoryId !== categoryId ? [m] : subtract(m, range),
    ),
  );
  if (!remove) h.marks = coalesce([...h.marks, { ...range, categoryId }]);
}

function cleanRanges(text, ranges) {
  return ranges.flatMap((r) => {
    try {
      return [{ ...r, ...trimRange(text, r.from, r.to) }];
    } catch {
      return [];
    }
  });
}
export function clearChapterText(chapter) {
  chapter.highlighter = {
    text: null,
    marks: [],
    assignments: [],
    importedAt: null,
  };
}
export function assignRange(chapter, from, to, cardId, expandId = null) {
  const h = chapter.highlighter,
    origin = h.assignments.find(
      (a) => a.id === expandId && a.cardId === cardId,
    );
  let range = wordRange(h.text, from, to);
  if (origin)
    range = {
      from: Math.min(origin.from, range.from),
      to: Math.max(origin.to, range.to),
    };
  const assignment = { id: origin?.id || id("link"), ...range, cardId };
  const rest = h.assignments
    .filter((a) => a.id !== origin?.id)
    .flatMap((a) => subtract(a, range));
  h.assignments = cleanRanges(h.text, [...rest, assignment]).sort(
    (a, b) => a.from - b.from,
  );
  // Joining adjacent passages of the same card never consumes undecided words.
  for (let i = 0; i < h.assignments.length - 1; ) {
    const a = h.assignments[i],
      b = h.assignments[i + 1];
    if (a.cardId === b.cardId && !h.text.slice(a.to, b.from).trim()) {
      if (b.id === assignment.id) a.id = b.id;
      a.to = b.to;
      h.assignments.splice(i + 1, 1);
    } else i++;
  }
  return (
    h.assignments.find((a) => a.id === assignment.id) ||
    h.assignments.find(
      (a) => a.cardId === cardId && a.from <= range.from && a.to >= range.to,
    )
  );
}
export function insertLinkedCard(project, chapter, from, to, createCard) {
  const h = chapter.highlighter,
    range = wordRange(h.text, from, to);
  const next = h.assignments.find(
    (a) => a.from >= range.to && project.stories.some((c) => c.id === a.cardId),
  );
  const previous = h.assignments
    .filter(
      (a) =>
        a.to <= range.from && project.stories.some((c) => c.id === a.cardId),
    )
    .at(-1);
  const card = createCard(chapter.id);
  let index = next
    ? project.stories.findIndex((c) => c.id === next.cardId)
    : previous
      ? project.stories.findIndex((c) => c.id === previous.cardId) + 1
      : -1;
  if (index < 0) {
    const last = project.stories.findLastIndex(
      (c) => c.chapterId === chapter.id,
    );
    index = last < 0 ? project.stories.length : last + 1;
  }
  project.stories.splice(index, 0, card);
  return assignRange(chapter, range.from, range.to, card.id);
}
export function rewindFreedAssignments(chapter,before){const h=chapter.highlighter,remaining=new Set(h.assignments.map(a=>a.cardId));const freed=before.slice().sort((a,b)=>a.from-b.from).find(a=>!remaining.has(a.cardId));if(freed)h.nextExistingCardId=freed.cardId;return freed?.cardId||null;}
export function removeAssignmentRange(chapter, from, to) {
  const before=(chapter.highlighter?.assignments||[]).filter(a=>a.from<Math.max(from,to)&&a.to>Math.min(from,to)).map(a=>a.cardId);
  const h = chapter.highlighter,
    range = wordRange(h.text, from, to);
  h.assignments = cleanRanges(
    h.text,
    h.assignments.flatMap((a) => subtract(a, range)),
  );
  const freed=before.find(id=>!h.assignments.some(a=>a.cardId===id));if(freed)h.nextExistingCardId=freed;
}

export function splitPoint(chapter, assignmentId, offset) {
  const h = chapter.highlighter,
    a = h.assignments.find((x) => x.id === assignmentId);
  if (!a) throw Error("Click inside an assigned passage.");
  let split = Math.max(a.from, Math.min(a.to, offset));
  if (
    split > a.from &&
    split < a.to &&
    !/\s/u.test(h.text[split - 1]) &&
    !/\s/u.test(h.text[split])
  ) {
    let left = split,
      right = split;
    while (left > a.from && !/\s/u.test(h.text[left - 1])) left--;
    while (right < a.to && !/\s/u.test(h.text[right])) right++;
    if (left > a.from || right < a.to)
      split = split - left < right - split ? left : right;
  }
  let first, second;
  try {
    first = trimRange(h.text, a.from, split);
    second = trimRange(h.text, split, a.to);
  } catch {
    throw Error("Split between words, leaving text on both sides.");
  }
  return { first, second, offset: second.from };
}
export function splitAssignment(
  project,
  chapter,
  assignmentId,
  offset,
  createCard,
) {
  const h = chapter.highlighter,
    a = h.assignments.find((x) => x.id === assignmentId);
  const { first, second } = splitPoint(chapter, assignmentId, offset);
  const card = createCard(chapter.id),
    original = project.stories.findIndex((c) => c.id === a.cardId);
  project.stories.splice(
    original < 0 ? project.stories.length : original + 1,
    0,
    card,
  );
  Object.assign(a, first);
  const b = { id: id("link"), ...second, cardId: card.id };
  h.assignments.push(b);
  h.assignments.sort((x, y) => x.from - y.from);
  return b;
}

export function cardPassages(project, cardId) {
  const out = [];
  for (const chapter of project.chapters || []) {
    const h = chapter.highlighter;
    if (!h?.text) continue;
    for (const a of h.assignments || [])
      if (a.cardId === cardId)
        out.push({
          chapterId: chapter.id,
          assignmentId: a.id,
          text: h.text.slice(a.from, a.to),
          from: a.from,
          to: a.to,
        });
    for (const a of chapterPauses(h).filter(
      (p) => p.manual && p.cardId === cardId,
    ))
      out.push({
        chapterId: chapter.id,
        assignmentId: a.id,
        text: "[" + a.label + "]",
        from: a.offset,
        to: a.offset,
        pause: true,
      });
  }
  return out;
}

// One shared renderer uses these boundaries for both the sidebar and expanded page.
export function textPieces(project, chapter) {
  const h = chapter.highlighter;
  if (!h?.text) return [];
  const boundaries = new Set([0, h.text.length]);
  const pauses = chapterPauses(h);
  for (const r of [
    ...h.marks,
    ...h.assignments,
    ...pauses.filter((x) => !x.manual),
  ]) {
    boundaries.add(r.from);
    boundaries.add(r.to);
  }
  const points = [...boundaries].sort((a, b) => a - b),
    out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i],
      to = points[i + 1];
    out.push({
      from,
      to,
      text: h.text.slice(from, to),
      mark: h.marks.find((m) => m.from <= from && m.to >= to) || null,
      pause:
        pauses.find((p) => !p.manual && p.from <= from && p.to >= to) || null,
      assignment:
        h.assignments.find((a) => a.from <= from && a.to >= to) || null,
    });
  }
  for (const pause of pauses.filter((p) => p.manual))
    out.push({
      from: pause.offset,
      to: pause.offset,
      text: "[" + pause.label + "]",
      pause,
      mark: null,
      assignment: pause.cardId ? { id: pause.id, cardId: pause.cardId } : null,
    });
  return out.sort((a, b) => a.from - b.from || (a.pause?.manual ? -1 : 1));
}

// Only category marks determine speech. Storyboard links are independent.
export function cardScriptRuns(project, cardId, view = "all") {
  const out = [];
  for (const a of cardPassages(project, cardId)) {
    const ch = project.chapters.find((c) => c.id === a.chapterId);
    const pieces = textPieces(project, ch).filter(
      (r) =>
        !r.pause?.manual &&
        r.from >= a.from &&
        r.to <= a.to &&
        (view !== "spoken" || r.pause || isSpokenPiece(project, r)),
    );
    if (!pieces.some((r) => r.text.trim())) continue;
    if (out.length) out.push({ text: "\n", mark: null });
    out.push(...pieces);
  }
  for (const ch of project.chapters || [])
    for (const pause of chapterPauses(ch.highlighter || {}).filter(
      (p) => p.manual && p.cardId === cardId,
    )) {
      if (out.length) out.push({ text: "\n", mark: null });
      out.push({ text: "[" + pause.label + "]", pause, mark: null });
    }
  return out;
}

export function nextExistingCard(project, chapter) {
  const cards = project.stories.filter((c) => c.chapterId === chapter.id),
    h = chapter.highlighter;
  if (h.nextExistingCardId === null)
    return (
      cards.find((c) => !h.assignments.some((a) => a.cardId === c.id)) || null
    );
  const saved = cards.find((c) => c.id === h.nextExistingCardId);
  return (
    saved ||
    cards.find((c) => !h.assignments.some((a) => a.cardId === c.id)) ||
    null
  );
}
export function advanceExistingCard(project, chapter, cardId) {
  const cards = project.stories.filter((c) => c.chapterId === chapter.id),
    index = cards.findIndex((c) => c.id === cardId);
  chapter.highlighter.nextExistingCardId = cards[index + 1]?.id || null;
}

export function highlightInk(color) {
  const hex = String(color).replace("#", ""),
    n = parseInt(hex, 16),
    light =
      (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) /
      1000;
  return light < 140 ? "#ffffff" : "#25272b";
}

// Markers retain their literal script spelling; manually inserted markers are
// zero-width annotations and never modify the read-only text snapshot.
export function chapterPauses(h) {
  const pauses = [];
  for (const m of String(h.text || "").matchAll(
    /\(\s*(?:(?:short|long)\s+)?(?:pause|silence)\s*\)|\[\s*(?:(?:short|long)\s+)?(?:pause|silence)\s*\]/giu,
  ))
    pauses.push({
      id: "pause-" + m.index,
      from: m.index,
      to: m.index + m[0].length,
      offset: m.index,
      label: m[0].slice(1, -1).trim(),
      manual: false,
    });
  for (const p of h.pauses || [])
    if (p && p.manual && typeof p.id === "string" && Number.isInteger(p.offset))
      pauses.push({
        ...p,
        from: p.offset,
        to: p.offset,
        label: String(p.label || "Pause").slice(0, 80),
      });
  return pauses.sort((a, b) => a.offset - b.offset);
}
export function isSpokenPiece(project, piece) {
  if (piece.pause) return false;
  return (
    !piece.mark ||
    project.highlighter?.categories?.find((c) => c.id === piece.mark.categoryId)
      ?.spoken === true
  );
}
export function wordSegments(text) {
  if (globalThis.Intl?.Segmenter)
    return [
      ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text),
    ]
      .filter((x) => x.isWordLike)
      .map((x) => ({ from: x.index, to: x.index + x.segment.length }));
  return [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)].map(
    (m) => ({ from: m.index, to: m.index + m[0].length }),
  );
}
export function wordRange(text, from, to) {
  let r = trimRange(text, from, to);
  for (const w of wordSegments(text)) {
    if (w.from < r.from && w.to > r.from) r.from = w.from;
    if (w.from < r.to && w.to > r.to) r.to = w.to;
  }
  for (const p of chapterPauses({ text }))
    if (r.from < p.to && p.from < r.to) {
      r.from = Math.min(r.from, p.from);
      r.to = Math.max(r.to, p.to);
    }
  return r;
}
export function addPause(chapter, offset, label = "Pause") {
  const h = chapter.highlighter;
  if (!h?.text) throw Error("Add chapter text first.");
  offset = Math.max(0, Math.min(h.text.length, offset));
  const w = wordSegments(h.text).find((w) => offset > w.from && offset < w.to);
  if (w) offset = offset - w.from < w.to - offset ? w.from : w.to;
  const existing = chapterPauses(h).find((p) => p.offset === offset);
  if (existing) return existing;
  const pause = { id: id("pause"), manual: true, offset, label, cardId: null };
  (h.pauses ||= []).push(pause);
  return pause;
}
export function pauseAssignments(project, chapter) {
  const h = chapter.highlighter || {};
  return chapterPauses(h).flatMap((p) => {
    const a = p.manual
      ? p.cardId
        ? { id: p.id, cardId: p.cardId, from: p.offset, to: p.offset }
        : null
      : (h.assignments || []).find((a) => a.from <= p.from && a.to >= p.to);
    return a ? [{ ...a, pause: p }] : [];
  });
}

export function reverseExpansionOrigin(chapter,anchor,head,lastVisibleWordFrom=null){
 const h=chapter.highlighter;if(!h?.text||head>=anchor)return null;
 const finalWord=wordSegments(h.text).at(-1);
 if(anchor>=(lastVisibleWordFrom??finalWord?.from??Infinity))return null;
 const origin=h.assignments.find(a=>anchor>a.from&&anchor<=a.to);
 if(!origin||head>=origin.from)return null;
 const fullWord=wordSegments(h.text).some(w=>w.from>=origin.from&&w.to<=origin.to&&w.from>=head&&w.to<=anchor);
 return fullWord?origin:null;
}
