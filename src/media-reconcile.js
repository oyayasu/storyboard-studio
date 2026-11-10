import {ensureCleanup,mediaPath,uniqueMedia,currentCleanup} from './cleanup-model.js';
import {normalizePath} from './local-paths.js';
import {appearanceKey} from './file-organization.js';

export function archiveChecks(p){
 const rows=new Map();
 for(const a of p.cleanup?.archive||[])if(!a.restored)for(const f of a.files||[]){
  if(f.relativePath&&f.managed&&f.fingerprint)rows.set(f.relativePath,{...f,path:mediaPath(p,f),verifyFingerprint:true});
 }
 return [...rows.values()];
}

// Reconcile identities before planning moves. No filename-based reassignment.
export function reconcileCleanupRecords(p,observations){
 const byPath=new Map(observations.map(f=>[normalizePath(f.path),f]));
 const cleanup=ensureCleanup(p),active=new Set(Object.values(cleanup.entries).filter(e=>!e.removed).flatMap(e=>[...e.files,...(e.referenceFiles||[])]).map(f=>f.id));
 const canonical=new Map(),owners=new Map();let changed=false;
 const key=f=>JSON.stringify([f.id,f.fingerprint||null]);
 const activeVersions=new Set(Object.values(cleanup.entries).filter(e=>!e.removed).flatMap(e=>[...e.files,...(e.referenceFiles||[])]).map(key));
 for(const a of cleanup.archive)if(!a.restored){
  if(a.files?.length&&a.files.every(f=>activeVersions.has(key(f)))){a.restored=true;changed=true;continue;}
  const before=JSON.stringify(a.files);a.files=uniqueMedia(a.files||[]);if(before!==JSON.stringify(a.files))changed=true;
  for(const f of a.files){const info=byPath.get(normalizePath(mediaPath(p,f)));
   if(info?.state==='ok'&&info.observedFingerprint===f.fingerprint){canonical.set(key(f),{...f,size:info.size,modified:info.modified,missing:false,state:'ok'});owners.set(key(f),a.sourceCardId||a.cardId);}
  }
 }
 for(const e of Object.values(cleanup.entries)){
  const old=JSON.stringify(e.ignoredFiles||[]);
  const archived=[...canonical.values()].filter(f=>owners.get(key(f))===e.sourceCardId&&!active.has(f.id));
  e.ignoredFiles=uniqueMedia([...(e.ignoredFiles||[]),...archived].filter(f=>!active.has(f.id)&&(!owners.has(key(f))||owners.get(key(f))===e.sourceCardId)).map(f=>canonical.get(key(f))||f));
  if(JSON.stringify(e.ignoredFiles)!==old){e.updatedAt=new Date(Math.max(Date.now(),Date.parse(e.updatedAt||0)+1)).toISOString();e.revision=crypto.randomUUID();changed=true;}
 }
 return changed;
}

export function redundantStoryboardOutputs(p,outputs){
 const keep=new Set(Object.values(p.studioLink?.storyboards||{}).filter(r=>!r.kept&&!r.retiredContext).map(r=>r.relativePath));
 const cleanups=new Set(Object.values(p.cleanup?.entries||{}).filter(e=>!e.removed).flatMap(e=>[...e.files,...(e.referenceFiles||[])]).map(f=>f.relativePath));
 const cards=['stories','unassigned','lost','archived'].flatMap(k=>p[k]||[]),out=[];
 for(const[relativePath,record]of Object.entries(outputs||{})){
  if(record.project!==p.id||keep.has(relativePath)||cleanups.has(relativePath)||!relativePath.endsWith('.png'))continue;
  const match=/^drawing:(.+):(\d+)$/.exec(record.key||'');if(!match)continue;
  const card=cards.find(c=>c.id===match[1]);if(!card||Number(card.activeVariant||0)!==Number(match[2]))continue;
  const current=p.studioLink.storyboards[appearanceKey(p,card)];if(!current||!current.archived||!currentCleanup(p,card).files.length||current.missing||current.relativePath===relativePath)continue;
  if(Object.values(p.studioLink.storyboards).some(r=>r.kept&&r.relativePath===relativePath&&r.ownerKey===record.key))continue;
  out.push({relativePath,ownerKey:record.key,cardId:card.id,sourceCardId:card.reuseOf||card.id,currentPath:current.relativePath});
 }
 return out;
}
