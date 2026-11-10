import {fitScale} from './media-supervisor.js';
import {normalizePath} from './local-paths.js';
import {appearanceKey} from './file-organization.js';
import {currentCleanup,mediaPath} from './cleanup-model.js';
import {uniqueRecordings} from "./recording-identity.js";
import {
  drawingKey,
  namingProfile,
  chapterDirectories,
  renderName,
  namingContext,
} from "./studio-link-model.js";
import {
  resolveCardImages,
  cardVisualIdentity,
} from "./image-assembly-model.js";
import { timingStale } from "./video-timing-model.js";
import { chapterNumberFor } from "./project-reference.js";
export const RATES = {
  23.976: [24000, 1001, 24, true],
  24: [24, 1, 24, false],
  25: [25, 1, 25, false],
  29.97: [30000, 1001, 30, true],
  30: [30, 1, 30, false],
  50: [50, 1, 50, false],
  59.94: [60000, 1001, 60, true],
  60: [60, 1, 60, false],
};
export const exportDefaults = () => ({
  workflowVersion: 2,
  editor: "premiere",
  fps: "30",
  resolution: "1080",
  recording: "all",
  includeAudio: true,
  splitAudio:false,chapterMarkers:false,defaultCardDuration:3,
  copyImages: false,
  drawingMode: "mixed",
  linkComponents: false,
  order: [],
  excludedCues: [],
});
export function exportOptions(p) {
  const r = p.timelineExport || {},
    base = exportDefaults();
  return {
    ...base,
    editor: "premiere",
    audioMode:r.audioMode==='mono'?'mono':'stereo',
    fps: RATES[r.fps] ? r.fps : base.fps,
    resolution: ["1080", "2160"].includes(r.resolution)
      ? r.resolution
      : base.resolution,
    recording: "all",
    includeAudio: r.includeAudio!==undefined?r.includeAudio===true:!!(p.studioLink?.activeAudio||(p.videoTiming?.tracks||[]).some(t=>t.audioPath||t.audioAssetId||t.source?.path)),
    splitAudio:r.splitAudio===true,chapterMarkers:r.chapterMarkers===true,
    defaultCardDuration:Math.min(3600,Math.max(.1,Number(r.defaultCardDuration)||3)),
    copyImages: false,
    drawingMode: ["mixed", "storyboards", "cleanups"].includes(r.drawingMode)
      ? r.drawingMode
      : "mixed",
    linkComponents: r.linkComponents === true,
    order: Array.isArray(r.order)
      ? [...new Set(r.order.filter((id) => typeof id === "string"))]
      : [],
    excludedCues: Array.isArray(r.excludedCues)
      ? r.excludedCues.filter((id) => typeof id === "string")
      : [],
  };
}
const clean = (s) =>
  String(s ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/gu, "");
const xml = (s) =>
  clean(s).replace(
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
export function safeFile(s) {
  const name =
      clean(s)
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/[. ]+$/, "") || "Timeline",
    ext = name.match(/\.[a-z0-9]{1,6}$/i)?.[0] || "",
    stem = ext ? name.slice(0, -ext.length) : name;
  let out = "",
    bytes = ext.length;
  for (const c of stem) {
    const n = c.codePointAt(0),
      size = n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4;
    if (bytes + size > 90) break;
    out += c;
    bytes += size;
  }
  return (out || "Timeline") + ext;
}
export function absoluteJoin(root, relative) {
  const p = normalizePath(root);
  if (
    /[\x00-\x1f]/u.test(p) ||
    (!p.startsWith("/") && !/^[a-z]:\//i.test(p)) ||
    p.startsWith("//")
  )
    throw Error("Choose a folder on a local drive.");
  return p.replace(/\/+$/, "") + "/" + relative;
}
export function fileUrl(path) {
  const p = absoluteJoin(path, "").replace(/\/$/, "");
  return (
    (p.startsWith("/") ? "file://localhost" : "file:///") +
    p
      .split("/")
      .map((s, i) =>
        i === 0 && /^[a-z]:$/i.test(s)
          ? s
          : encodeURIComponent(s).replace(
              /[!'()*]/g,
              (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
            ),
      )
      .join("/")
  );
}
export function recordingOrder(p, o = exportOptions(p)) {
  const ch = new Map(p.chapters.map((c, i) => [c.id, i])),
    order = new Map(o.order.map((id, i) => [id, i]));
  return uniqueRecordings(p.videoTiming?.tracks || [])
    .slice()
    .sort(
      (a, b) =>
        (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) ||
        Math.min(...a.chapterIds.map((id) => ch.get(id) ?? Infinity)) -
          Math.min(...b.chapterIds.map((id) => ch.get(id) ?? Infinity)) ||
        a.id.localeCompare(b.id),
    );
}
function untimedTracks(p,o){let time=0;const seconds=Number(o.defaultCardDuration)||3,cues=[];for(const ch of p.chapters.filter(ch=>!ch.unused))for(const c of p.stories.filter(c=>c.chapterId===ch.id)){cues.push({id:'untimed-'+c.id,cardId:c.id,chapterId:ch.id,start:time,end:time+seconds,spokenText:''});time+=seconds;}return time?[{id:'untimed-sequence',synthetic:true,source:{duration:time,name:'Untimed sequence'},chapterIds:p.chapters.filter(ch=>!ch.unused).map(ch=>ch.id),cues}]:[];}
export function buildTimelinePlan(p, o = exportOptions(p), assetFolders = []) {
  o={...o,recording:"all",copyImages:false};
  if (!RATES[o.fps]) throw Error("Choose a supported frame rate.");
  const [num, den, base, ntsc] = RATES[o.fps],
    q = (t) => Math.round((t * num) / den),
    ceil = (t) => Math.ceil((t * num) / den - 1e-9),
    h = o.resolution === "2160" ? 2160 : 1080;
  const [width, height] =
    p.ratio === "9:16"
      ? [h, (h * 16) / 9]
      : p.ratio === "4:3"
        ? [(h * 4) / 3, h]
        : [(h * 16) / 9, h];
  const savedTracks = recordingOrder(p, o),
    tracks=savedTracks.some(t=>(t.cues||[]).some(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start))?savedTracks:untimedTracks(p,o),
    errors = [],
    warnings = [],
    cues = [],
    recordings = [],
    media = new Map(),
    excluded = new Set(o.excludedCues),
    batches = new Map(
      (p.imageAssembly?.batches || []).map((b, i) => [b.id, i + 1]),
    );
  let offset = 0;
  const error = (message, cueId = null, trackId = null) =>
    errors.push({ message, cueId, trackId });
  if(!tracks.length)error("Add at least one card to the storyboard.");
  const untimed=tracks.some(t=>t.synthetic);
  if(untimed)warnings.push({message:`No audio timings are available. Cards will be placed in storyboard order, each lasting ${o.defaultCardDuration||3} seconds. You can adjust their timing in your video editor.`});
  for (const t of tracks) {
    const duration = t.source?.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      error("Invalid recording duration.", null, t.id);
      continue;
    }
    const frames = ceil(duration),
      r = {
        id: t.id,
        name: t.source.name,
        offset,
        frames,
        duration,
        chapterIds: t.chapterIds,
        audioAssetId: t.audioAssetId,
        audioPath: t.audioPath || t.source?.path || null,
        source:{...t.source,path:t.audioPath||t.source?.path},
        channels: t.source?.channels || null,
        sampleRate: t.source?.sampleRate || null,
      };
    if(!t.synthetic&&o.includeAudio)recordings.push(r);
    if (o.includeAudio&&!t.synthetic&&!t.audioAssetId && !t.audioPath && !t.source?.path)
      error(
        t.source.name +
          ": locate the original audio in Subtitler.",
        null,
        t.id,
      );
    let previousEnd = 0;
    for (const c of t.cues || []) {
      if (c.excluded || excluded.has(c.id)) continue;
      const chapter = p.chapters.find((ch) => ch.id === c.chapterId),
        card = p.stories.find((s) => s.id === c.cardId),
        issues = [];
      const issue = (m) => {
        error(m, c.id, t.id);
        issues.push(m);
      };
      const entry = {
        id: c.id,
        trackId: t.id,
        chapterId: c.chapterId,
        cardId: c.cardId,
        spokenText: c.spokenText || "",
        reviewed: !!c.reviewed,
        files: [],
        issues,
        title: "Card",
      };
      if (
        !chapter ||
        chapter.unused ||
        !card ||
        card.chapterId !== chapter.id ||
        !t.chapterIds.includes(chapter.id)
      ) {
        issue("The linked card/chapter changed. Match the recording again.");
        cues.push(entry);
        continue;
      }
      entry.title = `${chapterNumberFor(p, chapter)} · ${chapter.name} / Card ${p.stories.filter((s) => s.chapterId === chapter.id).findIndex((s) => s.id === card.id) + 1}`;
      if (!t.synthetic&&timingStale(p, t))
        issue("Script links changed. Match this recording again.");
      if (
        !Number.isFinite(c.start) ||
        !Number.isFinite(c.end) ||
        c.start < 0 ||
        c.end <= c.start ||
        c.end > duration + 0.0001
      ) {
        issue("Match this recording with Subtitler to supply usable timings.");
        cues.push(entry);
        continue;
      }
      const start = q(c.start),
        end = Math.abs(c.end - duration) < 0.0001 ? frames : q(c.end);
      entry.start = offset + start;
      entry.end = offset + end;
      if (end <= start)
        issue(
          "This cue is shorter than a frame. Lengthen it or choose a higher frame rate.",
        );
      if (start < previousEnd)
        issue("Included cue times overlap or are out of order.");
      previousEnd = end;
      for (const detail of c.issues || [])
        warnings.push({ cueId: c.id, message: detail });
      const identity = cardVisualIdentity(p, card),
        source =
          ["stories", "unassigned", "lost", "archived"]
            .flatMap((k) => p[k] || [])
            .find((s) => s.id === identity.sourceId) || card,
        variant = source.variants?.[identity.index],
        ref = variant?.sourceFile,
        folder = ref ? assetFolders.find((f) => f.id === ref.folderId) : null;
      const legacy=resolveCardImages(p,card),cleanup=currentCleanup(p,card);
      if(o.drawingMode!=='storyboards'&&cleanup.entry&&cleanup.status==='ready'){
        entry.representation='cleanup';for(const f of cleanup.files){
          const path=mediaPath(p,f),pos=path.replace(/\\/g,'/').lastIndexOf('/'),root=path.slice(0,pos),relativePath=path.slice(pos+1),key='cleanup/'+path;
          if(f.kind==='image'&&!/\.(png|jpe?g|tiff?|bmp)$/i.test(f.name))issue('Export this cleanup as PNG, JPEG, TIFF or BMP, or use a movie for animation.');
          if(!media.has(key))media.set(key,{...f,key,name:f.name||relativePath,kind:f.kind,cleanup:true,direct:true,root,relativePath,sourcePath:path});
          entry.files.push({key,label:f.name||relativePath,layer:entry.files.length+2,stackOrder:entry.files.length+1});
        }cues.push(entry);continue;
      }
      const result=cleanup.entry?{...legacy,status:cleanup.status==='none'?'unmatched':'needs-files',group:null,binding:true}:legacy;
      if (ref && !result.binding && o.drawingMode !== "storyboards") {
        const root = folder?.path || ref.folderPath,
          key = "asset/" + variant.assetId,
          name = String(ref.relativePath || "")
            .split("/")
            .at(-1);
        entry.representation = "asset";
        if (
          !root ||
          folder?.status === "missing" ||
          folder?.missing?.includes(ref.relativePath)
        )
          issue("Relink this reusable asset folder in Assets.");
        if (!/\.(png|jpe?g|tiff?|bmp)$/i.test(name))
          issue("Use PNG, JPEG, TIFF or BMP for this reusable asset.");
        let sourcePath = null;
        try {
          sourcePath = absoluteJoin(root, ref.relativePath);
        } catch {
          issue("The reusable asset folder must be on a local drive.");
        }
        if (!media.has(key))
          media.set(key, {
            key,
            kind: "image",
            direct: true,
            assetId: variant.assetId,
            name,
            root,
            relativePath: ref.relativePath,
            destination:
              "Media/Images/Assets/" +
              safeFile(variant.assetId) +
              "/" +
              ref.relativePath,
            sourcePath,
            width: null,
            height: null,
            size: null,
            modified: null,
          });
        entry.files.push({ key, label: name, layer: 2, stackOrder: 1 });
        cues.push(entry);
        continue;
      }
      if (
        o.drawingMode === "storyboards" ||
        (o.drawingMode === "mixed" && result.status !== "ready")
      ) {
        const record = p.studioLink?.storyboards?.[appearanceKey(p,card)] || p.studioLink?.storyboards?.[drawingKey(p, card)],
          saved=record?.missing?null:record,
          key = "storyboard/" + (saved?.relativePath||drawingKey(p,card)),
          root = p.studioLink?.directory;
        entry.representation = "storyboard";
        if (!identity.assetId)
          warnings.push({
            cueId: c.id,
            message: "Blank storyboard placeholder.",
          });
        if (o.drawingMode === "mixed" && result.status !== "unmatched")
          warnings.push({
            cueId: c.id,
            message:
              "Using storyboard: cleanup " +
              result.status.replaceAll("-", " ") +
              ".",
          });
        const dimensions =
          p.ratio === "9:16"
            ? [1080, 1920]
            : p.ratio === "4:3"
              ? [1440, 1080]
              : [1920, 1080];
        if (!media.has(key))
          media.set(key, {
            key,
            kind: "image",
            storyboard: true,
            cardId: card.id,
            assetId: identity.assetId,
            name: saved?.relativePath?.split("/").at(-1) || "Storyboard.png",
            root,
            relativePath: saved?.relativePath || null,
            sourcePath:
              saved && root ? absoluteJoin(root, saved.relativePath) : null,
            destination:
              "Media/Images/Storyboards/" + safeFile(card.id) + ".png",
            width: dimensions[0],
            height: dimensions[1],
            size: saved?.size ?? null,
            modified: saved?.modified ?? null,
          });
        entry.files.push({ key, label: "Storyboard", layer: 1, stackOrder: 1 });
        cues.push(entry);
        continue;
      }
      if (result.status !== "ready")
        issue(
          result.status === "needs-files"
            ? "Relink the cleaned-image folder in Storyboard vs cleanup."
            : "Choose a cleaned drawing in Storyboard vs cleanup, or use Mixed mode.",
        );
      if (result.group) {
        entry.representation = result.representation;
        const b = result.group.batch;
        if (!b.directory) issue("Relink this cleaned-image folder in Images.");
        if (result.files.length > 64)
          issue("Export at most 64 components per cue.");
        for (const f of result.files
          .slice()
          .sort((a, b) => (a.stackOrder ?? 0) - (b.stackOrder ?? 0))) {
          if (!/\.(png|jpe?g|tiff?|bmp)$/i.test(f.name))
            issue("Use PNG, JPEG, TIFF or BMP for the editor handoff.");
          const key = b.id + "/" + f.path,
            state = b.fileStates?.[f.path];
          if (!media.has(key)) {
            let sourcePath = null;
            try {
              sourcePath = absoluteJoin(b.directory, f.path);
            } catch {
              issue("The image folder must be on a local drive.");
            }
            media.set(key, {
              key,
              kind: "image",
              name: f.name,
              root: b.directory,
              relativePath: f.path,
              destination: `Media/Images/Export_${String(batches.get(b.id) || 1).padStart(3, "0")}/${f.path}`,
              sourcePath,
              width: f.width,
              height: f.height,
              size: state?.size ?? null,
              modified: state?.modified ?? null,
            });
          }
          entry.files.push({
            key,
            label: f.label,
            layer: entry.files.length + 2,
            stackOrder: f.stackOrder,
          });
        }
      }
      cues.push(entry);
    }
    offset += frames;
  }
  if(untimed&&o.includeAudio){const source=p.studioLink?.activeAudio||savedTracks[0]?.source,path=source?.relativePath&&p.studioLink?.directory?absoluteJoin(p.studioLink.directory,source.relativePath):source?.path||savedTracks[0]?.audioPath;
   if(!path||!Number.isFinite(source?.duration)||source.duration<=0)error('Choose readable audio with a known duration, or select Export without audio.');
   else{const frames=ceil(source.duration);recordings.push({id:'untimed-audio',name:source.name||'Audio',audioPath:path,source:{...source,path},duration:source.duration,frames,offset:0,channels:source.channels||null,sampleRate:source.sampleRate||null});offset=Math.max(offset,frames);}}
  if (offset > 2147483647)
    error("The sequence is too long; export recordings separately.");
  if (!cues.length) error("Choose at least one assigned, non-skipped cue.");
  if (cues.reduce((n, c) => n + c.files.length, 0) > 50000)
    error(
      "Export recordings separately when the timeline exceeds 50,000 image clips.",
    );
  const covered = new Set(tracks.flatMap((t) => t.chapterIds)),
    outside = p.chapters.filter(
      (c) =>
        !c.unused &&
        !covered.has(c.id) &&
        ((c.highlighter?.text || "").trim() ||
          p.stories.some((s) => s.chapterId === c.id)),
    );
  if (o.recording === "all" && outside.length)
    warnings.push({
      message:
        "No recording timing: " +
        outside.map((c) => c.name).join(", ") +
        ". These chapters are outside this timeline.",
    });
  const placed = new Set(cues.map((c) => c.cardId)),
    unplaced = p.stories.filter(
      (c) => covered.has(c.chapterId) && !placed.has(c.id),
    );
  if (unplaced.length)
    warnings.push({
      message: `${unplaced.length} card(s) have no included cue and are not placed.`,
    });
  return {
    format: "storyboardstudio-timeline-plan-v1",
    projectId: p.id,
    name: p.name,
    rate: { num, den, base, ntsc, label: o.fps },
    width: Math.round(width),
    height: Math.round(height),
    frames: offset,
    options: { ...o },
    untimed,
    chapterMarkers:p.chapters.filter(ch=>!ch.unused).map(ch=>({chapterId:ch.id,name:chapterNumberFor(p,ch)+' · '+ch.name,start:Math.min(...cues.filter(c=>c.chapterId===ch.id&&Number.isFinite(c.start)).map(c=>c.start))})).filter(m=>Number.isFinite(m.start)).sort((a,b)=>a.start-b.start).slice(1),
    cues,
    recordings,
    media: [...media.values()],
    videoTracks: Math.max(0, ...cues.flatMap(c=>c.files.map(f=>f.layer))),
    errors,
    warnings,
  };
}
export function materializeTimeline(plan, directory, audioInfo = {}) {
  if (plan.errors.length)
    throw Error("Resolve the listed items before exporting.");
  const media = plan.media.map((m) => ({
    ...m,
    path: m.sourcePath,
  }));
  const recordings = (plan.options.includeAudio===false?[]:plan.recordings).map((r, i) => {
    const a = audioInfo[r.id];
    if (
      !a ||
      ![1, 2].includes(a.channels) ||
      (a.sampleRate !== null &&
        (!Number.isFinite(a.sampleRate) ||
          a.sampleRate < 8000 ||
          a.sampleRate > 192000))
    )
      throw Error("Check the attached mono or stereo audio first.");
    if (Math.abs(a.duration - r.duration) > Math.max(0.5, r.duration * 0.01))
      throw Error(
        "Attached audio duration differs from the timing file. Relink the correct recording.",
      );
    const name = safeFile(a.name || r.name);
    if (!/\.(wav|mp3|m4a|aac|flac|ogg|opus|aif|aiff|wma)$/i.test(name))
      throw Error("Unsupported audio filename.");
    fileUrl(a.path || r.audioPath); // An original absolute path is required.
    const key = "audio/" + r.id;
    media.push({
      key,
      kind: "audio",
      name,
      path: a.path || r.audioPath,
      channels: a.channels,
      sampleRate: a.sampleRate,
      frames: r.frames,
    });
    return { ...r, audioKey: key, channels: a.channels };
  });
  return { ...plan, media, recordings };
}
const rateXml = (r) =>
  `<rate><timebase>${r.base}</timebase><ntsc>${r.ntsc ? "TRUE" : "FALSE"}</ntsc></rate>`;
function mediaRate(m,fallback){if(m.kind!=='video'||!m.fps)return fallback;const found=Object.entries(RATES).find(([fps])=>Math.abs(Number(fps)-m.fps)<.02)?.[1];if(found){const[num,den,base,ntsc]=found;return{num,den,base,ntsc};}return{num:Math.round(m.fps*1000),den:1000,base:Math.round(m.fps),ntsc:false};}
export function timelineXml(plan) {
  if (plan.errors.length) throw Error("Resolve the timeline issues first.");
  const handle = Math.ceil(3600 * plan.rate.num / plan.rate.den),
    stillDuration = 2 * handle + Math.max(plan.frames, 1),
    rate = rateXml(plan.rate),
    files = new Map(
      plan.media.map((m, i) => [m.key, { ...m, id: "file-" + (i + 1) }]),
    ),
    seen = new Set();
  const file = (m) => {
    if (seen.has(m.id)) return `<file id="${m.id}"/>`;
    seen.add(m.id);const sourceRate=mediaRate(m,plan.rate),sourceFrames=Math.ceil((m.duration||0)*sourceRate.num/sourceRate.den);
    return `<file id="${m.id}"><name>${xml(m.name)}</name><pathurl>${xml(fileUrl(m.path))}</pathurl>${rateXml(sourceRate)}<duration>${m.kind === "image" ? stillDuration : m.kind === "video" ? sourceFrames : m.frames}</duration><media>${m.kind !== "audio" ? `<video>${m.kind==="image"?"<stillframe>TRUE</stillframe>":""}<samplecharacteristics>${rateXml(sourceRate)}<width>${m.width}</width><height>${m.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></video>` : `<audio>${m.sampleRate ? `<samplecharacteristics><samplerate>${m.sampleRate}</samplerate></samplecharacteristics>` : ""}<channelcount>${m.channels}</channelcount></audio>`}</media></file>`;
  };
  const video = Array.from({ length: plan.videoTracks }, () => []),
    audio = [[], []];
  let id = 0;
  for (const c of plan.cues) {
    const group = c.files.map((f) => {
      const t = video[f.layer - 1],
        clip = {
          id: "video-" + ++id,
          name: c.title + " · " + f.label,
          media: files.get(f.key),
          start: c.start,
          end: files.get(f.key).kind==='video'?Math.min(c.end,c.start+Math.ceil(files.get(f.key).duration*plan.rate.num/plan.rate.den)):c.end,
          track: f.layer,
          index: t.length + 1,
        };
      t.push(clip);
      return clip;
    });
    for(const f of c.files){const m=files.get(f.key);if(m.kind!=='video')continue;const end=Math.min(c.end,c.start+Math.ceil(m.duration*plan.rate.num/plan.rate.den));if(end<c.end){if(!m.holdKey)throw Error('Generate the animation hold frame before exporting to Premiere.');const t=video[f.layer-1],tail={id:'video-'+ ++id,name:m.name+' · hold',media:files.get(m.holdKey),start:end,end:c.end,track:f.layer,index:t.length+1,links:[]};t.push(tail);}}
    for (const clip of group)
      clip.links = plan.options.linkComponents ? group : [];
  }
  for (const r of plan.recordings) {
    const boundaries=plan.options.splitAudio?[...new Set([r.offset,r.offset+r.frames,...plan.cues.flatMap(c=>[c.start,c.end]).filter(n=>n>r.offset&&n<r.offset+r.frames)])].sort((a,b)=>a-b):[r.offset,r.offset+r.frames];
    for(let part=0;part<boundaries.length-1;part++){
      const group = [];
      for (let ch = 0; ch < r.channels; ch++) {
        const t = audio[ch],
          clip = {
            id: "audio-" + ++id,
            name: r.name,
            media: files.get(r.audioKey),
            start: boundaries[part],
            end: boundaries[part+1],
            sourceIn:boundaries[part]-r.offset,
            track: ch + 1,
            index: t.length + 1,
            channel: ch + 1,
          };
        t.push(clip);
        group.push(clip);
      }
      for (const clip of group) clip.links = group;
    }}
  const links = (c, type) =>
    c.links
      .map(
        (l) =>
          `<link><linkclipref>${l.id}</linkclipref><mediatype>${type}</mediatype><trackindex>${l.track}</trackindex><clipindex>${l.index}</clipindex>${type === "audio" && c.links.length === 2 ? "<groupindex>1</groupindex>" : ""}</link>`,
      )
      .join("");
  const tracks = (list, type) =>
    list
      .map(
        (t, i) =>
          "<track>" +
          t
            .map(
              (c) =>
                `<clipitem id="${c.id}"><name>${xml(c.name)}</name><enabled>TRUE</enabled><duration>${type === "video" ? (c.media.kind==='image'?stillDuration:Math.ceil(c.media.duration*mediaRate(c.media,plan.rate).num/mediaRate(c.media,plan.rate).den)) : c.media.frames}</duration>${rateXml(mediaRate(c.media,plan.rate))}<start>${c.start}</start><end>${c.end}</end><in>${type === "video" && c.media.kind==='image' ? handle : (c.sourceIn||0)}</in><out>${(type === "video" && c.media.kind==='image' ? handle : (c.sourceIn||0)) + (c.media.kind==='video'?Math.min(Math.ceil(c.media.duration*mediaRate(c.media,plan.rate).num/mediaRate(c.media,plan.rate).den),Math.round((c.end-c.start)*plan.rate.den/plan.rate.num*mediaRate(c.media,plan.rate).num/mediaRate(c.media,plan.rate).den)):c.end-c.start)}</out>${type === "video" ? `${c.media.kind==='image'?'<stillframe>TRUE</stillframe>':''}<anamorphic>FALSE</anamorphic><alphatype>straight</alphatype><compositemode>normal</compositemode>` : ""}${type === "video" ? `<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype><parameter><parameterid>scale</parameterid><name>Scale</name><value>${fitScale(c.media.width,c.media.height,plan.width,plan.height)}</value></parameter></effect></filter>` : ""}${file(c.media)}<sourcetrack><mediatype>${type}</mediatype><trackindex>${type === "audio" ? c.channel : 1}</trackindex></sourcetrack>${links(c, type)}</clipitem>`,
            )
            .join("") +
          "<enabled>TRUE</enabled><locked>FALSE</locked>" +
          (type === "audio"
            ? `<outputchannelindex>${i + 1}</outputchannelindex>`
            : "") +
          "</track>",
      )
      .join("");
  const audioXml = plan.options.includeAudio===false?'':`<audio><channelcount>2</channelcount><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format><outputs><group><index>1</index><numchannels>2</numchannels><downmix>0</downmix><channel><index>1</index></channel><channel><index>2</index></channel></group></outputs>${tracks(audio, "audio")}</audio>`;
  const markers=plan.options.chapterMarkers?(plan.chapterMarkers||[]).map(m=>`<marker><name>${xml(m.name)}</name><in>${m.start}</in><out>-1</out></marker>`).join(''):'';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="ss-timeline"><name>${xml(plan.name)}</name><duration>${plan.frames}</duration>${rate}<in>0</in><out>${plan.frames}</out><timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>${markers}<media><video><format><samplecharacteristics>${rate}<width>${plan.width}</width><height>${plan.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance><colordepth>24</colordepth></samplecharacteristics></format>${tracks(video, "video")}</video>${audioXml}</media></sequence></xmeml>\n`;
}
// Zero-duration still assets remain stills. Source handles permit left and right trims.
export function timelineFcpxml(plan){
 if(plan.errors.length)throw Error('Resolve the timeline issues first.');
 const gcd=(a,b)=>b?gcd(b,a%b):a,seconds=(n,d=1000000)=>{n=Math.round(n*d);const g=gcd(Math.abs(n),d);return n===0?'0s':d/g===1?`${n/g}s`:`${n/g}/${d/g}s`;},time=f=>seconds(f*plan.rate.den/plan.rate.num,plan.rate.num*1000),files=new Map(plan.media.map((m,i)=>[m.key,{...m,id:'r'+(i+2)}]));
 const formats=[...files.values()].filter(m=>m.kind!=='audio').map((m,i)=>{m.formatId='format'+(i+2);return `<format id="${m.formatId}"${m.kind==='video'?` frameDuration="${seconds(mediaRate(m,plan.rate).den/mediaRate(m,plan.rate).num,mediaRate(m,plan.rate).num)}"`:''} width="${m.width}" height="${m.height}" colorSpace="1-1-1 (Rec. 709)"/>`;}).join('');
 const resources=[...files.values()].map(m=>`<asset id="${m.id}" name="${xml(m.name)}" start="0s" duration="${m.kind==='image'?'0s':m.kind==='video'?seconds(m.duration):time(m.frames)}" hasVideo="${m.kind==='audio'?0:1}" hasAudio="${m.kind==='audio'?1:0}"${m.kind==='audio'?` audioSources="1" audioChannels="${m.channels}" audioRate="${m.sampleRate||48000}"`:` format="${m.formatId}" videoSources="1"`}><media-rep kind="original-media" src="${xml(fileUrl(m.path))}"/></asset>`).join('');let anchored=false;
 const anchor=sourceStart=>{if(anchored)return '';anchored=true;return plan.recordings.map(r=>{const m=files.get(r.audioKey);return `<asset-clip ref="${m.id}" name="${xml(r.name)}" lane="-1" offset="${seconds(sourceStart+r.offset*plan.rate.den/plan.rate.num)}" start="0s" duration="${time(r.frames)}" srcEnable="audio" audioRole="dialogue"/>`;}).join('');};
 const clip=(c,f,offset,primary=false,annotate=false)=>{const m=files.get(f.key),source=m.kind==='image'?3600:0,duration=(c.end-c.start)*plan.rate.den/plan.rate.num,last=Math.max(0,(m.duration||0)-1/(m.fps||24)),hold=m.kind==='video'&&m.duration<duration?`<timeMap><timept time="0s" value="0s" interp="linear"/>${last>0?`<timept time="${seconds(last)}" value="${seconds(last)}" interp="linear"/>`:''}<timept time="${seconds(duration)}" value="${seconds(last)}" interp="linear"/></timeMap>`:'';return `<video ref="${m.id}" name="${xml(m.name)}" offset="${seconds(offset)}"${primary?'':` lane="${f.layer-1}"`} start="${seconds(source)}" duration="${time(c.end-c.start)}">${hold}${primary?anchor(source)+c.files.filter(x=>x!==f).map(x=>clip(c,x,source)).join(''):''}${primary||annotate?`<marker start="${seconds(source)}" duration="${time(c.end-c.start)}" value="${xml(c.title)}" note="${xml(c.spokenText)}"/>`:""}</video>`;};
 const gap=(start,end,contents='')=>`<gap name="Gap" offset="${time(start)}" start="0s" duration="${time(end-start)}">${anchor(0)}${contents}</gap>`;
 let cursor=0,spine='';for(const c of plan.cues.filter(c=>c.files.length).slice().sort((a,b)=>a.start-b.start)){if(c.start>cursor)spine+=gap(cursor,c.start);const rough=c.files.find(f=>f.layer===1);spine+=rough?clip(c,rough,c.start*plan.rate.den/plan.rate.num,true):gap(c.start,c.end,c.files.map((f,i)=>clip(c,f,0,false,i===0)).join(''));cursor=c.end;}if(cursor<plan.frames)spine+=gap(cursor,plan.frames);
 return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10"><resources><format id="r1" name="Storyboard Studio" frameDuration="${time(1)}" width="${plan.width}" height="${plan.height}" colorSpace="1-1-1 (Rec. 709)"/>${formats}${resources}</resources><library><event name="Storyboard Studio"><project name="${xml(plan.name)}"><sequence format="r1" duration="${time(plan.frames)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k"><spine>${spine}</spine></sequence></project></event></library></fcpxml>\n`;
}
export function timelineMap(plan) {
  return JSON.stringify(
    {
      format: "storyboardstudio-editor-handoff-v1",
      projectId: plan.projectId,
      editor: plan.options.editor,
      name: plan.name,
      rate: plan.rate,
      width: plan.width,
      height: plan.height,
      durationFrames: plan.frames,
      recordings: plan.recordings.map((r) => ({
        id: r.id,
        name: r.name,
        startFrame: r.offset,
        durationFrames: r.frames,
        chapterIds: r.chapterIds,
      })),
      cues: plan.cues.map((c) => ({
        id: c.id,
        chapterId: c.chapterId,
        cardId: c.cardId,
        title: c.title,
        startFrame: c.start,
        endFrame: c.end,
        spokenText: c.spokenText,
        files: c.files,
      })),
      media: plan.media.map((m) => ({
        key: m.key,
        name: m.name,
        path: m.path,
        kind: m.kind,
      })),
    },
    null,
    2,
  );
}
