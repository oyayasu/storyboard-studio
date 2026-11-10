import { ensureProject, ensureChapter } from "./highlighter-model.js";
import { chapterNumberFor } from "./project-reference.js";
export const canImportDocx = (project) =>
  !!project &&
  !(project.chapters || []).some((c) =>
    String(c.highlighter?.text || "").trim(),
  );
const normalized = (name) =>
  String(name || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ");
const cardsOf = (project, id) =>
  ["stories", "unassigned", "lost", "archived"]
    .flatMap((key) => project[key] || [])
    .filter((c) => c.chapterId === id);
function reusablePlaceholder(project) {
  const chapters = project.chapters || [],
    ch = chapters[0];
  return chapters.length === 1 &&
    !ch.parentId &&
    !ch.unused &&
    /^chapter\s*1$/i.test(ch.name) &&
    !cardsOf(project, ch.id).length &&
    !(project.stickyNotes || []).some((n) => n.chapterId === ch.id)
    ? ch.id
    : null;
}
export function suggestChapterTargets(project, sections) {
  const mapping = {},
    used = new Set(),
    placeholder = reusablePlaceholder(project);
  for (const section of sections) {
    const parentId = section.level === 2 ? mapping[section.parentKey] : null;
    const eligible = project.chapters.filter(
      (c) =>
        !c.unused &&
        !used.has(c.id) &&
        (section.level === 1
          ? !c.parentId
          : parentId && parentId !== "new" && c.parentId === parentId),
    );
    let candidates = eligible.filter(
      (c) => normalized(c.name) === normalized(section.name),
    );
    if (!candidates.length && section.sourceNumber)
      candidates = eligible.filter(
        (c) => chapterNumberFor(project, c) === section.sourceNumber,
      );
    const target =
      candidates.length === 1
        ? candidates[0].id
        : section === sections[0] && section.level === 1 && placeholder
          ? placeholder
          : "new";
    mapping[section.key] = target;
    if (target !== "new") used.add(target);
  }
  return mapping;
}
export function matchingChapters(project, section, mapping) {
  const parentId = section.level === 2 ? mapping[section.parentKey] : null;
  return project.chapters.filter(
    (c) =>
      !c.unused &&
      (section.level === 1
        ? !c.parentId
        : parentId && parentId !== "new" && c.parentId === parentId),
  );
}
export function applyDocxImport(
  project,
  parsed,
  mapping,
  createChapter,
  filename,
) {
  if (!canImportDocx(project))
    throw Error(
      "Delete all chapter and subchapter script text before importing a DOCX.",
    );
  if (!Array.isArray(parsed?.sections) || !parsed.sections.length)
    throw Error("The DOCX has no chapters to import.");
  const keys = new Map(),
    chosen = new Set();
  for (const section of parsed.sections) {
    if (
      !section.key ||
      keys.has(section.key) ||
      ![1, 2].includes(section.level) ||
      !section.name?.trim() ||
      typeof section.text !== "string"
    )
      throw Error("The chapter preview is invalid. Choose the DOCX again.");
    if (section.level === 2 && keys.get(section.parentKey) !== 1)
      throw Error("A subchapter has no imported parent chapter.");
    keys.set(section.key, section.level);
    const target = mapping[section.key];
    if (!target)
      throw Error("Choose a destination for every imported chapter.");
    if (target !== "new") {
      if (chosen.has(target))
        throw Error("Each imported chapter needs a different destination.");
      if (
        !matchingChapters(project, section, mapping).some(
          (c) => c.id === target,
        )
      )
        throw Error(
          "A chapter destination changed. Review the chapter matches again.",
        );
      chosen.add(target);
    }
    if (section.text.length > 2 * 1024 * 1024)
      throw Error("An imported chapter is larger than 2 MB.");
  }
  // Stage the full result before changing the project, even outside a Store transaction.
  const next = structuredClone(project);
  ensureProject(next);
  const ids = {},
    placeholder = reusablePlaceholder(project),
    created = [];
  for (const section of parsed.sections) {
    let ch;
    if (mapping[section.key] === "new") {
      ch = createChapter(
        section.name,
        section.level === 2 ? ids[section.parentKey] : null,
      );
      created.push(ch.id);
      if (ch.parentId) {
        const index = next.chapters.findLastIndex(
          (c) => c.id === ch.parentId || c.parentId === ch.parentId,
        );
        next.chapters.splice(index + 1, 0, ch);
      } else {
        const firstUnused = next.chapters.findIndex((c) => c.unused);
        next.chapters.splice(
          firstUnused < 0 ? next.chapters.length : firstUnused,
          0,
          ch,
        );
      }
    } else {
      ch = next.chapters.find((c) => c.id === mapping[section.key]);
      if (ch.id === placeholder) ch.name = section.name;
    }
    ids[section.key] = ch.id;
    const h = ensureChapter(ch, next.highlighter.categories);
    h.text = section.text.trim() ? section.text : null;
    h.marks = [];
    h.assignments = [];
    h.pauses = [];
    h.importedAt = new Date().toISOString();
    delete h.nextExistingCardId;
    for (const mark of section.marks || []) {
      if (
        !h.text ||
        !/^#[a-f\d]{6}$/i.test(mark.color) ||
        !Number.isInteger(mark.from) ||
        !Number.isInteger(mark.to) ||
        mark.from < 0 ||
        mark.to > h.text.length ||
        mark.from >= mark.to
      )
        continue;
      const style = ["normal", "italic", "bold", "bold-italic"].includes(
          mark.style,
        )
          ? mark.style
          : "normal",
        color = mark.color.toLowerCase();
      let category = next.highlighter.categories.find(
        (c) => c.color.toLowerCase() === color && c.style === style,
      );
      if (!category) {
        category = {
          id: "category-" + crypto.randomUUID(),
          name:
            "Imported highlight " +
            (next.highlighter.categories.filter((c) =>
              c.name.startsWith("Imported highlight "),
            ).length +
              1),
          color,
          style,
        };
        next.highlighter.categories.push(category);
      }
      h.marks.push({ from: mark.from, to: mark.to, categoryId: category.id });
    }
  }
  next.highlighter.lastDocxImport = {
    filename,
    importedAt: new Date().toISOString(),
    chapterIds: Object.values(ids),
  };
  next.modifiedAt = new Date().toISOString();
  ensureProject(next);
  Object.assign(project, next);
  return {
    firstChapterId: ids[parsed.sections[0].key],
    createdChapterIds: created,
    chapterIds: Object.values(ids),
  };
}
export function chapterMatchLabel(project, ch) {
  return `${chapterNumberFor(project, ch)} · ${ch.name} (${cardsOf(project, ch.id).length} cards)`;
}
