import {rebaseProjectFolders} from './folder-rename.js';
import {audioPage} from './audio-page.js';
import {detachProjectMedia} from './project-copy.js';
import {closestSlot,slotIntent} from './drop-target.js';
import {retireDeletedMedia} from './file-organization.js';
import {workflowManual} from './workflow-manual.js';
import {ensureCardLabels,deletionBlockers,rememberDeletedOrigins,promoteModification,renameFamilyInOrder,displayNumber} from './card-labels.js';
import {installPointerDrag} from './pointer-drag.js';
import {createCleanup} from './cleanup.js';
import {currentCleanup,attachCleanup,swapCleanupAssignments,prepareCleanupHistoryRestore} from './cleanup-model.js';
import {installDesktopDrop} from './desktop-drop.js';
import {pageHelp,paginateSettings} from "./page-help.js";
import {createSheetLayouts} from "./sheet-layouts.js";
import {installCloseFlow} from "./close-flow.js";
import { createPerformPreview } from "./perform-player.js";
import { createStudioLink } from "./studio-link.js";
import {
  ensureWorkspace,
  namingProfile,
  chapterDirectories,
  renderName,
  namingContext,
} from "./studio-link-model.js";
import { addIndependentCard, modificationLabel } from "./independent-card.js";
import {
  store,
  uid,
  date,
  newProject,
  chapter,
  card,
  ordered,
  chapterCards,
  position,
  sourceCard,
  visual,
  tags,
  tagDefs,tagDefinition,
  ratio,
  completionOf,
  setFamilyCompletion,
  allCards,
  gridPreset,
} from "./state.js";
import {
  attachImages,
  importImageFiles,
  importProject,
  exportProject,
  projectDocument,
  saveBlob,
  chooseExportDirectory,
  drawVisual,
  safe,
  assetUrl,
} from "./media.js";
import { layoutCards, wrapRuns, drawLines } from "./script-layout.js";
import { createAssetFolders } from "./asset-folders.js";
import { createDocxIntake } from "./docx-intake.js";
import {
  buildProjectReference,
  chapterNumberFor,
} from "./project-reference.js";
import { createHighlighter } from "./highlighter.js";
import { createImageAssembly } from "./image-assembly.js";
import { createVideoTiming } from "./video-timing.js";
import { createTimelineExport } from "./timeline-export.js";
import { ensureProject } from "./highlighter-model.js";
const $ = (sel, root = document) => root.querySelector(sel),
  $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $("#app"),
  files = $("#files");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = {
  new: "＋",
  folder: "▱",
  menu: "☰",
  sticky: "▤",
  print: "▧",
  tag: "◇",
  settings: "⚙",
  back: "‹",
  edit: "✎",
  archive: "▤",
};
const UI = {
  screen: "browser",
  completionChapterId: null,
  completionSelected: [],
  completionThumb: 220,
  browserFilter: "all",
  folderId: "root",
  selectedBrowser: [],
  focusBrowser: 0,
  sort: store.state.settings.browserSort || "modified",
  search: "",
  modal: null,
  menu: false,
  chapterId: null,
  left: true,
  right: true,
  bucket: "unassigned",
  archiveKind: "cards",
  cleanupArchiveSelected: [],
  matchingAudio: false,
  lostScope: "chapter",
  rightMode: "highlighter",
  selected: [],
  bucketSelected: [],
  selectionZone: "main",
  quick: false,
  print: {
    orientation: "portrait",
    cols: 3,
    rows: 5,
    spacing: 1,
    notes: false,
    tags: true,
    numbers: true,
    chapterTitle: true,
    projectTitle: true,
    range: true,
    pageNum: true,
    blankWhite: true,
    noteFont: 12,
    scriptFont: 12,
    script: "none",
    dpi: 200,
  },
  filterTag: "all",
  highlightTag: "none",
  highlightIndex: 0,
  boardPages: {},
  showStickies: false,
  contextTagId: null,
  contextEl: null,
  drag: null,
  focusIndex: 0,
  theme: store.state.settings.theme,
  renamingChapterId: null,
};
let renderToken = 0,
  boardLayoutCache = null,
  toastTimer;
let deleteChapterText = null,
  exportScript = null;
const p = () => store.project,
  chapters = () => p()?.chapters.filter((c) => !c.unused) || [],
  activeCh = () =>
    p()?.chapters.find((c) => c.id === UI.chapterId) || chapters()[0],
  activeCards = () => (p() ? chapterCards(p(), activeCh()?.id) : []);
const SHEETS=createSheetLayouts({get:()=>store.state.settings.sheetLayouts||[],set:value=>{store.state.settings.sheetLayouts=value;},commit:(label,fn)=>change(label,fn,{render:false}),modal,notify:toast});
const HL = createHighlighter({
  assignedContext:(e,id)=>{UI.contextScriptCardId=id;showContext(e.clientX,e.clientY,[{name:"Remove linked text",act:"remove-card-script",cls:"danger"}]);},
  preferences: () => store.state.settings,
  save: () => store.save(),
  importDocx: (file) => DOCX.open(file),
  chooseExport: (fn) => {
    exportScript = fn;
    modal(
      "Export DOCX",
      "<p>Choose the text to include in the exported copy.</p><p>Spoken text leaves out annotations unless their category is enabled as Spoken. Pause markers are excluded. Card assignment numbers stay in Highlighter.</p>",
      [
        { text: "Cancel", action: "close-modal" },
        { text: "Spoken text", action: "export-script-spoken" },
        { text: "All text", action: "export-script-all", primary: true },
      ],
    );
  },
  confirmDelete: (fn) => {
    deleteChapterText = fn;
    modal(
      "Delete chapter text",
      "<p>Remove this chapter’s text, category highlights, and card links? Drawings and card notes stay in the project. One Undo restores everything.</p>",
      [
        { text: "Cancel", action: "close-modal" },
        { text: "Delete text", action: "confirm-delete-text", danger: true },
      ],
    );
  },
  project: p,
  chapter: activeCh,
  chapterLabel: (c) => `${chapterNumber(c)} · ${c.name}`,
  number: (id) => {
    const n = position(p(), id, store.state.settings.numbering);
    return n ? n : "–";
  },
  prepareModify: prepareIndependentAsset,
  createCard: card,
  commit: (name, fn) => change(name, fn),
  render,
  notify: toast,
  selectCard: (id) => {
    UI.selected = [id];
    UI.bucketSelected = [];
    revealCardPage(id);
  },
  showPanel: (id) => {
    UI.chapterId = id;
    UI.right = true;
    UI.rightMode = "highlighter";
  },
  undo: () => {
    restoreProjectHistory(false);
    render();
  },
  redo: () => {
    restoreProjectHistory(true);
    render();
  },
});
const DOCX = createDocxIntake({
  project: p,
  createChapter: chapter,
  notify: toast,
  modal,
  closeModal,
  selectChapter: (id) => selectedChapter(id),
  commit: (name, fn) => change(name, fn, { render: false }),
});
const ASSEMBLY = createImageAssembly({
  project: p,
  projects: () => store.state.projects,
  chapter: activeCh,
  image: imageHtml,
  number: (id) => position(p(), id, store.state.settings.numbering),
  ratio: () => ratio(p()),
  caption: (id) => HL.caption(id),
  cleanupMarkup:card=>CLEANUP.markup(card),
  syncCleanup:()=>CLEANUP.sync(),
  prepareCleanup:()=>CLEANUP.prepare(),
  checkpoint:()=>makeBackup(true),
  inspectCleanup:paths=>CLEANUP.inspect(paths),
  attachDiscovered:(card,files)=>attachCleanup(p(),card,files,{source:"discovered"}),
  progress:cardExportProgress,

  openCleanup:id=>{UI.screen='storyboard';p().viewPrefs.boardMode='cleanup';UI.selected=[id];UI.chapterId=p().stories.find(c=>c.id===id)?.chapterId;revealCardPage(id);render();},
  signature: () => {
    try {
      return buildProjectReference(p(), store.state.settings.numbering)
        .structuralSignature;
    } catch {
      return null;
    }
  },
  commit: (name, fn) => change(name, fn),
  cacheUpdate: (fn) => {
    fn();
    store.save();
  },
  render,
  notify: toast,
});
const TIMING = createVideoTiming({
  project: p,
  chapter: activeCh,
  image: imageHtml,
  number: (id) => position(p(), id, store.state.settings.numbering),
  commit: (name, fn) => change(name, fn),
  render,
  notify: toast,
});
const EDITOR = createTimelineExport({
  project: p,
  assetFolders: () => store.state.assetFolders || [],
  commit: (name, fn) => change(name, fn),
  render,
  notify: toast,
  chooseDirectory: chooseExportDirectory,
  ensureRoot: () => STUDIO.ensureRoot(),
  refresh: () => STUDIO.refresh(),
  rematch: () => TIMING.rematch(),
  ensureStoryboards: (cards) => STUDIO.storyboards(cards),
  cardLabel: (id) =>
    "Card " + position(p(), id, store.state.settings.numbering),
});
const STUDIO = createStudioLink({
  project: p,
  confirmAudio:(old,next)=>new Promise(resolve=>{UI.audioChoice=resolve;modal('Replace project audio?',`<p>Use <strong>${esc(next.name)}</strong> instead of <strong>${esc(old.name)}</strong>?</p><p>The old file stays where you put it. Match timing with Subtitler for this recording version; previous timings will not be applied to different audio.</p>`,[{text:'Keep current',action:'audio-keep'},{text:'Replace audio',action:'audio-replace',primary:true}]);for(const[act,value]of [['audio-keep',false],['audio-replace',true]])actions[act]=()=>{UI.audioChoice=null;closeModal();resolve(value);};}),
  numbering: () => store.state.settings.numbering,
  chooseDirectory: chooseExportDirectory,
  save: () => store.save(),
  commit: (label, fn) => change(label, fn),
  render:()=>refreshSharedView(),
  notify: toast,
  importImages: (...args) => ASSEMBLY.importText(...args),
  importTiming: (...args) => TIMING.importText(...args),
  checkImages: () => ASSEMBLY.checkAll(),
  checkCleanup:()=>CLEANUP.refresh(),
  syncCleanup:()=>CLEANUP.sync(),
  prepareCleanup:()=>CLEANUP.prepare(),
  checkpoint:()=>makeBackup(true),
  inspectCleanup:paths=>CLEANUP.inspect(paths),
  attachDiscovered:(card,files)=>attachCleanup(p(),card,files,{source:"discovered"}),
  progress:cardExportProgress,
  outputConflict:(name,detail)=>new Promise(resolve=>{UI.outputChoice=resolve;modal('Existing storyboard export',`<p>${esc(name)} already exists.</p><p>${esc(detail)}</p>`,[{text:'Cancel',action:'output-cancel'},{text:'Keep both',action:'output-keep'},{text:'Use existing file as cleanup',action:'output-cleanup',primary:true},{text:'Replace',action:'output-replace'}]);for(const [act,value]of [['output-cancel','cancel'],['output-keep','keep'],['output-replace','replace'],['output-cleanup','cleanup']])actions[act]=()=>{UI.outputChoice=null;closeModal();resolve(value);};}),
  rematch: () => TIMING.rematch(),
  dimensions: () => pixels(p().ratio),
  renderPreferences:()=>({letterbox:store.state.settings.letterbox,noteSize:store.state.settings.noteSize,blankWhite:UI.print.blankWhite,tags:UI.print.tags,noteFont:UI.print.noteFont}),
  suspendProgress:paused=>document.querySelectorAll('.export-progress-overlay').forEach(el=>el.hidden=paused),
  drawingBlob:renderStoryboardPNG,
});

const CLEANUP=createCleanup({project:p,mode:()=>p()?.viewPrefs.boardMode,commit:(label,fn)=>change(label,fn),save:()=>store.save(),render,notify:toast,ensureRoot:()=>STUDIO.ensureRoot(),acceptVersion:(copy,previous)=>{for(const row of [...store.undo,...store.redo]){const snapshot=row.before.projects.find(pr=>pr.id===p().id);if(!snapshot)continue;for(const entry of Object.values(snapshot.cleanup?.entries||{}))for(const field of ['files','referenceFiles'])entry[field]=(entry[field]||[]).map(f=>f.id===previous.id&&f.relativePath===previous.relativePath?{...copy,recoverySize:copy.size,recoveryModified:copy.modified}:f);}},showUnassigned:()=>{UI.bucket='unassigned';UI.archiveKind='cleanups';UI.rightMode='holding';},forgetCleanupVersions:(ids,files)=>{const pid=p().id,versions=new Set(files.map(f=>JSON.stringify([f.id,f.fingerprint]))),active=new Set(Object.values(p().cleanup.entries).filter(e=>!e.removed).flatMap(e=>e.files).map(f=>JSON.stringify([f.id,f.fingerprint])));const scrub=state=>{const project=state.projects.find(pr=>pr.id===pid);if(!project)return;const model=project.cleanup;if(!model)return;model.purged=[...new Set([...(model.purged||[]),...files.map(f=>f.id)])];const keepVersion=f=>!versions.has(JSON.stringify([f.id,f.fingerprint]))||active.has(JSON.stringify([f.id,f.fingerprint]));model.archive=(model.archive||[]).filter(a=>!ids.includes(a.id)).map(a=>({...a,files:a.files.filter(keepVersion)})).filter(a=>a.files.length);model.unassigned=(model.unassigned||[]).filter(a=>!ids.includes(a.id)).map(a=>({...a,files:a.files.filter(keepVersion)})).filter(a=>a.files.length);model.unassignedRevision=new Date().toISOString();for(const entry of Object.values(model.entries||{})){const keep=f=>!versions.has(JSON.stringify([f.id,f.fingerprint]))||active.has(JSON.stringify([f.id,f.fingerprint]));entry.files=entry.files.filter(keep);entry.referenceFiles=(entry.referenceFiles||[]).filter(keep);entry.ignoredFiles=(entry.ignoredFiles||[]).filter(keep);entry.removed=!entry.files.length;}};scrub(store.state);for(const row of [...store.undo,...store.redo])scrub(row.before);store.save();},afterRemoval:async()=>{await STUDIO.storyboards(ordered(p()),{reuse:true,interactive:false});await STUDIO.sync();await STUDIO.supervise();},selected:()=>UI.selected,context:(e,id,items)=>{UI.contextCardId=id;if(!UI.selected.includes(id))UI.selected=[id];UI.bucketSelected=[];UI.selectionZone='main';showContext(e.clientX,e.clientY,items);}});
const assetFolders = createAssetFolders({
  store,
  card,
  render,
  notify: toast,
  change,
});
const item = (id) =>
  p()
    ? [
        ...p().stories,
        ...p().unassigned,
        ...p().lost,
        ...p().archived,
        ...store.state.globalAssets,
      ].find((x) => x.id === id)
    : null;
const color = (t) =>
  tagDefinition(p(),t)?.color ||
  "#95b6d7";
const label = (t) =>
  tagDefinition(p(),t)?.name || t;
const symbol = (t) =>
  tagDefinition(p(),t)?.icon || "◆";
const chapterStatusInfo = (status) =>
  status === "ready"
    ? { label: "Storyboard ready", asset: "ready" }
    : status === "revision"
      ? { label: "Needs revision", asset: "revision" }
      : null;
const customTagById = (id) => p()?.customTags?.find((x) => x.id === id) || null;
function updateBlankNoteOverflow(sheet) {
  const text = sheet?.querySelector(".blank-note-text");
  if (!text) return;
  sheet.classList.toggle(
    "note-too-long",
    text.scrollHeight > text.clientHeight + 2,
  );
}
let noteSaveTimer;
function scheduleNoteSave() {
  clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(() => store.save(), 150);
}
function flushNoteSave() {
  clearTimeout(noteSaveTimer);
  store.save();
}
function updateAllBlankNoteOverflows() {
  document
    .querySelectorAll(".blank-note-sheet")
    .forEach(updateBlankNoteOverflow);
}
function blankNotePreview(s, { print = false } = {}) {
  const note = (s?.note || "").trim();
  if (!visual(p(), s).blank || !note) return "";
  const full = esc(note);
  const cls = print
    ? "blank-note-sheet blank-note-sheet-print"
    : "blank-note-sheet";
  return `<div class="${cls}"><div class="blank-note-text">${full}</div></div>`;
}
const copyTitle = function copyTitle(s) {
  if (!s.reuseOf) return "";
  const origin = allCards(p()).find((x) => x.id === s.reuseOf);
  const copies = allCards(p())
    .filter((x) => x.reuseOf === s.reuseOf)
    .sort(
      (a, b) =>
        (Number(a.reuseIndex) || Infinity) - (Number(b.reuseIndex) || Infinity),
    );
  const n = copies.findIndex((x) => x.id === s.id) + 1;
  const num = origin
    ? position(p(), origin.id, store.state.settings.numbering)
    : null;
  return `copy${n > 1 ? " " + n : ""} of ${num ? num : "archived card"}`;
};
const globalCount = (c) => {
  const orderedCh = chapters();
  let n = 0;
  for (const x of orderedCh) {
    if (x.id === c.id) break;
    n += chapterCards(p(), x.id).length;
  }
  return n;
};
const cjClickSounds = [1, 2, 3].map((i) => {
  const a = new Audio(`assets/menu-click-${i}.wav`);
  a.preload = "auto";
  return a;
});
const cjPageSounds = {
  forward: new Audio("assets/page-flip-forward.wav"),
  back: new Audio("assets/page-flip-back.wav"),
};
for (const a of Object.values(cjPageSounds)) a.preload = "auto";
let cjClickIndex = 0;
function playOriginal(a) {
  if (!store.state.settings.sfx) return;
  try {
    const sound = a.cloneNode(true);
    sound.volume = Math.min(
      1,
      Math.max(0, Number(store.state.settings.sfxVolume ?? 0.4)),
    );
    const playback = sound.play();
    playback?.catch?.(() => {});
  } catch (e) {
    console.warn("UI sound failed", e);
  }
}
function uiSound() {
  playOriginal(cjClickSounds[cjClickIndex++ % cjClickSounds.length]);
}
function pageSound(direction = "forward") {
  playOriginal(cjPageSounds[direction] || cjPageSounds.forward);
}

function toast(txt) {
  txt=String(txt||"The operation could not finish. Please try again.");
  $(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = txt;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2400);
}
function change(label, fn, { render: shouldRender = true } = {}) {
  boardLayoutCache = null;
  store.change(label, s=>{fn(s);if(p())ensureCardLabels(p());});
  boardLayoutCache = null;
  if (shouldRender) render();
}
function render() {
  SHEETS.sync();
  updateNativeMenu();
  boardLayoutCache = null;
  const scrollPos = {};
  for (const id of [
    "paper-list",
    ".print-center",
    "chapter-list",
    ".assembly-page-main",
    ".assembly-cards",
    ".assembly-detail",
  ]) {
    const n = $(id.startsWith(".") ? id : "#" + id);
    if (n) scrollPos[id] = n.scrollTop;
  }
  renderToken++;
  if (p()) {
    ensureProject(p());
    ensureWorkspace(p());
  }
  document.body.style.setProperty(
    "--note-font",
    (store.state.settings.noteSize || 14) + "px",
  );
  document.body.style.setProperty(
    "--letterbox",
    store.state.settings.letterbox === "white" ? "#fff" : "#000",
  );
  document.body.className = `theme-${UI.theme} page-${UI.screen}${store.state.settings.animations ? "" : " animations-off"}`;
  document.body.style.setProperty(
    "--theme-tint",
    UI.screen === "print"
      ? "#d48ab8"
      : UI.screen === "browser"
        ? "#8886cd"
        : UI.screen === "assembly"
          ? "#244f91"
          : "#bc7880",
  );
  if (UI.screen === "browser") app.innerHTML = browserHtml();
  else if (UI.screen === "print") app.innerHTML = printHtml();
  else if (UI.screen === "highlighter")
    app.innerHTML = `${toolbar()}<div class="highlighter-page ${UI.left ? "" : "no-left"}">${UI.left ? chapterSidebar() : '<button class="rail-open left" data-act="toggle-chapters" title="Show chapters">≡</button>'}<main class="highlighter-page-main">${HL.html({ expanded: true })}</main></div>`;
  else if (UI.screen === "perform")
    app.innerHTML = `${toolbar()}${PERFORM.html()}`;
  else if (UI.screen === "completion") app.innerHTML = completionHtml();
  else if (UI.screen === "assembly")
    app.innerHTML = `${toolbar()}<div class="assembly-page ${UI.left ? "" : "no-left"}">${UI.left ? chapterSidebar() : '<button class="rail-open left" data-act="toggle-chapters" title="Show chapters">≡</button>'}<div class="assembly-page-main"><div class="prepare-toolbar"><nav class="prepare-steps" aria-label="Prepare video"><button data-act="prepare-images" aria-pressed="${!["export","audio"].includes(UI.prepareStep)}">1 · Storyboard vs cleanup</button><button data-act="prepare-audio" aria-pressed="${UI.prepareStep === "audio"}">2 · Audio</button><button data-act="prepare-export" aria-pressed="${UI.prepareStep === "export"}">3 · Editor export</button></nav>${STUDIO.html()}</div>${UI.prepareStep === "export" ? EDITOR.html() : UI.prepareStep === "audio" ? audioPage(p(),UI.matchingAudio) : ASSEMBLY.html()}</div></div>`;
  else {
    UI.screen = "storyboard";
    if(UI.pendingBoardAnchor)revealCardPage(UI.pendingBoardAnchor);
    app.innerHTML = storyboardHtml();
  }
  if (UI.modal && !$(".modal-overlay")) renderModal();
  if (UI.menu) renderMenu();
  if(UI.screen==='storyboard')document.querySelector('.board-main')?.insertAdjacentHTML('beforeend',pageHelp('storyboard'));
  else if(!["assembly","highlighter"].includes(UI.screen))app.insertAdjacentHTML("beforeend",pageHelp(UI.screen));
  attachImages(app);
  if(UI.screen==='storyboard')CLEANUP.decorate();
  if (UI.screen === "storyboard") {
    if(!fitStoryboardPage())UI.pendingBoardAnchor=null;
    positionInsertButtons();
    refreshHighlights();
  }
  if (UI.screen === "print") renderPrintPreviews(renderToken);
  PERFORM.mount(UI.screen === "perform");
  HL.mount();

  updateAllBlankNoteOverflows();
  for (const [id, top] of Object.entries(scrollPos)) {
    const n = $(id.startsWith(".") ? id : "#" + id);
    if (n) n.scrollTop = top;
  }
  activateScrollFade.cleanup?.();
  activateScrollFade();
}
const PERFORM = createPerformPreview({
 note:(id,text)=>change("Edit Perform note",()=>{const c=p().stories.find(c=>c.id===id);if(c)c.note=text;},{render:false}),
  project: p,
  chapter: activeCh,
  number: (id) => position(p(), id, store.state.settings.numbering),
  image: card=>currentCleanup(p(),card).status==='ready'?CLEANUP.markup(card):imageHtml(card),
  attach: attachImages,
  render,
  notify: toast,
  ensureRoot: () => STUDIO.ensureRoot(),
  sync: () => STUDIO.flush(),
  matchTiming:()=>STUDIO.matchTiming(),
  verifyAudio:()=>STUDIO.verifyAudio(),
});
function heading() {
  return `<div class="brand" data-act="browser" title="Save and return to projects"><span class="brand-emblem">✧</span><span>Storyboard Studio</span><small class="test-build-label">v0.11</small></div>`;
}
function toolbar() {
  return `<header class="topbar">${heading()}<span class="project-head">${esc(p()?.name || "")}</span><div class="top-actions">${UI.screen !== "storyboard" ? '<button data-act="storyboard">← Storyboard</button>' : ""}${UI.screen !== "highlighter" ? '<button class="mode-outline" data-act="highlighter">Highlighter</button>' : ""}${UI.screen === "storyboard" ? '<button class="mode-outline" data-act="perform">Perform</button>' : ""}${UI.screen === "completion" ? `<label class="completion-size-control top-size">Thumbnail size<input type="range" min="120" max="350" step="10" data-completion-size value="${UI.completionThumb}"></label>` : ""}${["highlighter","perform"].includes(UI.screen) ? '<button class="prepare-video-primary" data-act="prepare-video">PREPARE VIDEO</button>' : ""}<button data-act="menu" title="Open menu (Tab)" class="icon-button menu-button">☰</button></div></header>`;
}
function folderIcon(f) {
  const hue = Number.isFinite(Number(f.hue)) ? Number(f.hue) : 350;
  return `<div class="folder-art" style="--folder-selected-color:hsl(${hue} 68% 70%)"><span class="folder-color-mask" aria-hidden="true"></span></div>`;
}
function browserItems() {
  const root = UI.folderId === "root",
    q = UI.search.trim().toLowerCase();
  let folders = store.state.folders.filter(
      (f) => f.id !== "root" && f.parentId === (root ? "root" : UI.folderId),
    ),
    projects = store.state.projects.filter(
      (x) =>
        x.folderId === UI.folderId ||
        (root && UI.browserFilter === "all" && x.folderId === "root"),
    );
  if (UI.browserFilter === "folders") projects = [];
  if (["videos", "shorts"].includes(UI.browserFilter)) {
    folders = [];
    projects = store.state.projects.filter((x) =>
      UI.browserFilter === "shorts" ? x.ratio === "9:16" : x.ratio !== "9:16",
    );
    if (!root) projects = projects.filter((x) => x.folderId === UI.folderId);
  }
  if (q) {
    folders = folders.filter((f) => f.name.toLowerCase().includes(q));
    projects = projects.filter((x) => x.name.toLowerCase().includes(q));
  }
  const sorter = (a, b) =>
    Number(!!b.pinned) - Number(!!a.pinned) ||
    (UI.sort === "name"
      ? a.name.localeCompare(b.name)
      : UI.sort === "opened"
        ? new Date(b.lastOpenedAt || 0) - new Date(a.lastOpenedAt || 0)
        : UI.sort === "created"
          ? new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
          : UI.sort === "completion"
            ? Number(b.completion || 0) - Number(a.completion || 0)
            : new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0));
  return [
    { type: "new", id: "new" },
    ...folders.sort(sorter).map((f) => ({ type: "folder", id: f.id, data: f })),
    ...projects
      .sort(sorter)
      .map((x) => ({ type: "project", id: x.id, data: x })),
  ];
}
function selectedProjectIds() {
  return UI.selectedBrowser.filter((id) =>
    store.state.projects.some((project) => project.id === id),
  );
}
function browserMoveBar() {
  const ids = selectedProjectIds();
  if (!ids.length) return "";
  const folders = store.state.folders.filter((f) => f.id !== "root");
  return `<div class="browser-move-bar" role="group" aria-label="Move selected projects"><strong>${ids.length} selected</strong><select id="browser-move-destination" aria-label="Destination folder"><option value="root">All Projects</option>${folders.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("")}</select><button data-act="browser-move-selected" title="Move the selected projects">Move to folder</button><button data-act="browser-create-for-selected" title="Create a folder containing the selected projects">＋ New folder</button><button data-act="browser-clear-selection" title="Clear selection">✕</button></div>`;
}
function refreshBrowserSelection() {
  $$('.browser-tile[data-kind="project"]').forEach((el) =>
    el.classList.toggle(
      "multi-selected",
      UI.selectedBrowser.includes(el.dataset.browse),
    ),
  );
}
function stickers(xs) {
  return (xs || [])
    .slice(0, 2)
    .map(
      (s) =>
        `<span class="browser-sticker ${esc(s)}">${s === "star" ? "★" : s === "heart" ? "♥" : "✓"}</span>`,
    )
    .join("");
}
function browserDetails(project) {
  if (!store.state.settings.browserInfo) return "";
  const active = project.chapters.filter((c) => !c.unused);
  const all = active.flatMap((c) =>
    (project.stories || []).filter((s) => s.chapterId === c.id),
  );
  const percent = all.length
    ? Math.round(
        (all.reduce(
          (sum, s) =>
            sum +
            (s.completionStatus === "green"
              ? 1
              : s.completionStatus === "yellow"
                ? 0.5
                : 0),
          0,
        ) *
          100) /
          all.length,
      )
    : 0;
  const stamp = (t) => (t ? new Date(t).toLocaleString() : "—");
  return `<div class="browser-details"><span>Created: ${esc(stamp(project.createdAt))}</span><span>Modified: ${esc(stamp(project.modifiedAt))}</span><span>Last opened: ${esc(stamp(project.lastOpenedAt))}</span><span>Completion: ${percent}%</span></div>`;
}
function pinIcon() {
  return `<svg class="pin-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z"/><path d="M12 14v7"/></svg>`;
}
function folderNewIcon() {
  return `<svg class="folder-add-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M5 13a4 4 0 0 1 4-4h10l4 4h15a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V13Z" fill="#aac4ec" stroke="#6088be" stroke-width="2"/><path d="M6 22h35l-5 17H10a4 4 0 0 1-4-4V22Z" fill="#86a8d6" stroke="#6088be" stroke-width="1.6"/><circle cx="36" cy="35" r="9" fill="#f7faff" stroke="#6a90c4" stroke-width="2"/><path d="M36 30v10m-5-5h10" stroke="#587fbb" stroke-width="2.4" stroke-linecap="round"/></svg>`;
}
function browserHtml() {
  const xs = browserItems(),
    folder = store.state.folders.find((f) => f.id === UI.folderId),
    inside = UI.folderId !== "root",
    hue = Number(folder?.hue ?? 230);
  return `<div class="browser-shell" style="--folder-hue:${hue}"><header class="browser-top"><div class="browser-wordmark">✧ <span>Storyboard Studio</span><small>v0.11</small></div><div class="browser-tools"><button data-act="browser-settings" title="Settings">⚙</button><button data-act="browser-info" title="Project information" aria-pressed="${!!store.state.settings.browserInfo}" class="browser-info-toggle ${store.state.settings.browserInfo ? "active" : ""}">ⓘ</button></div></header>
 <div class="browser-panel ${inside ? "inside-folder" : ""}"><div class="browser-filters"><div class="browser-filter-row">${["all", "folders", "videos", "shorts"].map((v) => `<button data-filter="${v}" class="browser-filter ${UI.browserFilter === v ? "active" : ""}" aria-pressed="${UI.browserFilter === v}">${v === "all" ? "All Projects" : v[0].toUpperCase() + v.slice(1)}</button>`).join("")}<button data-act="folder-new" class="folder-create-button" title="Create folder">${folderNewIcon()}</button></div><div class="browser-filter-row"><select data-act="sort" aria-label="Sort projects"><option value="modified" ${UI.sort === "modified" ? "selected" : ""}>Recently Modified</option><option value="opened" ${UI.sort === "opened" ? "selected" : ""}>Last opened</option><option value="name" ${UI.sort === "name" ? "selected" : ""}>Name A–Z</option><option value="created" ${UI.sort === "created" ? "selected" : ""}>Date Created</option><option value="completion" ${UI.sort === "completion" ? "selected" : ""}>Completion</option></select><input data-act="search" placeholder="Search projects…" value="${esc(UI.search)}"></div></div>
 ${inside ? `<button class="breadcrumb" data-act="folder-back">‹ All Projects / ${esc(folder?.name || "")}</button>` : ""}
 ${browserMoveBar()}<div class="project-grid lasso-surface" id="browser-grid">${xs.map((x, i) => (x.type === "new" ? `<button class="browser-tile project-new ${UI.focusBrowser === i ? "kbd-selected" : ""}" data-browse="new"><div class="tile-art new-art">＋</div><strong>New Project</strong></button>` : x.type === "folder" ? `<div class="browser-tile ${UI.focusBrowser === i ? "kbd-selected" : ""}" draggable="true" data-browse="${x.id}" data-kind="folder" title="${esc(x.data.name)}"><div class="tile-art folder-tile">${folderIcon(x.data)}${stickers(x.data.stickers)}</div><strong>${esc(x.data.name)}</strong><small>${store.state.projects.filter((p) => p.folderId === x.id).length} projects</small>${x.data.pinned ? `<span class="pinned" title="Pinned">${pinIcon()}</span>` : ""}</div>` : `<div class="browser-tile ${UI.focusBrowser === i ? "kbd-selected" : ""} ${UI.selectedBrowser.includes(x.id) ? "multi-selected" : ""}" draggable="true" data-browse="${x.id}" data-kind="project" title="${esc(x.data.name)}"><div class="tile-art"><div class="project-art" style="aspect-ratio:${ratio(x.data)}">${x.data.thumbnailId ? `<img data-asset="${x.data.thumbnailId}" alt="">` : x.data.thumbnail ? `<img src="${x.data.thumbnail}" alt="">` : `<svg class="project-symbol" viewBox="0 0 96 54" aria-hidden="true"><rect x="2" y="3" width="92" height="48" rx="5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M9 38 31 20 44 30 61 15 87 41" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="73" cy="15" r="6" fill="currentColor"/></svg>`}</div>${stickers(x.data.stickers)}</div><strong>${esc(x.data.name)}</strong>${browserDetails(x.data)}${x.data.pinned ? `<span class="pinned" title="Pinned">${pinIcon()}</span>` : ""}</div>`)).join("")}</div>
 </div><footer class="browser-footer"><div><button data-act="project-import">↓ Import Project</button><button data-act="export-selected">↑ Export Project</button></div><button class="primary" data-act="project-new">＋ New Project</button></footer></div>`;
}

function chapterNumber(c) {
  return chapterNumberFor(p(), c);
}
function chapterMeta(c) {
  const n = chapterCards(p(), c.id).length;
  if (store.state.settings.chapterInfo === "hidden") return "";
  if (store.state.settings.chapterInfo === "count") return `${n}`;
  const base = globalCount(c);
  return n ? `${base + 1}–${base + n}` : "–";
}
function chapterIsDone(c) {
  const cards = chapterCards(p(), c.id);
  return cards.length > 0 && cards.every((s) => s.completionStatus === "green");
}
function chapterHtml(c) {
  const isEditing = UI.renamingChapterId === c.id;
  const status =
    UI.screen === "storyboard" &&
    ["ready", "revision"].includes(c.storyboardStatus)
      ? c.storyboardStatus
      : null;
  const done = chapterIsDone(c);
  const name = isEditing
    ? `<div class="chapter-name"><span class="chapter-number">${chapterNumber(c)}</span><input data-chapter-rename="${c.id}" class="chapter-rename-input" maxlength="180" value="${esc(c.name)}" aria-label="Rename chapter"></div>`
    : `<button class="chapter-name" data-activate-chapter="${c.id}">${done ? '<span class="chapter-check">✓</span>' : ""}<span class="chapter-number">${chapterNumber(c)}</span><span class="chapter-label">${esc(c.name)}</span></button>`;
  return `<div class="chapter-row ${c.id === UI.chapterId ? "on" : ""} ${c.parentId ? "subchapter" : ""} ${done ? "chapter-done" : ""} ${status ? "chapter-status-" + status : ""}" data-chapter="${c.id}" draggable="${!isEditing}" title="${esc(c.name)}">${name}<small>${chapterMeta(c)}</small>${status ? `<img class="chapter-status-sticker" src="assets/chapter-${status}.png" alt="${status === "ready" ? "Storyboard ready" : "Needs revision"}" title="${status === "ready" ? "Storyboard ready" : "Needs revision"}">` : ""}</div>`;
}
function chapterSidebar({ print = false } = {}) {
  return `<aside class="chapter-sidebar"><div class="side-head"><strong>Chapters</strong><div>${print ? "" : `<button data-act="add-chapter" title="Add chapter">＋</button>`}<button data-act="toggle-chapters" title="Hide chapters">≡</button></div></div><div id="chapter-list" class="chapter-list">${chapters().map(chapterHtml).join("")}</div>${!print ? '<div class="chapter-promote-target" data-drop-promote title="Drop here to make a main chapter">↖ Move to main chapters</div>' : ""}${
    !print
      ? `<div class="unused-zone ${p()?.chapters.some((c) => c.unused) ? "has-unused" : ""}" data-drop-unused>${
          p()?.chapters.some((c) => c.unused)
            ? `<div class="section-line">UNUSED</div>${p()
                .chapters.filter((c) => c.unused)
                .map(
                  (c) =>
                    `<div class="chapter-row unused" data-chapter="${c.id}" draggable="true">${esc(c.name)}</div>`,
                )
                .join("")}`
            : "<span>Drag a chapter here to keep it unused</span>"
        }</div>`
      : ""
  }${!print?'<button class="sidebar-completion-button" data-act="completion">✓ Completion</button>':""}</aside>`;
}
function imageHtml(s, { small = false } = {}) {
  const v = visual(p(), s);
  return v.blank
    ? '<div class="blank-art">BLANK</div>'
    : `<img data-asset="${v.variant?.assetId || ""}" draggable="false" alt="">`;
}
function badge(t) {
  return `<span class="tag-badge" style="--tag:${color(t)}" title="${esc(label(t))}">${esc(symbol(t))}</span>`;
}
function cardsInChapter() {
  let a = activeCards();
  if (UI.filterTag !== "all")
    a = a.filter((s) => tags(p(), s).includes(UI.filterTag));
  return a;
}
function cardHtml(s, idx, { bucket = false } = {}) {
  const v = visual(p(), s),
    num = position(p(), s.id, store.state.settings.numbering);
  const selected = (bucket ? UI.bucketSelected : UI.selected).includes(s.id);
  const mainNumber = num || "";
  const hasNote = Boolean((s.note || "").trim());
  return `<div class="story-entry ${selected ? "selected" : ""} ${bucket ? "bucket-card" : ""}" draggable="true" data-card="${s.id}" ${bucket ? 'data-in-bucket="1"' : ""}><div class="story-frame" style="aspect-ratio:${ratio(p())}">${imageHtml(s)}${blankNotePreview(s)}${hasNote ? '<span class="notes-card-indicator" aria-label="Card has notes" title="Card has notes">▤</span>' : ""}<div class="corner-tags">${tags(p(), s).slice(0, 4).map(badge).join("")}</div><button class="tag-add" title="Add a tag" data-act="add-card-tag" data-id="${s.id}">＋</button></div><div class="story-meta">${!bucket && store.state.settings.cardNumbers ? `<span>${mainNumber || "·"}</span>` : ""}${v.count > 1 ? `<span>${String.fromCharCode(65 + v.index)} (${v.count})</span>` : ""}${s.reuseOf ? `<span class="copy-label">${esc(copyTitle(s))}</span>` : ""}${s.modifiedOf&&!s.numberAsRegular ? `<span class="modified-label">${esc(modificationLabel(p(), s, store.state.settings.numbering))}</span>` : ""}</div>${!bucket && p()?.viewPrefs.linkedTextVisible !== false ? HL.caption(s.id) : ""}${!bucket && p()?.viewPrefs.cardNotesVisible ? `<textarea class="card-note inline-card-note" data-note="${s.id}" rows="3" placeholder="Add a note…" aria-label="Storyboard note">${esc(s.note || "")}</textarea>` : ""}</div>`;
}
function stickyHtml(n) {
  const projectScope = !n.chapterId;
  return `<div class="sticky-item ${projectScope ? "project-sticky" : "chapter-sticky"}" data-sticky="${n.id}" style="--paper:${projectScope ? "#d6eefb" : "#fff0b9"}"><div class="sticky-head"><div class="sticky-scope" aria-label="Sticky note scope"><button data-sticky-scope="project" data-id="${n.id}" class="${projectScope ? "selected" : ""}" title="Show on every chapter">Project</button><span> | </span><button data-sticky-scope="chapter" data-id="${n.id}" class="${projectScope ? "" : "selected"}" title="Show only on this chapter">Chapter</button></div><button title="Archive sticky" data-act="archive-sticky" data-id="${n.id}">×</button></div><textarea data-sticky-note="${n.id}" placeholder="An idea to remember…">${esc(n.text || "")}</textarea></div>`;
}
function rightSidebar() {
  if (UI.rightMode === "highlighter")
    return `<aside class="holding-sidebar highlighter-sidebar"><div class="side-head"><div class="switch-head"><button data-act="panel-holding">Holding Area</button><button class="active" data-act="panel-highlighter">Highlighter</button><button data-act="panel-assets">Assets</button></div><button title="Hide panel" data-act="toggle-holding">≡</button></div>${HL.html()}</aside>`;
  const mode = UI.rightMode,
    kind = UI.bucket;
  const source =
    mode === "assets"
      ? store.state.globalAssets
      : kind === "unassigned"
        ? p().unassigned
        : kind === "lost"
          ? p().lost
          : kind === "archived"
            ? ["stickies","cleanups"].includes(UI.archiveKind)
              ? []
              : p().archived
            : [];
  return `<aside class="holding-sidebar"><div class="side-head"><div class="switch-head"><button class="${mode === "holding" ? "active" : ""}" data-act="panel-holding">Holding Area</button><button data-act="panel-highlighter">Highlighter</button><button class="${mode === "assets" ? "active" : ""}" data-act="panel-assets">Assets</button></div><button title="Hide panel" data-act="toggle-holding">≡</button></div>${mode === "holding" ? `<div class="holding-tabs">${["unassigned", "lost", "archived"].map((v) => `<button class="${kind === v ? "active" : ""}" data-bucket="${v}">${v === "unassigned" ? "Not Assigned" : v === "archived" ? "Archive" : "Lost"}</button>`).join("")}</div>${kind === "lost" ? `<div class="mini-switch"><button data-act="lost-scope" class="${UI.lostScope === "chapter" ? "active" : ""}" data-scope="chapter">Chapter</button><button data-act="lost-scope" class="${UI.lostScope === "project" ? "active" : ""}" data-scope="project">Project</button></div>` : ""}${["archived","unassigned"].includes(kind) ? `<div class="mini-switch"><button class="${UI.archiveKind === "cards" ? "active" : ""}" data-act="archive-kind" data-kind="cards">Cards</button>${kind==='archived'?`<button class="${UI.archiveKind === "stickies" ? "active" : ""}" data-act="archive-kind" data-kind="stickies">Stickies</button>`:''}<button class="${UI.archiveKind === "cleanups" ? "active" : ""}" data-act="archive-kind" data-kind="cleanups">Cleanups</button></div>` : ""}` : `<p class="muted">Shared reusable images across projects</p>${assetFolders.html()}`}<div class="bucket-grid lasso-surface" id="holding-grid" data-drop-bucket="${mode === "assets" ? "assets" : kind}">${
    mode === "holding" && ["archived","unassigned"].includes(kind) && UI.archiveKind === "cleanups"
      ? CLEANUP.archiveMarkup(UI.cleanupArchiveSelected,kind==="unassigned")
      : mode === "holding" && kind === "archived" && UI.archiveKind === "stickies"
      ? (p().archivedStickies || [])
          .map(
            (n) =>
              `<div class="archived-sticky"><p>${esc(n.text)}</p><div class="archive-sticky-actions"><button data-act="restore-sticky" data-id="${n.id}">Restore</button><button class="delete-sticky" data-act="delete-archived-sticky" data-id="${n.id}" title="Permanently delete archived sticky">Delete</button></div></div>`,
          )
          .join("")
      : source
          .filter(
            (s) =>
              mode === "assets" ||
              kind !== "lost" ||
              (UI.lostScope === "project"
                ? s.lostScope === "project"
                : s.lostScope !== "project" && s.chapterId === UI.chapterId),
          )
          .map((s) => cardHtml(s, 0, { bucket: true }))
          .join("")
  }</div><button class="drop-import" data-act="import-image" title="Import into ${mode}">＋ Import</button></aside>`;
}
function boardDimensions() {
  const format = p()?.ratio || "16:9",
    base = gridPreset(store.state.settings, format),
    v = p()?.viewPrefs || {};
  return {
    cols: Math.max(
      1,
      Math.min(
        6,
        Number(
          v.gridCols ||
            (p()?.ratio === "9:16" ? 4 : p()?.ratio ? 3 : base.cols),
        ),
      ),
    ),
    rows: Math.max(
      1,
      Math.min(
        7,
        Number(
          v.gridRows ||
            (p()?.ratio === "9:16" ? 3 : p()?.ratio ? 4 : base.rows),
        ),
      ),
    ),
  };
}
function compactChapters() {
  return (
    UI.right &&
    UI.rightMode === "highlighter" &&
    p()?.viewPrefs.linkedTextVisible !== false
  );
}
function boardViewportKey() {
  return [
    innerWidth,
    innerHeight,
    UI.left,
    UI.right,
    UI.rightMode,
    UI.showStickies,
    compactChapters(),
  ].join(":");
}
function boardLayouts() {
  if (boardLayoutCache) return boardLayoutCache;
  const narrow = innerWidth <= 1150,
    left = UI.left
      ? compactChapters()
        ? narrow
          ? 170
          : 210
        : narrow
          ? 190
          : 250
      : 34,
    right = UI.right
      ? UI.rightMode === "highlighter"
        ? narrow
          ? 330
          : 360
        : narrow
          ? 235
          : 280
      : 34;
  const measured =
    UI.boardViewport?.key === boardViewportKey() ? UI.boardViewport : null;
  const width = Math.max(
      120,
      measured?.width || innerWidth - left - right - 42,
    ),
    height = Math.max(
      150,
      measured?.height || innerHeight - 200 - (UI.showStickies ? 130 : 0),
    );
  const d = boardDimensions(),
    settings = store.state.settings;
  return (boardLayoutCache = layoutCards(p(), cardsInChapter(), width, height, {
    ...d,
    gap: Math.max(5, Math.min(22, settings.spacing * 0.45)),
    script:
      p().viewPrefs.linkedTextVisible === false
        ? "none"
        : p().viewPrefs.hlView || "all",
    scriptFont: settings.hlCaptionSize || 14,
    noteFont: settings.noteSize || 14,
    notes: !!p().viewPrefs.cardNotesVisible,
    numbers: settings.cardNumbers,
    thumb: p().viewPrefs.thumbnailSize || 195,
  }));
}
function boardPage() {
  const id = UI.chapterId || "",
    max = boardLayouts().length - 1;
  UI.boardPages[id] = Math.max(
    0,
    Math.min(max, Number(UI.boardPages[id] || 0)),
  );
  return UI.boardPages[id];
}
function boardLayout() {
  return boardLayouts()[boardPage()];
}
function boardRows() {
  return boardLayout().rows;
}
function boardPageSize() {
  const l = boardLayout();
  return l.cols * l.rows;
}
function setBoardPage(n) {
  const id = UI.chapterId || "",
    max = boardLayouts().length - 1,
    next = Math.max(0, Math.min(max, n));
  if (next !== boardPage()) pageSound(next > boardPage() ? "forward" : "back");
  UI.boardPages[id] = next;
  render();
}
function revealCardPage(id) {
  const index = cardsInChapter().findIndex((x) => x.id === id);
  if (index >= 0) {
    const layouts = boardLayouts();
    UI.boardPages[UI.chapterId] = Math.max(
      0,
      layouts.findIndex(
        (l) => index >= l.offset && index < l.offset + l.items.length,
      ),
    );
  }
}
function boardSlots(list, offset) {
  const slots = [],
    layout = boardLayout();
  for (let i = 0; i < layout.cols * layout.rows; i++) {
    const entry = layout.items[i],
      s = entry?.card,
      index = offset + i;
    slots.push(
      s
        ? `<div class="grid-item board-slot ${layout.side ? "hl-side-caption" : ""}" data-slot="${index}" style="--hl-art-width:${entry.artW}px"><button type="button" class="gap-target" data-insert="${index}" title="Insert blank before this card">＋</button>${cardHtml(s, index)}</div>`
        : i === list.length - offset
          ? `<div class="grid-item board-slot board-empty" data-slot="${index}"><button class="page-add-blank" data-insert="${index}" aria-label="Add storyboard here" title="Add blank storyboard">＋</button></div>`
          : `<div class="grid-item board-slot board-empty" data-slot="${index}"></div>`,
    );
  }
  return slots.join("");
}

function storyboardHtml() {
  const C = cardsInChapter(),
    show = p()?.viewPrefs.cardNotesVisible,
    page = boardPage(),
    pages = boardLayouts().length,
    offset = boardLayout().offset;
  return `${toolbar()}<div class="workspace-shell ${compactChapters() ? "hl-compact-chapters" : ""} ${UI.right && UI.rightMode === "highlighter" ? "hl-sidebar-visible" : ""} ${UI.left ? "" : "no-left"} ${UI.right ? "" : "no-right"}">${UI.left ? chapterSidebar() : `<button class="rail-open left" data-act="toggle-chapters" title="Show chapters">≡</button>`}<main class="board-main ${p().viewPrefs.boardMode==='cleanup'?'cleanup-mode':''}"><div class="board-minihead"><button class="board-mode-switch" data-act="board-toggle" aria-label="Switch Storyboard and Clean up"><span class="${p().viewPrefs.boardMode!=='cleanup'?'active':''}">Storyboard</span><span class="${p().viewPrefs.boardMode==='cleanup'?'active':''}">Clean up</span></button>${CLEANUP.missingButton()}${p().viewPrefs.boardMode==='cleanup'?'<button class="cleanup-help-button" data-act="cleanup-help" aria-label="Cleanup help">ⓘ</button>':''}<div><h2>${esc(activeCh()?.name || "Chapter")}</h2></div><div class="board-icons"><button data-act="toggle-linked-text" class="hl-linked-toggle ${p()?.viewPrefs.linkedTextVisible !== false ? "on" : ""}" title="Show or hide linked script beneath cards" aria-pressed="${p()?.viewPrefs.linkedTextVisible !== false}" aria-label="Show linked script"><img src="assets/script-icon.png" alt=""></button><button data-act="toggle-notes" class="notes-tool ${show ? "on" : ""}" title="Show/hide card notes"><img src="assets/notes-icon.png" alt=""></button><button data-act="toggle-stickies" class="add-sticky-icon ${UI.showStickies ? "on" : ""}" title="Sticky notes" aria-pressed="${UI.showStickies}"><img src="assets/stickies.png" alt=""></button>${UI.showStickies ? '<button data-act="new-sticky" class="sticky-plus" title="Add sticky note">＋</button>' : ""}</div></div>${
    UI.showStickies &&
    p().stickyNotes.filter(
      (n) => !n.closed && (!n.chapterId || n.chapterId === UI.chapterId),
    ).length
      ? `<div class="sticky-margin">${p()
          .stickyNotes.filter(
            (n) => !n.closed && (!n.chapterId || n.chapterId === UI.chapterId),
          )
          .map(stickyHtml)
          .join("")}</div>`
      : ""
  }
 <div class="board-scroll lasso-surface board-page" id="storyboard-scroll"><div class="board-grid page-grid ${show ? "with-notes" : ""} ${p()?.viewPrefs.linkedTextVisible !== false ? "with-linked-text" : ""}" id="storyboard-grid" style="--card-width:${p()?.viewPrefs.thumbnailSize || 195}px;--card-gap:${store.state.settings.spacing}px;--page-rows:${boardRows()};--page-cols:${boardLayout().cols};--hl-caption-size:${store.state.settings.hlCaptionSize || 14}px;--hl-grid-height:${boardLayout().cellH * boardRows() + Math.max(0, boardRows() - 1) * Math.max(5, Math.min(22, store.state.settings.spacing * 0.45))}px">${boardSlots(C, offset)}</div></div><div class="board-bottom board-pagination"><span>${C.length} storyboards</span><div class="board-page-controls"><button data-act="board-prev" ${page === 0 ? "disabled" : ""} title="Previous page">‹</button><span>Page ${page + 1} / ${pages}</span><button data-act="board-next" ${page >= pages - 1 ? "disabled" : ""} title="Next page">›</button>${page === pages - 1 && C.length && boardLayout().items.length === boardPageSize() ? `<button data-act="board-add-page" title="Create next page with a blank storyboard">＋ New page</button>` : ""}</div></div></main>${UI.right ? rightSidebar() : `<button class="rail-open right" data-act="toggle-holding" title="Show Holding Area">≡</button>`}</div>`;
}
function fitStoryboardPage() {
  if (UI.screen !== "storyboard") return;
  const el = $("#storyboard-scroll");
  if (!el) return;
  const cs = getComputedStyle(el),
    width =
      el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    height =
      el.clientHeight -
      parseFloat(cs.paddingTop) -
      parseFloat(cs.paddingBottom),
    key = boardViewportKey();
  if (
    UI.boardViewport?.key !== key ||
    Math.abs(UI.boardViewport.width - width) > 2 ||
    Math.abs(UI.boardViewport.height - height) > 2
  ) {
    UI.boardViewport = { key, width, height };
    requestAnimationFrame(() => {
      if (UI.screen === "storyboard") render();
    });
    return true;
  }
  return false;
}

function menuItems() {
  if (UI.screen === "browser") return ["Settings", "Shortcuts", "Exit"];
  return [
    "Highlighter",
    "Print",
    "Completion",
    "Perform",
    "Prepare video",
    "Filter & Highlight",
    "Settings",
    "Shortcuts",
    "Exit",
  ];
}
function menuHtml() {
  return `<div class="overlay menu-overlay" data-overlay="menu"><nav class="game-menu"><h2 class="display-font">Storyboard Studio</h2>${menuItems()
    .map(
      (x, i) =>
        `<button class="menu-choice display-font ${UI.focusIndex === i ? "focused" : ""}" data-menu-option="${i}">${x === "Settings" ? '<span class="rule"></span>' : ""}${x === "Exit" ? "← " : ""}${x}</button>`,
    )
    .join("")}<small>W/S · Enter · Esc / Tab</small></nav></div>`;
}
function renderMenu() {
  document.body.insertAdjacentHTML("beforeend", menuHtml());
}
function openMenu() {
  $(".context-pop")?.remove();
  UI.menu = true;
  UI.focusIndex = 0;
  renderMenu();
}
function closeMenu() {
  $$(".menu-overlay").forEach((x) => x.remove());
  UI.menu = false;
}
function chooseMenu(i) {
  const choice = menuItems()[i];
  closeMenu();
  if (choice === "Prepare video") return actions["prepare-video"]();
  if (choice === "Storyboard") return actions.storyboard();
  if (choice === "Highlighter") return actions.highlighter();
  if (choice === "Settings") return showSettings();
  if (choice === "Shortcuts") return showShortcuts();
  if (choice === "Exit") return UI.screen === "browser" ? render() : leave();
  if (choice === "Perform") return actions.perform();
  if (choice === "Completion") return actions.completion();
  if (choice === "Print") {
    UI.screen = "print";
    render();
  } else if (choice === "Filter & Highlight") showFilterModal();
}
function getTagList() {
  return [
    ["all", "All"],
    ...Object.keys(tagDefs)
      .filter((k) => k !== "cleanup")
      .map((k) => [k, label(k)]),
    ...(p()?.customTags || []).map((t) => [t.id, t.name]),
  ];
}
function showFilterModal() {
  const t = getTagList();
  modal(
    "Filter & Highlight",
    `<p>Filter hides other boards. Highlight keeps their positions and helps you find them.</p><label>Filter <select id="filter-select">${t.map(([id, n]) => `<option value="${id}" ${UI.filterTag === id ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label><label>Highlight <select id="highlight-select"><option value="none">None</option>${t
      .filter((x) => x[0] !== "all")
      .map(
        ([id, n]) =>
          `<option value="${id}" ${UI.highlightTag === id ? "selected" : ""}>${esc(n)}</option>`,
      )
      .join(
        "",
      )}</select></label><button type="button" class="filter-reset-button" data-act="reset-filter">Reset filter &amp; highlight</button>`,
    [{ text: "Done", action: "apply-filter", primary: true }],
  );
}
function showFileNaming() {
  if (!p()) return;
  ensureWorkspace(p());
  const fields = [
    ["chapter", "Chapter folder"],
    ["card", "Individual card"], ["component", "Cleanup component"], ["reference", "Whole-frame reference"],
    ["archiveFolder", "Archived storyboard folder"],
    ["archiveCard", "Archived storyboard filename"],
    ["sheet", "Storyboard page / PDF"],
    ["timeline", "Timeline XML"],
  ];
  const body = `<div class="file-naming-form">${fields.map(([key, label]) => `<label>${label}<textarea rows="1" data-naming="${key}">${esc(p().fileNaming[key])}</textarea></label>`).join("")}<label>Number padding<select data-naming="padding">${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${p().fileNaming.padding === n ? "selected" : ""}>${n}</option>`).join("")}</select></label><p>Fields: {project}, {chapter_number}, {chapter_title}, {card_number}, {slight_modify_index}, {global_number}, {variant}, {page}, {card_name}, {component_index}, {component_name}</p><div data-naming-preview></div><small>App-managed names and indexes update before export and on closing. Managed cleanup copies follow these patterns; external originals are untouched. New projects inherit your last saved choices.</small></div>`;
  modal("Project file naming", body, [
    { text: "Cancel", action: "close-modal" },
    { text: "Save", action: "save-file-naming", primary: true },
  ]);
  const preview = () => {
    try {
      const value = {};
      for (const el of document.querySelectorAll("[data-naming]"))
        value[el.dataset.naming] = el.value;
      const profile = namingProfile(value),
        context = {
          project: p().name,
          chapter_number: "1",
          chapter_title: activeCh()?.name || "Opening",
          card_number: 1,
          global_number: 1,
          variant: "A",
          page: 1,
        };
      document.querySelector("[data-naming-preview]").textContent = fields
        .map(
          ([k, label]) =>
            label +
            ": " +
            renderName(
              profile,
              k,
              context,
              ["chapter","archiveFolder"].includes(k) ? "" : k === "timeline" ? "xml" : "png",
            ),
        )
        .join("\n");
    } catch (e) {
      document.querySelector("[data-naming-preview]").textContent = e.message;
    }
  };
  document.querySelector(".file-naming-form")?.closest(".modal-card")?.classList.add("file-naming-dialog");
  document.querySelectorAll("[data-naming]").forEach((el) => {
    el.addEventListener("input", preview);
    el.addEventListener("change", preview);
  });
  preview();
}
function showSettings() {
  const s = store.state.settings,
    highlight = s.settingsTab === "highlight";
  modal(
    "Settings",
    `<div class="settings-tabs" role="group" aria-label="Settings section"><button data-act="settings-storyboard" aria-pressed="${!highlight}">Storyboard</button><button data-act="settings-highlight" aria-pressed="${highlight}">Highlight</button></div><div class="settings-version"><span>Storyboard Studio</span><strong>v0.12.0</strong></div>${p()&&!highlight ? `<div class="settings-project-files">${STUDIO.html()}</div>` : ""}${highlight ? `<div class="settings-list"><label>Highlighter text size<select data-setting="hlFontSize">${[12, 14, 16, 18, 20, 22, 24, 28].map((n) => `<option value="${n}" ${(s.hlFontSize || 16) === n ? "selected" : ""}>${n}px</option>`).join("")}</select></label><label>Blank-line spacing<select data-setting="hlBlankSpacing">${[.25,.5,.75,1,1.25,1.5].map(n=>`<option value="${n}" ${(s.hlBlankSpacing??.5)===n?"selected":""}>${Math.round(n*100)}%</option>`).join("")}</select></label><label>Card numbers in text<select data-setting="hlNumberPosition"><option value="above" ${s.hlNumberPosition !== "below" ? "selected" : ""}>Above</option><option value="below" ${s.hlNumberPosition === "below" ? "selected" : ""}>Below</option></select></label><label>Script below cards<select data-setting="hlCaptionSize">${[10, 12, 14, 16, 18, 20, 22, 24].map((n) => `<option value="${n}" ${(s.hlCaptionSize || 14) === n ? "selected" : ""}>${n}px</option>`).join("")}</select></label></div><p class="muted">Text settings apply to both Highlighter views. Script size also applies to Quick Look.</p>` : `<div class="settings-list"><label>Theme<select data-setting="theme"><option value="light" ${UI.theme === "light" ? "selected" : ""}>Light</option><option value="dark" ${UI.theme === "dark" ? "selected" : ""}>Dark</option></select></label><label>Card numbers<select data-setting="numbering"><option value="global" ${s.numbering === "global" ? "selected" : ""}>Global</option><option value="chapter" ${s.numbering === "chapter" ? "selected" : ""}>Restart per chapter</option></select></label>${p()?`<label class="inline"><input type="checkbox" data-cleanup-completion ${p().viewPrefs.cleanupCompletion?'checked':''}> Valid cleanups count as complete</label><label class="inline"><input type="checkbox" data-slight-letters ${p().viewPrefs.slightModifyLetters?'checked':''}> Letter labels for Slight modify cards (3, 3A, 4)</label>`:''}<label>Chapter sidebar info<select data-setting="chapterInfo"><option value="range" ${s.chapterInfo === "range" ? "selected" : ""}>Card range</option><option value="count" ${s.chapterInfo === "count" ? "selected" : ""}>Count</option><option value="hidden" ${s.chapterInfo === "hidden" ? "selected" : ""}>Hidden</option></select></label><label class="inline"><input type="checkbox" data-setting="cardNumbers" ${s.cardNumbers ? "checked" : ""}> Show numbers below cards</label><label>Image padding bars<select data-setting="letterbox"><option value="black" ${s.letterbox === "black" ? "selected" : ""}>Black</option><option value="white" ${s.letterbox === "white" ? "selected" : ""}>White</option></select><small>Color of the empty bars around images that do not fill the card.</small></label><label class="setting-measure"><span class="measure-line"><span>Storyboard size</span><output>${p()?.viewPrefs.thumbnailSize || s.thumbSize}px</output></span><input type="range" min="100" max="360" step="5" data-setting="thumbSize" value="${p()?.viewPrefs.thumbnailSize || s.thumbSize}"></label><label>Storyboard columns (${esc(p()?.ratio || "16:9")} preset) <input type="number" min="1" max="6" data-grid-pref="gridCols" value="${boardDimensions().cols}"></label><label>Storyboard rows (${esc(p()?.ratio || "16:9")} preset) <input type="number" min="1" max="7" data-grid-pref="gridRows" value="${boardDimensions().rows}"></label><label class="setting-measure"><span class="measure-line"><span>Card spacing</span><output>${s.spacing}px</output></span><input type="range" min="8" max="65" data-setting="spacing" value="${s.spacing}"></label><label class="setting-measure"><span class="measure-line"><span>Note font size</span><output>${s.noteSize}px</output></span><input type="range" min="10" max="24" data-setting="noteSize" value="${s.noteSize}"></label><label class="inline"><input data-setting="autoSplitSheets" type="checkbox" ${s.autoSplitSheets !== false ? "checked" : ""}> Detect and split storyboard sheets</label><small>Turn off to import each file as one drawing.</small><label class="inline"><input data-setting="sfx" type="checkbox" ${s.sfx ? "checked" : ""}> UI sounds</label><label>Sound volume <input type="range" min="0" max="1" step=".05" data-setting="sfxVolume" value="${s.sfxVolume ?? 0.4}"></label><label class="inline"><input data-setting="animations" type="checkbox" ${s.animations ? "checked" : ""}> Animations</label>${p() ? '<button data-act="manage-project-tags">Manage tags</button>' : ""}<button data-act="sheet-layouts">Storyboard sheet layouts</button><button data-act="history-modal">Session history (${store.session.length})</button></div>`}`,
    [{ text: "Close", action: "close-modal", primary: true }],
  );
}

function showShortcuts() {
  modal(
    "Shortcuts",
    `<div class="shortcut-grid">${[
      ["Tab", "App menu"],
      ["WASD / Arrows", "Navigate cards"],
      ["Space", "Quick Look"],
      ["Q / E", "Cycle variants"],
      ["R", "Holding Area"],
      ["Delete", "Delete selection"],
      ["⌘/Ctrl+Z", "Undo"],
      ["⌘/Ctrl+⇧Z / Ctrl+Y", "Redo"],
      ["Drag empty space", "Lasso selection"],
      ["Double-click chapter", "Rename chapter"],
      ["Enter while renaming", "Save chapter name"],
      ["Esc", "Close menu or selection"],
    ]
      .map(([k, v]) => `<kbd>${esc(k)}</kbd><span>${esc(v)}</span>`)
      .join(
        "",
      )}</div><label class="inline"><input id="alt-undo" type="checkbox" ${store.state.settings.altUndoKeys ? "checked" : ""}> N/M alternate undo/redo</label>`,
    [{ text: "Done", action: "close-modal", primary: true }],
  );
}
function modal(
  title,
  body,
  buttons = [{ text: "Cancel", action: "close-modal" }],
) {
  UI.modal = { title, body, buttons };
  renderModal();
}
function renderModal() {
  $$(".modal-overlay").forEach((x) => x.remove());
  const m = UI.modal;
  if (!m) return;
  const node = document.createElement("div");
  node.className = "overlay modal-overlay";
  node.dataset.overlay = "modal";
  node.innerHTML = `<section class="modal-card"><h2 class="display-font">${esc(m.title)}</h2><div class="modal-body">${m.body}</div><div class="modal-buttons">${m.buttons.map((b, i) => `<button data-modal-btn="${b.action}" class="${b.primary ? "primary" : ""} ${b.danger ? "danger" : ""} ${i === 0 ? "modal-selected" : ""}">${esc(b.text)}</button>`).join("")}</div></section>`;
  document.body.append(node);
  paginateSettings(node.querySelector(".modal-card"));
  setTimeout(
    () =>
      $(
        '.modal-card input:not([type="checkbox"]):not([type="range"]),.modal-card select',
      )?.focus(),
    10,
  );
}
function closeModal() {
 if(UI.audioChoice){const done=UI.audioChoice;UI.audioChoice=null;done(false);}
  if(UI.outputChoice){const done=UI.outputChoice;UI.outputChoice=null;done("cancel");}
  UI.modal = null;
  $(".modal-overlay")?.remove();
}
function newProjectDialog() {
  modal(
    "New Project",
    `<label>Project name<input id="project-title" placeholder="Name your project" autocomplete="off"></label><fieldset class="project-ratio-field"><legend>Format</legend><div class="project-ratio-buttons">${["16:9", "9:16", "4:3"].map((format, i) => `<label class="ratio-button"><input name="project-ratio" type="radio" value="${format}" ${i === 0 ? "checked" : ""}><span>${format}</span></label>`).join("")}</div></fieldset>`,
    [
      { text: "Cancel", action: "close-modal" },
      { text: "Create", action: "confirm-new-project", primary: true },
    ],
  );
}
const folderColors = [5, 36, 58, 142, 195, 230, 275, 320, 350];
function selectFolderColor(button) {
  const hidden = $("#folder-hue");
  if (!hidden) return;
  hidden.value = button.dataset.folderHue;
  $$("[data-folder-hue]", button.parentElement).forEach((el) => {
    const active = el === button;
    el.classList.toggle("selected", active);
    el.setAttribute("aria-pressed", String(active));
  });
  uiSound();
}
function folderDialog(id = null) {
  const f = store.state.folders.find((x) => x.id === id);
  const selected = Number(f?.hue ?? 350);
  modal(
    f ? "Edit Folder" : "New Folder",
    `<label>Name<input id="folder-name" value="${esc(f?.name || "")}" placeholder="Folder name"></label><div class="folder-colors-field"><div class="folder-color-heading">Folder color</div><div class="folder-color-swatches" role="group" aria-label="Folder color">${folderColors.map((h, i) => `<button type="button" data-folder-hue="${h}" class="${h === selected ? "selected" : ""}" aria-pressed="${h === selected}" title="Color ${i + 1}" style="--swatch-hue:${h}" aria-label="Color ${i + 1}"></button>`).join("")}</div><input type="hidden" id="folder-hue" value="${selected}"></div>`,
    [
      { text: "Cancel", action: "close-modal" },
      {
        text: "Save",
        action: f ? "save-folder" : "create-folder",
        primary: true,
      },
    ],
  );
  UI.editFolderId = id;
}
function enterProject(id) {
  store.open(id);
  ensureProject(p());
  for (const key of ["hlFontSize", "hlNumberPosition"]) {
    if (
      store.state.settings[key] === undefined &&
      p().viewPrefs[key] !== undefined
    )
      store.state.settings[key] = p().viewPrefs[key];
    delete p().viewPrefs[key];
  }
  store.save();
  HL.chapterChanged();
  UI.rightMode = "highlighter";
  UI.right = true;
  UI.screen = "storyboard";
  UI.selectedBrowser = [];
  UI.chapterId = chapters()[0]?.id;
  UI.boardPages = {};
  UI.selected = [];
  UI.bucketSelected = [];
  UI.menu = false;
  UI.modal = null;
  render();
  if(p()?.studioLink?.pendingMediaSave)toast('Project saved. Some shared media still need review: '+p().studioLink.pendingMediaSave);
  if (p()?.studioLink?.directory)
    STUDIO.refresh().catch((e) => toast(e.message));
}
async function leave() {
  flushNoteSave();
  try {
    await STUDIO.flush();
  } catch (e) {
    toast(e.message || String(e));
  }
  UI.screen = "browser";
  store.open(null);
  UI.selected = [];
  UI.selectedBrowser = [];
  UI.menu = false;
  UI.modal = null;
  UI.quick = false;
  store.save();
  render();
}
function highlightNext() {
  const matches = activeCards().filter((s) =>
    tags(p(), s).includes(UI.highlightTag),
  );
  if (!matches.length) return toast("No matching cards");
  UI.highlightIndex = (UI.highlightIndex + 1) % matches.length;
  const el = $(`[data-card="${matches[UI.highlightIndex].id}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
  UI.selected = [matches[UI.highlightIndex].id];
  markSelected();
}
function refreshHighlights() {
  if (UI.screen !== "storyboard") return;
  const active = UI.highlightTag !== "none";
  $("#storyboard-grid")?.classList.toggle("highlight-mode", active);
  $$(".story-entry[data-card]").forEach((el) =>
    el.classList.toggle(
      "highlighted",
      active && tags(p(), item(el.dataset.card)).includes(UI.highlightTag),
    ),
  );
}
function markSelected() {
  for (const el of $$("[data-card]")) {
    const arr = el.dataset.inBucket ? UI.bucketSelected : UI.selected;
    el.classList.toggle("selected", arr.includes(el.dataset.card));
  }
}
function selectCard(id, bucket = false, multi = false) {
  const key = bucket ? "bucketSelected" : "selected";
  if (!multi) {
    UI.selected = [];
    UI.bucketSelected = [];
    UI[key] = [id];
  } else
    UI[key] = UI[key].includes(id)
      ? UI[key].filter((x) => x !== id)
      : [...UI[key], id];
  UI.selectionZone = bucket ? "bucket" : "main";
  if (!bucket && UI.rightMode === "highlighter" && HL.ui.mode === "cards")
    HL.chooseCard(id);
  markSelected();
}
function preserveBoardAnchor(fn,label){
 const anchor=UI.selected.find(id=>cardsInChapter().some(c=>c.id===id))||boardLayout()?.items[0]?.card.id;
 change(label,fn,{render:false});boardLayoutCache=null;UI.pendingBoardAnchor=anchor;revealCardPage(anchor);render();
}
function toggleNotes(){preserveBoardAnchor(()=>{p().viewPrefs.cardNotesVisible=!p().viewPrefs.cardNotesVisible;},"Toggle card notes");}

function archiveSticky(id) {
  change("Archive sticky", (s) => {
    const n = p().stickyNotes.find((x) => x.id === id);
    if (!n) return;
    if ((n.text || "").trim()) p().archivedStickies.push(n);
    p().stickyNotes = p().stickyNotes.filter((x) => x.id !== id);
  });
}
function blankAt(index) {
  change("Insert blank card", (s) => {
    const cs = cardsInChapter(),
      newcard = card(UI.chapterId);
    let raw =
      index < cs.length
        ? p().stories.findIndex((x) => x.id === cs[index].id)
        : cs.length
          ? p().stories.findIndex((x) => x.id === cs[cs.length - 1].id) + 1
          : p().stories.length;
    p().stories.splice(Math.max(0, raw), 0, newcard);
    UI.selected = [newcard.id];
    revealCardPage(newcard.id);
  });
}
function renumberReuseCopies(project) {
  const groups = new Map();
  for (const x of allCards(project)) {
    if (!x.reuseOf) continue;
    const arr = groups.get(x.reuseOf) || [];
    arr.push(x);
    groups.set(x.reuseOf, arr);
  }
  for (const copies of groups.values()) {
    copies.sort(
      (a, b) =>
        (Number(a.reuseIndex) || Infinity) - (Number(b.reuseIndex) || Infinity),
    );
    copies.forEach((x, i) => (x.reuseIndex = i + 1));
  }
}
async function prepareIndependentAsset(source) {
  const chosen = visual(p(), source);
  let assetId = null;
  if (chosen.variant?.assetId && !chosen.blank) {
    const asset = await window.SSDB.getAsset(chosen.variant.assetId);
    if (!asset) throw Error("Drawing unavailable; import it before copying.");
    assetId = uid("asset");
    await window.SSDB.putAsset({
      ...structuredClone(asset),
      id: assetId,
      createdAt: Date.now(),
    });
  }
  return { assetId };
}
async function independentCopy(id, kind) {
  const project = p(),
    source = item(id);
  if (!project || !source) return;

  const chosen = visual(project, source),
    projectId = project.id;
  let assetId = null;
  if (chosen.variant?.assetId && !chosen.blank) {
    const asset = await window.SSDB.getAsset(chosen.variant.assetId);
    if (!asset)
      throw Error(
        "The drawing is unavailable. Relink or import it before copying.",
      );
    assetId = uid("asset");
    await window.SSDB.putAsset({
      ...structuredClone(asset),
      id: assetId,
      createdAt: Date.now(),
    });
  }
  if (p()?.id !== projectId || item(id) !== source) return;
  let created;
  const ch = project.stories.some((c) => c.id === source.id)
    ? source.chapterId
    : activeCh()?.id;
  change(kind === "modify" ? "Slight modify" : "Duplicate drawing", () => {
    created = addIndependentCard(p(), source, {
      kind,
      assetId,
      createCard: card,
      chapterId: ch,
      sourceNumber: position(p(), source.id, store.state.settings.numbering),
    });
    UI.selected = [created.id];
    UI.bucketSelected = [];
    UI.selectionZone = "main";
  });
  revealCardPage(created.id);
  render();
}
function deleteSelected() {
  const ids = UI.selectionZone === "bucket" ? UI.bucketSelected : UI.selected;
  if (!ids.length) return;
  if(UI.screen==='storyboard'&&p().viewPrefs.boardMode==='cleanup'&&UI.selectionZone!=='bucket'){void CLEANUP.removeMany(ids);return;}
  const blockers=deletionBlockers(p(),ids);if(blockers.length)return toast('Remove the reusable copies first ('+blockers.length+' remaining). Independent Slight modify cards are kept.');
  change(`Delete ${ids.length} card${ids.length > 1 ? "s" : ""}`, (s) => {
    retireDeletedMedia(p(),allCards(p()).filter(c=>ids.includes(c.id)));
    rememberDeletedOrigins(p(),ids);
    for (const key of ["stories", "unassigned", "lost", "archived"])
      p()[key] = p()[key].filter((x) => !ids.includes(x.id));
    if (UI.rightMode === "assets")
      s.globalAssets = s.globalAssets.filter((x) => !ids.includes(x.id));
    for (const ch of p().chapters)
      ch.highlighter.assignments = ch.highlighter.assignments.filter(
        (a) => !ids.includes(a.cardId),
      );
    renumberReuseCopies(p());
    UI.selected = [];
    UI.bucketSelected = [];
  });
}
function transfer(ids, kind, chapterId = null, index = null) {
  const selected = [...new Set(ids)];
  if (!selected.length) return;
  const destChapter=chapterId||UI.chapterId;
  const hasLinks=kind==='stories'&&p().chapters.some(ch=>ch.id!==destChapter&&(ch.highlighter?.assignments||[]).some(a=>selected.includes(a.cardId)));
  if(hasLinks&&!window.confirm('Moving these cards to another chapter removes their old chapter script links. Move cards?'))return;
  const targetChapter = chapterId || UI.chapterId,
    original = kind === "stories" ? chapterCards(p(), targetChapter) : [];
  const remainingAnchor =
    index == null
      ? null
      : original.slice(index).find((x) => !selected.includes(x.id))?.id || null;
  change(`Move ${selected.length} card(s)`, (s) => {
    if(hasLinks)for(const ch of p().chapters)if(ch.id!==destChapter&&ch.highlighter)ch.highlighter.assignments=ch.highlighter.assignments.filter(a=>!selected.includes(a.cardId));
    let moved = [];
    for (const k of ["stories", "unassigned", "lost", "archived"]) {
      moved.push(...p()[k].filter((x) => selected.includes(x.id)));
      p()[k] = p()[k].filter((x) => !selected.includes(x.id));
    }
    const global = store.state.globalAssets.filter((x) =>
      selected.includes(x.id),
    );
    moved = selected
      .map(
        (id) =>
          moved.find((s) => s.id === id) || global.find((x) => x.id === id),
      )
      .filter(Boolean)
      .map((x) =>
        global.some((g) => g.id === x.id)
          ? {
              ...structuredClone(x),
              id: uid("story"),
              chapterId: targetChapter,
            }
          : x,
      );
    if (kind === "stories") {
      moved.forEach((x) => (x.chapterId = targetChapter));
      const dest = p().stories,
        existing = chapterCards(p(), targetChapter);
      let at = remainingAnchor
        ? dest.findIndex((x) => x.id === remainingAnchor)
        : -1;
      if (at < 0)
        at = existing.length
          ? dest.findIndex((x) => x.id === existing.at(-1).id) + 1
          : dest.length;
      dest.splice(Math.max(0, at), 0, ...moved);
      UI.selected = moved.map((x) => x.id);
      UI.bucketSelected = [];
      UI.chapterId = targetChapter;
      if (targetChapter === UI.chapterId && moved[0])
        revealCardPage(moved[0].id);
    } else if (kind === "assets") {
      for (const x of moved)
        if (!store.state.globalAssets.some((y) => y.id === x.id))
          store.state.globalAssets.push(x);
    } else {
      moved.forEach((x) => {
        if (kind === "lost") {
          x.lostScope = UI.lostScope;
          if (UI.lostScope === "chapter") x.chapterId = UI.chapterId;
        }
      });
      p()[kind].push(...moved);
      UI.bucketSelected = moved.map((x) => x.id);
      UI.selected = [];
    }
  });
}

function showContext(x, y, items) {
  $(".context-pop")?.remove();
  const el = document.createElement("div");
  el.className = "context-pop";
  el.innerHTML = items
    .map(({ name, act, cls }) =>
      name === "---"
        ? "<hr>"
        : `<button data-context="${act}" class="${cls || ""}">${esc(name)}</button>`,
    )
    .join("");
  document.body.append(el);
  const rect = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(x, innerWidth - rect.width - 8)) + "px";
  el.style.top = Math.max(8, Math.min(y, innerHeight - rect.height - 8)) + "px";
}
function cardContext(e, id, bucket = false) {
  if(!bucket&&p()?.viewPrefs.boardMode==='cleanup'&&CLEANUP.context(e,id))return;
  const already = (bucket ? UI.bucketSelected : UI.selected).includes(id);
  if (!already) selectCard(id, bucket, false);
  else UI.selectionZone = bucket ? "bucket" : "main";
  UI.contextCardId = id;
  const selected = (bucket ? UI.bucketSelected : UI.selected).length;
  showContext(e.clientX, e.clientY, [
    { name: "Turn blank", act: "turn-blank" },
    { name: "Replace image…", act: "replace-card" },
    { name: "Make reusable copy", act: "reuse" },
    { name: 'Slight modify', act: 'slight-modify' },
    { name: "Duplicate", act: "duplicate-card" },
    { name: "Manage tags…", act: "card-tags" },
    ...(item(id)?.modifiedOf&&!item(id)?.numberAsRegular?[{name:'Make regular card',act:'make-regular',cls:'make-regular-action'},{name:'Rename in order…',act:'rename-family'}]:[]),
    { name: "---" },
    { name: "Move to Lost", act: "move-lost" },
    { name: "Archive", act: "move-archived" },
    { name: "---" },
    { name: "Delete", act: "delete-cards", cls: "danger" },
  ]);
}
function quickTagMenu(el) {
  const id = el.dataset.id || UI.contextCardId;
  if (!id) return;
  UI.contextCardId = id;
  const targets = tagTargetIds().map(item).filter(Boolean);
  const allHave = (tag) =>
    targets.length &&
    targets.every((x) =>
      tag === "done"
        ? completionOf(p(), x) === "green"
        : (x.tags || []).includes(tag),
    );
  const r = el.getBoundingClientRect();
  const custom = (p()?.customTags || []).map((tag) => ({
    name: `${allHave(tag.id) ? "✓ " : ""}${tag.name}`,
    act: `quick-tag-custom:${tag.id}`,
  }));
  showContext(r.left, r.bottom + 4, [
    {
      name: `${allHave("animation") ? "✓ " : ""}Animation`,
      act: "quick-tag-animation",
    },
    { name: `${allHave("review") ? "✓ " : ""}Review`, act: "quick-tag-review" },
    { name: `${allHave("done") ? "✓ " : ""}Done`, act: "quick-tag-done" },
    ...(custom.length ? [{ name: "---" }] : []),
    ...custom,
    { name: "---" },
    { name: "＋ Create new tag…", act: "quick-create-tag" },
    {
      name:
        targets.length > 1
          ? `Manage tags (${targets.length} selected)…`
          : "Manage tags…",
      act: "card-tags",
    },
  ]);
}
function newTagDialog() {
  modal(
    "New Tag",
    `<label>Name<input id="tag-name" placeholder="Tag name"></label><label>Color <div class="tag-color-field"><input type="color" id="tag-color" value="#79a9d9"><span class="tag-color-preview" id="tag-color-preview" style="--tag-preview:#79a9d9">Aa</span></div></label><label>Symbol<input id="tag-icon" maxlength="32" value="◆" placeholder="Paste a symbol or emoji"></label>`,
    [
      { text: "Cancel", action: "close-modal" },
      { text: "Create", action: "confirm-tag", primary: true },
    ],
  );
}
function editCardNote(id) {
  const s = item(id);
  if (!s) return;
  UI.editNoteId = id;
  modal(
    "Card Note",
    `<label class="note-editor-label">Text<textarea id="note-editor-text" rows="10" placeholder="Write a note about this storyboard…">${esc(s.note || "")}</textarea></label>`,
    [
      { text: "Cancel", action: "close-modal" },
      { text: "Save", action: "save-card-note", primary: true },
    ],
  );
}
function renameChapter(id) {
  const ch = p()?.chapters.find((c) => c.id === id);
  if (!ch) return;
  UI.contextChapterId = id;
  UI.renamingChapterId = id;
  render();
  const field = $(`[data-chapter-rename="${id}"]`);
  if (field) {
    field.focus();
    field.select();
  }
}
function chapterContext(e, id) {
  UI.contextChapterId = id;
  const chapterItem = p().chapters.find((x) => x.id === id);
  const status = chapterItem?.storyboardStatus;
  showContext(e.clientX, e.clientY, [
    { name: "Rename", act: "chapter-rename" },
    { name: "Add Subchapter", act: "subchapter-add" },
    { name: "---" },
    {
      name: status === "revision" ? "✓ Needs revision" : "Needs revision",
      act: "chapter-status-revision",
      cls: "revision",
    },
    {
      name: status === "ready" ? "✓ Storyboard ready" : "Storyboard ready",
      act: "chapter-status-ready",
      cls: "ready",
    },
    { name: "---" },
    {
      name: chapterItem?.unused ? "Restore" : "Move to Unused",
      act: "chapter-unused",
    },
    { name: "Export this page (PNG)", act: "chapter-page-export" },
    { name: "Export chapter cards (PNG)", act: "chapter-cards-export" },
    { name: "---" },
    { name: "Delete chapter…", act: "chapter-delete", cls: "danger" },
  ]);
}
function selectedChapter(id) {
  if (!p().chapters.some((x) => x.id === id)) return;
  HL.chapterChanged();
  UI.chapterId = id;
  UI.selected = [];
  UI.highlightIndex = 0;
  render();
}
function deleteChapter(id) {
  if (p().chapters.length === 1)
    return toast("A project needs at least one chapter");
  const c = p().chapters.find((c) => c.id === id);
  if (!c.unused && chapters().length <= 1)
    return toast("Keep at least one active chapter");
  modal(
    "Delete Chapter",
    `<p>Delete <strong>${esc(c.name)}</strong>?</p><p>Its cards and direct subchapters will move to Not Assigned. No drawings will be destroyed.</p>`,
    [
      { text: "Cancel", action: "close-modal" },
      {
        text: "Delete Chapter",
        action: "confirm-delete-chapter",
        danger: true,
      },
    ],
  );
  UI.contextChapterId = id;
}
function completionSidebarWidth(
  width = Number(store.state.settings.completionSidebarWidth || 240),
) {
  return Math.max(175, Math.min(520, innerWidth - 240, width));
}
function beginCompletionSidebarResize(e) {
  if (
    UI.screen !== "completion" ||
    e.button !== 0 ||
    !e.target.closest("[data-completion-resizer]")
  )
    return;
  e.preventDefault();
  e.stopPropagation();
  const root = $(".completion-layout"),
    handle = e.target.closest("[data-completion-resizer]");
  if (!root) return;
  const startX = e.clientX,
    original = root
      .querySelector(".completion-chapter-sidebar")
      .getBoundingClientRect().width;
  try {
    handle.setPointerCapture?.(e.pointerId);
  } catch {}
  document.body.classList.add("completion-resizing");
  const move = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    const width = completionSidebarWidth(original + ev.clientX - startX);
    root.style.setProperty("--completion-sidebar-width", width + "px");
    store.state.settings.completionSidebarWidth = width;
  };
  const finish = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    handle.removeEventListener("lostpointercapture", finish);
    if (handle.hasPointerCapture?.(e.pointerId))
      handle.releasePointerCapture(e.pointerId);
    document.body.classList.remove("completion-resizing");
    store.save();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
}
function completionStatus(card) {
  return completionOf(p(), card);
}
function completionSummary() {
  const byChapter = chapters().map((c) => {
    const cards = chapterCards(p(), c.id);
    const done = cards.filter((s) => completionStatus(s) === "green").length,
      half = cards.filter((s) => completionStatus(s) === "yellow").length;
    return {
      c,
      cards,
      done,
      half,
      total: cards.length,
      pct: cards.length
        ? Math.round((100 * (done + half * 0.5)) / cards.length)
        : 0,
    };
  });
  const total = byChapter.reduce((n, x) => n + x.total, 0),
    done = byChapter.reduce((n, x) => n + x.done, 0),
    half = byChapter.reduce((n, x) => n + x.half, 0);
  return {
    byChapter,
    total,
    done,
    half,
    pct: total ? Math.round((100 * (done + half * 0.5)) / total) : 0,
  };
}
function completionCardHtml(s) {
  const status = completionStatus(s),
    selected = UI.completionSelected.includes(s.id);
  return `<div class="completion-card ${status} ${selected ? "selected" : ""}" data-completion-card="${s.id}"><div class="completion-art" style="aspect-ratio:${ratio(p())}">${imageHtml(s)}<div class="completion-tint"></div><div class="completion-tag-layer">${tags(
    p(),
    s,
  )
    .filter((tag) => tag !== "done" && tag !== "blank")
    .map(badge)
    .join(
      "",
    )}</div>${status === "green" ? '<span class="completion-check">✓</span>' : ""}<div class="completion-colors" title="Set completion status">${["red", "yellow", "green"].map((status) => `<button data-completion-status="${status}" data-card-id="${s.id}" class="${status}" title="${status === "red" ? "Not started" : status === "yellow" ? "In progress" : "Completed"}" aria-label="${status}"></button>`).join("")}</div></div><div class="completion-meta"><span>${esc(position(p(), s.id, store.state.settings.numbering))}</span>${s.reuseOf ? `<span class="completion-copy-label">${esc(copyTitle(s))}</span>` : ""}</div></div>`;
}
function completionSelect(id, multi = false, range = false) {
  const cards = chapterCards(p(), UI.completionChapterId).map((c) => c.id);
  if (range && UI.completionAnchor && cards.includes(UI.completionAnchor)) {
    const a = cards.indexOf(UI.completionAnchor),
      b = cards.indexOf(id);
    UI.completionSelected = [
      ...new Set([
        ...UI.completionSelected,
        ...cards.slice(Math.min(a, b), Math.max(a, b) + 1),
      ]),
    ];
  } else if (!multi) UI.completionSelected = [id];
  else
    UI.completionSelected = UI.completionSelected.includes(id)
      ? UI.completionSelected.filter((x) => x !== id)
      : [...UI.completionSelected, id];
  if (!range) UI.completionAnchor = id;
  $$("[data-completion-card]").forEach((el) =>
    el.classList.toggle(
      "selected",
      UI.completionSelected.includes(el.dataset.completionCard),
    ),
  );
}
function completionSetStatus(status, id) {
  if (!["red", "yellow", "green"].includes(status)) return;
  const ids =
    id == null
      ? [...UI.completionSelected]
      : UI.completionSelected.includes(id)
        ? UI.completionSelected
        : [id];
  if (!ids.length) return toast("Select at least one card");
  change("Set completion status", (state) => {
    for (const id of ids) {
      const c = item(id);
      if (c) setFamilyCompletion(p(), c, status);
    }
    const all = chapters().flatMap((x) => chapterCards(p(), x.id));
    p().completion = all.length
      ? Math.round(
          (all.reduce(
            (sum, c) =>
              sum +
              (completionStatus(c) === "green"
                ? 1
                : completionStatus(c) === "yellow"
                  ? 0.5
                  : 0),
            0,
          ) *
            100) /
            all.length,
        )
      : 0;
  });
}
function completionHtml() {
  const { byChapter, total, done, half, pct } = completionSummary(),
    active = byChapter.find((x) => x.c.id === UI.completionChapterId),
    sidebarWidth = Math.max(
      180,
      Math.min(420, Number(store.state.settings.completionSidebarWidth || 240)),
    );
  return `${toolbar()}<div class="completion-layout" style="--completion-sidebar-width:${sidebarWidth}px;--completion-chapter-font:${store.state.settings.completionChapterFont || 14}px"><aside class="completion-chapter-sidebar"><h2 class="display-font">Completion</h2><button class="completion-overview ${active ? "" : "selected"}" data-act="completion-overview">Overview <strong>${pct}%</strong></button><div class="completion-chapter-list">${byChapter
    .map(({ c, total, done, pct }) => {
      const info = chapterStatusInfo(c.storyboardStatus);
      return `<button class="completion-chapter-option ${c.parentId ? "completion-subchapter" : ""} ${active?.c.id === c.id ? "selected" : ""} ${info ? `completion-status-${info.asset}` : ""}" data-complete-chapter="${c.id}"><span class="completion-chapter-main"><span class="completion-chapter-title"><span class="completion-chapter-number">${chapterNumber(c)}</span><span class="completion-chapter-label">${esc(c.name)}</span></span><small>${pct}%</small></span><span class="completion-mini-progress"><i style="width:${pct}%"></i></span>${info ? `<img class="completion-status-sticker" src="assets/chapter-${info.asset}.png" alt="${info.label}" title="${info.label}">` : ""}</button>`;
    })
    .join(
      "",
    )}</div></aside><div class="completion-sidebar-resizer" data-completion-resizer role="separator" aria-orientation="vertical" aria-label="Resize chapter list" tabindex="0" title="Drag to resize chapter list"></div><main class="completion-content">${active ? `<div class="completion-content-header"><h2>${esc(active.c.name)}</h2><small>${active.pct}% · ${active.done} finished, ${active.half} in progress</small></div><div class="completion-batch">${["red", "yellow", "green"].map((x) => `<button class="completion-batch-btn ${x}" data-completion-status="${x}" aria-label="Mark selected cards ${x}" title="Mark selected cards ${x}"><span></span>${x === "red" ? "Not started" : x === "yellow" ? "In progress" : "Done"}</button>`).join("")}</div><div class="completion-card-grid lasso-surface" id="completion-grid" style="--completion-width:${UI.completionThumb}px">${active.cards.map(completionCardHtml).join("")}</div><footer class="completion-footer">Cmd/Ctrl-click or Shift-click to select multiple cards</footer>` : `<div class="completion-overview-main"><h1 class="display-font">Completion</h1><div class="completion-score">${pct}%</div><div class="progress-track"><div style="width:${pct}%"></div></div><p>${done} complete · ${half} in progress · ${total} total</p><div class="completion-overview-guide">Choose a chapter on the left to review its cards.</div></div>`}</main></div>`;
}

function quickLook() {
  if (!(UI.selected.length || UI.bucketSelected.length)) return;
  UI.quick = true;
  renderQuick();
}
function renderQuick() {
  $(".quick-overlay")?.remove();
  if (!UI.quick) return;
  const s = item(UI.selected[0] || UI.bucketSelected[0]);
  if (!s) return;
  const v = visual(p(), s),
    el = document.createElement("div");
  el.className = "overlay quick-overlay";
  el.innerHTML = `<div class="quick-card"><div class="quick-visual" style="--quick-ratio:${ratio(p())};--quick-width:${p().ratio === "9:16" ? 42.1875 : p().ratio === "4:3" ? 100 : 133.3333}vh;aspect-ratio:${ratio(p())}">${p().viewPrefs.boardMode==='cleanup'&&currentCleanup(p(),s).status==='ready'?CLEANUP.markup(s):imageHtml(s)}</div><div class="quick-caption"><strong>${position(p(), s.id) || ""} ${v.count > 1 ? ` · ${String.fromCharCode(65 + v.index)} (${v.count})` : ""}</strong>${s.modifiedOf&&!s.numberAsRegular ? `<p class="modified-label">${esc(modificationLabel(p(), s, store.state.settings.numbering))}</p>` : ""}${HL.caption(s.id, { quick: true })}<p>${esc(s.note || "")}</p><small>Space / Esc to close · A/D to browse · Q/E for variants</small></div></div>`;
  document.body.append(el);
  attachImages(el);
}
function printGeometry() {
  const landscape = UI.print.orientation === "landscape";
  return {
    width: landscape ? 841.89 : 595.28,
    height: landscape ? 595.28 : 841.89,
    margin: 26,
  };
}
function printPages(chapterId = null, cardIds = null) {
  const o = UI.print,
    g = printGeometry(),
    out = [],
    gap = 10 * o.spacing;
  for (const ch of chapters()) {
    if (chapterId && ch.id !== chapterId) continue;
    const cards = chapterCards(p(), ch.id).filter(
      (c) => !cardIds || cardIds.has(c.id),
    );
    if (!cards.length) continue;
    const projectLines = o.projectTitle
      ? wrapRuns([{ text: p().name }], g.width - 52, 14)
      : [];
    const chapterLines = o.chapterTitle
      ? wrapRuns([{ text: ch.name }], g.width - 52, 11)
      : [];
    const top =
      g.margin + projectLines.length * 19 + chapterLines.length * 16 + 12;
    const available = g.height - g.margin - 26 - top;
    if (available < 100)
      throw Error(
        "Project or chapter title leaves too little room to print cards. Shorten the title or hide it in Print.",
      );
    const layouts = layoutCards(p(), cards, g.width - 52, available, {
      cols: o.cols,
      rows: o.rows,
      gap,
      script: o.script,
      scriptFont: o.scriptFont,
      noteFont: o.noteFont,
      notes: o.notes,
      numbers: o.numbers,
      continuations: true,
      fillRows: true,
    });
    for (const layout of layouts) {
      const nums = layout.items.map((i) =>
        position(p(), i.card.id, store.state.settings.numbering),
      );
      out.push({
        chapter: ch,
        cards: layout.items.map((i) => i.card),
        layout,
        top,
        projectLines,
        chapterLines,
        range:
          nums.length === 1 ? String(nums[0]) : `${nums[0]}–${nums.at(-1)}`,
      });
    }
  }
  return out;
}
function printHtml() {
  const opt = UI.print,
    pages = printPages();
  return `${toolbar()}<div class="print-shell">${chapterSidebar({ print: true })}<main class="print-center"><div class="print-title"><h2>Final Printable</h2><small>${pages.length} page${pages.length !== 1 ? "s" : ""}</small></div><div id="paper-list" class="paper-list">${pages.map((page, i) => `<section data-print-chapter="${page.chapter.id}" class="paper measured-paper ${opt.orientation}" aria-label="Print page ${i + 1}"><canvas data-print-preview="${i}" aria-label="Storyboard print preview"></canvas></section>`).join("")}</div></main><aside class="print-options"><h3>Print layout</h3><div class="mini-switch"><button data-print-orientation="portrait" class="${opt.orientation === "portrait" ? "active" : ""}">Vertical</button><button data-print-orientation="landscape" class="${opt.orientation === "landscape" ? "active" : ""}">Horizontal</button></div><div class="two-cols"><label>Columns max<input type="number" min="1" max="6" data-print="cols" value="${opt.cols}"></label><label>Rows max<input type="number" min="1" max="8" data-print="rows" value="${opt.rows}"></label></div><label>Script<select data-print="script"><option value="none" ${opt.script === "none" ? "selected" : ""}>No script</option><option value="all" ${opt.script === "all" ? "selected" : ""}>All scripts</option><option value="spoken" ${opt.script === "spoken" ? "selected" : ""}>Spoken text</option></select></label><label>Script font size<input type="range" min="8" max="22" data-print="scriptFont" value="${opt.scriptFont}"></label><label>Spacing<input type="range" min="0.5" max="2" step=".1" data-print="spacing" value="${opt.spacing}"></label><label>Note font size<input type="range" min="8" max="22" data-print="noteFont" value="${opt.noteFont}"></label><div class="print-checks">${[
    ["notes", "Notes"],
    ["tags", "Tags"],
    ["numbers", "Card numbers"],
    ["projectTitle", "Project title"],
    ["chapterTitle", "Chapter title"],
    ["range", "Card range"],
    ["pageNum", "Page number"],
    ["blankWhite", "Blank cards white"],
  ]
    .map(
      ([key, n]) =>
        `<label><input type="checkbox" data-print="${key}" ${opt[key] ? "checked" : ""}> ${n}</label>`,
    )
    .join(
      "",
    )}</div><div class="print-export"><button data-act="print-pdf">Export PDF</button><button data-act="print-png">Export PNG pages</button><button data-act="print-cards">Export cards as PNGs</button></div></aside></div>`;
}
async function drawPrintPage(canvas, page, index, total, dpi = 144) {
  const o = { ...UI.print },
    g = printGeometry(),
    scale = dpi / 72;
  canvas.width = Math.ceil(g.width * scale);
  canvas.height = Math.ceil(g.height * scale);
  const cx = canvas.getContext("2d");
  cx.scale(scale, scale);
  cx.fillStyle = "#fff";
  cx.fillRect(0, 0, g.width, g.height);
  let headerY = g.margin - 10;
  drawLines(cx, page.projectLines, g.margin, headerY, 14, 19);
  headerY += page.projectLines.length * 19;
  drawLines(cx, page.chapterLines, g.margin, headerY, 11, 16);
  const { layout } = page,
    gap = 10 * o.spacing;
  for (let i = 0; i < layout.items.length; i++) {
    const item = layout.items[i],
      s = item.card,
      x = g.margin + (i % layout.cols) * (layout.cellW + gap),
      y = page.top + Math.floor(i / layout.cols) * (layout.cellH + gap);
    if (!item.continuation) {
      const temp = document.createElement("canvas");
      temp.width = Math.ceil(item.artW * scale);
      temp.height = Math.ceil(item.artH * scale);
      await drawVisual(temp, p(), s, {
        blankWhite: !!s.note?.trim() || o.blankWhite,
      });
      cx.drawImage(temp, x, y, item.artW, item.artH);
      drawBlankNoteOnCanvas(cx, s, x, y, item.artW, item.artH);
      if (o.tags)
        drawExportTags(cx, s, x, y, item.artW, item.artH, { inset: 0.025 });
      cx.strokeStyle = "#4b4c54";
      cx.lineWidth = 0.65;
      cx.strokeRect(x, y, item.artW, item.artH);
    }
    const textX = x + item.textX,
      textY = y + (layout.side ? 0 : item.artH + 4);
    let cursor = textY;
    if (o.numbers) {
      cx.fillStyle = "#555";
      cx.font = "10px sans-serif";
      cx.textBaseline = "top";
      cx.fillText(
        `${position(p(), s.id, store.state.settings.numbering)}${item.continuation ? " · continued" : ""}`,
        textX,
        cursor + 2,
      );
      cursor += item.numberH;
    }
    if (item.script.length) {
      drawLines(
        cx,
        item.script,
        textX + 6,
        cursor + 6,
        o.scriptFont,
        o.scriptFont * 1.45,
      );
      cursor += item.scriptH;
    }
    if (item.note.length) {
      if (o.script !== "none") {
        cx.strokeStyle = "#aaa";
        cx.lineWidth = 0.6;
        cx.strokeRect(textX, cursor, item.textW, item.noteH);
      }
      drawLines(
        cx,
        item.note,
        textX + 8,
        cursor + 8,
        o.noteFont,
        o.noteFont * 1.45,
      );
    }
  }
  cx.fillStyle = "#555";
  cx.font = "9px sans-serif";
  cx.textBaseline = "alphabetic";
  if (o.range) cx.fillText(page.range, g.margin, g.height - g.margin);
  if (o.pageNum) {
    const value = `${index + 1} / ${total}`;
    cx.fillText(
      value,
      g.width - g.margin - cx.measureText(value).width,
      g.height - g.margin,
    );
  }
  return canvas;
}
async function renderPrintPreviews(token) {
  try {
    const pages = printPages();
    for (let i = 0; i < pages.length; i++) {
      if (token !== renderToken) return;
      const canvas = $(`[data-print-preview="${i}"]`);
      if (canvas) {
        await drawPrintPage(canvas, pages[i], i, pages.length, 110);
        if (token === renderToken) canvas.dataset.ready = "true";
      }
    }
  } catch (e) {
    toast("Print preview: " + e.message);
  }
}

// ---------- Export and compatibility ----------
const pixels = (r) =>
  r === "9:16" ? [1080, 1920] : r === "4:3" ? [1920, 1440] : [1920, 1080];
function drawExportTags(
  ctx,
  story,
  x,
  y,
  width,
  height,
  { inset = 0.025 } = {},
) {
  if (!UI.print.tags) return;
  const visible = tags(p(), story).slice(0, 4);
  if (!visible.length) return;
  const size = Math.max(16, Math.min(width * 0.072, height * 0.15)),
    gap = Math.max(3, size * 0.12),
    left = x + width - width * inset - size,
    top = y + height * inset;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.floor(size * 0.65)}px sans-serif`;
  visible.forEach((tag, i) => {
    const xx = left - i * (size + gap);
    ctx.fillStyle = color(tag);
    ctx.fillRect(xx, top, size, size);
    ctx.strokeStyle = "#46515b";
    ctx.lineWidth = Math.max(1, size * 0.025);
    ctx.strokeRect(xx, top, size, size);
    ctx.fillStyle = "#202a35";
    ctx.fillText(symbol(tag), xx + size / 2, top + size / 2, size * 0.8);
  });
  ctx.restore();
}
function drawBlankNoteOnCanvas(ctx, story, x, y, w, h) {
  if (!visual(p(), story).blank || !(story.note || "").trim()) return;
  // Use identical centered typography for PDF, page PNG, and individual card PNG.
  const font = Math.max(
    9,
    Math.min(44, ((store.state.settings.noteSize || 14) * w) / 220),
  );
  const lh = font * 1.34,
    maxW = w * 0.87,
    maxH = h * 0.81,
    maxLines = Math.max(1, Math.floor(maxH / lh));
  const lines = [];
  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.fillRect(x, y, w, h);
  ctx.font = `${font}px sans-serif`;
  ctx.fillStyle = "#292a2e";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const paragraph of story.note.trim().split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxW) {
        lines.push(line);
        line = word;
      } else line = next;
      // Ensure even a single oversized word cannot extend beyond the frame.
      if (ctx.measureText(line).width > maxW) {
        let fragment = "";
        for (const ch of line) {
          if (fragment && ctx.measureText(fragment + ch).width > maxW) {
            lines.push(fragment);
            fragment = ch;
          } else fragment += ch;
        }
        line = fragment;
      }
    }
    lines.push(line);
  }
  const clipped = lines.length > maxLines,
    visible = lines.slice(0, maxLines);
  if (clipped && visible.length) {
    let last = visible.at(-1);
    while (last && ctx.measureText(last + "…").width > maxW)
      last = last.slice(0, -1);
    visible[visible.length - 1] = (last || "") + "…";
  }
  const first = clipped
    ? y + h * 0.105 + lh / 2
    : y + h / 2 - ((visible.length - 1) * lh) / 2;
  ctx.beginPath();
  ctx.rect(x + 2, y + 2, w - 4, h - 4);
  ctx.clip();
  visible.forEach((line, i) =>
    ctx.fillText(line, x + w / 2, first + i * lh, maxW),
  );
  ctx.restore();
}
async function renderStoryboardPNG(card){const project=p(),visualId=visual(project,card).variant?.assetId;if(visualId&&!(await assetUrl(visualId)))throw Error('The storyboard image is missing. Reimport it before exporting.');const canvas=document.createElement('canvas');[canvas.width,canvas.height]=pixels(project.ratio);await drawVisual(canvas,project,card,{blankWhite:!!card.note?.trim()||UI.print.blankWhite});drawBlankNoteOnCanvas(canvas.getContext('2d'),card,0,0,canvas.width,canvas.height);drawExportTags(canvas.getContext('2d'),card,0,0,canvas.width,canvas.height,{inset:.022});return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Could not render storyboard.')),'image/png'));}
let cardExportBusy=false,cardExportTask=null,closeProgress=null;
async function exportCards(selectedCards=null){
 if(cardExportBusy)return false;cardExportBusy=true;const overlay=document.createElement('div');overlay.className='export-progress-overlay';overlay.setAttribute('role','status');overlay.innerHTML='<section><h2>Saving storyboard cards…</h2><p data-card-export-progress>Preparing…</p><progress></progress></section>';document.body.append(overlay);
 try{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));cardExportTask=exportCardsNow(selectedCards);return await cardExportTask;}finally{cardExportBusy=false;cardExportTask=null;overlay.remove();}
}
function cardExportProgress(done,total){closeProgress?.(done,total);const el=document.querySelector('[data-card-export-progress]'),bar=document.querySelector('.export-progress-overlay progress');if(el)el.textContent=`${done} / ${total} cards`;if(bar){bar.max=total;bar.value=done;}}
async function exportCardsNow(selectedCards = null) {
  const cs = Array.isArray(selectedCards) ? selectedCards : ordered(p());
  if (!cs.length) return toast("No cards to export");
  const folder = await chooseExportDirectory();
  if (folder === null) return;
  const dirs = chapterDirectories(p()),
    dims = pixels(p().ratio);
  for (let i = 0; i < cs.length; i++) {
    cardExportProgress(i,cs.length);const blob=await renderStoryboardPNG(cs[i]);
    await saveBlob(
      blob,
      `${dirs.find((d) => d.chapterId === cs[i].chapterId)?.path || "Cards"}/${renderName(
        p().fileNaming,
        "card",
        namingContext(
          p(),
          p().chapters.find((ch) => ch.id === cs[i].chapterId),
          cs[i],
        ),
        "png",
      )}`,
      folder,
    );
  }
  toast(
    p().studioLink?.directory
      ? `${cs.length} cards saved in the selected export folder`
      : `${cs.length} cards exported`,
  );
}
function dataUrlBytes(url) {
  const bin = atob(url.split(",")[1]);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function buildPdfFromJpegs(images, landscape) {
  const enc = new TextEncoder(),
    objects = [];
  const pages = images.length;
  let no = 3,
    kids = [];
  for (let i = 0; i < pages; i++) {
    kids.push(`${no} 0 R`);
    no += 3;
  }
  objects[1] = enc.encode("<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = enc.encode(
    `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`,
  );
  no = 3;
  for (const im of images) {
    const pw = landscape ? 841.89 : 595.28,
      ph = landscape ? 595.28 : 841.89;
    objects[no] = enc.encode(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${no + 1} 0 R >> >> /Contents ${no + 2} 0 R >>`,
    );
    const h = enc.encode(
        `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`,
      ),
      end = enc.encode("\nendstream"),
      blob = new Uint8Array(h.length + im.bytes.length + end.length);
    blob.set(h);
    blob.set(im.bytes, h.length);
    blob.set(end, h.length + im.bytes.length);
    objects[no + 1] = blob;
    const body = `q\n${pw} 0 0 ${ph} 0 0 cm\n/Im0 Do\nQ\n`;
    objects[no + 2] = enc.encode(
      `<< /Length ${enc.encode(body).length} >>\nstream\n${body}endstream`,
    );
    no += 3;
  }
  const chunks = [enc.encode("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n")],
    offsets = [0];
  let pos = chunks[0].length;
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = pos;
    const start = enc.encode(`${i} 0 obj\n`),
      end = enc.encode("\nendobj\n");
    chunks.push(start, objects[i], end);
    pos += start.length + objects[i].length + end.length;
  }
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++)
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF`;
  chunks.push(enc.encode(xref));
  return new Blob(chunks, { type: "application/pdf" });
}
async function exportPages(type, chapterId = null, currentOnly = false) {
  const cardIds =
    currentOnly && chapterId === UI.chapterId
      ? new Set(boardLayout().items.map((i) => i.card.id))
      : null;
  const pages = printPages(chapterId, cardIds);
  if (!pages.length) return toast("Nothing to print");
  const folder = await chooseExportDirectory();
  if (folder === null) return;
  try {
    const images = [];
    for (let n = 0; n < pages.length; n++) {
      const canvas = await drawPrintPage(
        document.createElement("canvas"),
        pages[n],
        n,
        pages.length,
        UI.print.dpi,
      );
      if (type === "png")
        await saveBlob(
          await new Promise((r) => canvas.toBlob(r, "image/png")),
          renderName(
            p().fileNaming,
            "sheet",
            namingContext(
              p(),
              chapterId ? p().chapters.find((ch) => ch.id === chapterId) : null,
              null,
              n + 1,
            ),
            "png",
          ),
          folder,
        );
      else
        images.push({
          w: canvas.width,
          h: canvas.height,
          bytes: dataUrlBytes(canvas.toDataURL("image/jpeg", 0.94)),
        });
    }
    if (type === "pdf")
      await saveBlob(
        buildPdfFromJpegs(images, UI.print.orientation === "landscape"),
        renderName(
          p().fileNaming,
          "sheet",
          namingContext(
            p(),
            chapterId ? p().chapters.find((ch) => ch.id === chapterId) : null,
          ),
          "pdf",
        ),
        folder,
      );
    toast("Export complete");
  } catch (e) {
    toast("Export failed: " + e.message);
  }
}

// ---------- Events ----------
const actions = {
 "rename-family-confirm":()=>{change("Rename modification family",()=>renameFamilyInOrder(p(),item(UI.contextCardId)));closeModal();toast("Family renamed. Update the corresponding CSP/PSD folder names.");},
 "workflow-manual":()=>modal('Workflow rules',workflowManual,[{text:'Close',action:'close-modal',primary:true}]),
 "board-toggle":()=>actions[p().viewPrefs.boardMode==='cleanup'?'board-storyboards':'board-cleanup'](),
 "cleanup-missing":()=>CLEANUP.showMissing(),
 "cleanup-help":()=>CLEANUP.help(),
 "cleanup-restore-selected":()=>CLEANUP.archiveAction("cleanup-restore",UI.cleanupArchiveSelected).then(()=>{UI.cleanupArchiveSelected=[];render();}).catch(e=>toast(String(e.message||e))),
 "cleanup-purge-selected":()=>CLEANUP.archiveAction("cleanup-purge",UI.cleanupArchiveSelected).then(()=>{UI.cleanupArchiveSelected=[];render();}).catch(e=>toast(String(e.message||e))),
 "board-storyboards":()=>change('Show storyboards',()=>{p().viewPrefs.boardMode='storyboard';}),
 "board-cleanup":async()=>{if(!(await verifyProjectRoot()))return;change('Show cleanups',()=>{p().viewPrefs.boardMode='cleanup';});void CLEANUP.refresh().then(render).catch(e=>toast(e.message||String(e)));},
 "sheet-layouts":()=>SHEETS.show(),
 "sheet-layout-add":()=>SHEETS.add(),
 "sheet-layout-remove":el=>SHEETS.remove(el.dataset.id),
  perform: async () => {
    if(!(await verifyProjectRoot()))return;
    TIMING.rematch();
    UI.screen = "perform";
    render();
    await STUDIO.refresh();
  },
  completion: () => {
    UI.screen = "completion";
    UI.completionThumb = Number(store.state.settings.completionThumb || 220);
    render();
  },
  "completion-overview": () => {
    UI.completionChapterId = null;
    UI.completionSelected = [];
    render();
  },
  "apply-managed-tag":el=>{const id=el.dataset.tag,targets=(UI.tagTargets||[]).map(item).filter(Boolean),remove=targets.every(c=>(c.tags||[]).includes(id));change("Change selected card tags",()=>{for(const c of targets){c.tags=remove?(c.tags||[]).filter(t=>t!==id):[...new Set([...(c.tags||[]),id])];}});closeModal();},
  "manage-project-tags": () =>
    modal(
      "Manage tags",
      `<div class="tag-choices tag-manager">${[...Object.keys(tagDefs),...(p().customTags||[]).map(t=>t.id)].map(id=>{const t=tagDefinition(p(),id),automatic=!!tagDefs[id]&&!["animation","review"].includes(id),targets=UI.tagTargets||[];return `<div class="tag-row"><span style="color:${esc(t.color)}">${esc(t.icon)} ${esc(t.name)}</span><small>${tagDefs[id]?(automatic?'Automatic status':'Built-in tag'):'Custom tag'}</small>${targets.length&&!automatic?`<button data-act="apply-managed-tag" data-tag="${esc(id)}">Apply / remove</button>`:''}<button data-act="open-tag-edit" data-tag-edit="${esc(id)}" aria-label="Edit ${esc(t.name)}">✎</button></div>`;}).join('')}</div><button data-act="create-tag-dialog">＋ Create new tag</button>`,
      [{ text: "Close", action: "close-modal", primary: true }],
    ),
  "prepare-audio":()=>{UI.prepareStep="audio";render();},
  "prepare-match-timing":async()=>{UI.matchingAudio=true;render();try{await STUDIO.matchTiming();}catch(error){toast(String(error.message||error));}finally{UI.matchingAudio=false;render();}},
  "prepare-images": () => {
    UI.prepareStep = "images";
    render();
  },
  "prepare-export": () => {
    UI.prepareStep = "export";
    render();
  },

  "prepare-video": () => {
    UI.screen = "assembly";
    render();
    TIMING.rematch();
    (p().studioLink?.directory ? STUDIO.refresh() : ASSEMBLY.checkAll()).catch(
      (e) => toast(e.message || String(e)),
    );
  },
  "studio-root": () =>
    STUDIO.choose().catch((e) => toast(e.message || String(e))),
  "studio-refresh": () =>
    STUDIO.refresh().catch((e) => toast(e.message || String(e))),
  "file-naming": showFileNaming,
  "settings-storyboard": () => {
    store.state.settings.settingsTab = "storyboard";
    store.save();
    showSettings();
  },
  "settings-highlight": () => {
    store.state.settings.settingsTab = "highlight";
    store.save();
    showSettings();
  },
  "asset-link-folder": () => assetFolders.link().catch((e) => toast(e.message)),
  "asset-check-folders": () =>
    assetFolders.check().catch((e) => toast(e.message)),
  "asset-relink-folder": (el) =>
    assetFolders.relink(el.dataset.folderId).catch((e) => toast(e.message)),
  browser: () => leave(),
  menu: () => (UI.menu ? closeMenu() : openMenu()),
  "browser-settings": showSettings,
  "browser-info": () => {
    change(
      "Project info visibility",
      (s) => (s.settings.browserInfo = !s.settings.browserInfo),
    );
  },
  "browser-shortcuts": showShortcuts,
  "project-new": newProjectDialog,
  "folder-new": () => folderDialog(),
  "folder-back": () => {
    pageSound("back");
    UI.folderId = "root";
    UI.selectedBrowser = [];
    UI.focusBrowser = 0;
    render();
  },
  "project-import": () => {
    files.accept = ".sshltest,.storyboardstudio";
    files.multiple = true;
    files.dataset.intent = "project";
    files.click();
  },
  "browser-clear-selection": () => {
    UI.selectedBrowser = [];
    render();
  },
  "browser-create-for-selected": () => {
    UI.pendingFolderProjects = selectedProjectIds();
    if (UI.pendingFolderProjects.length) folderDialog();
  },
  "browser-move-selected": () => {
    const ids = selectedProjectIds();
    const destination = $("#browser-move-destination")?.value;
    if (!ids.length || !store.state.folders.some((f) => f.id === destination))
      return toast("Choose a destination folder");
    change("Move selected projects to folder", (s) => {
      for (const project of s.projects)
        if (ids.includes(project.id)) project.folderId = destination;
    });
    UI.selectedBrowser = [];
    UI.focusBrowser = 0;
    render();
  },
  "export-selected": async () => {
    const id = UI.selectedBrowser.find((x) =>
      store.state.projects.some((p) => p.id === x),
    );
    const s = store.state.projects.find((p) => p.id === id);
    if (s) await exportProject(s);
    else toast("Select a project first");
  },
  storyboard: () => {
    UI.screen = "storyboard";
    UI.modal = null;
    render();
  },
  highlighter: () => {
    UI.screen = "highlighter";
    UI.modal = null;
    render();
  },
  "panel-highlighter": () => {
    UI.rightMode = "highlighter";
    render();
  },
  "toggle-linked-text":()=>preserveBoardAnchor(()=>{p().viewPrefs.linkedTextVisible=p().viewPrefs.linkedTextVisible===false;},"Linked text visibility"),
  "toggle-chapters": () => {
    UI.left = !UI.left;
    render();
  },
  "toggle-holding": () => {
    UI.right = !UI.right;
    render();
  },
  "panel-holding": () => {
    UI.rightMode = "holding";
    render();
  },
  "panel-assets": () => {
    UI.rightMode = "assets";
    render();
    if (window.__TAURI__?.core?.invoke)
      assetFolders.check(true).catch((e) => toast(e.message));
  },
  "edit-note": (e) => editCardNote(e.dataset.id),
  "board-prev": () => setBoardPage(boardPage() - 1),
  "board-next": () => setBoardPage(boardPage() + 1),
  "board-add-page": () => blankAt(cardsInChapter().length),
  "toggle-notes": toggleNotes,
  "new-sticky": () => {
    change("Create sticky", (s) => {
      p().stickyNotes.push({
        id: uid("sticky"),
        text: "",
        color: "#fff0b9",
        chapterId: UI.chapterId,
        closed: false,
      });
    });
  },
  "toggle-stickies": () => {
    UI.showStickies = !UI.showStickies;
    render();
  },
  "import-image": (el) => {
    files.accept = "image/*";
    files.multiple = true;
    files.dataset.intent = "images";
    const fromHolding = !!el?.closest(".holding-sidebar");
    files.dataset.destination = fromHolding
      ? UI.rightMode === "assets"
        ? "assets"
        : UI.bucket
      : "stories";
    files.click();
  },
  "add-chapter": () => {
    const num = chapters().filter((c) => !c.parentId).length + 1;
    change("Add chapter", (s) => {
      const c = chapter(`Chapter ${num}`);
      p().chapters.push(c);
      UI.chapterId = c.id;
      UI.renamingChapterId = c.id;
    });
    const input = $(`[data-chapter-rename="${UI.renamingChapterId}"]`);
    input?.focus();
    input?.select();
  },
  "archive-sticky": (e) => archiveSticky(e.dataset.id),
  "sticky-scope": (e) => {
    const id = e.dataset.id,
      scope = e.dataset.stickyScope;
    change("Change sticky visibility", () => {
      const note = p().stickyNotes.find((n) => n.id === id);
      if (note) note.chapterId = scope === "project" ? null : UI.chapterId;
    });
  },
  "delete-archived-sticky": (e) => {
    UI.deleteStickyId = e.dataset.id;
    modal(
      "Delete archived sticky?",
      `<p>This permanently deletes the archived sticky. You can undo this action during this session.</p>`,
      [
        { text: "Cancel", action: "close-modal" },
        { text: "Delete", action: "confirm-delete-sticky", danger: true },
      ],
    );
  },
  "restore-sticky": (e) =>
    change("Restore sticky", (s) => {
      const n = p().archivedStickies.find((x) => x.id === e.dataset.id);
      if (n) {
        p().stickyNotes.push(n);
        p().archivedStickies = p().archivedStickies.filter(
          (x) => x.id !== n.id,
        );
      }
    }),
  "close-modal": closeModal,
  "confirm-new-project": () => {
    const nm = $("#project-title")?.value.trim();
    if (!nm) {
      $("#project-title")?.focus();
      return;
    }
    const r = $('input[name="project-ratio"]:checked')?.value || "16:9";
    const nw = newProject(nm, r, UI.folderId);
    change("Create project", (s) => s.projects.push(nw));
    closeModal();
    enterProject(nw.id);
  },
  "create-folder": () => {
    const name = $("#folder-name")?.value.trim();
    if (!name) return toast("Enter folder name");
    change("Create folder", (s) => {
      const id = uid("folder");
      s.folders.push({
        id,
        name,
        hue: +($("#folder-hue")?.value || 350),
        parentId: UI.folderId,
        stickers: [],
      });
      for (const p of s.projects)
        if ((UI.pendingFolderProjects || []).includes(p.id)) p.folderId = id;
    });
    UI.pendingFolderProjects = [];
    closeModal();
  },
  "save-folder": () => {
    const name = $("#folder-name")?.value.trim();
    if (!name) return;
    change("Edit folder", (s) => {
      const f = s.folders.find((f) => f.id === UI.editFolderId);
      if (f) {
        f.name = name;
        f.hue = +($("#folder-hue")?.value || 350);
      }
    });
    closeModal();
  },
  "toggle-stickies-ui": () => {
    UI.showStickies = !UI.showStickies;
    render();
  },
  "archive-kind": (e) => {
    UI.archiveKind = e.dataset.kind;
    UI.cleanupArchiveSelected = [];
    render();
  },
  "lost-scope": (e) => {
    UI.lostScope = e.dataset.scope;
    render();
  },
  "create-tag-dialog": newTagDialog,
  "confirm-tag": () => {
    const name = $("#tag-name")?.value.trim();
    if (!name) return;
    change("Create tag", (s) => {
      const id = uid("tag");
      p().customTags.push({
        id,
        name,
        color: $("#tag-color").value,
        icon: $("#tag-icon").value,
      });
      for (const cardId of tagTargetIds()) {
        const target = item(cardId);
        if (target) {
          target.tags ||= [];
          target.tags = [...new Set([...target.tags, id])];
        }
      }
    });
    closeModal();
  },
  "open-tag-edit": (el) => {
    UI.contextTagId = el.dataset.tagEdit;
    chooseContext("edit-tag");
  },
  "add-card-tag": (e) => quickTagMenu(e),
  "reset-filter": () => {
    UI.filterTag = "all";
    UI.highlightTag = "none";
    UI.highlightIndex = -1;
    const f = $("#filter-select"),
      h = $("#highlight-select");
    if (f) f.value = "all";
    if (h) h.value = "none";
    updateBehindModal();
  },
  "apply-filter": () => {
    UI.filterTag = $("#filter-select")?.value || "all";
    UI.highlightTag = $("#highlight-select")?.value || "none";
    UI.highlightIndex = -1;
    closeModal();
    render();
  },
  "highlight-jump": () => {
    closeModal();
    highlightNext();
  },
  "history-modal": () =>
    modal(
      "Action History (this session)",
      `<div class="history-list">${
        store.session.length
          ? store.session
              .slice(0, 120)
              .map(
                (e) =>
                  `<div><small>${new Date(e.at).toLocaleTimeString()}</small> ${esc(e.label)}</div>`,
              )
              .join("")
          : "No actions yet."
      }</div>`,
      [{ text: "Close", action: "close-modal" }],
    ),
  "print-pdf": () => exportPages("pdf"),
  "print-png": () => exportPages("png"),
  "print-cards": ()=>exportCards().catch(e=>toast(e.message||String(e))),
};
function chooseContext(act) {
 if(act==='rename-family'){document.querySelector('.context-pop')?.remove();const copy=structuredClone(p()),ids=renameFamilyInOrder(copy,item(UI.contextCardId));const rows=ids.map(id=>({before:displayNumber(p(),id,store.state.settings.numbering),after:displayNumber(copy,id,store.state.settings.numbering)}));modal('Rename in order','<p>This updates the entire Slight modify family. Permanent IDs and script/cleanup connections stay with their cards.</p><table><thead><tr><th>Current</th><th>New</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.before)+'</td><td>'+esc(r.after)+'</td></tr>').join('')+'</tbody></table><p><strong>Update the corresponding CSP/PSD folder names afterward.</strong> Managed project filenames update on the next save.</p>',[{text:'Cancel',action:'close-modal'},{text:'Rename family',action:'rename-family-confirm',primary:true}]);return;}
 if(act==='card-tags'){document.querySelector('.context-pop')?.remove();UI.tagTargets=UI.selected.includes(UI.contextCardId)?[...UI.selected]:[UI.contextCardId];actions['manage-project-tags']();return;}

 if(act==='make-regular'){document.querySelector('.context-pop')?.remove();change('Make regular card',()=>promoteModification(item(UI.contextCardId)));return;}

 if(['cleanup-restore-selected','cleanup-purge-selected'].includes(act)){document.querySelector('.context-pop')?.remove();actions[act]();return;}
 if(act.startsWith('cleanup-')){document.querySelector('.context-pop')?.remove();void CLEANUP.action(act,UI.contextCardId).catch(e=>toast(e.message||String(e)));return;}
 if(act==="remove-card-script"){
  document.querySelector(".context-pop")?.remove();
  const id=UI.contextScriptCardId;
  change("Remove linked text",()=>{for(const ch of p().chapters){const h=ch.highlighter;if(!h)continue;h.assignments=h.assignments.filter(a=>a.cardId!==id);h.nextExistingCardId=id;}});return;
 }

  const id = UI.contextCardId,
    selected = UI.selectionZone === "bucket" ? UI.bucketSelected : UI.selected;
  $(".context-pop")?.remove();
  if (act === "turn-blank") {
    change("Turn cards blank", () => {
      for (const cardId of selected) {
        const c = item(cardId);
        if (c) {
          c.variants = [];
          c.blank = true;
          c.activeVariant = 0;
          c.reuseOf = null;
          c.modifiedOf = null;
          c.completionStatus = "red";
        }
      }
    });
    return;
  }
  if (act === "quick-create-tag") {
    newTagDialog();
    return;
  }
  if (act === "quick-tag-done") {
    const targets = tagTargetIds().map(item).filter(Boolean);
    const next = targets.every((x) => completionOf(p(), x) === "green")
      ? "red"
      : "green";
    if (targets.length)
      change("Set Done on selected cards", () =>
        targets.forEach((x) => setFamilyCompletion(p(), x, next)),
      );
    return;
  }
  if (act === "quick-tag-animation" || act === "quick-tag-review") {
    const tag = act.split("-").at(-1),
      targets = tagTargetIds().map(item).filter(Boolean),
      add = !targets.every((x) => (x.tags || []).includes(tag));
    change("Set " + tag + " on selected cards", () => {
      for (const target of targets) {
        target.tags ||= [];
        target.tags = add
          ? [...new Set([...target.tags, tag])]
          : target.tags.filter((x) => x !== tag);
      }
    });
    return;
  }
  if (act.startsWith("quick-tag-custom:")) {
    const tag = act.split(":")[1],
      targets = tagTargetIds().map(item).filter(Boolean),
      add = !targets.every((x) => (x.tags || []).includes(tag));
    change("Set custom tag on selected cards", () => {
      for (const target of targets) {
        target.tags ||= [];
        target.tags = add
          ? [...new Set([...target.tags, tag])]
          : target.tags.filter((x) => x !== tag);
      }
    });
    return;
  }
  if (act === "edit-tag") {
    const t = tagDefinition(p(),UI.contextTagId);
    if (!t) return;
    modal(
      "Edit Tag",
      `<label>Name<input id="edit-tag-name" maxlength="80" ${tagDefs[UI.contextTagId]?'disabled':''} value="${esc(t.name)}"></label><label>Color <div class="tag-color-field"><input type="color" id="edit-tag-color" value="${esc(t.color || "#79a9d9")}"><span class="tag-color-preview" id="edit-tag-color-preview" style="--tag-preview:${t.color || "#79a9d9"}">Aa</span></div></label><label>Symbol<input id="edit-tag-icon" maxlength="32" value="${esc(t.icon||'◆')}" placeholder="Paste a symbol or emoji"></label>`,
      [
        ...(!tagDefs[UI.contextTagId]?[{ text: "Delete tag", action: "request-delete-tag", danger: true }]:[]),
        { text: "Cancel", action: "close-modal" },
        { text: "Save", action: "confirm-edit-tag", primary: true },
      ],
    );
    return;
  }
  if (act === "delete-tag") {
    if(tagDefs[UI.contextTagId])return;
    const tag = UI.contextTagId;
    modal(
      "Delete custom tag?",
      `<p>Delete <strong>${esc(label(tag))}</strong> from the project and all its cards?</p>`,
      [
        { text: "Cancel", action: "close-modal" },
        { text: "Delete", action: "confirm-delete-tag", danger: true },
      ],
    );
    return;
  }
  if (act === "variant-add" || act === "replace-card") {
    files.accept = "image/*";
    files.multiple = false;
    files.dataset.intent = act === "variant-add" ? "variant" : "replace";
    files.dataset.id = id;
    files.click();
    return;
  }
  if (act === "slight-modify" || act === "duplicate-card") {
    independentCopy(id, act === "slight-modify" ? "modify" : "duplicate").catch(
      (e) => toast(e.message),
    );
    return;
  }
  if (act === "reuse") {
    const s = item(id);
    if (!s) return;
    change("Make reusable copy", (x) => {
      const source = sourceCard(p(), s),
        c = card(s.chapterId);
      c.reuseOf = source.id;
      c.reuseIndex =
        Math.max(
          0,
          ...allCards(p())
            .filter((x) => x.reuseOf === source.id)
            .map((x) => Number(x.reuseIndex) || 0),
        ) + 1;
      c.blank = s.blank;
      c.activeVariant = s.activeVariant;
      c.completionStatus = completionOf(p(), source);
      p().stories.splice(p().stories.indexOf(s) + 1, 0, c);
    });
  }
  if (act === "variant-extract") {
    const s = item(id);
    if (!s) return;
    change("Extract variant", (x) => {
      const v = visual(p(), s);
      if (!v.variant) return;
      const c = card(s.chapterId, v.variant.assetId);
      p().stories.splice(p().stories.indexOf(s) + 1, 0, c);
    });
  }
  if (act === "blank-card")
    change("Turn blank", (x) => {
      const s = item(id);
      s.blank = true;
      s.variants = [];
      s.reuseOf = null;
    });
  if (act === "move-unassigned") transfer(selected, "unassigned");
  if (act === "move-lost") transfer(selected, "lost");
  if (act === "move-archived") transfer(selected, "archived");
  if (act === "delete-cards") deleteSelected();
  if (act.startsWith("chapter-status-")) {
    const status = act.slice("chapter-status-".length);
    change("Set chapter storyboard status", () => {
      const ch = p().chapters.find((c) => c.id === UI.contextChapterId);
      if (ch)
        ch.storyboardStatus =
          status === "clear" || ch.storyboardStatus === status ? null : status;
    });
    return;
  }
  if (act === "chapter-rename") return renameChapter(UI.contextChapterId);
  if (act === "chapter-page-export") {
    exportPages("png", UI.contextChapterId, true).catch((e) =>
      toast(e.message),
    );
    return;
  }
  if (act === "chapter-cards-export") {
    exportCards(chapterCards(p(), UI.contextChapterId)).catch((e) =>
      toast(e.message),
    );
    return;
  }
  if (act === "subchapter-add") {
    const parent = p().chapters.find((c) => c.id === UI.contextChapterId),
      index = p().chapters.indexOf(parent);
    change("Add subchapter", (x) => {
      const c = chapter(`Chapter ${chapterNumber(parent)}.1`, parent.id);
      p().chapters.splice(index + 1, 0, c);
      UI.chapterId = c.id;
      UI.renamingChapterId = c.id;
    });
    const input = $(`[data-chapter-rename="${UI.renamingChapterId}"]`);
    input?.focus();
    input?.select();
  }
  if (act === "chapter-unused")
    change("Move unused chapter", (x) => {
      const c = p().chapters.find((c) => c.id === UI.contextChapterId);
      if (!c) return;
      if (!c.unused) {
        if (
          chapters().filter((x) => !x.parentId).length <= 1 &&
          !p().chapters.some((x) => x.parentId === c.id)
        )
          return toast("Keep an active chapter");
        for (const child of p().chapters.filter((x) => x.parentId === c.id)) {
          child.parentId = c.parentId || null;
          child.unused = false;
        }
        c.unused = true;
        c.parentId = null;
        if (UI.chapterId === c.id)
          UI.chapterId = chapters().find((x) => x.id !== c.id)?.id || null;
      } else {
        c.unused = false;
        c.parentId = null;
        UI.chapterId = c.id;
      }
    });
  if (act === "chapter-delete") deleteChapter(UI.contextChapterId);
  if (act === "project-pin" || act === "folder-pin") {
    const x =
      store.state.projects.find((x) => x.id === UI.contextBrowserId) ||
      store.state.folders.find((x) => x.id === UI.contextBrowserId);
    if (x)
      change("Pin item", (s) => {
        x.pinned = !x.pinned;
      });
  }
  if (act === "project-thumbnail") {
    files.accept = "image/*";
    files.multiple = false;
    files.dataset.intent = "thumbnail";
    files.dataset.id = UI.contextBrowserId;
    files.click();
    return;
  }
  if (act === "selected-to-folder") {
    UI.pendingFolderProjects = UI.selectedBrowser.filter((x) =>
      store.state.projects.some((p) => p.id === x),
    );
    folderDialog();
    return;
  }
  if (act === "project-edit") {
    const x = store.state.projects.find((x) => x.id === UI.contextBrowserId);
    const n = prompt("Project name", x?.name);
    if (n?.trim()) change("Rename project", (s) => (x.name = n.trim()));
  }
  if (act === "folder-edit") folderDialog(UI.contextBrowserId);
  if (act === "project-export") {
    const x = store.state.projects.find((x) => x.id === UI.contextBrowserId);
    if (x) exportProject(x);
  }
  if (act === "project-print") {
    enterProject(UI.contextBrowserId);
    UI.screen = "print";
    render();
  }
  if (
    act === "browser-sticker-star" ||
    act === "browser-sticker-heart" ||
    act === "browser-sticker-check"
  ) {
    const x =
        store.state.projects.find((x) => x.id === UI.contextBrowserId) ||
        store.state.folders.find((x) => x.id === UI.contextBrowserId),
      k = act.split("-").at(-1);
    if (x)
      change("Toggle sticker", (s) => {
        x.stickers ||= [];
        x.stickers = x.stickers.includes(k)
          ? x.stickers.filter((y) => y !== k)
          : [...x.stickers, k];
      });
  }
  if (act === "project-delete" || act === "folder-delete") {
    UI.deleteBrowserId = UI.contextBrowserId;
    UI.deleteBrowserType = act === "project-delete" ? "project" : "folder";
    modal(
      "Delete",
      `<p>Delete <strong>${esc((store.state.projects.find((x) => x.id === UI.deleteBrowserId) || store.state.folders.find((x) => x.id === UI.deleteBrowserId))?.name || "item")}</strong>?</p>${UI.deleteBrowserType === "folder" ? '<p>Choose whether to preserve the contained projects or delete everything.</p><label class="inline"><input type="checkbox" id="folder-delete-content"> Delete all projects inside</label>' : "<p>This deletes the project entry. Export a backup first if you need it.</p>"}`,
      [
        { text: "Cancel", action: "close-modal" },
        { text: "Delete", action: "confirm-delete-browser", danger: true },
      ],
    );
  }
}
function browserContext(e, id, kind) {
  UI.contextBrowserId = id;
  showContext(e.clientX, e.clientY, [
    { name: "Open", act: "browser-open" },
    {
      name: "Pin / Unpin",
      act: kind === "folder" ? "folder-pin" : "project-pin",
    },
    {
      name: kind === "folder" ? "Change Name / Color" : "Rename",
      act: kind === "folder" ? "folder-edit" : "project-edit",
    },
    ...(kind === "project"
      ? [
          { name: "Change Thumbnail…", act: "project-thumbnail" },
          ...(UI.selectedBrowser.length > 1
            ? [
                {
                  name: "Create Folder with Selected…",
                  act: "selected-to-folder",
                },
              ]
            : []),
        ]
      : []),
    { name: "Sticker ★", act: "browser-sticker-star" },
    { name: "Sticker ♥", act: "browser-sticker-heart" },
    { name: "Sticker ✓", act: "browser-sticker-check" },
    ...(kind === "project"
      ? [
          { name: "Print", act: "project-print" },
          { name: "Export project", act: "project-export" },
        ]
      : []),
    { name: "---" },
    {
      name: kind === "folder" ? "Delete folder…" : "Delete project…",
      act: kind === "folder" ? "folder-delete" : "project-delete",
      cls: "danger",
    },
  ]);
}
function browserOpen(id) {
  if (id === "new") return newProjectDialog();
  const f = store.state.folders.find((x) => x.id === id);
  if (f) {
    f.lastOpenedAt = date();
    store.save();
    pageSound("forward");
    UI.folderId = id;
    UI.focusBrowser = 0;
    UI.selectedBrowser = [];
    render();
    return;
  }
  const pp = store.state.projects.find((x) => x.id === id);
  if (pp) return enterProject(pp.id);
}
function onClick(e) {
  if(UI.renamingChapterId&&!e.target.closest("[data-chapter-rename]")){commitChapterRename();}
  if (
    UI.screen === "perform" &&
    e.target.closest(
      "[data-preview-action],[data-preview-scope],[data-preview-card],[data-preview-flag]",
    )
  ) {
    PERFORM.onClick(e).catch((e) => toast(e.message));
    return;
  }
  const cc = e.target.closest("[data-completion-card]"),
    completionChapter = e.target.closest("[data-complete-chapter]"),
    st = e.target.closest("[data-completion-status]");
  if (st) {
    completionSetStatus(st.dataset.completionStatus, st.dataset.cardId);
    return;
  }
  if (completionChapter) {
    UI.completionChapterId = completionChapter.dataset.completeChapter;
    UI.completionSelected = [];
    render();
    return;
  }
  if (cc) {
    if(performance.now()<UI.suppressBrowserClickUntil)return;
    completionSelect(
      cc.dataset.completionCard,
      e.metaKey || e.ctrlKey,
      e.shiftKey,
    );
    return;
  }
  const jump = e.target.closest("[data-hl-jump]");
  if (jump) {
    e.preventDefault();
    e.stopPropagation();
    HL.reveal(jump.dataset.hlChapter, jump.dataset.hlJump);
    return;
  }
  if (e.target.closest('textarea,input,select,[contenteditable="true"]'))
    return;
  if (e.target.closest('[data-act="add-card-tag"]')) {
    e.preventDefault();
    e.stopPropagation();
    uiSound();
    quickTagMenu(e.target.closest('[data-act="add-card-tag"]'));
    return;
  }
  if (e.target.closest(".context-pop")) {
    const a = e.target.closest("[data-context]");
    if (a) {
      chooseContext(a.dataset.context);
      return;
    }
  }
  const act = e.target.closest("[data-act]");
  if (act) {
    uiSound(true);
    e.preventDefault();
    actions[act.dataset.act]?.(act);
    return;
  }
  const mb = e.target.closest("[data-modal-btn]");
  if (mb) {
    const a = mb.dataset.modalBtn;
    handleModalAction(a);
    return;
  }
  const m = e.target.closest("[data-menu-option]");
  if (m) {
    uiSound(true);
    chooseMenu(+m.dataset.menuOption);
    return;
  }
  if (e.target.matches("[data-overlay]")) {
    if (UI.modal) closeModal();
    else if (UI.menu) closeMenu();
    return;
  }
  const filter = e.target.closest("[data-filter]");
  if (filter) {
    UI.browserFilter = filter.dataset.filter;
    UI.focusBrowser = 0;
    UI.selectedBrowser = [];
    uiSound();
    render();
    return;
  }
  const hue = e.target.closest("[data-folder-hue]");
  if (hue) {
    const fld = $("#folder-hue");
    if (fld) {
      fld.value = hue.dataset.folderHue;
      fld.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return;
  }
  const b = e.target.closest("[data-browse]");
  if (b) {
    if (performance.now() < (UI.suppressBrowserClickUntil || 0)) return;
    const id = b.dataset.browse;
    if (e.metaKey || e.ctrlKey || e.altKey) {
      UI.selectedBrowser = UI.selectedBrowser.includes(id)
        ? UI.selectedBrowser.filter((x) => x !== id)
        : [...UI.selectedBrowser, id];
      UI.focusBrowser = browserItems().findIndex((x) => x.id === id);
      render();
    } else {
      UI.selectedBrowser = [id];
      browserOpen(id);
    }
    return;
  }
  const stickScope = e.target.closest("[data-sticky-scope]");
  if (stickScope) {
    actions["sticky-scope"](stickScope);
    return;
  }
  const c = e.target.closest("[data-card]");
  if (c) {
    selectCard(
      c.dataset.card,
      !!c.dataset.inBucket,
      e.metaKey || e.ctrlKey || e.shiftKey,
    );
    if (e.detail >= 2 && !c.dataset.inBucket) quickLook();
    return;
  }
  const ch = e.target.closest("[data-activate-chapter]");
  if (ch) {
    if (UI.screen === "print") {
      UI.chapterId = ch.dataset.activateChapter;
      $$(".chapter-row").forEach((el) =>
        el.classList.toggle("on", el.dataset.chapter === UI.chapterId),
      );
      const section = $$("[data-print-chapter]").find(
        (el) => el.dataset.printChapter === UI.chapterId,
      );
      section?.scrollIntoView({
        block: "start",
        behavior: store.state.settings.animations ? "smooth" : "instant",
      });
      return;
    }
    const chapterId = ch.dataset.activateChapter,
      now = performance.now(),
      repeat =
        UI.lastChapterClick?.id === chapterId &&
        now - UI.lastChapterClick.at < 450;
    UI.lastChapterClick = { id: chapterId, at: now };
    if (e.detail >= 2 || repeat) {
      UI.lastChapterClick = null;
      renameChapter(chapterId);
    } else selectedChapter(chapterId);
    return;
  }
  const ins = e.target.closest("[data-insert]");
  if (ins) {
    blankAt(+ins.dataset.insert);
    return;
  }
  const bucket = e.target.closest("[data-bucket]");
  if (bucket) {
    UI.bucket = bucket.dataset.bucket;
    render();
    return;
  }
  const o = e.target.closest("[data-print-orientation]");
  if (o) {
    UI.print.orientation = o.dataset.printOrientation;
    UI.print.cols = UI.print.orientation === "portrait" ? 3 : 4;
    UI.print.rows = UI.print.orientation === "portrait" ? 5 : 4;
    render();
    return;
  }
  const a = e.target.closest(".quick-overlay");
  if (a && e.target === a) {
    UI.quick = false;
    a.remove();
    return;
  }
}
function handleModalAction(a) {
  if (a === "save-file-naming") {
    try {
      const value = {};
      for (const el of document.querySelectorAll("[data-naming]"))
        value[el.dataset.naming] = el.value;
      const profile = namingProfile(value);
      const project=p();void (async()=>{const renamed=await STUDIO.renameFolders(profile);if(p()!==project)return;store.change('File naming settings',()=>{project.fileNaming=profile;store.state.settings.fileNamingDefaults=structuredClone(profile);},{silent:true});for(const row of [...store.undo,...store.redo]){const old=row.before.projects.find(pr=>pr.id===project.id);if(old){old.fileNaming=structuredClone(profile);rebaseProjectFolders(old,renamed?.moves||[]);}}render();closeModal();await STUDIO.organize();toast('File naming updated.');})().catch(e=>toast(String(e.message||e)));
    } catch (e) {
      toast(e.message||String(e));
    }
    return;
  }

  if (a === "apply-docx-import") {
    DOCX.apply();
    return;
  }
  if (a === "cancel-docx-import") {
    DOCX.cancel();
    return;
  }
  if (a === "export-script-all" || a === "export-script-spoken") {
    const fn = exportScript;
    exportScript = null;
    closeModal();
    fn?.(a === "export-script-spoken" ? "spoken" : "all");
    return;
  }
  if (a === "confirm-delete-text") {
    const fn = deleteChapterText;
    deleteChapterText = null;
    closeModal();
    fn?.();
    return;
  }
  if (a === "request-delete-tag") {
    chooseContext("delete-tag");
    return;
  }
  if (a === "confirm-edit-tag") {
    const t = tagDefinition(p(),UI.contextTagId);
    const name = $("#edit-tag-name")?.value?.trim();
    if (!t || !name) return;
    const appearance={color:$("#edit-tag-color")?.value||t.color,icon:$("#edit-tag-icon")?.value?.trim()||t.icon};
    change("Edit tag appearance",()=>{if(tagDefs[UI.contextTagId]){p().tagAppearance||={};p().tagAppearance[UI.contextTagId]=appearance;}else{Object.assign(p().customTags.find(x=>x.id===UI.contextTagId),{name,...appearance});}});
    closeModal();
    return;
  }
  if (a === "save-card-note") {
    const id = UI.editNoteId,
      text = $("#note-editor-text")?.value ?? "";
    change("Edit storyboard note", (state) => {
      const c = item(id);
      if (c) c.note = text;
    });
    closeModal();
    return;
  }
  if (a === "confirm-delete-tag") {
    const id = UI.contextTagId;
    change("Delete custom tag", (state) => {
      p().customTags = p().customTags.filter((t) => t.id !== id);
      for (const s of [
        ...p().stories,
        ...p().unassigned,
        ...p().lost,
        ...p().archived,
      ])
        s.tags = (s.tags || []).filter((t) => t !== id);
    });
    closeModal();
    return;
  }
  if (a === "confirm-delete-sticky") {
    const id = UI.deleteStickyId;
    change("Delete archived sticky", (state) => {
      p().archivedStickies = p().archivedStickies.filter((n) => n.id !== id);
    });
    closeModal();
    return;
  }
  if (a === "confirm-rename-chapter") {
    const id = UI.contextChapterId;
    const el = $("#rename-chapter-input");
    const name = el?.value?.trim();
    if (!name) {
      el?.focus();
      return;
    }
    change("Rename chapter", (state) => {
      const c = p().chapters.find((c) => c.id === id);
      if (c) c.name = name;
    });
    closeModal();
    return;
  }
  if (a === "confirm-delete-chapter") {
    const id = UI.contextChapterId;
    change("Delete chapter", (s) => {
      const old = p()
        .chapters.filter((c) => c.id === id || c.parentId === id)
        .map((c) => c.id);
      const moved = p().stories.filter((s) => old.includes(s.chapterId));
      p().unassigned.push(...moved);
      p().stories = p().stories.filter((s) => !old.includes(s.chapterId));
      p().chapters = p().chapters.filter((c) => !old.includes(c.id));
      UI.chapterId = p().chapters.find((c) => !c.unused)?.id;
    });
    closeModal();
    return;
  }
  if (a === "confirm-delete-browser") {
    const id = UI.deleteBrowserId;
    const withContent = !!$("#folder-delete-content")?.checked;
    change("Delete browser item", (s) => {
      if (UI.deleteBrowserType === "folder") {
        s.folders = s.folders.filter((x) => x.id !== id);
        if (withContent)
          s.projects = s.projects.filter((x) => x.folderId !== id);
        else
          s.projects.forEach((x) => {
            if (x.folderId === id) x.folderId = "root";
          });
      } else s.projects = s.projects.filter((x) => x.id !== id);
    });
    closeModal();
    return;
  }
  actions[a]?.();
}
function updateBehindModal() {
  const overlay = $(".modal-overlay");
  if (!overlay) {
    render();
    return;
  }
  overlay.remove();
  const modalData = UI.modal;
  UI.modal = null;
  render();
  UI.modal = modalData;
  document.body.append(overlay);
}
function onChange(e) {
 if(e.target.matches('[data-cleanup-completion]')){change('Cleanup completion preference',()=>p().viewPrefs.cleanupCompletion=e.target.checked);return;}
  if (e.target.matches("[data-completion-size]")) {
    UI.completionThumb = Number(e.target.value);
    store.state.settings.completionThumb = UI.completionThumb;
    store.save();
    const grid = document.querySelector("#completion-grid");
    grid?.style.setProperty("--completion-width", UI.completionThumb + "px");
    return;
  }
  const el = e.target;
  if (el.dataset.gridPref) {
    const key = el.dataset.gridPref,
      val = Math.max(
        1,
        Math.min(key === "gridCols" ? 6 : 7, Number(el.value) || 1),
      );
    change(
      "Change storyboard grid",
      (s) => {
        const format = p()?.ratio || "16:9";
        const presets = (s.settings.gridByRatio ||= {});
        const preset = (presets[format] ||= {
          cols: format === "9:16" ? 4 : 3,
          rows: format === "9:16" ? 3 : 4,
        });
        preset[key === "gridCols" ? "cols" : "rows"] = val;
        if (p()) p().viewPrefs[key] = val;
        if (UI.chapterId) UI.boardPages[UI.chapterId] = 0;
      },
      { render: false },
    );
    updateBehindModal();
    return;
  }
  if (el.id === "alt-undo") {
    change(
      "Alternate undo keys",
      (s) => (s.settings.altUndoKeys = el.checked),
      { render: false },
    );
    return;
  }
  if (el.dataset.toggleTag) {
    const tag = el.dataset.toggleTag,
      checked = el.checked;
    change(
      "Set tag on selected cards",
      () => {
        for (const id of tagTargetIds()) {
          const st = item(id);
          if (!st) continue;
          if (tag === "done") {
            setFamilyCompletion(p(), st, checked ? "green" : "red");
            continue;
          }
          st.tags = st.tags || [];
          st.tags = checked
            ? [...new Set([...st.tags, tag])]
            : st.tags.filter((x) => x !== tag);
        }
      },
      { render: false },
    );
    updateBehindModal();
    return;
  }
  if(el.matches('[data-slight-letters]')){change('Change modification labels',()=>{p().viewPrefs.slightModifyLetters=el.checked;ensureCardLabels(p());});return;}
  if (el.dataset.setting) {
    const key = el.dataset.setting,
      val =
        el.type === "checkbox"
          ? el.checked
          : el.type === "range" ||
              ["hlFontSize", "hlCaptionSize","hlBlankSpacing"].includes(el.dataset.setting)
            ? +el.value
            : el.value;
    change(
      "Change setting",
      (s) => {
        if (key === "thumbSize" && p()) p().viewPrefs.thumbnailSize = val;
        else s.settings[key] = val;
      },
      { render: false },
    );
    if (key === "theme") UI.theme = val;
    if (key === "noteSize")
      document.body.style.setProperty("--note-font", val + "px");
    if (key === "spacing")
      document.body.style.setProperty("--card-gap", val + "px");
    if (key === "thumbSize")
      document.body.style.setProperty("--card-width", val + "px");
    el.closest("label")
      ?.querySelector("output")
      ?.replaceChildren(document.createTextNode(`${val}px`));
    updateBehindModal();
    return;
  }
  if (el.id === "tag-color" && $("#tag-color-preview")) {
    $("#tag-color-preview").style.setProperty("--tag-preview", el.value);
    return;
  }
  if (el.id === "edit-tag-color" && $("#edit-tag-color-preview")) {
    $("#edit-tag-color-preview").style.setProperty("--tag-preview", el.value);
    return;
  }
  if (el.dataset.print) {
    const key = el.dataset.print;
    UI.print[key] =
      el.type === "checkbox"
        ? el.checked
        : el.type === "range" || el.type === "number"
          ? +el.value
          : el.value;
    if (["cols", "rows"].includes(key))
      UI.print[key] = Math.max(
        1,
        Math.min(key === "cols" ? 6 : 8, UI.print[key] || 1),
      );
    render();
    return;
  }
  if (el.dataset.act === "sort") {
    UI.sort = el.value;
    store.state.settings.browserSort = UI.sort;
    store.save();
    render();
    return;
  }
}
function onInput(e) {
  const el = e.target;
  if (el.dataset.act === "search") {
    UI.search = el.value;
    const cursor = el.selectionStart;
    render();
    const newel = $('[data-act="search"]');
    newel?.focus();
    newel?.setSelectionRange(cursor, cursor);
    return;
  }
  if (el.id === "tag-color" && $("#tag-color-preview")) {
    $("#tag-color-preview").style.setProperty("--tag-preview", el.value);
    return;
  }
  if (el.id === "edit-tag-color" && $("#edit-tag-color-preview")) {
    $("#edit-tag-color-preview").style.setProperty("--tag-preview", el.value);
    return;
  }
  if (el.dataset.note) {
    const card = item(el.dataset.note);
    if (card) {
      card.note = el.value;
      const frame = el.closest(".story-entry")?.querySelector(".story-frame");
      if (frame) {
        let badge = frame.querySelector(".notes-card-indicator"),
          sheet = frame.querySelector(".blank-note-sheet");
        const hasNote = !!card.note.trim();
        if (hasNote && !badge) {
          badge = document.createElement("span");
          badge.className = "notes-card-indicator";
          badge.textContent = "▤";
          badge.title = "Card has notes";
          badge.setAttribute("aria-label", "Card has notes");
          frame.append(badge);
        } else if (!hasNote) badge?.remove();
        if (visual(p(), card).blank) {
          if (hasNote && !sheet) {
            sheet = document.createElement("div");
            sheet.className = "blank-note-sheet";
            sheet.innerHTML = '<div class="blank-note-text"></div>';
            frame.append(sheet);
          }
          if (sheet) {
            if (hasNote) {
              sheet.querySelector(".blank-note-text").textContent =
                card.note.trim();
              updateBlankNoteOverflow(sheet);
            } else sheet.remove();
          }
        }
      }
      p().modifiedAt = date();
      scheduleNoteSave();
    }
    return;
  }
  if (el.dataset.stickyNote) {
    const n = p().stickyNotes.find((x) => x.id === el.dataset.stickyNote);
    if (n) {
      n.text = el.value;
      store.save();
    }
    return;
  }
}
function onContext(e) {
  const archivedCleanup=e.target.closest('[data-cleanup-archive]');if(archivedCleanup){e.preventDefault();UI.selectionZone='cleanup-archive';const id=archivedCleanup.dataset.cleanupArchive;if(!UI.cleanupArchiveSelected.includes(id))UI.cleanupArchiveSelected=[id];markCleanupArchiveSelection();showContext(e.clientX,e.clientY,[...(UI.bucket==='archived'?[{name:'Restore to Not Assigned',act:'cleanup-restore-selected'}]:[]),{name:'Move selected to Trash…',act:'cleanup-purge-selected',cls:'danger'}]);return;}

  const linked=e.target.closest(".hl-card-passages");
  if(linked&&UI.screen==="storyboard"){
    e.preventDefault();UI.contextScriptCardId=linked.closest("[data-card]")?.dataset.card;
    showContext(e.clientX,e.clientY,[{name:"Remove linked text",act:"remove-card-script",cls:"danger"}]);return;
  }

  if (e.target.closest('textarea,input,select,[contenteditable="true"]'))
    return;
  const tr = e.target.closest("[data-tag-row]");
  if (tr) {
    e.preventDefault();
    const id = tr.dataset.tagRow;
    if (p()?.customTags?.some((t) => t.id === id)) {
      UI.contextTagId = id;
      showContext(e.clientX, e.clientY, [
        { name: "Edit custom tag…", act: "edit-tag" },
        { name: "Delete custom tag…", act: "delete-tag", cls: "danger" },
      ]);
    } else toast("Built-in tags cannot be deleted");
    return;
  }
  const c = e.target.closest("[data-card]");
  if (c) {
    e.preventDefault();
    cardContext(e, c.dataset.card, !!c.dataset.inBucket);
    return;
  }
  const ch = e.target.closest("[data-chapter]");
  if (ch && UI.screen !== "print") {
    e.preventDefault();
    chapterContext(e, ch.dataset.chapter);
    return;
  }
  const browse = e.target.closest("[data-browse]");
  if (browse && browse.dataset.browse !== "new") {
    e.preventDefault();
    browserContext(e, browse.dataset.browse, browse.dataset.kind);
    return;
  }
}
function moveChapter(chapterId, targetId, placement) {
  const list = p()?.chapters || [],
    source = list.find((x) => x.id === chapterId),
    target = list.find((x) => x.id === targetId);
  if (!source || !target || source === target) return;
  const descendants = list.filter((x) => x.parentId === source.id),
    block = [source, ...descendants],
    ids = new Set(block.map((x) => x.id));
  if (ids.has(target.id)) return toast("Cannot move a chapter into itself");
  const rest = list.filter((x) => !ids.has(x.id));
  const parent =
    placement === "child"
      ? target.parentId || target.id
      : target.parentId || null;
  change("Reorder chapter", () => {
    source.parentId = parent;
    source.unused = false;
    for (const c of descendants) c.unused = false;
    let at = rest.findIndex((x) => x.id === target.id);
    if (at < 0) at = rest.length;
    if (placement !== "before") {
      at++;
      while (at < rest.length && rest[at].parentId === target.id) at++;
    }
    p().chapters = [...rest.slice(0, at), ...block, ...rest.slice(at)];
    UI.chapterId = source.id;
  });
}
function mergeOntoCard(sourceId, targetId) {
  const source = item(sourceId),
    target = item(targetId);
  if (!source || !target || source.id === target.id) return;
  const v = visual(p(), source);
  if (v.blank || !v.variant?.assetId)
    return toast("Only artwork can be dropped on a card");
  change("Add or replace storyboard artwork", (state) => {
    const base = sourceCard(p(), target);
    base.variants ||= [];
    if (visual(p(), target).blank) {
      base.variants = [structuredClone(v.variant)];
      target.blank = false;
      target.activeVariant = 0;
    } else {
      base.variants.push(structuredClone(v.variant));
      target.activeVariant = base.variants.length - 1;
    }
    UI.selected = [target.id];
    revealCardPage(target.id);
  });
  toast("Artwork applied; original card retained");
}

let chapterDwellTimers = [],
  chapterDwellId = null;
function cancelChapterDwell({ keepPreview = false } = {}) {
  for (const timer of chapterDwellTimers) clearTimeout(timer);
  chapterDwellTimers = [];
  if (chapterDwellId)
    $$("[data-chapter]").forEach((el) =>
      el.classList.remove("chapter-dwell-flash", "chapter-dwell-ready"),
    );
  chapterDwellId = null;
  if (!keepPreview) {
    $(".chapter-drop-preview")?.remove();
    UI.dropPreviewChapter = null;
  }
}
function chapterPreview(id) {
  if (UI.drag?.type !== "cards" || UI.screen !== "storyboard") return;
  const chapter = p()?.chapters.find((c) => c.id === id);
  if (!chapter || chapter.unused) return;
  UI.dropPreviewChapter = id;
  $(".chapter-drop-preview")?.remove();
  const existing = chapterCards(p(), id);
  const box = document.createElement("div");
  box.className = "chapter-drop-preview";
  box.innerHTML = `<div class="chapter-drop-preview-heading"><strong>${esc(chapter.name)}</strong><small>Release over a slot to place the dragged cards</small></div><div class="chapter-drop-preview-grid">${existing.map((c, i) => `<div class="chapter-drop-target" data-preview-chapter="${id}" data-preview-index="${i}"><span>${i + 1}</span><div class="chapter-drop-image" style="aspect-ratio:${ratio(p())}">${imageHtml(c)}</div></div>`).join("")}<div class="chapter-drop-target chapter-append" data-preview-chapter="${id}" data-preview-index="${existing.length}">＋ Add here</div></div>`;
  const main = $(".board-main");
  main?.append(box);
  attachImages(box);
}
function beginChapterDwell(id) {
  if (chapterDwellId === id || UI.dropPreviewChapter === id) return;
  cancelChapterDwell();
  chapterDwellId = id;
  const row = $$("[data-chapter]").find((el) => el.dataset.chapter === id);
  if (!row) return;
  // macOS-style slow three-pulse spring-load before showing destination.
  [0, 190, 380, 570, 760, 950].forEach((ms, i) =>
    chapterDwellTimers.push(
      setTimeout(() => {
        if (chapterDwellId === id && UI.drag?.type === "cards")
          row.classList.toggle("chapter-dwell-flash", i % 2 === 0);
      }, ms),
    ),
  );
  chapterDwellTimers.push(
    setTimeout(() => {
      if (chapterDwellId !== id) return;
      row.classList.add("chapter-dwell-ready");
      chapterPreview(id);
    }, 1100),
  );
}
function onDragStart(e) {
 const pending=e.target.closest('[data-unassigned-cleanup]');if(pending){UI.drag={type:'unassigned-cleanups',ids:UI.cleanupArchiveSelected.includes(pending.dataset.cleanupArchive)?[...UI.cleanupArchiveSelected]:[pending.dataset.cleanupArchive]};e.dataTransfer.setData('text/plain',JSON.stringify(UI.drag));e.dataTransfer.effectAllowed='move';return;}

  if (e.target.closest("[data-hl-jump],[data-hl-root]")) {
    e.preventDefault();
    return;
  }
  if (
    e.target.closest('textarea,input,[contenteditable="true"]') ||
    (document.activeElement?.matches?.("textarea[data-note]") &&
      document.activeElement.closest("[data-card]") ===
        e.target.closest("[data-card]"))
  ) {
    e.preventDefault();
    UI.drag = null;
    return;
  }
  const c = e.target.closest("[data-card]");
  if (c) {
    const bucket = !!c.dataset.inBucket,
      ids = bucket
        ? UI.bucketSelected.includes(c.dataset.card)
          ? UI.bucketSelected
          : [c.dataset.card]
        : UI.selected.includes(c.dataset.card)
          ? UI.selected
          : [c.dataset.card];
    UI.drag = { type: "cards", ids };
    c.classList.add("dragging-source");
    if (ids.length > 1) {
      const ghost = document.createElement("div");
      ghost.className = "drag-stack";
      ghost.innerHTML = `<span>${ids.length} storyboards</span>`;
      document.body.append(ghost);
      e.dataTransfer.setDragImage(ghost, 30, 30);
      requestAnimationFrame(() => ghost.remove());
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify(UI.drag));
    return;
  }
  const ch = e.target.closest("[data-chapter]");
  if (ch) {
    UI.drag = { type: "chapter", id: ch.dataset.chapter };
    document.body.classList.add("dragging-chapter");
    document.body.classList.toggle(
      "dragging-subchapter",
      !!p()?.chapters.find((x) => x.id === ch.dataset.chapter)?.parentId,
    );
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify(UI.drag));
    return;
  }
  const browse = e.target.closest("[data-browse]");
  if (browse && browse.dataset.browse !== "new") {
    UI.drag = {
      type: "browser",
      id: browse.dataset.browse,
      ids: UI.selectedBrowser.includes(browse.dataset.browse)
        ? UI.selectedBrowser
        : [browse.dataset.browse],
    };
    e.dataTransfer.setData("text/plain", JSON.stringify(UI.drag));
    return;
  }
}
function onDragOver(e) {
  pageDragHover(e);
  let slot=e.target.closest('[data-slot]');if(!slot&&e.target.closest('#storyboard-scroll,.board-main'))slot=closestSlot({x:e.clientX,y:e.clientY},[...document.querySelectorAll('.board-main .board-slot')].map(el=>({el,rect:el.getBoundingClientRect()})))?.el;
  const eligible = e.target.closest(
    '[data-drop-bucket],[data-bucket],[data-insert],[data-chapter],[data-drop-unused],[data-drop-promote],[data-browse],[data-preview-chapter],#storyboard-scroll,#browser-grid,[data-act="board-prev"],[data-act="board-next"]',
  );
  if (!eligible && !slot) return;
  e.preventDefault();
  if (UI.drag?.type === "cards") {
    const overChapter = e.target.closest("[data-chapter]"),
      previewSlot = e.target.closest("[data-preview-chapter]");
    if (
      overChapter &&
      overChapter.dataset.chapter !== UI.chapterId &&
      !p().chapters.find((c) => c.id === overChapter.dataset.chapter)?.unused
    )
      beginChapterDwell(overChapter.dataset.chapter);
    else if (
      !previewSlot &&
      !e.target.closest(".chapter-drop-preview") &&
      chapterDwellId
    )
      cancelChapterDwell({ keepPreview: true });
    $$(".chapter-drop-target").forEach((el) =>
      el.classList.toggle("drop-chapter-card-here", el === previewSlot),
    );
  }
  if (
    slot &&
    (UI.drag?.type === "cards" ||
      [...(e.dataTransfer?.types || [])].includes("Files"))
  ) {
    if (
      slot.classList.contains("board-empty") &&
      !slot.querySelector(".page-add-blank")
    )
      return;
    const art=slot.querySelector(".story-frame"),frame=art?.getBoundingClientRect();if(frame){slot.style.setProperty("--drop-line-top",(frame.top-slot.getBoundingClientRect().top)+"px");slot.style.setProperty("--drop-line-height",frame.height+"px");}
    const r = slot.getBoundingClientRect(),
      frac = (e.clientX - r.left) / Math.max(1, r.width);
    const targetId = slot.querySelector("[data-card]")?.dataset.card;
    const mode=p()?.viewPrefs.boardMode==='cleanup'&&UI.drag?.type==='cards'?'onto':slotIntent(r,e.clientX,UI.drag?.type!=='cards',!!targetId);
    const next = {
      index: +slot.dataset.slot + (mode === "after" ? 1 : 0),
      mode,
      targetId,
    };
    if (
      UI.dragSlot?.index !== next.index ||
      UI.dragSlot?.mode !== next.mode ||
      UI.dragSlot?.targetId !== targetId
    ) {
      $$(
        ".board-slot.drop-before,.board-slot.drop-after,.board-slot.drop-onto",
      ).forEach((x) =>
        x.classList.remove("drop-before", "drop-after", "drop-onto"),
      );
      slot.classList.add(
        mode === "before"
          ? "drop-before"
          : mode === "after"
            ? "drop-after"
            : "drop-onto",
      );
    }
    UI.dragSlot = next;
  } else if (UI.drag?.type !== "cards") UI.dragSlot = null;
  if (UI.drag?.type === "chapter") {
    const ch = e.target.closest("[data-chapter]");
    let next = null;
    if (ch && ch.dataset.chapter !== UI.drag.id) {
      const r = ch.getBoundingClientRect(),
        frac = (e.clientY - r.top) / Math.max(1, r.height);
      next = {
        id: ch.dataset.chapter,
        placement: frac < 0.43 ? "before" : frac > 0.57 ? "after" : "child",
      };
    }
    if (
      next?.id !== UI.dragHoverChapter?.id ||
      next?.placement !== UI.dragHoverChapter?.placement
    ) {
      $$(".chapter-row").forEach((el) =>
        el.classList.remove(
          "drop-chapter-before",
          "drop-chapter-after",
          "drop-chapter-child",
        ),
      );
      if (next) ch.classList.add("drop-chapter-" + next.placement);
    }
    UI.dragHoverChapter = next;
    UI.dragPlacement = next?.placement || null;
  }
  const el = e.target.closest(
    "[data-drop-bucket],[data-bucket],[data-drop-unused],[data-drop-promote]",
  );
  el?.classList.add("drop-hover");
}

async function onDrop(e) {
  cancelPageDragHover();
  e.preventDefault();
  $$(".drop-hover").forEach((el) => el.classList.remove("drop-hover"));
  $$(".chapter-row").forEach((el) =>
    el.classList.remove(
      "drop-chapter-before",
      "drop-chapter-after",
      "drop-chapter-child",
    ),
  );
  document.body.classList.remove("dragging-chapter", "dragging-subchapter");
  if (UI.drag?.type !== "cards") cancelChapterDwell();
  const target = e.target.closest(
    '[data-insert],[data-drop-bucket],[data-bucket],[data-chapter],[data-drop-unused],[data-drop-promote],[data-browse],[data-slot],[data-act="board-prev"],[data-act="board-next"]',
  );
  let payload = UI.drag;
  const dragSlot=e.slotSnapshot||UI.dragSlot;
  UI.dragSlot = null;
  $$(".board-slot").forEach((x) =>
    x.classList.remove(
      "drop-before",
      "drop-after",
      "drop-onto",
      "dragging-source",
    ),
  );
  try {
    if (!payload) payload = JSON.parse(e.dataTransfer.getData("text/plain"));
  } catch {}
  UI.drag = null;
  if (e.dataTransfer.files?.length) {
    const all = [...e.dataTransfer.files];
    if (UI.screen === "browser") {
      for (const f of all.filter((f) =>
        /\.(storyboardstudio|sshltest)$/i.test(f.name),
      )) {
        try {
          await importProject(f);
        } catch (err) {
          toast(err.message||String(err));
        }
      }
      render();
      return;
    }
    if (UI.screen === "storyboard") {
      const images = all.filter((f) => f.type.startsWith("image/"));
      if (!images.length) return;
      if(e.projectSnapshot&&p()?.id!==e.projectSnapshot)throw Error("Project changed during import. Drop the files again in the intended project.");
      const importChapter=e.chapterSnapshot||UI.chapterId,importProject=p();
      const destination = target?.dataset.dropBucket || "stories",
        index =
          target?.dataset.insert != null
            ? +target.dataset.insert
            : (dragSlot?.index ?? (target?.dataset.act?.startsWith("board-")?boardLayout().offset+(target.dataset.act==="board-next"?boardLayout().items.length:0):null));
      await importImageFiles(
        images,
        p(),
        async (ids) => {
          if(p()!==importProject)throw Error("Project changed while reading the images. Drop them again in the intended project.");
          change(`Import ${ids.length} drawings`, (s) => {
            const cards = ids.map((id) => card(importChapter, id));
            if (destination === "stories") {
              const onto =
                dragSlot?.mode === "onto"
                  ? p().stories.find((x) => x.id === dragSlot.targetId)
                  : null;
              if (onto && ids.length === 1) {
                const origin = sourceCard(p(), onto);
                if (visual(p(), onto).blank) {
                  origin.variants = [{ assetId: ids[0] }];
                  onto.blank = false;
                  onto.activeVariant = 0;
                } else {
                  origin.variants.push({ assetId: ids[0] });
                  onto.activeVariant = origin.variants.length - 1;
                }
              } else {
                const existing = p().stories.filter(c=>c.chapterId===importChapter),
                  dest = p().stories;
                let at =
                  index === null
                    ? dest.length
                    : index < existing.length
                      ? dest.indexOf(existing[index])
                      : existing.length
                        ? dest.indexOf(existing.at(-1)) + 1
                        : dest.length;
                dest.splice(Math.max(0, at), 0, ...cards);
              }
            } else if (destination === "assets") s.globalAssets.push(...cards);
            else if (p()[destination]) p()[destination].push(...cards);
          });
        },
        {
          forceSingleImage:
            dragSlot?.mode === "onto" || destination === "assets"
              ? true
              : undefined,
        },
      );
      return;
    }
  }
  if (!payload) return;
  if(payload.type==='unassigned-cleanups'){const targetCard=e.target.closest('[data-card]')?.dataset.card;if(targetCard)await CLEANUP.attachUnassigned(targetCard,payload.ids);else toast('Drop the cleanup on a storyboard card.');return;}
  if (payload.type === "cards") {
    if(p()?.viewPrefs.boardMode==='cleanup'&&UI.screen==='storyboard'){const targetId=dragSlot?.targetId||e.target.closest('[data-card]')?.dataset.card;if(!targetId)return;change('Move cleanup connections',()=>swapCleanupAssignments(p(),payload.ids,targetId));await CLEANUP.sync();render();return;}
    const preview = e.target.closest("[data-preview-chapter]");
    if (preview) {
      const dest = preview.dataset.previewChapter,
        at = Number(preview.dataset.previewIndex);
      cancelChapterDwell();
      transfer(payload.ids, "stories", dest, at);
      return;
    }
    const hovering = target?.dataset.chapter;
    if (hovering && !p().chapters.find((c) => c.id === hovering)?.unused) {
      cancelChapterDwell();
      transfer(
        payload.ids,
        "stories",
        hovering,
        chapterCards(p(), hovering).length,
      );
      return;
    }
    const ch = target?.dataset.chapter,
      index =
        target?.dataset.insert != null
          ? +target.dataset.insert
          : (dragSlot?.index ?? null),
      bucket = target?.dataset.dropBucket || target?.dataset.bucket;
    if (
      target?.dataset.act === "board-prev" ||
      target?.dataset.act === "board-next"
    ) {
      const direction=target.dataset.act==='board-next'?1:-1;
      transfer(payload.ids,'stories',UI.chapterId,direction>0?boardLayout().offset+boardLayout().items.length:boardLayout().offset);
      return;
    }
    if (ch) {
      const targetC = p().chapters.find((c) => c.id === ch);
      if (targetC && !targetC.unused)
        transfer(payload.ids, "stories", ch, null);
      return;
    }
    if (bucket) {
      UI.bucket = bucket;
      UI.rightMode = "holding";
      transfer(payload.ids, bucket);
      return;
    }
    if (UI.screen === "storyboard") {
      if (
        dragSlot?.mode === "onto" &&
        dragSlot.targetId &&
        !payload.ids.includes(dragSlot.targetId) &&
        payload.ids.length === 1
      ) {
        mergeOntoCard(payload.ids[0], dragSlot.targetId);
        return;
      }
      transfer(payload.ids, "stories", UI.chapterId, index);
    }
    return;
  }
  if (payload.type === "chapter") {
    const c = p().chapters.find((x) => x.id === payload.id),
      to = target?.dataset.chapter;
    if (!c) return;
    if (target?.hasAttribute("data-drop-promote")) {
      change("Promote subchapter", () => {
        c.parentId = null;
        c.unused = false;
      });
      return;
    }
    if (target?.hasAttribute("data-drop-unused")) {
      if (
        !c.unused &&
        chapters().filter((x) => !x.parentId).length <= 1 &&
        !p().chapters.some((x) => x.parentId === c.id && !x.unused)
      ) {
        toast("Keep at least one active chapter");
        return;
      }
      change("Move chapter to unused", (state) => {
        for (const child of p().chapters.filter((x) => x.parentId === c.id)) {
          child.parentId = c.parentId || null;
          child.unused = false;
        }
        c.unused = true;
        c.parentId = null;
        UI.chapterId = p().chapters.find((x) => !x.unused)?.id || null;
      });
      return;
    }
    if (to && to !== c.id) {
      moveChapter(c.id, to, UI.dragHoverChapter?.placement || "child");
      UI.dragPlacement = null;
      UI.dragHoverChapter = null;
      return;
    }
    if (e.target.closest("#chapter-list") && c.parentId)
      change("Promote chapter", (state) => {
        c.parentId = null;
        c.unused = false;
      });
    return;
  }

  if (payload.type === "browser") {
    const folder = target?.dataset.browse;
    if (store.state.folders.some((f) => f.id === folder)) {
      const ids = (payload.ids || [payload.id]).filter((id) =>
        store.state.projects.some((pr) => pr.id === id),
      );
      if (ids.length)
        change("Move projects into folder", (s) => {
          for (const pp of s.projects)
            if (ids.includes(pp.id)) pp.folderId = folder;
        });
      UI.selectedBrowser = [];
      UI.focusBrowser = 0;
      render();
    }
  }
}
function onLassoDown(e) {
  if (e.button !== 0 || UI.modal || UI.menu) return;
  const isBoard =
    UI.screen === "storyboard" && !!e.target.closest(".board-main");
  const isBrowserScreen =
    UI.screen === "browser" && !!e.target.closest(".browser-panel");
  const surface = UI.screen==="completion"
    ? $("#completion-grid")
    : isBoard
    ? $("#storyboard-grid")
    : isBrowserScreen
      ? $("#browser-grid")
      : e.target.closest(".holding-sidebar") && UI.rightMode === "holding" ? $("#holding-grid") : e.target.closest(".lasso-surface");
  if (!surface) return;
  const isCompletion=UI.screen==="completion";
  const isBrowser = surface.id === "browser-grid",
    isBucket = surface.id === "holding-grid";
  // Preserve native card dragging and the ability to edit inline notes.
  if (
    e.target.closest(
      'button,input,textarea,select,a,summary,.page-help,[data-completion-resizer],[contenteditable="true"],.gap-target',
    )
  )
    return;
  if (e.target.closest('[draggable="true"]')) {
    if (!(isBoard && (e.altKey || e.shiftKey))) return;
    e.preventDefault();
  }
  if(isCompletion)e.preventDefault();
  const isCleanupArchive=isBucket&&["archived","unassigned"].includes(UI.bucket)&&UI.archiveKind==="cleanups";
  if(isCleanupArchive){e.preventDefault();window.getSelection()?.removeAllRanges();}
  const selector = isCleanupArchive?"[data-cleanup-archive]":isCompletion?"[data-completion-card]":isBrowser ? '[data-kind="project"]' : "[data-card]";
  const p0 = { x: e.clientX, y: e.clientY };
  let rect = null;
  const prior =
    e.shiftKey || e.metaKey || e.ctrlKey
      ? isCleanupArchive?UI.cleanupArchiveSelected:isCompletion?UI.completionSelected:isBrowser
        ? UI.selectedBrowser
        : isBucket
          ? UI.bucketSelected
          : UI.selected
      : [];
  function move(ev) {
    if (Math.hypot(ev.clientX - p0.x, ev.clientY - p0.y) < 6 && !rect) return;
    if (!rect) {
      rect = document.createElement("div");
      rect.className = "lasso-rect";
      document.body.append(rect);
      document.body.classList.add("lasso-active");
    }
    ev.preventDefault();
    const x = Math.min(p0.x, ev.clientX),
      y = Math.min(p0.y, ev.clientY),
      w = Math.abs(ev.clientX - p0.x),
      h = Math.abs(ev.clientY - p0.y);
    Object.assign(rect.style, {
      left: x + "px",
      top: y + "px",
      width: w + "px",
      height: h + "px",
    });
    const ids = new Set(prior);
    $$(selector, surface).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.left < x + w && r.right > x && r.top < y + h && r.bottom > y)
        ids.add(
          el.dataset.cleanupArchive || el.dataset.completionCard || el.dataset.browse || el.dataset.card,
        );
    });
    if(isCleanupArchive){UI.selectionZone='cleanup-archive';UI.cleanupArchiveSelected=[...ids];UI.selected=[];UI.bucketSelected=[];markCleanupArchiveSelection();}
    else if(isCompletion){UI.completionSelected=[...ids];UI.completionAnchor=UI.completionSelected[0]||null;document.querySelectorAll("[data-completion-card]").forEach(el=>el.classList.toggle("selected",ids.has(el.dataset.completionCard)));}
    else if (isBrowser) {
      UI.selectedBrowser = [...ids];
      refreshBrowserSelection();
    } else if (isBucket) {
      UI.bucketSelected = [...ids];
      UI.selected = [];
      UI.selectionZone = "bucket";
      markSelected();
    } else {
      UI.selected = [...ids];
      UI.bucketSelected = [];
      UI.selectionZone = "main";
      markSelected();
    }
  }
  function up() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    if (rect) {
      UI.suppressBrowserClickUntil = performance.now() + 350;
      rect.remove();
      if (isBrowser) render();
    }
    document.body.classList.remove("lasso-active");
  }
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up, { once: true });
  window.addEventListener("pointercancel", up, { once: true });
}

function onKey(e) {
  if(document.querySelector('.cleanup-overlay'))return;
  if (e.target.matches?.("[data-chapter-rename]")) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitChapterRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      commitChapterRename(true);
    }
    return;
  }
  const tag = (document.activeElement?.tagName || "").toLowerCase(),
    typing = ["input", "textarea", "select"].includes(tag),
    k = e.key.toLowerCase(),
    modified = e.metaKey || e.ctrlKey;
  if(modified&&k==='s'){e.preventDefault();void saveAllProjectMedia().catch(err=>toast(String(err.message||err)));return;}
  if (modified && k === "z") {
    e.preventDefault();
    ASSEMBLY.cancel();
    restoreProjectHistory(e.shiftKey);
    render();
    return;
  }
  if (e.ctrlKey && !e.metaKey && k === "y" && !typing) {
    e.preventDefault();
    ASSEMBLY.cancel();
    restoreProjectHistory(true);
    render();
    return;
  }
  if (modified && k === "a" && !typing && UI.screen === "storyboard") {
    e.preventDefault();
    UI.selected = activeCards().map((x) => x.id);
    UI.selectionZone = "main";
    markSelected();
    return;
  }
  if (UI.modal) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
      return;
    }
    if (
      e.key === "Enter" &&
      document.activeElement?.id === "rename-chapter-input"
    ) {
      e.preventDefault();
      handleModalAction("confirm-rename-chapter");
      return;
    }
    if (e.key === "Enter" && !typing) {
      e.preventDefault();
      $(".modal-buttons .primary")?.click();
    }
    return;
  }
  if (UI.menu) {
    e.preventDefault();
    if (["w", "arrowup"].includes(k)) {
      UI.focusIndex =
        (UI.focusIndex + menuItems().length - 1) % menuItems().length;
      uiSound();
    } else if (["s", "arrowdown"].includes(k)) {
      UI.focusIndex = (UI.focusIndex + 1) % menuItems().length;
      uiSound();
    } else if (e.key === "Enter") chooseMenu(UI.focusIndex);
    else if (e.key === "Escape" || k === "tab") closeMenu();
    $$(".menu-choice").forEach((el, i) =>
      el.classList.toggle("focused", i === UI.focusIndex),
    );
    return;
  }
  if (e.key === "Escape" && UI.screen === "browser" && UI.folderId !== "root") {
    e.preventDefault();
    actions["folder-back"]();
    return;
  }
  if (typing) {
    if(e.key==="Escape"&&UI.screen==="perform"){e.preventDefault();PERFORM.flush();UI.screen="storyboard";render();return;}
    if (e.key === "Escape") document.activeElement.blur();
    return;
  }
  if(UI.screen==="perform"&&!UI.quick){
    if(e.key==="Escape"){e.preventDefault();PERFORM.flush();UI.screen="storyboard";render();return;}
    if(e.code==="Space"){e.preventDefault();PERFORM.toggle().catch(e=>toast(e.message));return;}
    if(k.startsWith("arrow")){e.preventDefault();PERFORM.moveCard(["arrowleft","arrowup"].includes(k)?-1:1).catch(e=>toast(e.message));return;}
  }
  if(UI.screen==="completion"&&!UI.quick){
    if(e.key==="Escape"){e.preventDefault();UI.screen="storyboard";render();return;}
    if(k.startsWith("arrow")){
      e.preventDefault();const nodes=[...document.querySelectorAll("[data-completion-card]")];if(!nodes.length)return;
      let i=nodes.findIndex(el=>el.dataset.completionCard===UI.completionSelected.at(-1));if(i<0)i=0;
      const first=nodes[0].getBoundingClientRect(),cols=nodes.filter(el=>Math.abs(el.getBoundingClientRect().top-first.top)<10).length||1;
      const step=k==="arrowleft"?-1:k==="arrowright"?1:k==="arrowup"?-cols:cols;
      const target=nodes[Math.max(0,Math.min(nodes.length-1,i+step))];completionSelect(target.dataset.completionCard,false,e.shiftKey);target.scrollIntoView({block:"nearest"});return;
    }
  }
  if (k === "tab") {
    e.preventDefault();
    UI.quick = false;
    $(".quick-overlay")?.remove();
    uiSound();
    openMenu();
    return;
  }
  if (
    e.key === "Escape" &&
    (UI.screen === "print" ||
      UI.screen === "highlighter" ||
      UI.screen === "assembly")
  ) {
    e.preventDefault();
    UI.screen = "storyboard";
    render();
    return;
  }
  if (e.key === "Escape") {
    if (UI.quick) {
      UI.quick = false;
      $(".quick-overlay")?.remove();
    } else if (UI.highlightTag !== "none") {
      UI.highlightTag = "none";
      refreshHighlights();
    } else {
      UI.selected = [];
      UI.bucketSelected = [];
      markSelected();
    }
    return;
  }
  if (UI.screen === "browser") {
    const list = browserItems();
    if (!list.length) return;
    const cards = $$(".browser-tile"),
      focus = (i) => {
        UI.focusBrowser = Math.max(0, Math.min(list.length - 1, i));
        UI.selectedBrowser = [list[UI.focusBrowser].id];
        $$(".browser-tile").forEach((el, j) =>
          el.classList.toggle("kbd-selected", j === UI.focusBrowser),
        );
        cards[UI.focusBrowser]?.scrollIntoView({ block: "nearest" });
      };
    if (["d", "arrowright"].includes(k)) {
      e.preventDefault();
      focus(UI.focusBrowser + 1);
    }
    if (["a", "arrowleft"].includes(k)) {
      e.preventDefault();
      focus(UI.focusBrowser - 1);
    }
    if (["w", "arrowup", "s", "arrowdown"].includes(k)) {
      e.preventDefault();
      const current = cards[UI.focusBrowser]?.getBoundingClientRect();
      if (current) {
        const isUp = k === "w" || k === "arrowup";
        const nearby = cards
          .map((node, i) => ({ i, r: node.getBoundingClientRect() }))
          .filter((o) =>
            isUp ? o.r.top < current.top - 10 : o.r.top > current.top + 10,
          )
          .sort(
            (a, b) =>
              Math.abs(a.r.top - current.top) -
                Math.abs(b.r.top - current.top) ||
              Math.abs(a.r.left - current.left) -
                Math.abs(b.r.left - current.left),
          );
        if (nearby[0]) {
          const rowTop = nearby[0].r.top;
          const sameRow = nearby
            .filter((o) => Math.abs(o.r.top - rowTop) < 10)
            .sort(
              (a, b) =>
                Math.abs(a.r.left - current.left) -
                Math.abs(b.r.left - current.left),
            );
          focus(sameRow[0].i);
        }
      }
    }
    if (e.key === "Enter") browserOpen(list[UI.focusBrowser]?.id);
    if (k === "delete" || k === "backspace") {
      const id = UI.selectedBrowser[0];
      if (id && id !== "new") {
        UI.contextBrowserId = id;
        chooseContext(
          store.state.folders.some((x) => x.id === id)
            ? "folder-delete"
            : "project-delete",
        );
      }
    }
    return;
  }
  if (
    store.state.settings.altUndoKeys &&
    ["storyboard", "highlighter"].includes(UI.screen) &&
    !modified &&
    !e.altKey &&
    ["n", "m"].includes(k)
  ) {
    e.preventDefault();
    restoreProjectHistory(k !== "n");
    render();
    return;
  }
  if (UI.screen !== "storyboard") return;
  if (k === "r") {
    UI.right = !UI.right;
    render();
    return;
  }
  if (k === "delete" || k === "backspace") {
    e.preventDefault();
    if(UI.selectionZone==='cleanup-archive'&&UI.cleanupArchiveSelected.length&&UI.rightMode==="holding"&&["archived","unassigned"].includes(UI.bucket)&&UI.archiveKind==="cleanups")return actions["cleanup-purge-selected"]();
    deleteSelected();
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    UI.quick = !UI.quick;
    UI.quick ? renderQuick() : $(".quick-overlay")?.remove();
    return;
  }
  if (
    [
      "a",
      "d",
      "arrowleft",
      "arrowright",
      "w",
      "s",
      "arrowup",
      "arrowdown",
    ].includes(k)
  ) {
    e.preventDefault();
    const list = activeCards(),
      current = list.findIndex((c) => UI.selected.includes(c.id));
    const cols = boardLayout().cols;
    let target = current;
    if (k === "a" || k === "arrowleft") target--;
    if (k === "d" || k === "arrowright") target++;
    if (k === "w" || k === "arrowup") target -= cols;
    if (k === "s" || k === "arrowdown") target += cols;
    target = Math.max(0, Math.min(list.length - 1, target));
    if (list[target]) {
      UI.selected = [list[target].id];
      UI.bucketSelected = [];
      const oldPage = boardPage();
      revealCardPage(list[target].id);
      if (boardPage() !== oldPage) render();
      else markSelected();
      if (UI.quick) renderQuick();
    }
    return;
  }
  if (k === "q" || k === "e") {
    const id = UI.selected[0],
      s = item(id),
      count = s && visual(p(), s).count;
    if (count > 1) {
      change("Switch variant", (st) => {
        s.activeVariant =
          (s.activeVariant + (k === "q" ? -1 : 1) + count) % count;
      });
      if (UI.quick) renderQuick();
    }
    return;
  }
  if (e.key === "Enter" && UI.selected.length) {
    e.preventDefault();
    const field = $(`[data-note="${UI.selected[0]}"]`);
    if (field) field.focus();
    else editCardNote(UI.selected[0]);
  }
}
files.addEventListener("change", async () => {
  const fs = [...files.files],
    intent = files.dataset.intent;
  files.value = "";
  try {
    if (intent === "project") {
      for (const f of fs) {
        await importProject(f);
      }
      render();
    } else if (intent === "thumbnail" && fs[0]) {
      const project = store.state.projects.find(
        (x) => x.id === files.dataset.id,
      );
      if (project) {
        const result = await SSImporter.importImageFile(fs[0], project.ratio, {
          forceSingleImage: true,
        });
        change("Change project thumbnail", (s) => {
          project.thumbnailId = result.assetId;
          project.modifiedAt = date();
        });
      }
    } else if (intent === "images") {
      await importImageFiles(
        fs,
        p(),
        async (ids) =>
          change(`Import ${ids.length} drawing(s)`, (s) => {
            const newcards = ids.map((id) => card(UI.chapterId, id));
            const bucket = files.dataset.destination;
            if (bucket === "stories") p().stories.push(...newcards);
            else if (bucket === "assets") s.globalAssets.push(...newcards);
            else (p()[bucket] || p().unassigned).push(...newcards);
          }),
        {
          forceSingleImage:
            files.dataset.destination === "assets" ? true : undefined,
        },
      );
    } else if (["variant", "replace"].includes(intent)) {
      const id = files.dataset.id,
        s = item(id);
      if (s && fs[0])
        await importImageFiles(
          fs,
          p(),
          async (ids) =>
            change("Change variant", (state) => {
              const src = sourceCard(p(), s);
              if (intent === "replace") {
                src.variants = [{ assetId: ids[0] }];
                s.blank = false;
                s.activeVariant = 0;
              } else {
                src.variants.push({ assetId: ids[0] });
                s.activeVariant = src.variants.length - 1;
                s.blank = false;
              }
            }),
          { forceSingleImage: true },
        );
    }
  } catch (err) {
    console.error(err);
    toast(err.message||String(err));
  }
  render();
});
app.addEventListener("focusin", (e) => {
  if (e.target.matches("textarea[data-note]")) {
    const row = e.target.closest(".story-entry");
    if (row) row.draggable = false;
  }
});
app.addEventListener("focusout", (e) => {
  if (e.target.matches("textarea[data-note]")) {
    const row = e.target.closest(".story-entry");
    if (row) row.draggable = true;
    flushNoteSave();
  }
  if (
    e.target.matches("[data-chapter-rename]") &&
    UI.renamingChapterId === e.target.dataset.chapterRename
  )
    commitChapterRename();
});
app.addEventListener("pointerdown",e=>{
  if(UI.renamingChapterId&&!e.target.closest("[data-chapter-rename]")){
    // Save before blur, but keep the pressed element alive until its click runs.
    const input=document.querySelector("[data-chapter-rename]");
    commitChapterRename(false,false);input?.blur();
    document.addEventListener("pointerup",()=>setTimeout(()=>render(),0),{once:true});
  }
},true);
app.addEventListener("click", onClick);
app.addEventListener("change", onChange);
app.addEventListener("input", onInput);
app.addEventListener("contextmenu", onContext);
app.addEventListener("dragstart", onDragStart);
app.addEventListener("dragover", onDragOver);
app.addEventListener("dragleave", (e) =>
  e.target.closest(".drop-hover")?.classList.remove("drop-hover"),
);
app.addEventListener("drop", onDrop);
app.addEventListener("dragend", () => {
  cancelChapterDwell();
  document.body.classList.remove("dragging-chapter", "dragging-subchapter");
  $$(".dragging-source,.drop-before,.drop-after,.drop-onto").forEach((x) =>
    x.classList.remove("dragging-source", "drop-before", "drop-after"),
  );
  UI.dragSlot = null;
  UI.dragPlacement = null;
  UI.dragHoverChapter = null;
  $$(".chapter-row").forEach((el) =>
    el.classList.remove(
      "drop-chapter-before",
      "drop-chapter-after",
      "drop-chapter-child",
    ),
  );
});
app.addEventListener("pointerdown", (e) => {
  const note = e.target.closest("textarea[data-note]");
  if (note) {
    const row = note.closest(".story-entry");
    if (row) row.draggable = false;
  }
});
app.addEventListener("pointerdown", onLassoDown);
document.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".context-pop")) return;
  $(".context-pop")?.remove();
  if (e.target.matches(".modal-overlay")) closeModal();
  else if (e.target.matches(".menu-overlay")) closeMenu();
},true);
document.addEventListener(
  "click",
  (e) => {
    const otherAct = e.target.closest("[data-act]");
    if (otherAct && !app.contains(otherAct)) {
      uiSound();
      actions[otherAct.dataset.act]?.(otherAct);
      return;
    }
    const ctx = e.target.closest("[data-context]");
    if (ctx && !app.contains(ctx)) {
      uiSound();
      chooseContext(ctx.dataset.context);
      return;
    }
    const btn = e.target.closest("[data-modal-btn]");
    if (btn && !app.contains(btn)) {
      uiSound();
      handleModalAction(btn.dataset.modalBtn);
      return;
    }
    const m = e.target.closest("[data-menu-option]");
    if (m && !app.contains(m)) {
      uiSound();
      chooseMenu(+m.dataset.menuOption);
      return;
    }
    const swatch = e.target.closest("[data-folder-hue]");
    if (swatch && !app.contains(swatch)) {
      selectFolderColor(swatch);
      return;
    }
  },
  true,
);
// Modals live under document.body rather than #app: dispatch their actual input events.
document.addEventListener("change", (e) => {
  if (!app.contains(e.target) && e.target.closest(".modal-overlay"))
    onChange(e);
});
document.addEventListener("contextmenu", (e) => {
  if (!app.contains(e.target) && e.target.closest(".modal-overlay"))
    onContext(e);
});
document.addEventListener("input", (e) => {
  if (!app.contains(e.target) && e.target.closest(".modal-overlay")) {
    if (e.target.matches('[data-setting][type="range"]')) onChange(e);
    else onInput(e);
  }
});
document.addEventListener("keydown", onKey);
app.addEventListener("pointerdown", beginCompletionSidebarResize);
document.addEventListener("pointerover", (e) => {
  if (UI.screen === "browser" && !UI.menu && !UI.modal) {
    const b = e.target.closest("[data-browse]");
    if (b) {
      const next = browserItems().findIndex((x) => x.id === b.dataset.browse);
      if (next !== UI.focusBrowser) uiSound();
      UI.focusBrowser = next;
      $$(".browser-tile").forEach((el, i) =>
        el.classList.toggle("kbd-selected", i === UI.focusBrowser),
      );
    }
  }
  const m = e.target.closest(".menu-choice");
  if (!m || !UI.menu) return;
  const next = +m.dataset.menuOption;
  if (next !== UI.focusIndex) {
    UI.focusIndex = next;
    uiSound();
    $$(".menu-choice").forEach((el, i) =>
      el.classList.toggle("focused", i === next),
    );
  }
});
document.addEventListener("ss-save-failed", (e) =>
  modal(
    "Save Failed",
    `<p>Cannot save the latest project data: ${esc(e.detail)}</p><p>Do not close the app until you have exported a project backup.</p>`,
    [{ text: "Close", action: "close-modal" }],
  ),
);
// Flush pending inline-note saves before the native window closes.
window.addEventListener("beforeunload", () => {
  flushNoteSave();
});
window.addEventListener("pagehide", flushNoteSave);
window.addEventListener("focus", () => {
  if (
    UI.screen === "assembly" &&
    !p()?.studioLink?.directory &&
    !["timing", "export"].includes(UI.prepareStep)
  )
    ASSEMBLY.check().catch((e) => toast(e.message));
  if (window.__TAURI__?.core?.invoke && store.state.assetFolders?.length)
    assetFolders.check(true).catch((e) => toast(e.message));
});
store.subscribe(() => {
  if (p()) STUDIO.schedule();
});
window.addEventListener("focus", () => {
  if (p()?.studioLink?.directory) STUDIO.refresh().catch(() => {});
});
activateScrollFade();
render();

function tagTargetIds() {
  const selected =
    UI.selectionZone === "bucket" ? UI.bucketSelected : UI.selected;
  return selected.includes(UI.contextCardId)
    ? [...selected]
    : [UI.contextCardId].filter(Boolean);
}
function commitChapterRename(cancel = false, shouldRender = true) {
  const id = UI.renamingChapterId;
  if (!id) return;
  const field = $(`[data-chapter-rename="${id}"]`),
    name = field?.value.trim();
  UI.renamingChapterId = null;
  if (!cancel && name && name !== p().chapters.find((c) => c.id === id)?.name)
    change("Rename chapter", () => {
      const ch = p().chapters.find((c) => c.id === id);
      if (ch) ch.name = name;
    }, {render:shouldRender});
  else if(shouldRender)render();
}

function activateScrollFade() {
  if (activateScrollFade.initialized) return;
  activateScrollFade.initialized = true;
  const active = new Map();
  activateScrollFade.cleanup = () => {
    for (const [el, entry] of active) {
      if (el.isConnected) continue;
      clearTimeout(entry.timer);
      clearTimeout(entry.clearTimer);
      entry.vertical?.remove();
      entry.horizontal?.remove();
      active.delete(el);
    }
  };
  document.addEventListener(
    "scroll",
    (event) => {
      const el =
        event.target === document ? document.scrollingElement : event.target;
      if (!(el instanceof HTMLElement)) return;
      const v = el.scrollHeight > el.clientHeight + 2,
        h = el.scrollWidth > el.clientWidth + 2;
      if (!v && !h) return;
      let entry = active.get(el);
      if (!entry) {
        entry = {
          vertical: null,
          horizontal: null,
          timer: 0,
          clearTimer: 0,
          dragging: false,
        };
        active.set(el, entry);
      }
      clearTimeout(entry.timer);
      clearTimeout(entry.clearTimer);
      const rect = el.getBoundingClientRect();
      function show(axis) {
        let thumb = entry[axis];
        if (!thumb) {
          thumb = document.createElement("div");
          thumb.className = "overlay-scroll-thumb " + axis;
          document.body.append(thumb);
          entry[axis] = thumb;
          thumb.addEventListener("pointerdown", (ev) => {
            if (ev.button !== 0) return;
            ev.preventDefault();
            ev.stopPropagation();
            entry.dragging = true;
            clearTimeout(entry.timer);
            clearTimeout(entry.clearTimer);
            thumb.classList.add("dragging");
            const vertical = axis === "vertical",
              start = vertical ? ev.clientY : ev.clientX,
              initial = vertical ? el.scrollTop : el.scrollLeft;
            const client = vertical ? el.clientHeight : el.clientWidth,
              total = vertical ? el.scrollHeight : el.scrollWidth;
            const track = Math.max(12, client - 8),
              len = Math.max(22, Math.min(track, (client / total) * track));
            thumb.setPointerCapture(ev.pointerId);
            const move = (e) => {
              if (e.pointerId !== ev.pointerId) return;
              const delta = (vertical ? e.clientY : e.clientX) - start;
              el[vertical ? "scrollTop" : "scrollLeft"] =
                initial + (delta * (total - client)) / Math.max(1, track - len);
            };
            const finish = (e) => {
              if (e.pointerId !== ev.pointerId) return;
              entry.dragging = false;
              thumb.classList.remove("dragging");
              thumb.removeEventListener("pointermove", move);
              thumb.removeEventListener("pointerup", finish);
              thumb.removeEventListener("pointercancel", finish);
              thumb.removeEventListener("lostpointercapture", finish);
              if (thumb.hasPointerCapture(ev.pointerId))
                thumb.releasePointerCapture(ev.pointerId);
              el.dispatchEvent(new Event("scroll"));
            };
            thumb.addEventListener("pointermove", move);
            thumb.addEventListener("pointerup", finish);
            thumb.addEventListener("pointercancel", finish);
            thumb.addEventListener("lostpointercapture", finish);
          });
        }
        const vertical = axis === "vertical",
          client = vertical ? el.clientHeight : el.clientWidth,
          total = vertical ? el.scrollHeight : el.scrollWidth,
          scroll = vertical ? el.scrollTop : el.scrollLeft;
        const track = Math.max(12, client - 8),
          len = Math.max(22, Math.min(track, (client / total) * track)),
          offset =
            (Math.max(0, scroll) / Math.max(1, total - client)) * (track - len);
        Object.assign(
          thumb.style,
          vertical
            ? {
                top: rect.top + 4 + offset + "px",
                left: rect.right - 6 + "px",
                width: "3px",
                height: len + "px",
              }
            : {
                top: rect.bottom - 6 + "px",
                left: rect.left + 4 + offset + "px",
                width: len + "px",
                height: "3px",
              },
        );
        thumb.classList.add("visible");
      }
      if (v) show("vertical");
      if (h) show("horizontal");
      entry.timer = setTimeout(() => {
        if (entry.dragging) return;
        entry.vertical?.classList.remove("visible");
        entry.horizontal?.classList.remove("visible");
        entry.clearTimer = setTimeout(() => {
          entry.vertical?.remove();
          entry.horizontal?.remove();
          active.delete(el);
        }, 470);
      }, 1000);
    },
    true,
  );
}
window.addEventListener("resize", () => {
  if (UI.screen === "storyboard") render();
  updateAllBlankNoteOverflows();
  activateScrollFade.cleanup?.();
});

installCloseFlow({notify:toast,flush:progress=>saveAllProjectMedia({closing:true,progress})});


function positionInsertButtons(){for(const button of document.querySelectorAll('.board-slot .gap-target')){const slot=button.closest('.board-slot'),art=slot.querySelector('.story-frame');if(art)button.style.top=(art.getBoundingClientRect().top-slot.getBoundingClientRect().top+art.getBoundingClientRect().height/2)+'px';}}
let insertHoverFrame=0;
app.addEventListener('pointermove',e=>{if(UI.screen!=='storyboard')return;cancelAnimationFrame(insertHoverFrame);insertHoverFrame=requestAnimationFrame(()=>{for(const button of app.querySelectorAll('.gap-target')){const r=button.getBoundingClientRect(),cx=r.x+r.width/2,cy=r.y+r.height/2;button.classList.toggle('is-near',Math.abs(e.clientX-cx)<=r.width*1.725&&Math.abs(e.clientY-cy)<=r.height*1.725);}});});
app.addEventListener('pointerleave',()=>app.querySelectorAll('.gap-target.is-near').forEach(b=>b.classList.remove('is-near')));

document.addEventListener('pointerdown',e=>{for(const d of document.querySelectorAll('details[open]'))if(d.matches('.page-help,.prepare-help details')&&!d.contains(e.target))d.open=false;if(!e.target.closest('[data-hl-action="help"],.hl-help'))HL.closeHelp();},true);
installDesktopDrop({active:value=>{UI.nativeDragging=value;},cleanupMode:()=>UI.screen==='storyboard'&&p()?.viewPrefs.boardMode==='cleanup',notify:toast,hover:(target,point)=>{if(target&&point)onDragOver({preventDefault(){},target,clientX:point.x,clientY:point.y,dataTransfer:{types:['Files']}});},leave:()=>{UI.dragSlot=null;cancelPageDragHover();},drop:async(paths,target,point)=>{
 const cardId=target?.closest('.story-entry[data-card]')?.dataset.card;
 if(UI.screen==='storyboard'&&p()?.viewPrefs.boardMode==='cleanup'){if(!cardId)return toast('Drop the cleanup on a storyboard card.');return CLEANUP.attach(cardId,paths);}
 cancelPageDragHover();const slotSnapshot=UI.dragSlot?{...UI.dragSlot}:null,chapterSnapshot=UI.chapterId,projectSnapshot=p()?.id;const incoming=[];for(const path of paths){const name=path.replace(/\\/g,'/').split('/').at(-1);if(/\.(storyboardstudio|sshltest)$/i.test(name)){const text=await window.__TAURI__.core.invoke('read_dropped_document',{path});incoming.push(new File([text],name,{type:'application/json'}));}else if(/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(name)){const pos=path.replace(/\\/g,'/').lastIndexOf('/'),data=await window.__TAURI__.core.invoke('read_asset_image',{directory:path.slice(0,pos),relativePath:name}),blob=await(await fetch(data)).blob();incoming.push(new File([blob],name,{type:blob.type}));}}
 if(incoming.length){await onDrop({preventDefault(){},slotSnapshot,chapterSnapshot,projectSnapshot,target:target||app,dataTransfer:{files:incoming,getData(){return '';}}});}
}});

installPointerDrag(app,{start:onDragStart,over:onDragOver,drop:onDrop,end:()=>{UI.drag=null;UI.dragSlot=null;cancelChapterDwell();cancelPageDragHover();document.querySelectorAll('.dragging-source,.drop-before,.drop-after,.drop-onto').forEach(el=>el.classList.remove('dragging-source','drop-before','drop-after','drop-onto'));}});

let savingAll=null;
function nativeInvoke(name,args){return window.__TAURI__?.core?.invoke(name,args);}
var menuState;
function updateNativeMenu(){const active=!!p(),linked=!!p()?.studioLink?.directory,key=active+':'+linked;if(menuState===key)return;menuState=key;void nativeInvoke('update_file_menu',{active,linked})?.catch(()=>{});}
async function makeBackup(closing=false){const project=p();if(!project||!window.__TAURI__?.core?.invoke)return;const document=await projectDocument(project);for(const key of ['organizationIssues','pendingMediaSave','cancelledDrawingUpdates'])if(document.project.studioLink)delete document.project.studioLink[key];await nativeInvoke('save_project_backup',{projectId:project.id,snapshot:JSON.stringify(document),closing});}
async function saveAllProjectMedia({closing=false,progress=null}={}){
 if(closing)document.querySelector('[data-review-cancel]')?.click();
 if(closing&&(UI.audioChoice||UI.outputChoice)){UI.audioChoice?.(false);UI.outputChoice?.('cancel');UI.audioChoice=null;UI.outputChoice=null;closeModal();}
 if(cardExportTask){if(!closing)return toast('Wait for the current card export to finish.');await cardExportTask.catch(()=>{});}if(savingAll){await savingAll.catch(e=>{if(!closing)throw e;});if(!closing)return;}
 if(!p())return;
 savingAll=(async()=>{closeProgress=progress;if(closing)PERFORM.pause();PERFORM.flush();flushNoteSave();if(store.save()===false)throw Error('Could not save project data. Free some disk space before closing.');
 const before=JSON.stringify(p());let root=p().studioLink?.directory,issues=[];const hadRoot=!!root;if(root){try{root=await STUDIO.verifyRoot({locate:!closing});if(!root)issues.push('Project folder was not reconnected. Media files were left unchanged.');}catch(error){issues.push(String(error.message||error));root=null;}}
 if(!root&&!hadRoot&&!closing&&window.__TAURI__?.core?.invoke){toast('Choose or create a project folder. Cards will be saved in separate chapter folders.');if(await STUDIO.choose())root=p().studioLink.directory;}
 if(root){if(!closing){const overlay=document.createElement('div');overlay.className='export-progress-overlay save-media-overlay';overlay.innerHTML='<section><h2>Saving project media…</h2><p data-card-export-progress>Checking files…</p><progress></progress></section>';document.body.append(overlay);app.setAttribute('inert','');}delete p().studioLink.pendingMediaSave;const attempt=async fn=>{try{await fn();}catch(e){issues.push(String(e.message||e));p().studioLink.pendingMediaSave=issues.join('\n');}};await attempt(()=>CLEANUP.refresh());await attempt(()=>CLEANUP.prepare());await attempt(()=>STUDIO.storyboards(ordered(p()),{reuse:true,interactive:!closing}));await attempt(()=>CLEANUP.sync());await attempt(()=>STUDIO.sync());await attempt(()=>STUDIO.supervise());}
 progress?.(1,1,'Saving recovery copy…');try{await makeBackup(closing);}catch(e){issues.push('Recovery copy: '+String(e.message||e));}if(store.save()===false)throw Error('Could not save project data.');progress?.(1,1,'Saved');
 if(!closing&&before!==JSON.stringify(p()))refreshSharedView();
 if(!closing)toast(issues.length?'Project saved. Some media need attention: '+issues[0]:!root?'Project saved internally. No project folder selected.':before===JSON.stringify(p())?'Everything is up to date.':'Project and changed media saved.');
 })();try{return await savingAll;}finally{savingAll=null;closeProgress=null;document.querySelector('.save-media-overlay')?.remove();if(!document.querySelector('.saving-overlay'))app.removeAttribute('inert');}
}
async function duplicateProject(){PERFORM.flush();flushNoteSave();await makeBackup(true);const original=p(),copy=structuredClone(original);copy.id=uid();copy.name=original.name+' copy';copy.createdAt=date();copy.updatedAt=date();detachProjectMedia(copy);store.change('Duplicate project',state=>{state.projects.push(copy);store.projectId=copy.id;});UI.chapterId=copy.chapters.find(c=>!c.unused)?.id;UI.screen='storyboard';render();toast('Independent project copy opened. Choose its own project folder before exporting.');}
async function fileAction(id){if(id==='file-backups')return nativeInvoke('show_project_backups');if(!p())return;if(id==='file-save')return saveAllProjectMedia();if(id==='file-duplicate')return duplicateProject();if(['file-choose','file-change','file-locate'].includes(id))return STUDIO.choose();if(id==='file-show')return STUDIO.showFolder();if(id==='file-export')return exportProject(p());if(id==='file-pdf')return exportPages('pdf');if(id==='file-png')return exportPages('png');if(id==='file-cards')return exportCards();if(id==='file-check')return STUDIO.supervise(true);if(id==='file-restore'){const text=await nativeInvoke('pick_project_backup',{projectId:p().id});if(text){await importProject(new File([text],'Recovered.StoryboardStudio',{type:'application/json'}));UI.screen='browser';render();toast('Recovery copy opened as a separate project.');}}}
window.__TAURI__?.event?.listen('studio-file-action',event=>{void fileAction(event.payload).catch(e=>toast(String(e.message||e)));}).catch(()=>{});
setInterval(()=>{if(!savingAll&&!cardExportTask)void makeBackup().catch(()=>{});},20*60*1000);
let pageHoverTimer=0,pageHoverAct='',pageHoverPoint=null;
function cancelPageDragHover(){clearTimeout(pageHoverTimer);pageHoverTimer=0;pageHoverAct='';pageHoverPoint=null;}
function pageDragHover(e){const arrow=e.target.closest('[data-act="board-prev"],[data-act="board-next"]');if(!arrow||arrow.disabled||!(UI.drag?.type==='cards'||UI.nativeDragging||[...(e.dataTransfer?.types||[])].includes('Files'))){cancelPageDragHover();return;}pageHoverPoint={x:e.clientX,y:e.clientY};const act=arrow.dataset.act;if(pageHoverAct===act)return;cancelPageDragHover();pageHoverAct=act;pageHoverPoint={x:e.clientX,y:e.clientY};const flip=()=>{const next=boardPage()+(act==='board-next'?1:-1);if(next<0||next>=boardLayouts().length)return cancelPageDragHover();UI.dragSlot=null;setBoardPage(next);pageHoverTimer=setTimeout(flip,800);};pageHoverTimer=setTimeout(flip,550);}
document.addEventListener('dragend',cancelPageDragHover,true);

document.addEventListener('input',e=>{if(e.target.matches('textarea[data-naming]')){e.target.style.height='auto';e.target.style.height=e.target.scrollHeight+'px';}});
new MutationObserver(()=>{for(const el of document.querySelectorAll('textarea[data-naming]'))if(el.style.height!==el.scrollHeight+'px'){el.style.height='auto';el.style.height=el.scrollHeight+'px';}}).observe(document.body,{childList:true,subtree:true});

let pointerPressed=false,sharedRenderTimer=0;
function refreshSharedView(){clearTimeout(sharedRenderTimer);if(pointerPressed||UI.drag||UI.nativeDragging||UI.modal||cardExportBusy||UI.screen==='perform'&&PERFORM.isPlaying()){sharedRenderTimer=setTimeout(refreshSharedView,150);return;}render();}
document.addEventListener('pointerdown',()=>{pointerPressed=true;},true);document.addEventListener('pointerup',()=>{pointerPressed=false;},true);document.addEventListener('pointercancel',()=>{pointerPressed=false;},true);

function restoreProjectHistory(redo=false){const before=p();redo?store.redoNow():store.undoNow();prepareCleanupHistoryRestore(before,p());store.save();}

async function verifyProjectRoot(){if(!p()?.studioLink?.directory||!window.__TAURI__?.core?.invoke)return true;try{await STUDIO.verifyRoot();return true;}catch{modal('Project folder unavailable','<p>Locate the moved or renamed project folder to use cleanup media and playback. Ordinary storyboard work remains available.</p>',[{text:'Cancel',action:'close-modal'},{text:'Locate project folder',action:'locate-unavailable-root',primary:true}]);return false;}}

actions['locate-unavailable-root']=async()=>{closeModal();try{await STUDIO.choose();}catch(e){toast(String(e.message||e));}};

function markCleanupArchiveSelection(){for(const el of document.querySelectorAll('[data-cleanup-archive]'))el.classList.toggle('selected',UI.cleanupArchiveSelected.includes(el.dataset.cleanupArchive));}
app.addEventListener('click',e=>{const el=e.target.closest('[data-cleanup-archive]');if(!el||performance.now()<UI.suppressBrowserClickUntil)return;UI.selectionZone='cleanup-archive';const id=el.dataset.cleanupArchive;if(e.metaKey||e.ctrlKey){UI.cleanupArchiveSelected=UI.cleanupArchiveSelected.includes(id)?UI.cleanupArchiveSelected.filter(x=>x!==id):[...UI.cleanupArchiveSelected,id];}else if(e.shiftKey){const ids=[...document.querySelectorAll('[data-cleanup-archive]')].map(el=>el.dataset.cleanupArchive),a=ids.indexOf(UI.cleanupArchiveSelected[0]),b=ids.indexOf(id);UI.cleanupArchiveSelected=ids.slice(Math.min(a<0?b:a,b),Math.max(a,b)+1);}else UI.cleanupArchiveSelected=[id];UI.selected=[];UI.bucketSelected=[];markCleanupArchiveSelection();});
