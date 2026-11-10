import {ensureCardLabels,displayNumber,modificationRoot} from './card-labels.js';
const everyone = (p) =>
  ["stories", "unassigned", "lost", "archived"].flatMap((k) => p[k] || []);
export function modificationLabel(project, card, scope = "chapter") {
  if (!card.modifiedOf || card.numberAsRegular) return "";
  const source = everyone(project).find((c) => c.id === card.modifiedOf);
  const number=source?displayNumber(project,source.id,scope):0;
  const history=project.deletedCardOrigins?.[card.modifiedOf];
  return source?'modified of '+(number||card.modifiedSourceNumber||'source card')+(number?'':' (off board)'):'modified from deleted card '+(history?.[scope==='global'?'globalLabel':'label']||card.modifiedSourceNumber||'source');
}
export function addIndependentCard(
  project,
  source,
  {
    kind,
    assetId = null,
    createCard,
    chapterId = source.chapterId,
    sourceNumber = 0,
  },
) {
  const origin=kind==='modify'?modificationRoot(project,source):null;
  if (!["modify", "duplicate"].includes(kind))
    throw Error("Unknown copy action");
  if (!project.chapters.some((ch) => ch.id === chapterId && !ch.unused))
    throw Error("Choose an active chapter for the copy.");
  const card = createCard(chapterId, assetId);
  card.reuseOf = null;
  card.note = "";
  card.tags = [];
  card.stickers = [];
  card.activeVariant = 0;
  card.completionStatus = "red";
  if (kind === "modify") {
    card.modifiedOf = origin.id;
    card.modifiedBaseId=origin.id;card.modifiedBaseNumber=source.modifiedBaseNumber;card.modifiedBaseGlobalNumber=source.modifiedBaseGlobalNumber;
    card.modifiedSourceNumber = sourceNumber > 0 ? sourceNumber : null;
  }
  const index = project.stories.findIndex((c) => c.id === source.id);
  const last = project.stories
    .map((c, i) => (c.chapterId === chapterId ? i : -1))
    .reduce((a, b) => Math.max(a, b), -1);
  project.stories.splice(
    index >= 0 ? index + 1 : last >= 0 ? last + 1 : project.stories.length,
    0,
    card,
  );
  ensureCardLabels(project);
  return card;
}
