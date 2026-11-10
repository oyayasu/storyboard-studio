import {resolveLocalPath,normalizePath,pathInside} from './local-paths.js';
import {cardVisualIdentity,imageGroups,resolveCardImages,representationFiles,defaultRepresentation} from './image-assembly-model.js';
export function ensureCleanup(p){p.cleanup||={version:1,entries:{}};p.cleanup.archive||=[];p.cleanup.unassigned||=[];p.cleanup.purged||=[];return p.cleanup;}
export function mediaPath(p,f){return f.relativePath&&p.studioLink?.directory?resolveLocalPath(p.studioLink.directory,f.relativePath,f.path):normalizePath(f.path);}
export function validateCatalog(raw,projectId){
 if(!raw||raw.format!=='studio-media-index-v1'||raw.schemaVersion!==1||raw.projectId!==projectId||!raw.entries||Array.isArray(raw.entries)||typeof raw.entries!=='object'||Object.keys(raw.entries).length>10000)throw Error('Invalid cleanup catalog or different project.');
 for(const [key,e]of Object.entries(raw.entries)){
  if(key!==JSON.stringify([e.sourceCardId,e.variantIndex])||typeof e.sourceCardId!=='string'||!Number.isInteger(e.variantIndex)||e.variantIndex<0||!Number.isFinite(Date.parse(e.updatedAt))||!Array.isArray(e.files)||e.files.length>64)throw Error('Invalid cleanup identity.');
  for(const f of e.files){if(!['image','video'].includes(f.kind)||typeof f.path!=='string'||f.path.length>4096||/[\x00-\x1f]/.test(f.path))throw Error('Invalid cleanup file.');if(f.relativePath&&(/^[\\/]|^[a-z]:/i.test(f.relativePath)||f.relativePath.includes('\\')||f.relativePath.split('/').some(x=>!x||x==='.'||x==='..')))throw Error('Invalid cleanup location.');}
 }return raw;
}
export function uniqueMedia(files){const seen=new Set();return files.filter(f=>{const key=JSON.stringify([f.id||f.path,f.fingerprint||null]);if(seen.has(key))return false;seen.add(key);return true;});}
export function mergeCatalog(p,raw){
 validateCatalog(raw,p.id);const local=ensureCleanup(p).entries;if(raw.unassignedRevision&&(!p.cleanup.unassignedRevision||raw.unassignedRevision>p.cleanup.unassignedRevision)){p.cleanup.unassigned=structuredClone(raw.unassigned||[]);p.cleanup.unassignedRevision=raw.unassignedRevision;}
 for(const[key,incoming]of Object.entries(raw.entries)){
  const old=local[key];if(old?.removed&&!incoming.removed&&old.blockedExportIds?.includes(incoming.exportId))continue;
  if(old&&Date.parse(incoming.updatedAt)<Date.parse(old.updatedAt))continue;
  const e=structuredClone(incoming);
  // Each ordinary row is a complete revision, including deliberate removals.
  if(e.source==='folderexporter'&&!e.removed){
   const extras=(old?.files||[]).filter(f=>f.origin==='attached'&&!e.files.some(x=>x.id===f.id));
   if(extras.length){e.files.push(...extras);e.files.forEach((f,i)=>f.stackOrder=i+1);e.updatedAt=new Date(Math.max(Date.now(),Date.parse(e.updatedAt)+1)).toISOString();e.revision=crypto.randomUUID();}
   e.ignoredFiles=uniqueMedia([...(e.ignoredFiles||[]),...(old?.ignoredFiles||[])]);
  }else if(e.ignoredFiles)e.ignoredFiles=uniqueMedia(e.ignoredFiles);
  local[key]=e;
 }
}
export function currentCleanup(p,card){
 const identity=cardVisualIdentity(p,card),entry=p.cleanup?.entries?.[identity.key];
 if(entry){const files=entry.removed?[]:entry.files||[];const status=!files.length?'none':entry.variantAssetId!==identity.assetId?'review':files.some(f=>f.missing||f.state==='missing')?'missing':files.some(f=>f.state==='unreadable')?'unreadable':files.some(f=>!f.width||!f.height||f.kind==='video'&&!(f.duration>0))?'checking':'ready';return{identity,entry,files,status};}
 const r=resolveCardImages(p,card);return{identity,entry:null,status:r.status==='ready'?'ready':r.status==='unmatched'?'none':'review',files:r.status==='ready'?r.files.map(f=>({...f,name:f.name,kind:'image',path:r.group.batch.directory+'/'+f.path,...r.group.batch.fileStates[f.path]})):[]};
}
export function attachCleanup(p,card,files,extra={}){
 if(files.length>64)throw Error('Attach at most 64 components to one drawing.');
 const v=cardVisualIdentity(p,card),entry={sourceCardId:v.sourceId,variantIndex:v.index,variantAssetId:v.assetId,source:'manual',...extra,updatedAt:new Date().toISOString(),revision:crypto.randomUUID(),files:files.map((f,i)=>({...f,id:f.id||crypto.randomUUID(),stackOrder:i+1}))};
 ensureCleanup(p).entries[v.key]=entry;return entry;
}
export function archiveCleanup(p,card,files){const model=ensureCleanup(p),unique=files.filter(f=>!model.archive.some(a=>a.files.some(x=>x.id===f.id&&x.fingerprint===f.fingerprint)&&!a.restored));if(unique.length)model.archive.push({id:crypto.randomUUID(),cardId:card.id,sourceCardId:cardVisualIdentity(p,card).sourceId,label:card.id,removedAt:new Date().toISOString(),files:structuredClone(unique.map(f=>({...f,...(currentCleanup(p,card).entry?.referenceFiles?.some(r=>r.id===f.id)?{role:'reference'}:{})})))});}
export function removeCleanup(p,card){const old=currentCleanup(p,card),files=[...old.files,...(old.entry?.referenceFiles||[])],ignoredFiles=uniqueMedia([...(old.entry?.ignoredFiles||[]),...files]);archiveCleanup(p,card,files);const e=attachCleanup(p,card,[],{ignoredFiles,blockedExportIds:[...(old.entry?.blockedExportIds||[]),old.entry?.exportId].filter(Boolean)});e.removed=true;return e;}
export function cleanupCatalog(p){return{format:'studio-media-index-v1',schemaVersion:1,projectId:p.id,entries:structuredClone(p.cleanup?.entries||{}),unassigned:structuredClone(p.cleanup?.unassigned||[]),unassignedRevision:p.cleanup?.unassignedRevision||null};}
export function ingestCleanupIndexes(p){
 upgradeFolderExporterOwnership(p);
 const grouped=new Map();for(const g of imageGroups(p)){if(g.batch.projectId!==p.id||g.batch.incomplete||g.frame.complete===false||!g.frame.autoMatch||!g.batch.directory)continue;const key=JSON.stringify([g.frame.suggestedSourceId,g.frame.suggestedVariantIndex]);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(g);}
 for(const[key,list]of grouped){list.sort((a,b)=>Date.parse(b.frame.exportedAt||b.batch.createdAt)-Date.parse(a.frame.exportedAt||a.batch.createdAt));const g=list[0],stamp=g.frame.exportedAt||g.batch.createdAt,existing=p.cleanup?.entries?.[key];if(!Number.isFinite(Date.parse(stamp))||existing&&Date.parse(existing.updatedAt)>=Date.parse(stamp))continue;if(!existing&&new Set(list.map(g=>g.batch.sourceId)).size>1)continue;
  const card=p.stories.find(c=>cardVisualIdentity(p,c).key===key);if(!card)continue;const files=representationFiles(g.frame,defaultRepresentation(g.frame)).map(f=>({...f,path:g.batch.directory+'/'+f.path,kind:'image',...g.batch.fileStates[f.path]}));if(files.some(f=>f.state!=='ok'&&f.state!=='preview-unavailable'))continue;
  const extras=(existing?.files||[]).filter(f=>f.origin==='attached'&&!files.some(x=>normalizePath(mediaPath(p,x))===normalizePath(mediaPath(p,f))));const e=attachCleanup(p,card,[...files,...extras],{source:'folderexporter',sourceId:g.batch.sourceId,exportId:g.batch.exportId,ignoredFiles:existing?.ignoredFiles||[]});e.updatedAt=stamp;
 }
 upgradeFolderExporterOwnership(p);
}

export function upgradeFolderExporterOwnership(p){
 const root=p.studioLink?.directory;if(!root)return;
 for(const g of imageGroups(p)){
  if(g.batch.projectId!==p.id)continue;
  const identity=JSON.stringify([g.frame.suggestedSourceId,g.frame.suggestedVariantIndex]),e=p.cleanup?.entries?.[identity];
  if(!e||e.removed||e.source!=='folderexporter'||e.sourceId!==g.batch.sourceId||e.exportId!==(g.frame.exportId||g.batch.exportId))continue;
  let changed=false;const local=f=>pathInside(root,g.batch.directory+'/'+f.path),same=(f,s)=>normalizePath(mediaPath(p,f))===normalizePath(g.batch.directory+'/'+s.path);
  const convert=(s,old={})=>{const relative=local(s);if(!relative)return null;const info=g.batch.fileStates?.[s.path]||{};return{...old,...info,id:old.id||crypto.randomUUID(),kind:'image',name:s.name,path:normalizePath(root)+'/'+relative,relativePath:relative,width:s.width,height:s.height,managed:!!s.managed,componentSuffix:s.componentSuffix||'',componentIndex:s.kind==='component'?(s.stackOrder||s.componentIndex):null,componentName:s.label||s.sourceComponentName,missing:info.state==='missing'};};
  const components=g.frame.files.filter(f=>f.kind==='component'),whole=g.frame.files.find(f=>f.kind==='whole-frame');
  if(components.length&&whole&&e.files.length===1&&same(e.files[0],whole)&&components.every(local)){
   const reference=convert(whole,e.files[0]);if(reference){e.referenceFiles||=[];if(!e.referenceFiles.some(f=>same(f,whole)))e.referenceFiles.push(reference);e.files=components.map(f=>convert(f));e.files.forEach((f,i)=>f.stackOrder=i+1);changed=true;}
  }
  for(const f of e.files||[]){if(f.managed!==undefined)continue;const source=g.frame.files.find(s=>same(f,s));if(!source?.managed||!local(source))continue;Object.assign(f,{managed:true,relativePath:local(source),componentSuffix:source.componentSuffix||'',componentIndex:source.kind==='component'?(source.stackOrder||source.componentIndex):null,componentName:source.label||source.sourceComponentName});changed=true;}
  if(components.length&&whole&&whole.managed&&!e.files.some(f=>same(f,whole))&&!(e.referenceFiles||[]).some(f=>same(f,whole))){const reference=convert(whole);if(reference){e.referenceFiles||=[];e.referenceFiles.push(reference);changed=true;}}
  if(changed){e.updatedAt=new Date().toISOString();e.revision=crypto.randomUUID();}
 }
}

export function swapCleanupAssignments(p,sourceIds,targetId){const at=p.stories.findIndex(c=>c.id===targetId);if(at<0)return;for(const[id,i]of [...new Set(sourceIds)].map((id,i)=>[id,i])){const from=p.stories.find(c=>c.id===id),to=p.stories[at+i];if(!from||!to||from.id===to.id||to.chapterId!==p.stories[at].chapterId)continue;const a=currentCleanup(p,from),b=currentCleanup(p,to);if(a.identity.key===b.identity.key)continue;const move=(card,current,old)=>{const e=attachCleanup(p,card,structuredClone(current.files),{source:'manual',referenceFiles:structuredClone(current.entry?.referenceFiles||[]),ignoredFiles:[...(old.entry?.ignoredFiles||[]),...old.files,...(old.entry?.referenceFiles||[])]});if(!current.files.length)e.removed=true;};move(to,a,b);move(from,b,a);}}

export function prepareCleanupHistoryRestore(before,project){if(!project||project.id!==before?.id)return;const oldFiles=new Map(Object.values(before.cleanup?.entries||{}).filter(e=>!e.removed).flatMap(e=>[...e.files,...(e.referenceFiles||[])]).map(f=>[f.id,f]));for(const e of Object.values(project.cleanup?.entries||{})){if(e.removed)continue;let changed=false;for(const f of [...e.files,...(e.referenceFiles||[])]){const old=oldFiles.get(f.id);if(f.vaultRelativePath&&(!old||old.relativePath!==f.relativePath||old.fingerprint!==f.fingerprint)){f.relativePath=f.vaultRelativePath;f.path=project.studioLink.directory+'/'+f.vaultRelativePath;f.managed=false;f.missing=false;f.state='ok';f.historyRestore=true;changed=true;}}if(changed){e.updatedAt=new Date().toISOString();e.revision=crypto.randomUUID();}}}
