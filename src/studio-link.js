import {folderRenamePlan,rebaseProjectFolders} from './folder-rename.js';
import {bindProjectAudio,markAudioMissing} from './audio-state.js';
import {archiveChecks,reconcileCleanupRecords,redundantStoryboardOutputs} from './media-reconcile.js';
import {reviewDrawings} from './update-review.js';
import {supervisorPlan} from './media-supervisor.js';
import {sameRecording,uniqueRecordings} from './recording-identity.js';
import {discoverMedia} from './media-discovery.js';
import {showMediaLocations} from './media-locations.js';
import {organizationPlan,applyOrganization,appearanceKey} from './file-organization.js';
import {currentCleanup} from './cleanup-model.js';
import {archiveRough} from './media-policy.js';
import {normalizePath} from './local-paths.js';
import {
  archiveDirectory,
  ensureWorkspace,
  chapterDirectories,
  workspaceManifest,
  spokenScript,
  renderName,
  namingContext,
  drawingKey,
  joinPath,
} from "./studio-link-model.js";
import { buildProjectReference } from "./project-reference.js";
import { parseImageIndex } from "./image-assembly-model.js";
const native = () => !!window.__TAURI__?.core?.invoke,
  invoke = (name, args) => window.__TAURI__.core.invoke(name, args);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export async function writeProjectBlob(
  directory,
  relativePath,
  blob,
  projectId,
  ownerKey = relativePath,
) {
  const base64Data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
  return invoke("write_project_output", {
    directory,
    relativePath,
    base64Data,
    projectId,
    ownerKey,
  });
}
export function createStudioLink(host) {
  let busy = false,
    refreshing = false,
    last = "",
    message = "",
    error = false;
  let pending = null;
  const workspace = () => ensureWorkspace(host.project());
  function html() {
    const p = host.project();
    if (!p) return "";
    const root = workspace().directory;
    return `<div class="studio-link-bar"><span title="${esc(root || "")}">${root ? esc(root) : "Choose your project folder to save and discover shared files."}</span><button data-act="studio-root">${root ? "Relink folder" : "Choose project folder"}</button>${root ? '<button data-act="studio-refresh">Refresh</button>' : ""}<button data-act="file-naming">File naming</button>${root?'<button data-media-locations>Media locations</button>':''}${message ? `<small role="status" class="${error ? "studio-link-error" : ""}">${esc(message)}</small>` : ""}</div>`;
  }
  function status(text, bad = false) {
    message = text;
    error = bad;
    document.querySelectorAll(".studio-link-bar").forEach((el) => {
      const holder = document.createElement("div");
      holder.innerHTML = html();
      el.replaceWith(holder.firstChild);
    });
  }
  async function sync(force = false) {
    const p = host.project();
    if (!p || !native() || !workspace().directory) return;
    if (busy) {
      if (!force) return;
      await pending;
      return sync(true);
    }
    const id = p.id,
      directory = workspace().directory;
    chapterDirectories(p);
    const manifest = workspaceManifest(p),
      reference = buildProjectReference(p, host.numbering()),
      script = spokenScript(p),
      fingerprint = JSON.stringify([
        directory,
        { ...manifest, updatedAt: "" },
        { ...reference, exportedAt: "" },
        { ...script, exportedAt: "" },
      ]);
    if (!force && fingerprint === last) return;
    busy = true;
    try {
      const root = await (pending = invoke("sync_studio_link", {
        directory,
        projectId: id,
        manifest: JSON.stringify(manifest, null, 2),
        reference: JSON.stringify(reference, null, 2),
        script: JSON.stringify(script, null, 2),
      }));
      if (host.project()?.id === id && workspace().directory === directory) {
        workspace().directory = root;
        last = fingerprint;
        host.save();
        status("Studio Link ready");
      }
    } catch (e) {
      last = "";
      status(String(e.message || e), true);
      throw e;
    } finally {
      busy = false;
    }
  }
  function schedule(){ /* Project autosave remains local. Shared writes are batched. */ }
  let discovering=null,discoveryRetry=null,discoveryTries=0;
  async function discover(){
    if(discovering)return discovering;const p=host.project();if(!native()||!p?.studioLink?.directory||!host.inspectCleanup)return;
    discovering=discoverMedia(p,{invoke,inspect:host.inspectCleanup,save:host.save,sync:host.syncCleanup});
    try{const result=await discovering;clearTimeout(discoveryRetry);if(result?.pending&&discoveryTries++<20)discoveryRetry=setTimeout(()=>{if(host.project()===p)discover().then(async result=>{if(!result?.pending){await organize();await sync(false);status('Shared files refreshed');host.render();}}).catch(e=>status(String(e.message||e),true));},1500);else discoveryTries=0;return result;}finally{discovering=null;}
  }
  let organizing=null;
  async function organize(){if(organizing)return organizing;const p=host.project();if(!p?.studioLink?.directory||!native())return;organizing=(async()=>{const layout=await invoke('snapshot_project_media',{directory:p.studioLink.directory,projectId:p.id});if(layout.namingRevision&&layout.namingRevision!==p.studioLink.namingRevision&&layout.naming){p.fileNaming=layout.naming;p.studioLink.namingRevision=layout.namingRevision;if(layout.chapterDirectories)for(const f of layout.chapterDirectories)p.studioLink.chapterDirectories[f.chapterId]=f.path;host.save();}await host.syncCleanup?.();const discovered=await discover();if(discovered?.pending)p.studioLink.pendingDiscovery=true;else delete p.studioLink.pendingDiscovery;await host.prepareCleanup?.();const remote=await invoke('snapshot_project_media',{directory:p.studioLink.directory,projectId:p.id});for(const[key,r]of Object.entries(remote.storyboards||{})){const old=p.studioLink.storyboards[key],retired=old?.retiredContext;p.studioLink.storyboards[key]={...old,...r,...(retired?{retiredContext:retired}:{})};}if(remote.catalog)applyOrganization(p,{catalog:remote.catalog});const checks=archiveChecks(p);if(checks.length){const audit=await invoke('manage_cleanup_media',{directory:p.studioLink.directory,projectId:p.id,action:'audit',files:checks});if(reconcileCleanupRecords(p,audit.files))await host.syncCleanup?.();}
 const duplicateIssues=[];for(const obsolete of redundantStoryboardOutputs(p,remote.outputs)){
  const present=await invoke('inspect_image_index_files',{directory:p.studioLink.directory,relativePaths:[obsolete.currentPath]});if(present[0]?.state!=='ok')continue;
  try{await invoke('retire_storyboard_output',{directory:p.studioLink.directory,projectId:p.id,...obsolete});for(const[key,record]of Object.entries(p.studioLink.storyboards))if(record.relativePath===obsolete.relativePath&&record.kept)delete p.studioLink.storyboards[key];}
  catch(error){duplicateIssues.push('Older storyboard kept for review: '+obsolete.relativePath+' · '+String(error.message||error));}
 }
 const pending=organizationPlan(p),groups=[];if(pending.length)await host.checkpoint?.();for(const move of pending){const matches=groups.filter(g=>g.some(m=>[m.from,m.to].some(x=>x===move.from||x===move.to)));if(!matches.length)groups.push([move]);else{const group=matches[0];group.push(move);for(const other of matches.slice(1)){group.push(...other);groups.splice(groups.indexOf(other),1);}}}const errors=[...duplicateIssues];for(const moves of groups){try{const result=await invoke('organize_project_media',{directory:p.studioLink.directory,projectId:p.id,moves});if(host.project()===p)applyOrganization(p,result);}catch(e){errors.push(String(e.message||e));}}p.studioLink.organizationIssues=errors;host.save();await host.syncCleanup?.();await sync(false);return{issues:errors};})();try{return await organizing;}finally{organizing=null;}}
  async function choose() {
    if (!native()) throw Error("Choose the folder in the installed app.");
    let directory = await (native()?invoke("pick_project_directory"):host.chooseDirectory());
    if (!directory) return false;
    const p = host.project(),
      id = p.id,
      old = workspace().directory;
    const probe=await invoke('probe_project_folder',{directory});directory=probe.directory;if(probe.projectId&&probe.projectId!==id)throw Error('This Studio Link belongs to another project. Select its matching folder or an empty destination.');
    if(old&&normalizePath(old)!==normalizePath(directory)&&!probe.exists)await invoke('copy_project_workspace',{directory:old,destination:directory,projectId:id});
    const candidate = structuredClone(p);
    ensureWorkspace(candidate).directory = directory;
    if(probe.exists&&probe.projectId===id){const layout=await invoke('snapshot_project_media',{directory,projectId:id});if(layout.namingRevision&&layout.naming){candidate.fileNaming=layout.naming;candidate.studioLink.namingRevision=layout.namingRevision;}}
    chapterDirectories(candidate);
    const root = await invoke("sync_studio_link", {
      directory,
      projectId: id,
      manifest: JSON.stringify(workspaceManifest(candidate)),
      reference: JSON.stringify(
        buildProjectReference(candidate, host.numbering()),
      ),
      script: JSON.stringify(spokenScript(candidate)),
    });
    if (host.project() !== p) return false;
    host.commit("Connect project folder", () => {
      p.fileNaming=candidate.fileNaming;
      p.studioLink = candidate.studioLink;
      p.studioLink.directory = root;
      if (old && old !== root) {
        const rebase = (path) =>
          path === old
            ? root
            : normalizePath(path).startsWith(normalizePath(old) + "/")
              ? root + normalizePath(path).slice(normalizePath(old).length)
              : path;
        for(const e of Object.values(p.cleanup?.entries||{}))for(const f of [...(e.files||[]),...(e.referenceFiles||[]),...(e.ignoredFiles||[])])f.path=f.relativePath?root+'/'+f.relativePath:rebase(f.path);
        for(const a of [...(p.cleanup?.archive||[]),...(p.cleanup?.unassigned||[])])for(const f of a.files)f.path=f.relativePath?root+'/'+f.relativePath:rebase(f.path);
        if(p.studioLink.activeAudio?.relativePath)p.studioLink.activeAudio.path=root+'/'+p.studioLink.activeAudio.relativePath;
        for (const b of p.imageAssembly?.batches || []) {
          b.directory = rebase(b.directory);
          b.sourceStatus = "unchecked";
        }
        for (const t of p.videoTiming?.tracks || []) {
          t.audioPath = rebase(t.audioPath);
          if (t.source?.path) t.source.path = rebase(t.source.path);
        }
      }
    });
    last = "";
    if(p.studioLink.pendingAudioCopy){const path=await invoke('manage_cleanup_media',{directory:root,projectId:id,action:'copy-audio',files:[{path:p.studioLink.pendingAudioCopy}]});const audio=await invoke('inspect_linked_audio',{path});await selectAudio(audio,{confirm:false});delete p.studioLink.pendingAudioCopy;}
    try{await refresh();}catch(e){status(String(e.message||e),true);}
    return true;
  }
  async function refresh() {
    const p = host.project();
    if (!p || !native() || !workspace().directory || refreshing) return;
    refreshing = true;
    const id = p.id;
    try {
      await organize();
      await sync(false);
      const result = await invoke("inspect_studio_link", {
        directory: workspace().directory,
        projectId: id,
      });
      if (host.project()?.id !== id) return;
      for(const [key,r]of Object.entries(result.manifest?.storyboards||{}))if(!p.studioLink.storyboards[key])p.studioLink.storyboards[key]=r;
      for(const folder of result.chapterFolders||[])workspace().chapterDirectoryStates[folder.path]=folder.state;
      chapterDirectories(p);
      const warnings = [...(result.warnings || [])];
      let active=await checkAudio(result.audioFiles||[],warnings);if(active&&p.videoTiming?.tracks?.length)p.videoTiming.tracks=p.videoTiming.tracks.filter(t=>sameRecording(t,active));
      for (const h of result.handoffs || []) {
        if (host.project()?.id !== id) return;
        try {
          const raw = JSON.parse(h.text);
          if (raw.format === "folderexporter-index-v1") {
            const parsed = parseImageIndex(raw, h.filename);
            if (parsed.projectId !== id) {
              warnings.push(h.filename + ": belongs to another project.");
              continue;
            }
            const existing = p.imageAssembly?.batches?.find(
              (b) => b.exportId === parsed.exportId,
            );
            if (existing) {
              if(parsed.pathRevision&&parsed.pathRevision!==existing.pathRevision){Object.assign(existing,parsed,{id:existing.id,directory:h.directory,sourceStatus:'unchecked',previews:{},fileStates:{}});host.save();continue;}
              if([parsed.contentHash,parsed.legacyContentHash,parsed.previousContentHash].includes(existing.contentHash)){existing.sharedNames=parsed.sharedNames;for(const frame of existing.frames||[]){const current=parsed.frames.find(f=>f.id===frame.id);if(current)frame.exportId=current.exportId;for(const f of frame.files||[]){const metadata=current?.files.find(x=>x.path===f.path);if(metadata){f.managed=metadata.managed;f.componentSuffix=metadata.componentSuffix;}}}}
              if (
                existing.contentHash !== parsed.contentHash &&
                existing.contentHash !== parsed.legacyContentHash &&
                existing.contentHash !== parsed.previousContentHash
              )
                warnings.push(
                  h.filename +
                    ": changed contents with the same export ID. Export a new index.",
                );
              else if (existing.directory !== h.directory) {
                existing.directory = h.directory;
                existing.sourceStatus = "unchecked";
                host.save();
              }
            } else await host.importImages(h.text, h.filename, h.directory);
          } else if (
            raw.format === "whisperdesk-timing-v1" ||
            raw.format === "subtitler-timing-v1"
          ) {
            if ((raw.studioProjectId || raw.scriptProjectId) !== id) {
              warnings.push(
                h.filename +
                  ": import timing manually once; it has no matching project ID.",
              );
              continue;
            }
            if(active&&!sameRecording(raw,active)){warnings.push(h.filename+': timing is for another recording; the current audio was kept.');continue;}
            if(raw.subtitlerProjectFile&&active)active.subtitlerProjectFile=raw.subtitlerProjectFile;if(active&&!active.missing){raw.source={...raw.source,...active};if(!active.relativePath)delete raw.source.relativePath;}await host.importTiming(JSON.stringify(raw), h.filename, { automatic: true });
          }
        } catch (e) {
          warnings.push(h.filename + ": " + String(e.message || e));
        }
      }
      for (const t of p.videoTiming?.tracks || []) {
        let path = active && !active.missing && sameRecording(t,active) ? active.path : t.source?.relativePath
          ? joinPath(workspace().directory, t.source.relativePath)
          : t.audioPath || t.source?.path;
        if (!path) {
          const matches = (result.audioFiles || []).filter(
            (f) =>
              f.name === t.source?.name &&
              (!t.source?.size || f.size === t.source.size),
          );
          if (matches.length === 1) path = matches[0].path;
          else if (matches.length > 1)
            warnings.push(
              t.source.name +
                ": several matching audio files; locate the original in Subtitler.",
            );
        }
        if (path) {
          try {
            const observed=await invoke('inspect_linked_audio',{path});if(!sameRecording(t,observed)){warnings.push(t.source.name+': recording changed; match timing with Subtitler before exporting.');t.audioMissing=true;continue;}t.audioPath=path;t.audioMissing=false;delete t.audioError;if(active&&!active.missing&&sameRecording(t,active))bindProjectAudio(p,active);
          } catch {
            markAudioMissing(p,t);warnings.push(t.source.name+": audio is missing. Use Locate audio or Recover audio from Subtitler project.");
          }
        }
      }
      host.rematch();
      await host.checkImages();
      await host.checkCleanup?.();
      await organize();
      await sync(false);
      host.save();
      status(
        warnings.length ? warnings.join(" ") : "Shared files refreshed",
        !!warnings.length,
      );
      host.render();
    } catch (e) {
      status(String(e.message || e), true);
      host.render();
      throw e;
    } finally {
      refreshing = false;
    }
  }
  let declinedAudio=null;
  async function selectAudio(info,{confirm=true}={}){const p=host.project(),link=workspace(),old=link.activeAudio;delete info.header;const different=old&&!sameRecording(old,info);if(different&&confirm&&host.confirmAudio&&!(await host.confirmAudio(old,info)))return false;if(host.project()!==p)return false;const root=link.directory;if(root&&normalizePath(info.path).startsWith(normalizePath(root)+'/'))info.relativePath=normalizePath(info.path).slice(normalizePath(root).length+1);else delete info.relativePath;host.commit(different?'Replace project recording':'Locate project recording',()=>{if(different){link.audioHistory||=[];link.audioHistory.push({...old,replacedAt:new Date().toISOString()});if(p.videoTiming?.tracks?.length){p.videoTiming.previousTracks||=[];p.videoTiming.previousTracks.push(...p.videoTiming.tracks);}}if(p.videoTiming)p.videoTiming.tracks=p.videoTiming.tracks.filter(t=>sameRecording(t,info));bindProjectAudio(p,info);});await sync(true);declinedAudio=null;return true;}
  async function checkAudio(candidates,warnings){const link=workspace(),active=link.activeAudio;let observed=null;if(active?.path)try{observed=await invoke('inspect_linked_audio',{path:active.relativePath?joinPath(link.directory,active.relativePath):active.path});delete observed.header;}catch{active.missing=true;}if(observed&&sameRecording(active,observed)){bindProjectAudio(host.project(),observed);return link.activeAudio;}let candidate=observed;if(!candidate&&candidates.length===1)try{candidate=await invoke('inspect_linked_audio',{path:candidates[0].path});delete candidate.header;}catch{}if(candidate){if(!active||sameRecording(active,candidate)){await selectAudio(candidate,{confirm:false});return link.activeAudio;}const key=candidate.fingerprint||JSON.stringify([candidate.path,candidate.size,candidate.modified]);if(key!==declinedAudio&&host.confirmAudio){declinedAudio=key;if(await selectAudio(candidate))return link.activeAudio;}warnings.push('A different recording is available. Click the recording name to replace the project audio.');}else if(active?.missing)warnings.push('Project audio is missing. Click its name to choose a recording.');return active;}
  async function changeAudio(){if(!native())return;const path=await invoke('pick_project_audio');if(!path)return;const info=await invoke('inspect_linked_audio',{path});if(await selectAudio(info)){await refresh();host.notify('Recording selected. Match timing with Subtitler to update the timing for this version.');}}
  async function verifyAudio(){
   const p=host.project(),source=workspace().activeAudio||(p.videoTiming?.tracks||[])[0]?.source;if(!source?.path)return true;
   try{const path=source.relativePath?joinPath(workspace().directory,source.relativePath):source.path;const info=await invoke('inspect_linked_audio',{path});if(host.project()!==p)return false;if(!sameRecording(source,info))throw Error('Recording changed');bindProjectAudio(p,info);host.save();return true;}
   catch{if(host.project()===p){markAudioMissing(p,source);host.save();}return false;}
  }
  async function locateAudio(recover=false){
   const p=host.project(),source=workspace().activeAudio||(p.videoTiming?.tracks||[])[0]?.source;
   const path=await invoke(recover?'recover_subtitler_audio':'locate_project_audio',{directory:workspace().directory||null,projectId:p.id,name:source?.name||'',fingerprint:source?.fingerprint||null,documentPath:source?.subtitlerProjectFile||null});
   if(!path||host.project()!==p)return;const info=await invoke('inspect_linked_audio',{path});if(await selectAudio(info)){await refresh();host.notify(recover?'Audio recovered from Subtitler project.':'Audio located.');}
  }
  document.addEventListener?.('click',e=>{if(e.target.closest('[data-locate-project-audio]'))locateAudio().catch(err=>host.notify(String(err.message||err)));if(e.target.closest('[data-recover-project-audio]'))locateAudio(true).catch(err=>host.notify(String(err.message||err)));if(e.target.closest('[data-change-project-audio]'))changeAudio().catch(err=>host.notify(String(err.message||err)));if(e.target.closest('[data-media-locations]'))showMediaLocations(host.project());});
  async function verifyRoot({locate=false}={}){
   const p=host.project(),directory=p?.studioLink?.directory;if(!directory)return null;
   try{const result=await invoke('probe_project_folder',{directory});if(result.projectId&&result.projectId!==p.id)throw Error('This folder belongs to another project.');if(!result.exists)throw Error('Studio Link was not found.');return directory;}
   catch(error){if(host.project()!==p)return null;if(locate){host.notify?.('Project folder was moved or renamed. Select its current location.');return await choose()?workspace().directory:null;}throw Error('Project folder is unavailable or was renamed. Use File → Locate project folder to select its current location.');}
  }
  async function ensureRoot(){if(workspace().directory){if(!(await verifyRoot({locate:true})))return null;}else if(!(await choose()))return null;await sync();return workspace().directory;}
  async function showFolder(){const directory=await verifyRoot();if(directory)return invoke('reveal_cleanup_file',{path:directory});}
  async function matchTiming(){
   const directory=await ensureRoot();if(!directory)return;await refresh();
   if(!workspace().activeAudio){
    const tracks=uniqueRecordings(host.project().videoTiming?.tracks||[]);
    if(tracks.length===1){const track=tracks[0],path=track.audioPath||track.source?.path;if(path)try{const observed=await invoke('inspect_linked_audio',{path});if(sameRecording(track,observed))await selectAudio(observed,{confirm:false});}catch{}}
   }
   if(!workspace().activeAudio){await changeAudio();if(!workspace().activeAudio)return;}
   await sync();await invoke('open_subtitler',{directory,projectId:host.project().id});host.notify('Subtitler opened with the selected project recording.');
  }
  async function storyboards(cards, { reuse = true, interactive = true } = {}) {
    const p = host.project(),
      pid = p.id,
      root = await ensureRoot();
    if (!root) return false;
    await organize();
    const folders = chapterDirectories(p),seenNames=new Set(),staged=new Map(),review=[];
    for(const card of cards){const key=appearanceKey(p,card),source=['stories','unassigned','lost','archived'].flatMap(k=>p[k]||[]).find(c=>c.id===(card.reuseOf||card.id))||card,signature=JSON.stringify([p.ratio,card.activeVariant||0,source.variants,source.note,source.blank,source.completionStatus,card.tags,currentCleanup(p,card).files.length,p.customTags,host.renderPreferences?.()]),record=p.studioLink.storyboards[key];
      if(reuse&&record?.renderSignature===signature&&!record.missing&&record.archived===archiveRough(p,card)){const info=await invoke('inspect_image_index_files',{directory:root,relativePaths:[record.relativePath]});if(info[0]?.state==='ok'&&info[0].size===record.size&&info[0].modified===record.modified){const oldURL=(window.__TAURI__.core.convertFileSrc?.(record.path||root+'/'+record.relativePath)||record.path||root+'/'+record.relativePath)+'?v='+record.modified;const ch=p.chapters.find(ch=>ch.id===card.chapterId),ctx=namingContext(p,ch,card);if(workspace().pendingExports)delete workspace().pendingExports[card.id];review.push({id:card.id,changed:false,existed:true,title:ch.name+' · Card '+ctx.card_number+(ctx.slight_modify_index||''),oldURL,newURL:oldURL});continue;}}
      if(!interactive&&workspace().cancelledDrawingUpdates?.[card.id]===signature)continue;
      const ch=p.chapters.find(ch=>ch.id===card.chapterId),archive=archiveRough(p,card),folder=archive?archiveDirectory(p,namingContext(p,ch,card)):folders.find(f=>f.chapterId===ch.id).path,relativePath=folder+'/'+renderName(p.fileNaming,archive?'archiveCard':'card',namingContext(p,ch,card),'png').replace(/\.png$/,(record?.exportSuffix||'')+'.png'),blob=await host.drawingBlob(card),data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
      staged.set(card.id,{blob,signature});const comparison=await invoke('manage_cleanup_media',{directory:root,projectId:pid,action:'compare',files:[{id:card.id,relativePath,oldPath:record?.relativePath||relativePath,base64Data:String(data).split(',')[1]}]});const c=comparison[0];if(!c.changed&&record)record.renderSignature=signature;review.push({...c,title:ch.name+' · Card '+(namingContext(p,ch,card).card_number+(namingContext(p,ch,card).slight_modify_index||'')),oldURL:c.oldPath?(window.__TAURI__.core.convertFileSrc?.(c.oldPath)||c.oldPath)+'?v='+(record?.modified||0):'',newURL:data});
    }
    let chosen=new Set(review.filter(r=>r.changed).map(r=>r.id));
    if(interactive&&review.some(r=>r.existed&&r.changed)){host.suspendProgress?.(true);try{chosen=await reviewDrawings(review);}finally{host.suspendProgress?.(false);}}
    workspace().cancelledDrawingUpdates||={};for(const r of review)if(r.changed&&!chosen?.has(r.id))workspace().cancelledDrawingUpdates[r.id]=staged.get(r.id).signature;else delete workspace().cancelledDrawingUpdates[r.id];
    if(chosen===null){host.save();return false;}


    for(const card of cards){const ch=p.chapters.find(ch=>ch.id===card.chapterId),archive=archiveRough(p,card),context=namingContext(p,ch,card),folder=archive?archiveDirectory(p,context):folders.find(f=>f.chapterId===ch.id).path,name=folder+'/'+renderName(p.fileNaming,archive?'archiveCard':'card',context,'png').replace(/\.png$/,(p.studioLink.storyboards[appearanceKey(p,card)]?.exportSuffix||'')+'.png');if(seenNames.has(name.toLowerCase()))throw Error('Two cards would use '+name+'. Add {card_number} and {slight_modify_index} to the naming pattern.');seenNames.add(name.toLowerCase());}
    let completed=0;
    for (const card of cards) {
      if(!chosen.has(card.id))continue;
      host.progress?.(completed++,cards.length);
      if (host.project()?.id !== pid)
        throw Error("Project changed during export.");
      const key = appearanceKey(p,card),source=["stories","unassigned","lost","archived"].flatMap(k=>p[k]||[]).find(c=>c.id===(card.reuseOf||card.id))||card,renderSignature=JSON.stringify([p.ratio,card.activeVariant||0,source.variants,source.note,source.blank,source.completionStatus,card.tags,currentCleanup(p,card).files.length,p.customTags,host.renderPreferences?.()]);
      if (reuse && p.studioLink.storyboards[key]?.archived===archiveRough(p,card)&&p.studioLink.storyboards[key]&&!p.studioLink.storyboards[key].missing&&p.studioLink.storyboards[key].renderSignature===renderSignature) {
        try {
          const info = await invoke("inspect_image_index_files", {
            directory: root,
            relativePaths: [p.studioLink.storyboards[key].relativePath],
          });
          if (
            info[0]?.state === "ok" &&
            info[0].size === p.studioLink.storyboards[key].size &&
            info[0].modified === p.studioLink.storyboards[key].modified
          )
            continue;
        } catch {}
      }
      const ch = p.chapters.find((c) => c.id === card.chapterId),
        archive=archiveRough(p,card),
        folder = archive?archiveDirectory(p,namingContext(p,ch,card)):folders.find((f) => f.chapterId === ch.id).path,
        blob = staged.get(card.id)?.blob || await host.drawingBlob(card),
        name = renderName(
          p.fileNaming,
          archive?"archiveCard":"card",
          namingContext(p, ch, card),
          "png",
        ).replace(/\.png$/,(p.studioLink.storyboards[key]?.exportSuffix||'')+'.png');
      if (host.project()?.id !== pid)
        throw Error("Project changed during export.");
      let saved,previousRecord=p.studioLink.storyboards[key],keepPrior=null,exportSuffix=p.studioLink.storyboards[key]?.exportSuffix||'';
      try{saved = await writeProjectBlob(
        root,
        folder + "/" + name,
        blob,
        pid,
        "drawing:" +
          card.id +
          ":" +
          (card.activeVariant || 0),
      );}catch(e){const detail=String(e.message||e);if(!/already exists|reserved|changed outside|another export/i.test(detail))throw e;if(!interactive){workspace().pendingExports||={};workspace().pendingExports[card.id]=detail;host.notify?.('Storyboard output kept for review: '+name);continue;}host.suspendProgress?.(true);let choice;try{choice=await host.outputConflict?.(name,detail);}finally{host.suspendProgress?.(false);}if(!choice||choice==='cancel')return false;if(choice==='cleanup'){const infos=await host.inspectCleanup([root+'/'+folder+'/'+name]);if(infos[0]?.state==='unreadable'||infos[0]?.missing)throw Error('Choose a readable cleanup.');host.attachDiscovered(card,infos);await host.syncCleanup();return storyboards(cards,{reuse});}const relative=await invoke('resolve_storyboard_collision',{directory:root,projectId:pid,relativePath:folder+'/'+name,ownerKey:'drawing:'+card.id+':'+(card.activeVariant||0),choice});if(choice==='keep'){keepPrior=p.studioLink.storyboards[key]?{...p.studioLink.storyboards[key],cardId:card.id,kept:true}:null;exportSuffix+=relative.slice((folder+'/'+name).length-4,-4);}saved=await writeProjectBlob(root,relative,blob,pid,'drawing:'+card.id+':'+(card.activeVariant||0));}
      if(previousRecord?.relativePath&&previousRecord.relativePath!==saved.relativePath&&!keepPrior){try{await invoke('retire_storyboard_output',{directory:root,projectId:pid,relativePath:previousRecord.relativePath,cardId:card.id,sourceCardId:previousRecord.sourceCardId||card.reuseOf||card.id,ownerKey:previousRecord.ownerKey||null});}catch(e){keepPrior={...previousRecord,cardId:card.id,kept:true,archived:true,exportSuffix:(previousRecord.exportSuffix||'')+'_preserved-'+crypto.randomUUID().slice(0,8)};host.notify('The previous export was changed outside the app and has been kept: '+previousRecord.relativePath);}}
      if(keepPrior)p.studioLink.storyboards[key+'::kept:'+crypto.randomUUID()]=keepPrior;
      p.studioLink.chapterDirectoryStates[folder]="used";
      for(const [oldKey,record]of Object.entries(p.studioLink.storyboards))if(oldKey!==key&&!record.kept&&(record.relativePath===saved.relativePath||record.cardId===card.id))delete p.studioLink.storyboards[oldKey];
      p.studioLink.storyboards[key] = {
        ...saved,
        width: host.dimensions()[0],
        height: host.dimensions()[1],
        sourceCardId: card.reuseOf || card.id,
        cardId:card.id,
        exportSuffix,
        renderSignature,
        archived:archive,
        ownerKey:"drawing:"+card.id+":"+(card.activeVariant||0),
      };
      if(workspace().pendingExports)delete workspace().pendingExports[card.id];
      host.save();
    }
    host.progress?.(cards.length,cards.length);
    await sync(false);
    return true;
  }
  async function renameFolders(profile){const p=host.project();if(!native()||!p?.studioLink?.directory)return;await organize();const moves=folderRenamePlan(p,profile);if(!moves.length)return;await host.checkpoint?.();const result=await invoke('rename_project_folders',{directory:p.studioLink.directory,projectId:p.id,moves,naming:profile});if(host.project()!==p)throw Error('Project changed during folder renaming. Reopen the project to refresh its paths.');rebaseProjectFolders(p,result.moves||[]);if(result.namingRevision)p.studioLink.namingRevision=result.namingRevision;host.save();return result;}
  let supervising=null;
  async function supervise(show=false){if(supervising)return supervising;const p=host.project();if(!p?.studioLink?.directory||!native())return;supervising=(async()=>{const plan=supervisorPlan(structuredClone(p)),report=await invoke('manage_cleanup_media',{directory:p.studioLink.directory,projectId:p.id,action:'audit',files:plan.checks});if(host.project()!==p)return;const backups=show?await invoke('inspect_project_backups',{projectId:p.id}):null;const issues=[...plan.issues,...(p.studioLink.organizationIssues||[]).map(message=>({kind:'conflict',message})),...report.files.filter(f=>f.state==='missing').map(f=>({cardId:f.cardId||f.id,kind:'missing',message:'Missing '+f.role+': '+(f.relativePath||f.path)}))];for(const f of report.files)if(f.fingerprint&&f.observedFingerprint&&f.fingerprint!==f.observedFingerprint)issues.push({cardId:f.cardId,kind:'integrity',message:(f.role==='audio'?'Selected recording contents changed: ':'Cleanup recovery contents differ from their recorded version: ')+(f.relativePath||f.path)});const roles=new Map();for(const r of report.records){if(r.error)issues.push({kind:'record',message:r.name+': unreadable index'});if(r.projectId&&r.projectId!==p.id)issues.push({kind:'record',message:r.name+': belongs to another project'});if(['studio-link-project-v1','storyboardstudio-reference-v1','subtitler-script-v1','studio-media-index-v1','storyboard-outputs-v1'].includes(r.format)){const key='singleton:'+r.format;roles.set(key,[...(roles.get(key)||[]),r.name]);}if(r.format?.includes('timing')){const key=r.sourceId||'recording';roles.set(key,[...(roles.get(key)||[]),r.name]);}}for(const[key,list]of roles)if(list.length>1)issues.push({kind:'record',message:(key.startsWith('singleton:')?'Repeated shared records: ':'Competing timing handoffs: ')+list.join(', ')});if(p.studioLink.pendingDiscovery)issues.push({kind:'copy',message:'Some new files are still being copied; automatic discovery will retry.'});if(backups?.issues)for(const message of backups.issues)issues.push({kind:'backup',message});const previous=p.studioLink.lastCheck,summary={checkedFiles:report.files.length,issues:structuredClone(issues),repaired:[],backups:backups||previous?.backups||null};if(!previous||JSON.stringify({...previous,checkedAt:undefined})!==JSON.stringify(summary)){p.studioLink.lastCheck={...summary,checkedAt:new Date().toISOString()};host.save();}if(show){const el=document.createElement('div');el.className='overlay';el.innerHTML='<section class="modal-card supervisor-dialog"><h2>Last check</h2><p>'+report.files.length+' file locations checked.</p>'+(backups?'<p>'+backups.valid+' validated recovery snapshots.</p>':'')+'<div class="supervisor-list">'+(issues.length?issues.map(i=>'<p>'+esc(i.message)+'</p>').join(''):'<p>Project media and shared records are consistent.</p>')+'</div><button data-close>Close</button></section>';el.onclick=e=>{if(e.target===el||e.target.closest('[data-close]'))el.remove();};document.body.append(el);}return{issues,files:report.files};})();try{return await supervising;}finally{supervising=null;}}
  return {
    supervise,renameFolders,
    discover,
    changeAudio,
    selectAudio,
    html,
    choose,
    refresh,
    sync,
    organize,
    flush:async()=>{if(busy&&pending)await pending;await organize();return sync(false);},
    schedule,
    ensureRoot,
    verifyRoot,
    showFolder,
    matchTiming,
    verifyAudio,
    locateAudio,
    storyboards,
  };
}
