// Run with PLAYWRIGHT_MODULE and TEST_BROWSER_PATH pointing at local test tools.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../src/',import.meta.url));
const output=process.env.TEST_OUTPUT||path.join(root,'../../test-output');fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{
 try {
  const relative=decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]);
  const filename=path.join(root,relative);if(!filename.startsWith(root))throw Error('path');
  res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(filename));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||undefined,args:['--no-sandbox','--no-zygote','--single-process','--disable-dev-shm-usage','--disable-gpu','--font-render-hinting=none'],headless:true});
 const page=await browser.newPage({viewport:{width:1500,height:900},acceptDownloads:true});page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',error=>errors.push(String(error)));
 await page.goto('http://127.0.0.1:'+server.address().port);
 const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('storyboardStudio.next.v03.state')));
 const text='Alpha opens the door. Beta waits nearby. Uncertain ending.';
 async function select(from,to,reverse=false) {
  await page.evaluate(({from,to,reverse})=>{
   const doc=document.querySelector('[data-hl-document]');
   const locate=(pos,end=false)=>{const runs=[...doc.querySelectorAll('[data-hl-offset]')];const run=runs.find(r=>pos>=+r.dataset.hlOffset&&(end?pos<=+r.dataset.hlEnd:pos<+r.dataset.hlEnd))||runs.at(-1);return [run.firstChild,pos-(+run.dataset.hlOffset)];};
   const a=locate(from),b=locate(to,true);doc.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}));window.getSelection().setBaseAndExtent(...(reverse?[...b,...a]:[...a,...b]));doc.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0}));
  },{from,to,reverse});
 }
 async function menu(name){await page.locator('[data-act="menu"]').click();await page.getByRole('button',{name,exact:true}).click();}
 async function undo(){await page.keyboard.press('Control+z');}
 async function settingOption(key,value){const item=page.locator(`[data-setting="${key}"]`);for(let i=0;i<30&&!await item.isVisible();i++){if(await page.locator('[data-settings-next]').isDisabled()){while(!await page.locator('[data-settings-prev]').isDisabled())await page.locator('[data-settings-prev]').click();}else await page.locator('[data-settings-next]').click();}await item.selectOption(value);}

 await page.locator('[data-browse="new"]').click();await page.locator('#project-title').fill('Highlighter test');await page.locator('[data-modal-btn="confirm-new-project"]').click();
 await page.locator('[data-hl-action="paste"]').click();await page.locator('[data-hl-draft]').fill(text);await page.locator('[data-hl-action="accept-text"]').click();
 assert.equal(await page.locator('[data-hl-document]').getAttribute('contenteditable'),'false');assert.equal(await page.locator('[data-hl-change="chapter"]').count(),0);
 assert.equal(await page.locator('[data-hl-action="undo"],[data-hl-action="redo"],[data-hl-action="merge"],[data-hl-action="unassign"],[data-hl-action="expand"]').count(),0);
 await page.locator('[data-hl-change="assignment-mode"]').selectOption("new");
 await select(0,21);await select(22,40);let p=(await state()).projects[0],h=p.chapters[0].highlighter;const firstId=h.assignments[0].cardId,secondId=h.assignments[1].cardId;
 await select(6,32);p=(await state()).projects[0];h=p.chapters[0].highlighter;assert.equal(p.stories.length,2);assert.deepEqual(h.assignments.map(a=>[a.from,a.to,a.cardId]),[[0,32,firstId],[33,40,secondId]]);
 await select(33,text.length,true);h=(await state()).projects[0].chapters[0].highlighter;assert.equal(h.assignments.length,1);assert.equal(h.text.slice(h.assignments[0].from,h.assignments[0].to).trim(),h.text.slice(h.assignments[0].from,h.assignments[0].to));
 await undo();assert.equal((await state()).projects[0].chapters[0].highlighter.assignments.length,2);
 console.log('PASS: expansion across cards, reverse from unassigned text, whitespace cleanup, keyboard undo, read-only body, removed buttons');
 assert.equal(await page.locator('[data-hl-change="assignment-mode"] option').count(),2);
 await select(0,text.length,true);await page.locator('[data-hl-change="assignment-mode"]').selectOption('existing');
 assert.ok((await page.locator('.hl-next-card').innerText()).includes('Next: Card 1'));
 await select(0,21);assert.equal((await state()).projects[0].stories.length,2);assert.ok((await page.locator('.hl-next-card').innerText()).includes('Next: Card 2'));
 await undo();assert.ok((await page.locator('.hl-next-card').innerText()).includes('Next: Card 1'));await page.keyboard.press('Control+Shift+z');
 await select(22,40);assert.equal((await state()).projects[0].stories.length,2);assert.ok((await page.locator('.hl-next-card').innerText()).includes('No more existing cards'));
 await select(41,text.length);assert.equal((await state()).projects[0].stories.length,2);assert.equal((await state()).projects[0].chapters[0].highlighter.assignments.length,2);
 await select(6,32);assert.equal((await state()).projects[0].chapters[0].highlighter.assignments[0].cardId,firstId);assert.ok((await page.locator('.hl-next-card').innerText()).includes('No more existing cards'));
 await page.locator('[data-hl-change="assignment-mode"]').selectOption('new');
 // A click on an existing drawing must not change blank-card mode's next selection.
 await page.locator(`[data-card="${firstId}"] .story-frame`).click();await select(41,text.length);assert.equal((await state()).projects[0].stories.length,3);await undo();
 console.log('PASS: two assignment modes, existing-card advance and Undo, no blanks at exhaustion, expansion preserves cursor, blank mode stays blank mode');

 await page.locator('[data-hl-mode="categories"]').click();await page.locator('[data-hl-action="palette"]').click();assert.equal(await page.locator('[data-hl-color]').count(),8);await page.locator('[data-hl-action="palette"]').click();assert.equal(await page.locator('[data-hl-color]').count(),0);await page.locator('[data-hl-action="palette"]').click();await page.locator('[data-hl-color="action"]').click();
 await select(6,11);await page.locator('[data-hl-action="categories"]').click();assert.equal(await page.locator('.hl-category-manager').count(),1);await page.locator('[data-hl-action="categories"]').click();assert.equal(await page.locator('.hl-category-manager').count(),0);
 await page.locator('[data-hl-action="categories"]').click();await page.locator('[data-hl-category-row="action"] [data-hl-field="italic"]').check();await page.locator('[data-hl-action="save-categories"]').click();
 assert.equal(await page.locator('[data-hl-offset="6"]').evaluate(el=>getComputedStyle(el).fontStyle),'italic');assert.equal(await page.locator('.hl-card-passage span').filter({hasText:'opens'}).first().evaluate(el=>getComputedStyle(el).fontStyle),'italic');
 await page.locator('[data-hl-action="categories"]').click();await page.locator('[data-hl-category-row="action"] [data-hl-field="bold"]').check();await page.locator('[data-hl-action="save-categories"]').click();assert.equal(await page.locator('[data-hl-offset="6"]').evaluate(el=>getComputedStyle(el).fontWeight),'700');await undo();
 await page.locator('[data-hl-view="spoken"]').click();assert.ok(!(await page.locator('[data-hl-document]').innerText()).includes('opens'));assert.ok(!(await page.locator('.hl-card-passages').first().innerText()).includes('opens'));
 await page.locator('[data-act="highlighter"]').click();assert.equal(await page.locator('[data-hl-view="spoken"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-hl-change="chapter"]').count(),0);await page.locator('[data-act="toggle-chapters"]').first().click();assert.equal(await page.locator('[data-hl-change="chapter"]').count(),0);
 await page.locator('[data-hl-view="all"]').click();await page.locator('[data-act="storyboard"]').click();assert.equal(await page.locator('[data-hl-view="all"]').getAttribute('aria-pressed'),'true');
 console.log('PASS: palette and Manage toggles, italic category styling in HL and cards, shared Spoken text filter, chapter dropdown removed in both views');
 await menu('Settings');await page.locator('[data-act="settings-highlight"]').click();await settingOption('hlFontSize','20');await settingOption('hlNumberPosition','below');await settingOption('hlCaptionSize','16');await page.locator('[data-modal-btn="close-modal"]').click();
 assert.equal(await page.locator('[data-hl-document]').evaluate(el=>getComputedStyle(el).fontSize),'20px');assert.equal(await page.locator('.hl-numbers-below').count(),1);assert.equal(await page.locator('.hl-card-passage').first().evaluate(el=>getComputedStyle(el).fontSize),'16px');await menu('Settings');assert.equal(await page.locator('[data-act="settings-highlight"]').getAttribute('aria-pressed'),'true');await page.locator('[data-modal-btn="close-modal"]').click();
 await menu('Shortcuts');await page.locator('#alt-undo').check();await page.locator('[data-modal-btn="close-modal"]').click();await select(12,15);const markCount=(await state()).projects[0].chapters[0].highlighter.marks.length;await page.locator('[data-hl-document]').focus();await page.keyboard.press('n');assert.equal((await state()).projects[0].chapters[0].highlighter.marks.length,markCount-1);await page.keyboard.press('m');assert.equal((await state()).projects[0].chapters[0].highlighter.marks.length,markCount);
 await page.locator('[data-hl-action="help"]').click();assert.equal(await page.locator('.hl-help').count(),1);await page.locator('[data-hl-action="help"]').click();assert.equal(await page.locator('.hl-help').count(),0);
 await page.locator('[data-hl-mode="cards"]').click();await page.locator('[data-hl-action="scissors"]').click();assert.equal(await page.locator('[data-hl-document]').evaluate(el=>getComputedStyle(el).cursor.includes('scissors-cursor.svg')),true);await page.locator('[data-hl-action="scissors"]').click();
 await page.locator(`[data-card="${firstId}"] .story-frame`).click();await page.keyboard.press('Space');assert.equal(await page.locator('.quick-caption .hl-card-passages').count(),1);assert.equal(await page.locator('.quick-caption span').filter({hasText:'opens'}).last().evaluate(el=>getComputedStyle(el).fontStyle),'italic');await page.keyboard.press('Escape');
 console.log('PASS: settings shared and remembered, caption size, alternate N/M in HL, help popup, scissors cursor, highlighted script in Quick Look');
 if(await page.locator('.rail-open.left').count())await page.locator('.rail-open.left').click();
 await page.locator('.chapter-sidebar').waitFor({state:'visible'});await page.waitForTimeout(80);
 assert.equal(Math.round((await page.locator('.chapter-sidebar').boundingBox()).width),210);
 await page.locator('[data-act="toggle-linked-text"]').click();await page.waitForTimeout(80);assert.equal(Math.round((await page.locator('.chapter-sidebar').boundingBox()).width),250);
 await page.locator('[data-act="toggle-linked-text"]').click();await page.waitForTimeout(80);
 assert.ok((await page.locator('[data-hl-action="help"]').boundingBox()).width<16);

 assert.equal(await page.locator('[data-hl-action="export"],[data-hl-action="delete-text"]').count(),0);
 await page.locator('[data-act="highlighter"]').click();
 await page.evaluate(async()=>{const {store,chapter}=await import('/state.js'),{ensureProject,setChapterText,colorRange}=await import('/highlighter-model.js');const p=store.project,a=chapter('Chapter 2'),b=chapter('Chapter 3');p.chapters.push(a,b);ensureProject(p);setChapterText(a,'A second chapter. [whispers]\nThe lamp flickers.');setChapterText(b,'The final chapter ends in daylight.');p.highlighter.categories.find(c=>c.id==='emotion').style='bold-italic';colorRange(p,a,18,28,'emotion');store.save();});
 const dlEvent=page.waitForEvent('download');await page.locator('[data-hl-action="export"]').click();await page.locator('[data-modal-btn="export-script-all"]').click();await (await dlEvent).saveAs(path.join(output,'annotated-test.docx'));
 const spokenEvent=page.waitForEvent('download');await page.locator('[data-hl-action="export"]').click();await page.locator('[data-modal-btn="export-script-spoken"]').click();await (await spokenEvent).saveAs(path.join(output,'spoken-test.docx'));
 const before=structuredClone((await state()).projects[0]);await page.locator('[data-hl-action="delete-text"]').click();await page.locator('[data-modal-btn="confirm-delete-text"]').click();p=(await state()).projects[0];assert.equal(p.chapters[0].highlighter.text,null);assert.equal(p.stories.length,2);await undo();p=(await state()).projects[0];assert.deepEqual(p.chapters[0].highlighter,before.chapters[0].highlighter);
 await page.locator('[data-hl-mode="categories"]').click();await page.locator('[data-hl-action="categories"]').click();await page.locator('[data-hl-delete-category="action"]').click();await page.locator('[data-hl-action="save-categories"]').click();p=(await state()).projects[0];assert.equal(p.highlighter.categories.some(c=>c.id==='action'),false);assert.equal(p.chapters[0].highlighter.marks.length,0);await undo();
 await page.locator('[data-act="storyboard"]').click();
 await page.locator('[data-act="panel-assets"]').click();const headRects=await page.locator('.holding-sidebar .side-head').evaluate(el=>[...el.querySelectorAll('button')].map(x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));assert.ok(headRects.every(r=>r.top===headRects[0].top||Math.abs(r.top-headRects[0].top)<5));assert.ok(headRects.slice(1).every((r,i)=>r.left>=headRects[i].right-1));
 await page.locator('[data-act="import-image"]').click();await page.locator('#files').setInputFiles(path.join(root,'assets/script-icon.png'));await page.waitForFunction(()=>JSON.parse(localStorage.getItem('storyboardStudio.next.v03.state')).globalAssets.length===1);assert.equal((await state()).globalAssets.length,1);assert.equal((await state()).projects[0].unassigned.length,0);await page.locator('[data-act="panel-highlighter"]').click();
 console.log('PASS: real DOCX download, chapter delete and undo, category delete and undo, Assets header and global image import');
 // Trusted mouse gestures catch native selection behavior that synthetic ranges miss.
 await page.locator('[data-act="highlighter"]').click();await page.locator('[data-hl-mode="cards"]').click();
 async function charPoint(offset,end=false){return page.evaluate(({offset,end})=>{const run=[...document.querySelectorAll('[data-hl-offset]')].find(r=>offset>=+r.dataset.hlOffset&&offset<+r.dataset.hlEnd);const r=document.createRange();r.setStart(run.firstChild,offset-(+run.dataset.hlOffset));r.setEnd(run.firstChild,offset-(+run.dataset.hlOffset)+1);const b=r.getBoundingClientRect();return {x:end?b.right-1:b.left+1,y:b.top+b.height/2};},{offset,end});}
 async function dragText(from,to){const a=await charPoint(from,from>to),b=await charPoint(to,from<to);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:14});await page.mouse.up();}
 await dragText(1,44);h=(await state()).projects[0].chapters[0].highlighter;assert.equal(h.assignments.length,1);assert.ok(h.assignments[0].to>=44);assert.equal((await state()).projects[0].stories.length,2);await undo();
 await dragText(text.length-1,0);assert.equal((await state()).projects[0].chapters[0].highlighter.assignments.length,0);await undo();
 await page.locator('[data-hl-action="scissors"]').click();const splitPoint=await charPoint(12);await page.mouse.move(splitPoint.x,splitPoint.y);assert.equal(await page.locator('.hl-cut-guide:not([hidden])').count(),1);await page.screenshot({path:path.join(output,'scissors-guide-v03.png')});await page.mouse.click(splitPoint.x,splitPoint.y);assert.equal((await state()).projects[0].stories.length,3);await undo();await page.locator('[data-hl-action="scissors"]').click();
 await page.locator('[data-hl-mode="read"]').click();await dragText(0,20);await page.locator('[data-hl-action="help"]').click();assert.equal(await page.evaluate(()=>getSelection().toString()),'');assert.equal(await page.locator('[data-hl-action="help"]').evaluate(el=>{const r=el.getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight;}),true);
 await page.locator('[data-act="storyboard"]').click();console.log('PASS: trusted forward/reverse mouse gestures, scissors split, and selection kept out of toolbar controls');
 // Portrait print must use a fourth row when short notes or script fit safely.
 const density=await page.evaluate(async()=>{
  const {layoutCards}=await import('/script-layout.js'),{store,card,chapter}=await import('/state.js'),{ensureProject,setChapterText,assignRange}=await import('/highlighter-model.js');
  const p=structuredClone(store.project),ch=chapter('Density');p.chapters=[ch];p.stories=[];ensureProject(p);setChapterText(ch,Array(18).fill('Line.').join('\n'));
  for(let i=0;i<18;i++){const c=card(ch.id);c.note='Note.';p.stories.push(c);assignRange(ch,i*6,i*6+5,c.id);}
  const out=[];for(const script of ['none','all'])for(const notes of [false,true]){const pages=layoutCards(p,p.stories,543,716,{cols:3,rows:5,gap:10,script,notes,scriptFont:12,noteFont:12,continuations:true,fillRows:true});out.push({script,notes,first:pages[0].items.length,rows:pages[0].rows});for(const pg of pages)for(const i of pg.items)if(i.height>pg.cellH+.1)throw Error('Density overflow');}return out;
 });
 assert.ok(density.find(x=>x.script==='none'&&x.notes).first>=12);assert.ok(density.find(x=>x.script==='all'&&!x.notes).first>=12);
 console.log('PASS: portrait fills an additional row when measured notes or script fit');
 // Seed varied passages through the same model to stress real screen and print layouts.
 const fixture=await page.evaluate(async()=>{
  const {store,card}=await import('/state.js'),{setChapterText,clearChapterText,insertLinkedCard,colorRange}=await import('/highlighter-model.js');
  const p=store.project,ch=p.chapters[0];clearChapterText(ch);p.stories=[];const texts=['Short first line.',Array(100).fill('A longer passage with a drawing and narration.').join(' '),'Short third line.',Array(250).fill('A very long continuation passage.').join(' '),'Short final line.'];setChapterText(ch,texts.join('\n'));let offset=0;
  for(const text of texts){const a=insertLinkedCard(p,ch,offset,offset+text.length,card);p.stories.find(c=>c.id===a.cardId).note='Notes stay in a separate box. '+Array(12).fill('Keep all notes visible.').join(' ');offset+=text.length+1;}
  colorRange(p,ch,0,5,'action');store.save();return {id:p.id,cardIds:p.stories.map(c=>c.id)};
 });
 await page.reload();await page.locator(`[data-browse="${fixture.id}"]`).click();
 for(const size of [{width:1500,height:900},{width:1024,height:670}]){
  await page.setViewportSize(size);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.locator('[data-act="toggle-holding"]').click();await page.waitForTimeout(80);await page.locator('[data-act="toggle-holding"]').click();
  while(!(await page.locator('[data-act="board-prev"]').isDisabled()))await page.locator('[data-act="board-prev"]').click();
  const visited=new Set();
  for(let i=0;i<8;i++){
   const cards=await page.locator('#storyboard-grid .story-entry').evaluateAll(els=>els.map(el=>({id:el.dataset.card,text:el.querySelector('.hl-card-passage')?.textContent,scroll:el.querySelector('.hl-card-passages')?.scrollHeight,client:el.querySelector('.hl-card-passages')?.clientHeight})));
   for(const c of cards){visited.add(c.id);assert.ok(c.scroll<=c.client+1,'caption clipped');}
   const next=page.locator('[data-act="board-next"]');if(await next.isDisabled())break;await next.click();
  }
  assert.equal(visited.size,5);await page.screenshot({path:path.join(output,'highlighter-v03-'+size.width+'.png')});
 }
 await menu('Print');await page.locator('[data-print="script"]').selectOption('all');await page.locator('[data-print="notes"]').check();await page.waitForFunction(()=>[...document.querySelectorAll('[data-print-preview]')].every(c=>c.dataset.ready==='true'),null,{timeout:30000});
 const printPlans=await page.evaluate(async()=>{
  const {layoutCards}=await import('/script-layout.js'),{cardScriptRuns}=await import('/highlighter-model.js'),{store}=await import('/state.js');const p=store.project;
  const layouts=layoutCards(p,p.stories,543,716,{cols:3,rows:5,gap:10,script:'all',scriptFont:12,noteFont:12,notes:true,continuations:true,fillRows:true});
  return layouts.map(l=>({cols:l.cols,items:l.items.map(i=>({id:i.card.id,source:cardScriptRuns(p,i.card.id,'all').map(r=>r.text).join(''),noteSource:i.card.note,continuation:!!i.continuation,artW:i.artW,artH:i.artH,script:i.script.map(line=>line.spans.map(s=>s.text).join('')).join(' '),note:i.note.map(line=>line.spans.map(s=>s.text).join('')).join(' '),height:i.height,numberH:i.numberH,scriptH:i.scriptH,noteH:i.noteH})),cellH:l.cellH}));
 });
 assert.ok(printPlans.some(l=>l.items.some(i=>i.continuation)));assert.equal(new Set(printPlans.flatMap(l=>l.items.filter(i=>!i.continuation).map(i=>i.id))).size,5);
 for(const plan of printPlans)for(const item of plan.items){assert.ok(item.numberH+item.scriptH+item.noteH<=plan.cellH+1);assert.ok(item.artH<=plan.cellH+1);}
 for(const id of fixture.cardIds){const parts=printPlans.flatMap(l=>l.items).filter(i=>i.id===id),normalize=s=>s.replace(/\s/gu,'');assert.equal(normalize(parts.map(i=>i.script).join('')),normalize(parts[0].source),'print script lost characters');assert.equal(normalize(parts.map(i=>i.note).join('')),normalize(parts[0].noteSource),'print notes lost characters');}
 await page.evaluate(async()=>{
  const {layoutCards}=await import('/script-layout.js'),{store}=await import('/state.js');
  for(const ratio of ['16:9','9:16','4:3'])for(const landscape of [false,true])for(const notes of [false,true]) {
   const p={...store.project,ratio},height=landscape?470:716,width=landscape?790:543;
   const plans=layoutCards(p,p.stories,width,height,{cols:3,rows:5,gap:10,script:'all',scriptFont:12,noteFont:12,notes,continuations:true,fillRows:true});
   const ids=new Set();for(const plan of plans)for(const item of plan.items){if(!item.continuation)ids.add(item.card.id);if(item.artH>plan.cellH+.5||item.numberH+item.scriptH+item.noteH>plan.cellH+.5)throw Error('Print overflow '+ratio);}
   if(ids.size!==p.stories.length)throw Error('Print dropped a card '+ratio);
  }
 });
 const printDownload=page.waitForEvent('download');await page.locator('[data-act="print-pdf"]').click();await(await printDownload).saveAs(path.join(output,'storyboard-test.pdf'));
 await page.screenshot({path:path.join(output,'highlighter-print-v03.png')});
 await page.locator('[data-print="script"]').selectOption('spoken');await page.waitForFunction(()=>[...document.querySelectorAll('[data-print-preview]')].every(c=>c.dataset.ready==='true'),null,{timeout:30000});
 // Exercise the real dense-page exporter in both orientations, not just its plan.
 await page.locator('[data-act="storyboard"]').click();
 const denseId=await page.evaluate(async()=>{const {store,card}=await import('/state.js'),{clearChapterText,setChapterText,assignRange}=await import('/highlighter-model.js');const p=store.project,ch=p.chapters[0];clearChapterText(ch);ch.name='Dense print';setChapterText(ch,Array(18).fill('Line.').join('\n'));p.stories=[];for(let i=0;i<18;i++){const c=card(ch.id);c.note='Note.';p.stories.push(c);assignRange(ch,i*6,i*6+5,c.id);}store.save();return p.id;});
 await page.reload();await page.locator(`[data-browse="${denseId}"]`).click();await menu('Print');await page.locator('[data-print="notes"]').check();
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-print-preview]')].every(c=>c.dataset.ready==='true'),null,{timeout:30000});assert.equal(await page.locator('[data-print-preview]').count(),2);
 let denseDownload=page.waitForEvent('download');await page.locator('[data-act="print-pdf"]').click();await(await denseDownload).saveAs(path.join(output,'dense-portrait.pdf'));
 await page.locator('[data-print-orientation="landscape"]').click();await page.locator('[data-print="script"]').selectOption('all');await page.waitForFunction(()=>[...document.querySelectorAll('[data-print-preview]')].every(c=>c.dataset.ready==='true'),null,{timeout:30000});
 denseDownload=page.waitForEvent('download');await page.locator('[data-act="print-pdf"]').click();await(await denseDownload).saveAs(path.join(output,'dense-landscape.pdf'));
 console.log('PASS: actual portrait and landscape PDF exports with dense cards, notes, and script');
 assert.deepEqual(errors,[]);console.log('PASS: mixed adaptive pages at 1500/1024, uncut captions, notes + script print, highlighted PDF export, continuation pages, no runtime errors');
} catch(e){try{const pages=browser?.contexts()[0]?.pages();if(pages?.[0]){await pages[0].screenshot({path:path.join(output,'failure.png')});fs.writeFileSync(path.join(output,'failure.html'),await pages[0].content());}}catch{}throw e;} finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
