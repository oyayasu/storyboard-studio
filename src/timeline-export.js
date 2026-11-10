import {sameRecording} from './recording-identity.js';
import { renderName, namingContext } from "./studio-link-model.js";
import {
  exportOptions,
  recordingOrder,
  buildTimelinePlan,
  materializeTimeline,
  timelineXml,
  RATES,
} from "./timeline-export-model.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const native = () => !!window.__TAURI__?.core?.invoke,
  invoke = (name, args) => window.__TAURI__.core.invoke(name, args);
const duration = (n) => (Number.isFinite(n) ? n.toFixed(3) + " s" : "—");
function wavInfo(bytes) {
  if (
    bytes.length < 44 ||
    String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.slice(8, 12)) !== "WAVE"
  )
    return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let channels = 0,
    sampleRate = 0,
    byteRate = 0;
  for (let i = 12; i + 8 <= bytes.length; ) {
    const tag = String.fromCharCode(...bytes.slice(i, i + 4)),
      n = v.getUint32(i + 4, true),
      at = i + 8;
    if (tag === "fmt " && n >= 16 && at + 16 <= bytes.length) {
      channels = v.getUint16(at + 2, true);
      sampleRate = v.getUint32(at + 4, true);
      byteRate = v.getUint32(at + 8, true);
    }
    if (tag === "data" && byteRate) {
      return { channels, sampleRate, duration: n / byteRate };
    }
    i = at + n + (n % 2);
  }
  return null;
}
function mp3Info(bytes) {
  let from = 0;
  if (String.fromCharCode(...bytes.slice(0, 3)) === "ID3")
    from =
      10 +
      ((bytes[6] & 127) << 21) +
      ((bytes[7] & 127) << 14) +
      ((bytes[8] & 127) << 7) +
      (bytes[9] & 127);
  for (let i = from; i < Math.min(bytes.length - 4, from + 65536); i++) {
    const b = bytes;
    if (b[i] !== 255 || (b[i + 1] & 224) !== 224) continue;
    const ver = (b[i + 1] >> 3) & 3,
      layer = (b[i + 1] >> 1) & 3,
      rate = (b[i + 2] >> 2) & 3,
      bitrate = b[i + 2] >> 4;
    if (ver === 1 || !layer || rate === 3 || !bitrate || bitrate === 15)
      continue;
    return {
      channels: b[i + 3] >> 6 === 3 ? 1 : 2,
      sampleRate:
        [44100, 48000, 32000][rate] / (ver === 3 ? 1 : ver === 2 ? 2 : 4),
    };
  }
  return null;
}
function bytes64(value) {
  const raw = atob(value || "");
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export function createTimelineExport(host) {
  const ui = {
    projectId: null,
    busy: false,
    progress: "",
    problems: [],
    lastFile: null,
    showAll: false,
    page: 0,
    limit: 6,
  };
  const options = () => exportOptions(host.project()),
    plan = () =>
      buildTimelinePlan(host.project(), options(), host.assetFolders());
  function html() {
    if (ui.projectId !== host.project().id) {
      ui.projectId = host.project().id;
      ui.problems = [];
      ui.lastFile = null;
      ui.showAll = false;
    }
    const p = plan(),
      o = options(),
      issues = new Map();
    for (const e of [...p.errors, ...p.warnings])
      if (e.cueId) {
        const list = issues.get(e.cueId) || [];
        list.push(e.message);
        issues.set(e.cueId, list);
      }
    const list = ui.showAll ? p.cues : p.cues.filter((c) => issues.has(c.id));
    const pages=Math.max(1,Math.ceil(list.length/ui.limit));ui.page=Math.min(ui.page,pages-1);
    return `<section class="timeline-view"><header class="assembly-header"><h2>Timeline preview</h2><button class="primary" data-export-action="write" ${ui.busy || !native() ? "disabled" : ""}>Export timeline</button></header><div class="timeline-options"><label>Drawings<select data-export-option="drawingMode" ${ui.busy ? "disabled" : ""}>${[
      ["mixed", "Mixed"],
      ["storyboards", "Storyboards"],
      ["cleanups", "Cleanups"],
    ]
      .map(
        ([v, t]) =>
          `<option value="${v}" ${o.drawingMode === v ? "selected" : ""}>${t}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Frame rate<select data-export-option="fps" ${ui.busy ? "disabled" : ""}>${Object.keys(
      RATES,
    )
      .sort((a, b) => +a - +b)
      .map(
        (v) =>
          `<option value="${v}" ${o.fps === v ? "selected" : ""}>${v} fps</option>`,
      )
      .join(
        "",
      )}</select></label><label>Audio<select data-export-option="audioMode" ${ui.busy ? "disabled" : ""}><option value="stereo" ${o.audioMode==='stereo'?'selected':''}>Stereo</option><option value="mono" ${o.audioMode==='mono'?'selected':''}>Mono</option></select></label><label>Resolution<select data-export-option="resolution" ${ui.busy ? "disabled" : ""}>${["1080", "2160"].map((v) => `<option value="${v}" ${o.resolution === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><label><input type="checkbox" data-export-without-audio ${!o.includeAudio?'checked':''} ${ui.busy?'disabled':''}>Export without audio</label><label><input type="checkbox" data-export-option="splitAudio" ${o.splitAudio?'checked':''} ${ui.busy||!o.includeAudio?'disabled':''}>Split audio at card changes</label><label><input type="checkbox" data-export-option="chapterMarkers" ${o.chapterMarkers?'checked':''} ${ui.busy?'disabled':''}>Chapter markers</label>${p.untimed?`<label>Seconds per card<input type="number" min="0.1" max="3600" step="0.1" value="${o.defaultCardDuration}" data-export-option="defaultCardDuration"></label>`:''}${o.editor === "premiere" ? `<label><input type="checkbox" data-export-option="linkComponents" ${ui.busy ? "disabled" : ""} ${o.linkComponents ? "checked" : ""}>Link stacked components</label>` : ""}</div>
 <div class="assembly-summary"><span>${p.cues.length} cues</span><span>${p.media.length} image files</span><span>${p.videoTracks} video tracks</span><span>${p.width} × ${p.height}</span><button data-export-action="check" ${ui.busy ? "disabled" : ""}>Refresh preview</button>${ui.busy ? `<strong role="status">${esc(ui.progress)}</strong>` : ""}</div>
 <div class="timeline-paths">${p.recordings.map((r) => `<p><button data-change-project-audio>${esc(r.name)}</button><span>${esc(r.audioPath || "Locate original audio in Perform")}</span></p>`).join("")}${[...new Set(p.media.filter((m) => m.root).map((m) => m.root))].map((root) => `<p><strong>Images</strong><span>${esc(root)}</span></p>`).join("")}</div>
 ${p.errors.filter((e) => !e.cueId).length || ui.problems.length ? `<div class="assembly-notice" role="status">${[...p.errors.filter((e) => !e.cueId).map((e) => e.message), ...ui.problems].map((s) => `<p>${esc(s)}</p>`).join("")}</div>` : ""}
 ${p.warnings
   .filter((w) => !w.cueId)
   .map((w) => `<p class="timeline-notices">${esc(w.message)}</p>`)
   .join("")}
 ${p.recordings.length > 1 ? `<details class="timeline-recordings"><summary>Recording order</summary>${p.recordings.map((r, i) => `<div><span>${esc(r.name)}</span><button data-export-move="${esc(r.id)}" data-direction="-1" ${!i ? "disabled" : ""}>↑</button><button data-export-move="${esc(r.id)}" data-direction="1" ${i === p.recordings.length - 1 ? "disabled" : ""}>↓</button></div>`).join("")}</details>` : ""}
 <div class="timeline-list-tools"><button data-export-action="show">${ui.showAll ? "Show issues" : "Show all cues"}</button><span>${p.errors.length} blocking items · ${p.warnings.length} notices</span></div><div class="timeline-cues">${
   list
     .slice(ui.page*ui.limit, (ui.page+1)*ui.limit)
     .map(
       (c) =>
         `<div class="timeline-cue"><input type="checkbox" data-export-cue="${esc(c.id)}" aria-label="Include cue" checked><div><strong>${esc(c.title)}</strong><small>${duration((c.start * p.rate.den) / p.rate.num)} → ${duration((c.end * p.rate.den) / p.rate.num)} · ${esc(c.representation || "missing image")}</small>${(issues.get(c.id) || []).map((s) => `<span class="timeline-issue">${esc(s)}</span>`).join("")}</div></div>`,
     )
     .join("") ||
   '<p class="assembly-empty">No issues in this preview. Media will be checked automatically at export.</p>'
 }</div>
 ${o.excludedCues.length ? `<button data-export-action="restore">Restore ${o.excludedCues.length} excluded cue(s)</button>` : ""}${list.length>ui.limit?`<nav class="timeline-pagination"><button data-export-action="previous" ${!ui.page?"disabled":""}>‹ Previous</button><span>${ui.page+1} / ${pages}</span><button data-export-action="next" ${ui.page===pages-1?"disabled":""}>Next ›</button></nav>`:""}
 ${ui.lastFile ? `<p class="timeline-result">Saved: ${esc(ui.lastFile)}</p>` : ""}<footer class="prepare-help"><details><summary aria-label="Export help">i</summary><div><strong>Premiere / DaVinci Resolve</strong><p>Mixed uses confidently matched cleanups, otherwise the storyboard. Cleanups requires a usable cleanup for each cue. Components are independent unless Link stacked components is enabled.</p><p>Export checks your original files automatically. The timeline references the original image and audio files. New storyboard images are saved in the chapter folders. The timeline goes directly into your main project folder.</p><p>The same .xml file works in Premiere and DaVinci Resolve. Stereo references the original recording with both channels; some editors display linked left/right clips. Mono creates one reusable mixed WAV in Studio Link. Import through your editor’s timeline import. If files move later, relink their folder. Import the complete project once; continue editing in your video editor.</p></div></details></footer></section>`;
  }
  async function linkedAudio(r) {
    if (!r.audioPath)
      throw Error(r.name + ": locate the original recording in Perform.");
    const info = await invoke("inspect_linked_audio", { path: r.audioPath }),
      bytes = bytes64(info.header),
      header = wavInfo(bytes) || mp3Info(bytes),
      probe = new Audio();
    if(r.source&&!sameRecording(r.source,info))throw Error(r.name+': this recording changed. Replace the project audio and match its new timing with Subtitler.');
    let seconds;
    try {
      seconds = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Audio metadata could not be read.")),
          15000,
        );
        probe.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve(probe.duration);
        };
        probe.onerror = () => {
          clearTimeout(timer);
          reject(Error("Cannot open original audio. Relink it in Perform."));
        };
        probe.src = window.__TAURI__.core.convertFileSrc(info.path);
      });
    } finally {
      probe.removeAttribute("src");
      probe.load();
    }
    let decodedChannels = null;
    if (!header && !r.channels) {
      if (info.size > 128 * 1024 * 1024)
        throw Error(
          r.name +
            ": include channel metadata in its timing JSON, or use an original WAV/MP3 for this large recording.",
        );
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw Error("Audio inspection is unavailable.");
      const context = new Context();
      try {
        const response = await fetch(
          window.__TAURI__.core.convertFileSrc(info.path),
        );
        if (!response.ok) throw Error("Cannot read original audio.");
        const decoded = await context.decodeAudioData(
          await response.arrayBuffer(),
        );
        decodedChannels = decoded.numberOfChannels;
      } finally {
        await context.close();
      }
    }
    return {
      ...header,
      channels: header?.channels || r.channels || decodedChannels,
      sampleRate: header?.sampleRate || r.sampleRate || null,
      duration: seconds,
      path: info.path,
      name: info.name,
      size: info.size,
      modified: info.modified,
    };
  }
  async function prepare(write = false) {
    if (ui.busy) return;
    ui.busy = true;
    ui.problems = [];
    ui.progress = write ? "Preparing timeline…" : "Refreshing preview…";
    host.render();
    const pid = host.project().id;
    try {
      const directory = await host.ensureRoot();
      if (!directory) return;
      if (host.project()?.id !== pid)
        throw Error("Project changed during export.");
      await host.refresh();
      if (host.project()?.id !== pid)
        throw Error("Project changed during export.");
      host.rematch();
      let p = plan();
      if (p.errors.length) {
        ui.problems = [...new Set(p.errors.map((e) => e.message))];
        return;
      }
      const cards = [
        ...new Set(p.media.filter((m) => m.storyboard).map((m) => m.cardId)),
      ].map((id) => host.project().stories.find((c) => c.id === id));
      if (write && cards.length) {
        ui.progress = "Saving storyboard images…";
        host.render();
        if (!(await host.ensureStoryboards(cards))) return;
        p = plan();
      }
      if (!write) return;
      const roots = new Map();
      for (const m of p.media) {
        if (!m.root || !m.relativePath)
          throw Error("An image has no local file. Relink its folder.");
        if (!roots.has(m.root)) roots.set(m.root, []);
        roots.get(m.root).push(m);
      }
      for (const [directory, files] of roots) {
        const states = await invoke("inspect_image_index_files", {
          directory,
          relativePaths: files.map((m) => m.relativePath),
        });
        for (const m of files) {
          const state = states.find((s) => s.path === m.relativePath);
          if (state?.state !== "ok")
            throw Error(m.name + ": file is missing. Relink its image folder.");
          if (
            !m.direct &&
            (m.size !== state.size || m.modified !== state.modified)
          )
            throw Error(m.name + ": file changed. Refresh its image index.");
          Object.assign(m, { size: state.size, modified: state.modified });
          if (m.direct && !m.cleanup) {
            const a = await window.SSDB.getAsset(m.assetId);
            if (!a) throw Error("Reusable asset preview missing.");
            m.width = a.originalWidth || a.width;
            m.height = a.originalHeight || a.height;
          }
        }
      }
      const infos = {};
      if(p.options.includeAudio)for (const r of p.recordings) infos[r.id] = await linkedAudio(r);
      if (host.project()?.id !== pid)
        throw Error("Project changed during export.");
      const name = renderName(
          host.project().fileNaming,
          "timeline",
          namingContext(host.project()),
          "xml",
        ),
        reserved = await invoke("reserve_project_timeline", {
          directory,
          filename: name,
          projectId: pid,
        });
      if(p.options.audioMode==='mono')for(const [id,info]of Object.entries(infos))if(info.channels>1)infos[id]={...info,...await invoke('prepare_mono_audio',{directory,path:info.path}),channels:1,sampleRate:48000};
      const full = materializeTimeline(p, directory, infos);
      for(const m of [...full.media]){
        if(m.kind!=='video'||!full.cues.some(c=>c.files.some(f=>f.key===m.key)&&(c.end-c.start)*full.rate.den/full.rate.num>m.duration))continue;
        const path=await invoke('create_cleanup_hold_frame',{path:m.path,directory,duration:m.duration}),split=path.lastIndexOf('/'),root=path.slice(0,split),relativePath=path.slice(split+1),states=await invoke('inspect_image_index_files',{directory:root,relativePaths:[relativePath]}),state=states[0];if(state?.state!=='ok')throw Error('Animation hold preview is unavailable.');
        m.holdKey=m.key+'/hold';const cached={key:m.holdKey,kind:'image',name:m.name+' hold.png',path,root,relativePath,width:m.width,height:m.height,size:state.size,modified:state.modified};full.media.push(cached);p.media.push(cached);
      }

      ui.progress = "Writing timeline…";
      host.render();
      const result = await invoke("write_linked_timeline", {
        directory,
        projectId: pid,
        filename: reserved.filename,
        xml: timelineXml(full),
        images: p.media.map((m) => ({
          root: m.root,
          relativePath: m.relativePath,
          size: m.size,
          modified: m.modified,
        })),
        audios: Object.values(infos).map((i) => i.path),
      });
      if (host.project()?.id === pid) ui.lastFile = result;
      host.notify("Timeline exported to your project folder.");
    } catch (e) {
      ui.problems = [String(e.message || e)];
      host.notify(ui.problems[0]);
    } finally {
      ui.busy = false;
      ui.progress = "";
      host.render();
    }
  }
  document.addEventListener("change", (e) => {
    if (!e.target.closest(".timeline-view") || ui.busy) return;
    const el = e.target;
    if(el.hasAttribute('data-export-without-audio'))host.commit('Timeline audio option',()=>{host.project().timelineExport={...options(),includeAudio:!el.checked};});
    if (el.dataset.exportOption)
      host.commit("Timeline options", () => {
        host.project().timelineExport = {
          ...options(),
          [el.dataset.exportOption]:
            el.type === "checkbox" ? el.checked : el.value,
        };
      });
    if (el.dataset.exportCue)
      host.commit("Exclude timeline cue", () => {
        host.project().timelineExport = {
          ...options(),
          excludedCues: [...options().excludedCues, el.dataset.exportCue],
        };
      });
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".timeline-view") || ui.busy) return;
    const a = e.target.closest("[data-export-action]");
    if (a) {
      if (["previous","next"].includes(a.dataset.exportAction)) {
        ui.page=Math.max(0,ui.page+(a.dataset.exportAction==="next"?1:-1));
        host.render();
      } else if (a.dataset.exportAction === "show") {
        ui.showAll = !ui.showAll;ui.page=0;
        host.render();
      } else if (a.dataset.exportAction === "restore")
        host.commit("Restore timeline cues", () => {
          host.project().timelineExport = { ...options(), excludedCues: [] };
        });
      else void prepare(a.dataset.exportAction === "write");
    }
    const move = e.target.closest("[data-export-move]");
    if (move) {
      const order = recordingOrder(host.project()).map((t) => t.id),
        i = order.indexOf(move.dataset.exportMove),
        j = i + Number(move.dataset.direction);
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      host.commit("Recording order", () => {
        host.project().timelineExport = { ...options(), order };
      });
    }
  });
  return { html };
}
