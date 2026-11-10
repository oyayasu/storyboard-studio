import test from 'node:test';import assert from 'node:assert/strict';
import {sameRecording,uniqueRecordings} from '../src/recording-identity.js';
import {createVideoTiming} from '../src/video-timing.js';
import {previewSegments,chapterFlags} from '../src/perform-preview-model.js';
import {reverseExpansionOrigin} from '../src/highlighter-model.js';
import {ensureWorkspace,chapterDirectories} from '../src/studio-link-model.js';
function fixture(){return{id:'ss',chapters:[{id:'a',name:'Chapter 1',highlighter:{text:'One two.',marks:[],assignments:[{id:'aa',from:0,to:8,cardId:'one'}]}},{id:'b',name:'Chapter 2',highlighter:{text:'Three four.',marks:[],assignments:[{id:'bb',from:0,to:11,cardId:'two'}]}}],stories:[{id:'one',chapterId:'a'},{id:'two',chapterId:'b'}],videoTiming:{tracks:[]}};}
function timing(){return{format:'whisperdesk-timing-v1',schemaVersion:1,timeUnit:'seconds',studioProjectId:'ss',projectId:'sub-1',chapterIds:['a'],exportedAt:'2026-11-05T10:00:00Z',source:{name:'Audio.wav',path:'/Project/Audio.wav',fingerprint:'audio-v1-test',duration:7.2},words:['One','two','Three','four'].map((text,i)=>({id:'w'+i,text,start:i*1.5,end:i*1.5+1,timing:'whisper'}))};}
test('original audio identity survives transcript IDs and moves, without merging namesakes',()=>{
 assert.ok(sameRecording({source:{path:'/a.wav'}},{source:{path:'/a.wav'}}));
 assert.ok(sameRecording({source:{path:'/old/a.wav',fingerprint:'a'}},{source:{path:'/new/b.wav',fingerprint:'a'}}));
 assert.ok(!sameRecording({source:{name:'a.wav',path:'/a/a.wav'}},{source:{name:'a.wav',path:'/b/a.wav'}}));
 assert.ok(!sameRecording({source:{path:'/a.wav',fingerprint:'a'}},{source:{path:'/a.wav',fingerprint:'b'}}));
 const tracks=[{id:'old',source:{path:'/a.wav'},words:[1],exportedAt:'2026-01-01'},{id:'new',source:{path:'/a.wav'},words:[1],exportedAt:'2026-02-01'}];assert.equal(uniqueRecordings(tracks)[0].id,'new');
});
test('one audio rematches all chapters after script splitting and reuses one recording',async()=>{
 const p=fixture(),api=createVideoTiming({project:()=>p,commit:(_n,f)=>f(),notify:msg=>{throw Error(msg);}}),raw=timing();
 await api.importText(JSON.stringify(raw),'timing.json',{automatic:true});
 assert.equal(p.videoTiming.tracks.length,1);assert.deepEqual(p.videoTiming.tracks[0].chapterIds,['a','b']);
 assert.equal(p.videoTiming.tracks[0].cues.find(c=>c.chapterId==='b').start,3);
 raw.projectId='sub-2';raw.exportedAt='2026-11-05T11:00:00Z';await api.importText(JSON.stringify(raw),'new.json',{automatic:true});assert.equal(p.videoTiming.tracks.length,1);
 const all=previewSegments(p),chapter=previewSegments(p,'b');assert.equal(all.length,1);assert.equal(chapter[0].start,3);assert.equal(chapter[0].cues[0].cardId,'two');assert.equal(chapterFlags(all,p).length,2);
});
test('a newly populated chapter is detected even if it was outside the original timing scope',async()=>{
 const p=fixture(),second=p.chapters.pop(),card=p.stories.pop(),api=createVideoTiming({project:()=>p,commit:(_n,f)=>f(),notify:msg=>{throw Error(msg);}});
 await api.importText(JSON.stringify(timing()),'timing.json',{automatic:true});p.chapters.push(second);p.stories.push(card);api.rematch();assert.equal(p.videoTiming.tracks[0].cues.find(c=>c.chapterId==='b').start,3);
});
test('two different recordings cover separate chapters rather than duplicating full-project cues',async()=>{
 const p=fixture(),api=createVideoTiming({project:()=>p,commit:(_n,f)=>f(),notify:msg=>{throw Error(msg);}}),first=timing(),second=timing();first.words=first.words.slice(0,2);second.projectId='other';second.source={...second.source,name:'Other.wav',path:'/Project/Other.wav',fingerprint:'other'};second.words=second.words.slice(2).map(w=>({...w,start:w.start-3,end:w.end-3}));
 await api.importText(JSON.stringify(first),'a.json',{automatic:true});await api.importText(JSON.stringify(second),'b.json',{automatic:true});
 assert.equal(p.videoTiming.tracks.length,2);assert.deepEqual(p.videoTiming.tracks.map(t=>t.chapterIds),[['a'],['b']]);assert.equal(previewSegments(p,'b')[0].start,0);
});
test('reverse selection from the final word always unassigns before expansion snapping',()=>{
 const ch={highlighter:{text:'Alpha walks. Beta waits. Last ending.',assignments:[{id:'a',cardId:'one',from:0,to:12},{id:'b',cardId:'two',from:13,to:36}]}};
 assert.equal(reverseExpansionOrigin(ch,35,0),null);assert.equal(reverseExpansionOrigin(ch,32,0),null);assert.equal(reverseExpansionOrigin(ch,17,0)?.cardId,'two');
});
test('deleted/unwritten chapter folders release names without inventing _2 versions',()=>{
 const p=fixture();ensureWorkspace(p);const old=chapterDirectories(p)[0].path;p.studioLink.chapterDirectoryStates[old]='empty';p.chapters[0].name='Renamed';assert.match(chapterDirectories(p)[0].path,/Renamed/);assert.ok(p.studioLink.cleanupChapterDirectories.includes(old));
 const id=p.chapters[0].id;p.chapters=p.chapters.slice(1);chapterDirectories(p);assert.ok(!p.studioLink.chapterDirectories[id]);
});
