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
 await select(0,text.length);const before=(await state()).projects[0].stories.length;await page.locator('[data-hl-action="scissors"]').click();
 const point=await page.evaluate(()=>{const text=document.querySelector('[data-hl-offset]').firstChild;const range=document.createRange();range.setStart(text,11);range.setEnd(text,12);const r=range.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});await page.mouse.click(point.x,point.y);await page.waitForFunction(n=>JSON.parse(localStorage.getItem('storyboardStudio.next.v03.state')).projects[0].stories.length===n+1,before);assert.equal((await state()).projects[0].chapters[0].highlighter.assignments.length,2);assert.deepEqual(errors,[]);console.log('PASS first scissors click splits assigned card.');

} catch(e){try{const pages=browser?.contexts()[0]?.pages();if(pages?.[0]){await pages[0].screenshot({path:path.join(output,'failure.png')});fs.writeFileSync(path.join(output,'failure.html'),await pages[0].content());}}catch{}throw e;} finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
