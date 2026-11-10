import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reverseExpansionOrigin, removeAssignmentRange, nextExistingCard, advanceExistingCard} from '../src/highlighter-model.js';
import {parseSheetLayout} from '../src/sheet-layout-model.js';
import {buildTimelinePlan, exportDefaults, materializeTimeline, timelineXml, timelineFcpxml} from '../src/timeline-export-model.js';
import {fixture} from './timeline-fixture.mjs';

test('reverse takeover needs an entire raw word from the starting card before snapping',()=>{
  const ch={highlighter:{text:'Alpha walks. Beta waits.',assignments:[{id:'a',cardId:'one',from:0,to:12},{id:'b',cardId:'two',from:13,to:24}]}};
  assert.equal(reverseExpansionOrigin(ch,15,0),null); // only Be from Beta
  assert.equal(reverseExpansionOrigin(ch,12,0),null); // within Card 1: erase
  assert.equal(reverseExpansionOrigin(ch,17,3)?.cardId,'two'); // whole Beta
  assert.equal(reverseExpansionOrigin(ch,23,14),null); // stays within Card 2
  assert.equal(reverseExpansionOrigin(ch,3,17),null); // never controls forward selection
  assert.equal(reverseExpansionOrigin(ch,13,3),null); // boundary only
});

test('unassigning a card resets the cursor even before existing-card mode is exhausted',()=>{
  const p=fixture(),ch=p.chapters[0];p.stories.push({id:'third',chapterId:'ch'});
  ch.highlighter.nextExistingCardId='third';
  removeAssignmentRange(ch,0,8);
  assert.equal(nextExistingCard(p,ch).id,'one');
  advanceExistingCard(p,ch,'one');assert.equal(nextExistingCard(p,ch).id,'copy');
});

const layout=()=>({format:'storyboard-studio-sheet-layout',schemaVersion:1,id:'custom-two',name:'Two landscape panels',page:{width:1000,height:1000},cards:[{x:50,y:50,width:900,height:400},{x:50,y:550,width:900,height:400}],cropInset:5});
test('custom sheet definitions preserve explicit reading order and reject ambiguous geometry',()=>{
  const raw=layout(),parsed=parseSheetLayout(JSON.stringify(raw));
  assert.deepEqual(parsed.boxes,[[50,50,900,400],[50,550,900,400]]);
  assert.equal(parsed.custom,true);assert.equal(parsed.cropInset,5);
  assert.throws(()=>parseSheetLayout({...raw,id:'sheet-3x5'}));
  assert.throws(()=>parseSheetLayout(raw,['custom-two']));
  assert.throws(()=>parseSheetLayout({...raw,cards:[...raw.cards,raw.cards[0]]}));
  assert.throws(()=>parseSheetLayout({...raw,cards:[{x:900,y:0,width:200,height:100}]}));
  assert.throws(()=>parseSheetLayout({...raw,page:{width:NaN,height:1000}}));
  assert.throws(()=>parseSheetLayout(' '.repeat(262145)));
});

function materialized(fps='30'){
  const p=fixture();p.videoTiming.tracks[0].audioPath='/Project/Narration.wav';
  return materializeTimeline(buildTimelinePlan(p,{...exportDefaults(),fps}),'/Project',{rec:{channels:2,sampleRate:44100,duration:7.2,path:'/Project/Narration.wav',name:'Narration.wav'}});
}
test('Resolve FCPXML has one stereo asset-clip, original paths and independent component lanes',()=>{
  const plan=materialized(),x=timelineFcpxml(plan);
  assert.match(x,/<fcpxml version="1.10">/);
  assert.equal((x.match(/srcEnable="audio"/g)||[]).length,1);
  assert.equal((x.match(/audioChannels="2"/g)||[]).length,1);
  assert.equal((x.match(/<video ref=/g)||[]).length,4);
  assert.match(x,/<gap [^>]+offset="1\/2s"/);assert.match(x,/lane="1"/);assert.match(x,/lane="2"/);
  assert.match(x,/src="file:\/\/localhost\/Project\/Narration.wav"/);
  assert.match(x,/offset="0s" start="0s" duration="36\/5s" srcEnable="audio"/);
  assert.ok(!/<sync-clip|<ref-clip|<media\s|<link>/.test(x));
  assert.equal((x.match(/<marker /g)||[]).length,2);
  assert.match(x,/Test &amp; 日本語/);
  if(process.env.FCPXML_OUTPUT)fs.writeFileSync(process.env.FCPXML_OUTPUT,x);
});
test('timeline cuts stay unchanged; legacy still handles do not turn Resolve images into sequences',()=>{
  const p=materialized('29.97'),modern=timelineFcpxml(p),legacy=timelineXml(p);
  assert.match(modern,/frameDuration="1001\/30000s"/);
  for(const c of legacy.matchAll(/<clipitem id="video-[\s\S]*?<\/clipitem>/g)){
    const read=n=>+c[0].match(new RegExp(`<${n}>([0-9]+)</${n}>`))[1];
    assert.ok(read('in')>100000);assert.ok(read('out')<read('duration'));
    assert.ok(p.cues.some(q=>q.start===read('start')&&q.end===read('end')));
  }
  assert.match(modern,/<video [^>]*start="3600s"/);
  assert.ok(!/<format id="format[^>]*frameDuration/.test(modern));
  assert.ok(modern.includes('start="3600s"'));
  assert.equal((modern.match(/duration="0s" hasVideo="1"/g)||[]).length,p.media.filter(m=>m.kind==='image').length);
});
