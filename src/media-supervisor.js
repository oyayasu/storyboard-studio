import {currentCleanup,mediaPath} from './cleanup-model.js';
import {archiveRough,roughDestination} from './media-policy.js';
import {appearanceKey} from './file-organization.js';
// This checker runs after the normal pipeline, never as a second importer/renamer.
export function supervisorPlan(p){
 const checks=[],issues=[],files=new Map();
 for(const c of p.stories||[]){const clean=currentCleanup(p,c),rough=p.studioLink?.storyboards?.[appearanceKey(p,c)],target=roughDestination(p,c);
  if(rough){checks.push({id:c.id,role:'storyboard',path:rough.path||p.studioLink.directory+'/'+rough.relativePath,relativePath:rough.relativePath});if(!archiveRough(p,c)&&target&&rough.relativePath!==target.path)issues.push({cardId:c.id,kind:'routing',message:'Storyboard needs its current chapter location.'});}
  else issues.push({cardId:c.id,kind:'unexported',message:'Storyboard has not been exported.'});
  if(clean.status==='unreadable'||clean.status==='checking')issues.push({cardId:c.id,kind:'preview',message:'Cleanup preview needs attention.'});

  for(const [i,f]of clean.files.entries()){const key=f.id||mediaPath(p,f),seen=files.get(key);if(seen&&seen.path!==mediaPath(p,f))issues.push({cardId:c.id,kind:'identity',message:'One cleanup identity has competing locations.'});files.set(key,{path:mediaPath(p,f)});checks.push({...f,cardId:c.id,role:'cleanup',path:mediaPath(p,f),stackOrder:i+1});if(f.vaultRelativePath)checks.push({id:f.id,cardId:c.id,role:'cleanup recovery',verifyFingerprint:true,fingerprint:f.fingerprint,relativePath:f.vaultRelativePath,path:p.studioLink.directory+'/'+f.vaultRelativePath});else issues.push({cardId:c.id,kind:'recovery',message:'Cleanup recovery copy has not been created.'});}
  if(new Set(clean.files.map(f=>f.stackOrder)).size!==clean.files.length)issues.push({cardId:c.id,kind:'stack',message:'Component order needs review.'});
 }
 const all=['stories','unassigned','lost','archived'].flatMap(k=>p[k]||[]),ids=new Set();for(const card of all){if(ids.has(card.id))issues.push({kind:'identity',message:'A permanent card ID is repeated: '+card.id});ids.add(card.id);}for(const card of all)if(card.reuseOf&&!ids.has(card.reuseOf))issues.push({cardId:card.id,kind:'relationship',message:'Reusable copy has no source card.'});
 for(const ch of p.chapters||[])for(const a of ch.highlighter?.assignments||[]){if(!ids.has(a.cardId))issues.push({kind:'script',message:ch.name+': linked text points to an unavailable card.'});}
 for(const group of p.cleanup?.unassigned||[])for(const f of group.files||[])checks.push({...f,role:'unassigned cleanup',path:mediaPath(p,f)});
 for(const group of p.cleanup?.archive||[])if(!group.restored)for(const f of group.files||[])if(f.vaultRelativePath)checks.push({...f,relativePath:f.vaultRelativePath,role:'archived cleanup recovery',verifyFingerprint:true,path:p.studioLink.directory+'/'+f.vaultRelativePath});
 const audio=p.studioLink?.activeAudio;if(audio?.path||audio?.relativePath)checks.push({...audio,id:'project-audio',role:'audio',path:audio.relativePath?p.studioLink.directory+'/'+audio.relativePath:audio.path});
 return{checks,issues};
}
export function fitScale(width,height,frameWidth,frameHeight){return Math.min(1,frameWidth/width,frameHeight/height)*100;}
