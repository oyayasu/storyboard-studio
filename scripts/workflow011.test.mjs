import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ensureWorkspace,namingDefaults} from '../src/studio-link-model.js';
import {attachCleanup,currentCleanup,removeCleanup,mergeCatalog,cleanupCatalog} from '../src/cleanup-model.js';
import {reconcileCleanupRecords,redundantStoryboardOutputs} from '../src/media-reconcile.js';
import {appearanceKey,organizationPlan} from '../src/file-organization.js';
import {projectAudioState} from '../src/audio-page.js';
import {assignRange,rewindFreedAssignments,nextExistingCard} from '../src/highlighter-model.js';
const fixture=()=>{const p={id:'regression',name:'Test',ratio:'16:9',customTags:[],viewPrefs:{slightModifyLetters:true},chapters:[{id:'ch',name:'Chapter 1',highlighter:{text:'one two three four five six seven',marks:[],assignments:[]}}],stories:Array.from({length:7},(_,i)=>({id:'card'+(i+1),chapterId:'ch',variants:[]})),unassigned:[],lost:[],archived:[]};p.stories[1].reuseOf='card1';ensureWorkspace(p);p.fileNaming=namingDefaults();return p;};
test('an expansion freeing Card 3 rewinds the existing-card cursor, even though Card 4 was never assigned',()=>{const p=fixture(),ch=p.chapters[0];assignRange(ch,0,3,'card1');assignRange(ch,4,7,'card2');assignRange(ch,8,13,'card3');ch.highlighter.nextExistingCardId='card4';const before=structuredClone(ch.highlighter.assignments);assignRange(ch,4,13,'card2');rewindFreedAssignments(ch,before);assert.equal(nextExistingCard(p,ch).id,'card3');});
test('catalog reconciliation does not resurrect removed inactive rows',()=>{const p=fixture(),c=p.stories[0];const old=attachCleanup(p,c,[{id:'media',path:'/Project/a.png',kind:'image'}],{ignoredFiles:[{id:'old',path:'/Project/old.png',kind:'image'}]});const incoming=cleanupCatalog(p);incoming.entries[JSON.stringify(['card1',0])].ignoredFiles=[];mergeCatalog(p,incoming);assert.equal(currentCleanup(p,c).entry.ignoredFiles.length,0);assert.equal(old.ignoredFiles.length,1);});
test('archive reconciliation merges repeated history and removes competing inactive claims only after byte verification',()=>{const p=fixture();p.studioLink.directory='/Project';const old={id:'old',kind:'image',fingerprint:'verified',managed:true,path:'/Project/Ch/3.png',relativePath:'Ch/3.png',missing:true};attachCleanup(p,p.stories[2],[],{ignoredFiles:[old,old]});attachCleanup(p,p.stories[3],[],{ignoredFiles:[old]});const archived={...old,path:'/Project/OldArchive/3.png',relativePath:'OldArchive/3.png'};p.cleanup.archive=[{cardId:'card3',files:[archived,archived]}];assert.equal(reconcileCleanupRecords(p,[{path:archived.path,state:'ok',observedFingerprint:'verified',size:12,modified:2}]),true);assert.equal(p.cleanup.archive[0].files.length,1);assert.equal(currentCleanup(p,p.stories[2]).entry.ignoredFiles[0].relativePath,'OldArchive/3.png');assert.equal(currentCleanup(p,p.stories[3]).entry.ignoredFiles.length,0);assert.equal(reconcileCleanupRecords(p,[{path:archived.path,state:'ok',observedFingerprint:'verified',size:12,modified:2}]),false);});
test('moving an active cleanup never leaves that same version listed as a deleted archive',()=>{const p=fixture(),file={id:'media',fingerprint:'current',path:'/Project/a.png',kind:'image'};attachCleanup(p,p.stories[0],[file]);p.cleanup.archive=[{id:'same',cardId:'card3',files:[{...file}]},{id:'older',cardId:'card3',files:[{...file,fingerprint:'older'}]}];reconcileCleanupRecords(p,[]);assert.equal(p.cleanup.archive[0].restored,true);assert.equal(p.cleanup.archive[1].restored,undefined);});
test('external project audio is usable only with the selected recording’s timing',()=>{const p=fixture();p.studioLink.directory='/Project';p.studioLink.activeAudio={path:'/Elsewhere/voice.wav',name:'voice.wav',fingerprint:'a',duration:3};p.videoTiming={tracks:[{source:{fingerprint:'b'},words:[{start:0,end:1}]}]};assert.deepEqual([projectAudioState(p).outside,projectAudioState(p).ready],[true,false]);p.videoTiming.tracks[0].source.fingerprint='a';assert.equal(projectAudioState(p).ready,true);});
test('the archive parent applies to new chapters and preserves the chapter naming pattern',()=>{const p=fixture();p.studioLink.directory='/Project';p.studioLink.storyboards[appearanceKey(p,p.stories[0])]={cardId:'card1',relativePath:'Ch/1.png'};attachCleanup(p,p.stories[0],[{id:'f',kind:'image',path:'/Project/f.png'}]);assert.ok(organizationPlan(p).some(m=>m.to==='Storyboard Archive/1 - Chapter 1_storyboard/1_storyboard.png'));});

const binary=process.env.STUDIO_TEST_NATIVE;
test('seven-card upgrade repairs already-archived cleanups and ownership conflicts; repeat save and cleanup removal stay consistent',{skip:!binary},async()=>{
 const root=await fs.mkdtemp('/tmp/studio011-'),external=await fs.mkdtemp('/tmp/studio011-external-'),p=fixture();p.studioLink.directory=root;
 const previous={window:globalThis.window,document:globalThis.document,FileReader:globalThis.FileReader};
 const invoke=async(name,args)=>{
  if(name==='probe_project_folder')return{directory:args.directory,exists:true,projectId:p.id};
  const run=spawnSync(binary,[],{input:JSON.stringify({name,args}),encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);if(!result.ok)throw Error(result.error);
  return name==='inspect_cleanup_media'?result.value.map(f=>f.missing?f:{...f,width:64,height:36}):result.value;
 };
 globalThis.window={__TAURI__:{core:{invoke}}};globalThis.document={querySelectorAll:()=>[],addEventListener(){}};globalThis.FileReader=class{async readAsDataURL(blob){this.result='data:image/png;base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');this.onload();}};
 const {createCleanup}=await import('../src/cleanup.js'),{createStudioLink}=await import('../src/studio-link.js');let studio;
 const cleanup=createCleanup({project:()=>p,save(){},notify(){},render(){},commit(_label,fn){fn();},ensureRoot:()=>studio.ensureRoot()});
 studio=createStudioLink({project:()=>p,numbering:()=> 'chapter',save(){},notify(){},syncCleanup:()=>cleanup.sync(),prepareCleanup:()=>cleanup.prepare(),checkCleanup:()=>cleanup.refresh(),inspectCleanup:paths=>cleanup.inspect(paths),dimensions:()=>[64,36],drawingBlob:async c=>new Blob(['ROUGH-'+(c.reuseOf||c.id)])});
 try{
  await studio.sync();
  for(const c of p.stories){const saved=await invoke('write_project_output',{directory:root,relativePath:'1 - Chapter 1_storyboard/'+c.id+'.png',base64Data:Buffer.from('ROUGH-'+c.id).toString('base64'),projectId:p.id,ownerKey:'drawing:'+c.id+':0'});p.studioLink.storyboards[appearanceKey(p,c)]={...saved,cardId:c.id,sourceCardId:c.reuseOf||c.id,archived:true,ownerKey:'drawing:'+c.id+':0'};}
  for(let i=0;i<p.stories.length;i++){
   if(i===1)continue;const c=p.stories[i],source=path.join(external,'new-'+i+'.png');await fs.writeFile(source,'NEW CLEANUP '+i);
   const [f]=await invoke('manage_cleanup_media',{directory:root,projectId:p.id,action:'preserve',stage:true,files:[{id:'new-'+i,path:source,kind:'image',width:64,height:36}]});attachCleanup(p,c,[{...f,state:i>=2?'unreadable':'ok'}]);
   if(i>=2){const oldPath='1 - Chapter 1_storyboard/old-'+i+'.png';await fs.writeFile(path.join(root,oldPath),'OLD CLEANUP '+i);const [archived]=await invoke('manage_cleanup_media',{directory:root,projectId:p.id,action:'preserve',stage:false,files:[{id:'old-'+i,path:path.join(root,oldPath),kind:'image',width:64,height:36}]});const stale={...archived,path:root+'/1 - Chapter 1/'+(i+1)+'.png',relativePath:'1 - Chapter 1/'+(i+1)+'.png',missing:true,state:'missing'};currentCleanup(p,c).entry.ignoredFiles=[stale,structuredClone(stale)];p.cleanup.archive.push({id:'history-'+i,cardId:c.id,sourceCardId:c.id,files:[archived,structuredClone(archived)]});}
  }
  // The same old Card 6 media was accidentally retained on Card 7 too.
  currentCleanup(p,p.stories[6]).entry.ignoredFiles.push(structuredClone(currentCleanup(p,p.stories[5]).entry.ignoredFiles[0]));
  const extra=await invoke('write_project_output',{directory:root,relativePath:'1 - Chapter 1/3.png',base64Data:Buffer.from('OBSOLETE ROUGH').toString('base64'),projectId:p.id,ownerKey:'drawing:card2:0'});
  p.studioLink.storyboards.stale={...extra,cardId:'card3',ownerKey:'drawing:card3:0',kept:true};
  await cleanup.sync();await studio.sync();await cleanup.refresh();await studio.storyboards(p.stories,{interactive:false});
  assert.deepEqual(p.stories.map(c=>currentCleanup(p,c).status),Array(7).fill('ready'));
  assert.equal(p.studioLink.organizationIssues.length,0,JSON.stringify(p.studioLink.organizationIssues));
  assert.equal(await fs.readFile(path.join(root,'1 - Chapter 1/3.png'),'utf8'),'NEW CLEANUP 2');assert.equal(p.studioLink.storyboards.stale,undefined);
  for(const c of p.stories)assert.ok(p.studioLink.storyboards[appearanceKey(p,c)].relativePath.startsWith('Storyboard Archive/'));
  const tracked=currentCleanup(p,p.stories[2]).files[0];assert.equal(await fs.readFile(path.join(root,tracked.relativePath),'utf8'),'NEW CLEANUP 2');
  const inspected=await studio.supervise();assert.equal(inspected.issues.length,0,JSON.stringify(inspected.issues));
  const activeStat=await fs.stat(path.join(root,tracked.relativePath));await studio.storyboards(p.stories,{interactive:false});assert.equal((await fs.stat(path.join(root,tracked.relativePath))).mtimeMs,activeStat.mtimeMs);
  const records=['project.json','media-index.json','storyboard-outputs.json','spoken-script.json','storyboard.ssreference.json'];const dates=await Promise.all(records.map(name=>fs.stat(path.join(root,'Studio Link',name)).then(s=>s.mtimeMs)));await studio.storyboards(p.stories,{interactive:false});assert.deepEqual(await Promise.all(records.map(name=>fs.stat(path.join(root,'Studio Link',name)).then(s=>s.mtimeMs))),dates);

  removeCleanup(p,p.stories[2]);await cleanup.sync();await studio.storyboards(p.stories,{interactive:false});assert.equal(currentCleanup(p,p.stories[2]).status,'none');assert.equal(await fs.readFile(path.join(root,'1 - Chapter 1/3.png'),'utf8'),'ROUGH-card3');
  await studio.storyboards(p.stories,{interactive:false});assert.equal(currentCleanup(p,p.stories[2]).status,'none');
  assert.equal(await fs.readFile(path.join(external,'new-2.png'),'utf8'),'NEW CLEANUP 2');
  const broken=currentCleanup(p,p.stories[3]).files[0],identity=broken.id;await fs.unlink(path.join(root,broken.relativePath));broken.missing=true;broken.state='missing';
  await cleanup.attach('card4',[path.join(external,'new-3.png')]);assert.equal(currentCleanup(p,p.stories[3]).files.length,1);assert.equal(currentCleanup(p,p.stories[3]).files[0].id,identity);assert.equal(currentCleanup(p,p.stories[3]).status,'ready');await studio.storyboards(p.stories,{interactive:false});assert.equal(await fs.readFile(path.join(root,currentCleanup(p,p.stories[3]).files[0].relativePath),'utf8'),'NEW CLEANUP 3');

 }finally{Object.assign(globalThis,previous);await fs.rm(root,{recursive:true,force:true});await fs.rm(external,{recursive:true,force:true});}
});
