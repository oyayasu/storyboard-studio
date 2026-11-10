import {ensureCardLabels,exportLabel} from './card-labels.js';
import { ARCHIVE_ROOT,ensureWorkspace, chapterDirectories } from "./studio-link-model.js";
import { cardVisualIdentity } from "./image-assembly-model.js";
export function chapterNumberFor(project, chapter) {
  project = { ...project, studioLink: structuredClone(project.studioLink) };
  ensureWorkspace(project);
  const active = (project.chapters || []).filter((c) => !c.unused),
    roots = active.filter((c) => !c.parentId);
  if (chapter.parentId) {
    const parent = roots.findIndex((c) => c.id === chapter.parentId) + 1,
      index =
        active
          .filter((c) => c.parentId === chapter.parentId)
          .findIndex((c) => c.id === chapter.id) + 1;
    return `${parent}.${index}`;
  }
  return String(roots.findIndex((c) => c.id === chapter.id) + 1);
}
function fingerprint(value) {
  let a = 0x811c9dc5,
    b = 0x9e3779b9;
  for (const char of JSON.stringify(value)) {
    const n = char.codePointAt(0);
    a = Math.imul(a ^ n, 0x01000193);
    b = Math.imul(b ^ n, 0x85ebca6b);
  }
  return [a, b].map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
}
export function buildProjectReference(
  project,
  numbering = "chapter",
  now = new Date().toISOString(),
) {
  project = { ...project, studioLink: structuredClone(project.studioLink) };
  ensureWorkspace(project);
  const active = (project.chapters || []).filter((c) => !c.unused),
    activeIds = new Set(active.map((c) => c.id));
  if (active.some((c) => c.parentId && !activeIds.has(c.parentId)))
    throw Error(
      "Restore the parent of each active subchapter before exporting the project reference.",
    );
  ensureCardLabels(project);
  let global = 0;
  const chapters = active.map((ch) => ({
    id: ch.id,
    parentId: ch.parentId || null,
    number: chapterNumberFor(project, ch),
    title: ch.name,
    cards: (project.stories || [])
      .filter((c) => c.chapterId === ch.id)
      .map((c, index) => ({
        id: c.id,
        frameLabel: exportLabel(project,c,'chapter').label,
        globalFrameLabel: exportLabel(project,c,'global').label,
        displayLabel: exportLabel(project,c,numbering).label,
        exportNumber: exportLabel(project,c,'chapter').number,
        globalExportNumber: exportLabel(project,c,'global').number,
        slightModifyIndex: exportLabel(project,c).suffix,
        modifiedOf: c.modifiedOf||null,
        ordinal: index+1,
        number: index + 1,
        globalNumber: ++global,
        displayNumber: numbering === "global" ? global : index + 1,
        sourceCardId: c.reuseOf || c.id,
        variantIndex: cardVisualIdentity(project, c).index,
        variantAssetId: cardVisualIdentity(project, c).assetId,
        blank: !!c.blank,
      })),
  }));
  const structure = {
    projectId: project.id,
    projectName: project.name,
    ratio: project.ratio,
    chapters,
  };
  return {
    format: "storyboardstudio-reference-v1",
    schemaVersion: 1,
    exportedAt: now,
    sourceApp: "Storyboard Studio",
    project: {
      id: project.id,
      name: project.name,
      ratio: project.ratio,
      numbering,
    },
    structuralSignature: fingerprint(structure),
    componentOrder: { direction: "bottom-to-top", startIndex: 1 },
    naming: project.fileNaming,
    archiveRoot: ARCHIVE_ROOT,
    chapterDirectories: chapterDirectories(project),
    mediaRoot: ".",
    chapters,
  };
}
