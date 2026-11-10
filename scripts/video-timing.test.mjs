import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {parseTiming,buildTiming,attachTiming,timingStale,saveCueTiming,reviewCue,alignWords} from '../src/video-timing-model.js';
function fixture(text='One two three. Four five six.',spoken='One two three Four five six'){
 const p={chapters:[{id:'c',name:'Chapter',highlighter:{text,marks:[],assignments:[{id:'a',from:0,to:14,cardId:'one'},{id:'b',from:15,to:text.length,cardId:'two'}]}}],stories:[{id:'one',chapterId:'c'},{id:'two',chapterId:'c'}]};
 const words=spoken.split(' ').map((text,i)=>({id:'w'+i,text,start:i,end:i+.7,timing:'whisper'}));
 const raw={format:'whisperdesk-timing-v1',schemaVersion:1,timeUnit:'seconds',source:{name:'Audio.wav',duration:words.length+.5},words};return {p,raw,parsed:parseTiming(raw)};
}
test('validate genuine handoff contract without trusting paths or duplicate IDs',()=>{
 const {raw}=fixture();assert.equal(parseTiming(raw).words.length,6);raw.words[1].id=raw.words[0].id;assert.throws(()=>parseTiming(raw),/duplicate/);
 for(const mutation of [r=>r.format='other',r=>r.timeUnit='milliseconds',r=>r.words[0].start=-1,r=>r.words[1].start=-1,r=>r.words[0].end=100,r=>r.source.duration=null]){const {raw}=fixture();mutation(raw);assert.throws(()=>parseTiming(raw));}
});
test('normalize punctuation and apostrophes and use first word / next cue holds',()=>{
 const {p,parsed}=fixture();const t=buildTiming(p,parsed,['c']);assert.equal(t.matchedWords,6);assert.deepEqual(t.cues.map(c=>[c.start,c.end]),[[0,3],[3,6.5]]);assert.equal(t.cues[0].issues.length,0);
 const f=fixture('“One two three.” Four five six.');f.p.chapters[0].highlighter.assignments=[{id:'x',from:0,to:f.p.chapters[0].highlighter.text.length,cardId:'one'}];assert.equal(buildTiming(f.p,f.parsed,['c']).matchedWords,6);
});
test('annotations excluded independently of assignment; annotation-only cue skipped',()=>{
 const {p,parsed}=fixture();p.chapters[0].highlighter.marks=[{from:0,to:14,categoryId:'note'}];const t=buildTiming(p,parsed,['c']);assert.equal(t.scriptWordCount,3);assert.equal(t.cues[0].excluded,true);assert.equal(t.cues[0].start,null);assert.equal(t.cues[1].start,3);
});
test('deletions, extra speech and estimated words remain reviewable',()=>{
 const {p,raw}=fixture(undefined,'One three Four extra five six');raw.words[4].timing='estimated';const t=buildTiming(p,parseTiming(raw),['c']);assert.equal(t.cues[0].coverage,2/3);assert.match(t.cues[0].issues.join(' '),/not matched/);assert.match(t.cues[1].issues.join(' '),/Extra spoken|Estimated/);assert.ok(t.cues.every(c=>!c.reviewed));
});
test('repeated wording flagged; monotonic alignment handles repeats correctly',()=>{
 const {p,parsed}=fixture('One two three. One two three.','One two three One two three');const t=buildTiming(p,parsed,['c']);assert.deepEqual(t.cues.map(c=>c.start),[0,3]);assert.ok(t.cues.every(c=>c.issues.some(i=>i.includes('Repeated'))));
});
test('unmatched cues do not fabricate timing, independent appearances preserve card ID',()=>{
 const {p,parsed}=fixture('Gone absent no. Four five six.');p.chapters[0].highlighter.assignments[1].cardId='one';const t=buildTiming(p,parsed,['c']);assert.equal(t.cues[0].start,null);assert.equal(t.cues[0].end,null);assert.equal(t.cues[1].start,3);assert.equal(t.cues[0].cardId,t.cues[1].cardId);assert.notEqual(t.cues[0].id,t.cues[1].id);
});
test('manual times validate bounds/overlaps and confirmation uses stale-script gate',()=>{
 const {p,parsed}=fixture();const t=buildTiming(p,parsed,['c']);attachTiming(p,t);saveCueTiming(t,t.cues[0].id,.2,2.7);assert.equal(t.cues[0].manual,true);reviewCue(p,t,t.cues[0].id);assert.equal(t.cues[0].reviewed,true);
 for(const [s,e] of [[-1,2],[2,1],[0,3.1],[NaN,2],[1,100]])assert.throws(()=>saveCueTiming(t,t.cues[0].id,s,e));
 p.chapters[0].highlighter.assignments[0].to=10;assert.equal(timingStale(p,t),true);assert.throws(()=>reviewCue(p,t,t.cues[0].id),/changed/);assert.equal(t.cues[0].start,.2);
});
test('renumbering, chapter titles and drawing variants preserve timing',()=>{
 const {p,parsed}=fixture();const t=buildTiming(p,parsed,['c']);p.stories.reverse();p.stories[0].activeVariant=2;p.chapters[0].name='Changed title';assert.equal(timingStale(p,t),false);p.stories.push({id:'new',chapterId:'c'});assert.equal(timingStale(p,t),false);p.stories=p.stories.filter(c=>c.id!=='one');assert.equal(timingStale(p,t),true);
});
test('chapter-sized imports preserve unrelated chapters; replacement explicit',()=>{
 const {p,parsed}=fixture();p.chapters.push({...structuredClone(p.chapters[0]),id:'d'});p.stories.push({id:'three',chapterId:'d'});p.chapters[1].highlighter.assignments=p.chapters[1].highlighter.assignments.map(a=>({...a,cardId:'three'}));const a=buildTiming(p,parsed,['c']),b=buildTiming(p,parsed,['d']);attachTiming(p,a);attachTiming(p,b);assert.equal(p.videoTiming.tracks.length,2);assert.throws(()=>attachTiming(p,buildTiming(p,parsed,['c'])));attachTiming(p,buildTiming(p,parsed,['c']),true);assert.equal(p.videoTiming.tracks.length,2);assert.ok(p.videoTiming.tracks.includes(b));
});
test('sparse alignment matches dense LCS optimum on repeat-rich small examples',()=>{
 let seed=17;const rand=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)%4;
 for(let trial=0;trial<60;trial++){const a=Array.from({length:30},()=>({key:String(rand())})),b=Array.from({length:24},()=>({key:String(rand())})),dp=Array.from({length:31},()=>new Uint16Array(25));for(let i=1;i<=30;i++)for(let j=1;j<=24;j++)dp[i][j]=a[i-1].key===b[j-1].key?dp[i-1][j-1]+1:Math.max(dp[i-1][j],dp[i][j-1]);const map=alignWords(a,b);assert.equal(map.size,dp[30][24]);const pairs=[...map].sort((a,b)=>a[0]-b[0]);for(let i=1;i<pairs.length;i++)assert.ok(pairs[i][1]>pairs[i-1][1]);}
});
if(process.env.TEST_PROJECT&&process.env.TEST_TIMING)test('actual user files: five passages, all 58 words matched without touching source',()=>{const p=JSON.parse(fs.readFileSync(process.env.TEST_PROJECT)).project,source=JSON.stringify(p),parsed=parseTiming(fs.readFileSync(process.env.TEST_TIMING,'utf8')),t=buildTiming(p,parsed,p.chapters.map(c=>c.id));assert.equal(t.cues.length,5);assert.equal(t.scriptWordCount,58);assert.equal(t.matchedWords,58);assert.deepEqual(t.cues.flatMap(c=>c.issues),['Estimated word timing']);assert.deepEqual(t.cues.map(c=>c.start),[0,4.7,5.63,6.92,14]);assert.equal(JSON.stringify(p),source);console.log('Actual TEST cue ranges:',t.cues.map(c=>[c.start,c.end]));});
