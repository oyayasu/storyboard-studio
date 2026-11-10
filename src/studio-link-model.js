import {normalizePath} from './local-paths.js';
import {
  textPieces,
  isSpokenPiece,
  chapterPauses,
  ensureProject,
} from "./highlighter-model.js";
import {ensureCardLabels,exportLabel} from './card-labels.js';
export const LINK_FOLDER = "Studio Link";
export const ARCHIVE_ROOT = "Storyboard Archive";
export function archiveDirectory(project, context) { return ARCHIVE_ROOT + "/" + renderName(project.fileNaming, "archiveFolder", context); }
export const namingDefaults = () => ({
  chapter: "{chapter_number} - {chapter_title}",
  card: "{card_number}",
  component: "{card_name}_component-{component_index}",
  reference: "{card_name}_FULL",
  sheet: "{project}_Storyboard_{page}",
  timeline: "{project}_Timeline",
  archiveFolder: "{chapter_number} - {chapter_title}_storyboard",
  archiveCard: "{card_number}{slight_modify_index}_storyboard",
  padding: 1,
});
const fields = ["chapter", "card", "component", "reference", "archiveFolder", "archiveCard", "sheet", "timeline"];
const tokens = new Set([
  "project", "card_name", "component_index", "component_name",
  "chapter_number",
  "chapter_title",
  "card_number",
  "slight_modify_index",
  "global_number",
  "variant",
  "page",
]);
export function namingProfile(value) {
  const base = namingDefaults(),
    out = {};
  for (const field of fields) {
    const v = value?.[field] ?? base[field];
    if (
      typeof v !== "string" ||
      !v.trim() ||
      v.length > 160 ||
      /[\\/\x00-\x1f]/u.test(v)
    )
      throw Error("Use a short filename pattern without slashes.");
    for (const m of v.matchAll(/\{([^{}]+)\}/g))
      if (!tokens.has(m[1])) throw Error("Unknown naming field: " + m[1]);
    if (v.replace(/\{[^{}]+\}/g, "").match(/[{}]/))
      throw Error("Close each naming field with a matching brace.");
    out[field] = v;
  }
  if(!out.component.includes('{component_index}'))throw Error('Component names need {component_index}.');
  if(!['{card_name}','{card_number}','{global_number}'].some(t=>out.component.includes(t)))throw Error('Component names need a card name or number.');
  for(const token of ['component_index','component_name'])if(out.component.split('{'+token+'}').length>2)throw Error('Use each component field once in the pattern.');
  if(out.card.includes('{card_name}')||out.card.includes('{component_index}')||out.card.includes('{component_name}'))throw Error('Use card fields in the individual-card pattern.');
  out.padding = Math.max(
    1,
    Math.min(6, Math.round(Number(value?.padding) || base.padding)),
  );
  return out;
}
export function fileLeaf(value) {
  let s = String(value ?? "")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\x00-\x1f]/gu, "_")
    .replace(/[. ]+$/, "")
    .trim();
  if (!s || s === "." || s === "..") s = "Untitled";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)) s = "_" + s;
  let out = "";
  for (const c of s) {
    if (new TextEncoder().encode(out + c).length > 120) break;
    out += c;
  }
  return out || "Untitled";
}
export function renderName(profile, field, context = {}, extension = "") {
  profile = namingProfile(profile);
  if(field==='component'||field==='reference')context={...context,card_name:renderName(profile,'card',context)};
  const numbers = new Set(["card_number", "global_number", "component_index", "page"]);
  let pattern=profile[field];
  if(["card","archiveCard","component"].includes(field)&&context.slight_modify_index&&!pattern.includes("{slight_modify_index}"))pattern=pattern.replace(/\{(card_number|global_number)\}/,"$&{slight_modify_index}");
  const s = pattern.replace(/\{([^{}]+)\}/g, (_, k) =>
    numbers.has(k)
      ? String(context[k] ?? 1).padStart(profile.padding, "0")
      : String(context[k] ?? ""),
  );
  return fileLeaf(s) + (extension ? "." + extension.replace(/^\./, "") : "");
}
export function chapterNumber(project, ch) {
  const active = project.chapters.filter((c) => !c.unused),
    roots = active.filter((c) => !c.parentId);
  return ch.parentId
    ? `${roots.findIndex((c) => c.id === ch.parentId) + 1}.${active.filter((c) => c.parentId === ch.parentId).findIndex((c) => c.id === ch.id) + 1}`
    : String(roots.findIndex((c) => c.id === ch.id) + 1);
}
export function namingContext(project, ch, card, page = 1) {
  const active = project.chapters
      .filter((c) => !c.unused)
      .flatMap((ch) => project.stories.filter((c) => c.chapterId === ch.id)),
    local = project.stories.filter((c) => c.chapterId === ch?.id);
  if(project.stories.some(c=>c.modifiedOf&&!c.numberAsRegular&&!c.modifyLetter))ensureCardLabels(project);
  const localLabel=card?exportLabel(project,card,"chapter"):null,globalLabel=card?exportLabel(project,card,"global"):null;
  return {
    project: project.name,
    chapter_number: ch ? chapterNumber(project, ch) : "",
    chapter_title: ch?.name || "",
    card_number: localLabel?.number||1,
    slight_modify_index: localLabel?.suffix||"",
    global_number: globalLabel?.number||1,
    variant: String.fromCharCode(65 + (card?.activeVariant || 0)),
    page,
  };
}
export function ensureWorkspace(project, defaults) {
  project.fileNaming = namingProfile(project.fileNaming || defaults);
  project.studioLink ||= {
    directory: null,
    chapterDirectories: {},
    storyboards: {},
  };
  project.studioLink.chapterDirectories ||= {};
  project.studioLink.storyboards ||= {};
  return project.studioLink;
}
export function chapterDirectories(project){
 const link=ensureWorkspace(project),active=project.chapters.filter(c=>!c.unused),ids=new Set(active.map(c=>c.id));
 link.cleanupChapterDirectories||=[];link.chapterDirectoryStates||={};
 const clean=path=>{if(path&&!link.cleanupChapterDirectories.includes(path))link.cleanupChapterDirectories.push(path);};
 for(const [id,path]of Object.entries(link.chapterDirectories))if(!ids.has(id)){clean(path);delete link.chapterDirectories[id];}
 const used=new Set();const out=[];
 for(const ch of active){
  const old=link.chapterDirectories[ch.id],state=link.chapterDirectoryStates[old],base=renderName(project.fileNaming,"chapter",namingContext(project,ch));
  let path=base;
  if(old&&path!==old)clean(old);
  let i=2;while(used.has(path.toLowerCase()))path=base+"_"+i++;
  used.add(path.toLowerCase());link.chapterDirectories[ch.id]=path;
  out.push({chapterId:ch.id,number:chapterNumber(project,ch),title:ch.name,path});
 }
 return out;
}
export function relativePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    /[\\:\x00-\x1f]/u.test(value) ||
    value.split("/").some((s) => !s || s === "." || s === "..")
  )
    throw Error("Invalid project-relative path.");
  return value;
}
export function joinPath(root, relative) {
  relativePath(relative);
  return (
    normalizePath(root) +
    "/" +
    relative
  );
}
export function spokenScript(project) {
  ensureProject(project);
  return {
    format: "subtitler-script-v1",
    schemaVersion: 1,
    studioProjectId: project.id,
    project: { id: project.id, name: project.name },
    exportedAt: new Date().toISOString(),
    chapters: project.chapters
      .filter((ch) => !ch.unused)
      .map((ch) => {
        const h = ch.highlighter || {},
          pieces = textPieces(project, ch).filter((r) =>
            isSpokenPiece(project, r),
          ),
          ranges = pieces.map((p) => ({
            from: p.from,
            to: p.to,
            text: p.text,
          })),
          pauses = chapterPauses(h).map((p) => ({
            ...p,
            cardId:
              p.cardId ||
              (h.assignments || []).find(
                (a) => a.from <= p.from && a.to >= p.to,
              )?.cardId ||
              null,
          }));
        return {
          id: ch.id,
          parentId: ch.parentId || null,
          number: chapterNumber(project, ch),
          title: ch.name,
          text: ranges.map((r) => r.text).join(""),
          ranges,
          pauses,
          assignments: structuredClone(h.assignments || []),
        };
      }),
  };
}
export function workspaceManifest(project) {
  return {
    format: "studio-link-project-v1",
    schemaVersion: 1,
    project: { id: project.id, name: project.name, ratio: project.ratio },
    updatedAt: new Date().toISOString(),
    maintenanceVersion: 2,
    archiveRoot: ARCHIVE_ROOT,
    activeRecording: project.studioLink.activeAudio || project.videoTiming?.tracks?.[0]?.source || null,
    naming: project.fileNaming,
    namingRevision:project.studioLink.namingRevision||null,
    chapterDirectories: chapterDirectories(project),
    cleanupChapterDirectories: project.studioLink.cleanupChapterDirectories || [],
    storyboards: project.studioLink.storyboards,
    files: {
      mediaCatalog:"media-index.json",
      reference: "storyboard.ssreference.json",
      script: "spoken-script.json",
    },
    mediaPaths: "project-relative-or-explicit-local-path",
    contractVersion: 1,
  };
}
export function drawingKey(project, card) {
  const source = card.reuseOf
      ? ["stories", "unassigned", "lost", "archived"]
          .flatMap((k) => project[k] || [])
          .find((c) => c.id === card.reuseOf) || card
      : card,
    index = Math.max(
      0,
      Math.min(card.activeVariant || 0, (source.variants?.length || 1) - 1),
    );
  return `${source.id}/${index}/${source.variants?.[index]?.assetId || "blank"}`;
}
