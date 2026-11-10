import {fileLeaf} from './studio-link-model.js';
const MAX_FILES = 4096,
  MAX_FRAMES = 2048;
const allCards = (p) =>
  ["stories", "unassigned", "lost", "archived"].flatMap((k) => p[k] || []);
const activeCards = (p) =>
  (p.stories || []).filter((c) =>
    p.chapters?.some((ch) => ch.id === c.chapterId && !ch.unused),
  );
const text = (v, max = 1000) => (typeof v === "string" ? v.slice(0, max) : "");
const required = (v, label) => {
  if (typeof v !== "string" || !v.trim() || v.length > 2048)
    throw Error("Invalid " + label + " in the image index.");
  return v;
};
const dimension = (v) => Number.isInteger(v) && v > 0 && v <= 100000;
export function imagePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2048 ||
    /[\\\x00-\x1f]/u.test(value) ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    value.includes("://") ||
    value.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw Error("The image index contains an invalid file location.");
  if (!/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(value))
    throw Error("The image index contains an unsupported image filename.");
  return value;
}
function hash(value) {
  let n = 2166136261;
  for (const c of JSON.stringify(value))
    n = Math.imul(n ^ c.codePointAt(0), 16777619);
  return (n >>> 0).toString(16);
}
export function parseImageIndex(input, filename = "folderexporter-index.json") {
  if (typeof input === "string" && input.length > 16 * 1024 * 1024)
    throw Error("The image index exceeds 16 MB.");
  let raw;
  try {
    raw =
      typeof input === "string"
        ? JSON.parse(input.replace(/^\uFEFF/u, ""))
        : structuredClone(input);
  } catch {
    throw Error("The image index is not valid JSON.");
  }
  if (
    !raw ||
    raw.format !== "folderexporter-index-v1" ||
    raw.schemaVersion !== 1 ||
    !["index-directory", "media-root"].includes(raw.pathBase) ||
    raw.componentOrder !== "bottom-to-top"
  )
    throw Error(
      "Choose a FolderExporter image index, not the Storyboard Studio reference.",
    );
  if (
    !Array.isArray(raw.frames) ||
    !raw.frames.length ||
    raw.frames.length > MAX_FRAMES
  )
    throw Error("Choose an index containing 1–2048 exported frames.");
  const ids = new Set(),
    paths = new Map();
  let total = 0;
  const frames = raw.frames.map((frame, index) => {
    if (
      !Array.isArray(frame.sourceFrameKey) ||
      !frame.sourceFrameKey.length ||
      frame.sourceFrameKey.some((n) => !Number.isSafeInteger(n) || n < 0)
    )
      throw Error("An exported frame has an invalid identity.");
    const id = frame.sourceFrameKey.join("-");
    if (ids.has(id))
      throw Error("The index contains duplicate frame identities.");
    ids.add(id);
    if (!Array.isArray(frame.files) || !frame.files.length)
      throw Error("An exported frame has no image files.");
    const stack = new Set();
    let whole = 0;
    const files = frame.files
      .map((f) => {
        if (++total > MAX_FILES)
          throw Error("Import at most 4096 files per index.");
        const path = imagePath(f.path);
        if (f.filename !== path.split("/").at(-1))
          throw Error(
            "An image filename disagrees with its recorded location.",
          );
        if (!dimension(f.width) || !dimension(f.height))
          throw Error("An image has invalid dimensions.");
        if (!["component", "whole-frame"].includes(f.kind))
          throw Error("An image has an unknown drawing type.");
        if (f.kind === "component") {
          if (
            !Number.isInteger(f.stackOrder) ||
            f.stackOrder < 1 ||
            stack.has(f.stackOrder)
          )
            throw Error(
              "A frame has invalid or duplicate component stacking numbers.",
            );
          stack.add(f.stackOrder);
        } else if (++whole > 1)
          throw Error("A frame contains multiple whole-frame images.");
        if (paths.has(path) && paths.get(path) !== `${f.width}x${f.height}`)
          throw Error("One filename has conflicting image dimensions.");
        paths.set(path, `${f.width}x${f.height}`);
        return {
          path,
          name: f.filename,
          label: text(f.label) || text(f.sourceComponentName) || f.filename,
          kind: f.kind,
          stackOrder: f.kind === "component" ? f.stackOrder : null,
          width: f.width,
          height: f.height,
        };
      })
      .sort((a, b) => (a.stackOrder ?? -1) - (b.stackOrder ?? -1));
    const refs = Array.isArray(frame.cardReferences)
      ? frame.cardReferences
      : [];
    if (refs.length > 10000) throw Error("Too many reusable card references.");
    const snapshot = raw.storyboardReference?.chapters
      ?.flatMap((ch) => ch.cards || [])
      .find((c) => c.id === frame.cardId);
    return {
      exportedAt:frame.exportedAt||raw.createdAt,
      variantIndex: snapshot?.variantIndex ?? null,
      variantAssetId: snapshot?.variantAssetId ?? null,
      id,
      name: text(frame.sourceFrameName) || `Frame ${index + 1}`,
      sourceChapterFolders: Array.isArray(frame.sourceChapterFolders)
        ? frame.sourceChapterFolders.map((s) => text(s))
        : [],
      cardId: frame.cardId ? required(frame.cardId, "card ID") : null,
      sourceCardId: frame.sourceCardId
        ? required(frame.sourceCardId, "source card ID")
        : frame.cardId || null,
      cardNumber: frame.displayCardNumber || frame.cardNumber || null,
      chapterId: frame.chapterId || null,
      chapterTitle: text(frame.chapterTitle),
      references: [
        ...new Set(refs.map((c) => required(c.cardId, "reusable card ID"))),
      ],
      files,
    };
  });
  const ref = raw.storyboardReference;
  const parsed = {
    exportId: required(raw.exportId, "export ID"),
    filename: text(filename),
    createdAt: text(raw.createdAt),
    projectId: ref?.project?.id ? required(ref.project.id, "project ID") : null,
    projectName: text(ref?.project?.name),
    signature: text(ref?.structuralSignature),
    sourceName: text(raw.source?.filename),
    canvasWidth: dimension(raw.source?.canvasWidth)
      ? raw.source.canvasWidth
      : 1920,
    canvasHeight: dimension(raw.source?.canvasHeight)
      ? raw.source.canvasHeight
      : 1080,
    incomplete: raw.complete === false || raw.cancelled === true,
    failureCount: Array.isArray(raw.failures) ? raw.failures.length : 0,
    frames,
  };
  if (JSON.stringify(parsed).length > 2 * 1024 * 1024)
    throw Error(
      "This index is too large to keep in a project. Export smaller batches.",
    );
  const legacy = structuredClone(parsed);
  for (const f of legacy.frames) {
    delete f.variantIndex;
    delete f.variantAssetId;
    delete f.exportedAt;
  }
  const legacyContentHash = hash(legacy);
  if (raw.mediaRoot !== undefined) parsed.mediaRoot = String(raw.mediaRoot);
  const previous=structuredClone(parsed);for(const frame of previous.frames)delete frame.exportedAt;
  parsed.previousContentHash=hash(previous);
  const current=structuredClone(parsed);delete current.previousContentHash;parsed.contentHash=hash(current);
  parsed.sourceId = raw.source?.id || null;
  for (let i = 0; i < parsed.frames.length; i++) {
    const f = raw.frames[i],
      target = parsed.frames[i];
    target.complete =
      f.complete !== false &&
      (f.expectedFileCount == null || f.expectedFileCount === f.files.length);
    target.sourceFrameKey = f.sourceFrameKey || null;
    target.exportId=f.exportId||raw.exportId;
  }
  parsed.legacyContentHash = legacyContentHash;
  parsed.sharedNames=raw.naming?.mode==='Use project card names'&&raw.organization?.studioLink===true&&raw.organization.chapterFolderStyle==='Use Storyboard Studio folders'&&raw.organization.chapterFolders!==false&&!raw.organization.frameFolders;
  for(let i=0;i<parsed.frames.length;i++)for(const f of parsed.frames[i].files){const source=raw.frames[i].files.find(x=>x.path===f.path);f.managed=source.managed??parsed.sharedNames;f.componentSuffix=source.componentSuffix??(source.kind==='component'?fileLeaf('_'+(source.label||source.sourceComponentName)+(source.componentIndex?'_'+String(source.componentIndex).padStart(raw.naming?.padding||1,'0'):'')):'');}
  parsed.pathRevision=raw.pathRevision||null;
  parsed.hashVersion = 2;
  return parsed;
}
export function ensureAssembly(project) {
  let a = project.imageAssembly;
  if (!a || a.version !== 1 || !Array.isArray(a.batches))
    a = project.imageAssembly = {
      version: 1,
      batches: [],
      bindings: {},
      representations: {},
    };
  a.bindings ||= {};
  a.representations ||= {};
  return a;
}
export function cardVisualIdentity(project, card) {
  const source = card.reuseOf
    ? allCards(project).find((c) => c.id === card.reuseOf) || card
    : card;
  const count = source.variants?.length || 0,
    index = Math.max(
      0,
      Math.min(Number(card.activeVariant) || 0, Math.max(0, count - 1)),
    );
  const sourceId = card.reuseOf || card.id;
  return {
    key: JSON.stringify([sourceId, index]),
    sourceId,
    index,
    count,
    assetId: source.variants?.[index]?.assetId || null,
  };
}
export function addImageBatch(
  project,
  parsed,
  { directory = null, sourceMode = "browser" } = {},
) {
  const a = ensureAssembly(project),
    existing = a.batches.find((b) => b.exportId === parsed.exportId);
  if (existing) {
    if (
      existing.contentHash !== parsed.contentHash &&
      existing.contentHash !== parsed.legacyContentHash &&
      existing.contentHash !== parsed.previousContentHash
    )
      throw Error(
        "This export ID is already imported with different contents.",
      );
    throw Error(
      "This export is already imported. Use Relink folder if it moved.",
    );
  }
  const batch = {
    ...structuredClone(parsed),
    id: "images-" + crypto.randomUUID(),
    importedAt: new Date().toISOString(),
    directory,
    sourceMode,
    sourceStatus: directory ? "unchecked" : "cached",
    previews: {},
    fileStates: {},
  };
  const cards = allCards(project),
    sameProject = parsed.projectId === project.id;
  for (const frame of batch.frames) {
    let anchor = sameProject ? cards.find((c) => c.id === frame.cardId) : null;
    if (!anchor && sameProject)
      anchor = cards.find(
        (c) =>
          frame.references.includes(c.id) &&
          (!frame.sourceCardId || (c.reuseOf || c.id) === frame.sourceCardId),
      );
    const v = anchor ? cardVisualIdentity(project, anchor) : null;
    frame.suggestedSourceId =
      v &&
      (!frame.sourceCardId ||
        frame.sourceCardId === v.sourceId ||
        frame.sourceCardId === frame.cardId)
        ? v.sourceId
        : null;
    frame.suggestedVariantIndex = frame.suggestedSourceId
      ? (frame.variantIndex ?? v.index)
      : null;
    frame.autoMatch =
      !!v &&
      (frame.variantIndex !== null
        ? frame.variantAssetId === v.assetId
        : v.count <= 1);
  }
  if (JSON.stringify(a).length + JSON.stringify(batch).length > 3 * 1024 * 1024)
    throw Error(
      "The project has too many image indexes. Remove an unused import first.",
    );
  a.batches.push(batch);
  return batch;
}
export function imageGroups(project) {
  return ensureAssembly(project).batches.flatMap((batch) =>
    batch.frames.map((frame) => ({
      batch,
      frame,
      key: batch.id + "/" + frame.id,
    })),
  );
}
export function groupByKey(project, key) {
  return imageGroups(project).find((g) => g.key === key) || null;
}
export function representationFiles(frame, representation) {
  return frame.files.filter(
    (f) =>
      f.kind === (representation === "whole" ? "whole-frame" : "component"),
  );
}
export function defaultRepresentation(frame) {
  return frame.files.some((f) => f.kind === "component")
    ? "components"
    : "whole";
}
export function resolveCardImages(project, card) {
  const a = ensureAssembly(project),
    v = cardVisualIdentity(project, card),
    binding = a.bindings[v.key];
  const bound = binding ? groupByKey(project, binding.groupKey) : null;
  const candidates = imageGroups(project).filter(
    (g) =>
      g.frame.suggestedSourceId === v.sourceId &&
      g.frame.suggestedVariantIndex === v.index,
  );
  const effective = candidates.filter(
    (g) =>
      (!g.batch.incomplete ||
        !candidates.some(
          (x) =>
            !x.batch.incomplete &&
            x.batch.sourceId === g.batch.sourceId &&
            x.frame.variantAssetId === g.frame.variantAssetId &&
            x.frame.variantIndex === g.frame.variantIndex &&
            x.frame.sourceCardId === g.frame.sourceCardId,
        )) &&
      (!g.batch.sourceId ||
        !candidates.some(
          (other) =>
            other !== g &&
            other.batch.sourceId === g.batch.sourceId &&
            other.frame.sourceCardId === g.frame.sourceCardId &&
            other.frame.variantIndex === g.frame.variantIndex &&
            other.frame.variantAssetId === g.frame.variantAssetId &&
            other.frame.complete !== false &&
            !other.batch.incomplete &&
            Date.parse(other.batch.createdAt) > Date.parse(g.batch.createdAt),
        )),
  );
  const group = bound || (effective.length === 1 ? effective[0] : null);
  const stale = !!bound && binding.assetId !== v.assetId;
  const representation=group?defaultRepresentation(group.frame):'components';
  const files = group ? representationFiles(group.frame, representation) : [];
  const badFiles = group
    ? files.filter(
        (f) =>
          !["ok", "preview-unavailable"].includes(
            group.batch.fileStates[f.path]?.state,
          ),
      )
    : [];
  const sourceAvailable = !!group && group.batch.sourceStatus === "ok";
  const status = !group
    ? effective.length > 1
      ? "choose-export"
      : "unmatched"
    : stale || (!bound && group.frame.autoMatch === false)
      ? "review"
      : !sourceAvailable || badFiles.length
        ? "needs-files"
        : "ready";
  return {
    identity: v,
    binding,
    group,
    candidates,
    representation,
    files,
    badFiles,
    stale,
    status,
  };
}
export function confirmCardImages(
  project,
  cardId,
  groupKey,
  representation = "components",
) {
  const card = activeCards(project).find((c) => c.id === cardId),
    group = groupByKey(project, groupKey);
  if (!card || !group)
    throw Error("Choose an active storyboard card and an exported frame.");
  if (
    !["components", "whole"].includes(representation) ||
    !representationFiles(group.frame, representation).length
  )
    throw Error("This frame does not have that representation.");
  const a = ensureAssembly(project),
    v = cardVisualIdentity(project, card);
  a.bindings[v.key] = {
    groupKey,
    assetId: v.assetId,
    confirmedAt: new Date().toISOString(),
    representation,
  };
  a.representations[card.id] = representation;
  return a.bindings[v.key];
}
export function removeImageBatch(project, batchId) {
  const a = ensureAssembly(project);
  a.batches = a.batches.filter((b) => b.id !== batchId);
  for (const [key, binding] of Object.entries(a.bindings))
    if (binding.groupKey.startsWith(batchId + "/")) delete a.bindings[key];
}
export function assemblyPreviewAssetIds(project) {
  return [
    ...new Set(
      (project.imageAssembly?.batches || [])
        .flatMap((b) => Object.values(b.previews || {}))
        .filter(Boolean),
    ),
  ];
}
export function unlinkImportedAssemblyRoots(project) {
  for (const batch of project.imageAssembly?.batches || []) {
    batch.directory = null;
    batch.sourceStatus = "cached";
    batch.sourceMode = "browser";
  }
}
export function assemblySummary(project) {
  const cards = activeCards(project),
    states = cards.map((c) => resolveCardImages(project, c));
  const referenced = new Set(
    states.flatMap((s) => (s.group ? [s.group.key] : [])),
  );
  return {
    cards: cards.length,
    ready: states.filter((s) => s.status === "ready").length,
    review: states.filter(
      (s) => s.status === "review" || s.status === "choose-export",
    ).length,
    unmatched: states.filter((s) => s.status === "unmatched").length,
    unusedGroups: imageGroups(project).filter((g) => !referenced.has(g.key)),
  };
}
