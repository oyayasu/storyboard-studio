import {assetUrl} from './media.js';
import {previewSegments,previewCueAt,chapterFlags} from './perform-preview-model.js';
import {cardScriptRuns,ensureProject} from './highlighter-model.js';
import {runsMarkup} from './highlighter.js';
import {tags,tagDefs,tagDefinition} from './state.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}.${Math.floor(t%1*1000).toString().padStart(3,'0')}`;
export function createPerformPreview(host){
 const ui={projectId:null,scope:'all',chapterId:null,index:0,active:false,manual:null,key:null,painted:null,busy:false,advancing:false,expanded:false,missing:false};
 const audio=new Audio();audio.preload='metadata';let segments=[],cards=[],raf=0,loadGeneration=0,selectionGeneration=0,noteDraft=null,playGeneration=0,playIntent=false,resizeObserver=null;
 const $=s=>document.querySelector(`[data-preview-${s}]`),segment=()=>segments[ui.index];
 const length=s=>Math.max(0,s.end-s.start),total=()=>segments.reduce((n,s)=>n+length(s),0),base=()=>segments.slice(0,ui.index).reduce((n,s)=>n+length(s),0);
 function notice(text=''){if($('notice'))$('notice').textContent=text;}
 function flush(){if(!noteDraft)return;const draft=noteDraft;noteDraft=null;const card=host.project()?.stories.find(c=>c.id===draft.id);if(card&&card.note!==draft.text)host.note(card.id,draft.text);}
 function html(){
  flush();const p=host.project();ensureProject(p);
  if(ui.projectId!==p.id){pausePlayback();ui.projectId=p.id;ui.chapterId=host.chapter()?.id;ui.index=0;ui.key=null;ui.manual=null;}
  if(!p.chapters.some(c=>c.id===ui.chapterId&&!c.unused))ui.chapterId=p.chapters.find(c=>!c.unused)?.id;
  segments=previewSegments(p,ui.scope==='all'?'all':ui.chapterId);ui.index=Math.min(ui.index,Math.max(0,segments.length-1));
  const chapters=p.chapters.filter(c=>!c.unused&&(ui.scope==='all'||c.id===ui.chapterId));
  cards=chapters.flatMap(ch=>p.stories.filter(c=>c.chapterId===ch.id));
  if(!cards.some(c=>c.id===ui.manual))ui.manual=null;
  const timed=id=>segments.some(s=>s.cues.some(c=>c.cardId===id));
  if(audio.paused&&!previewCueAt(segment(),audio.currentTime)&&!ui.manual)ui.manual=cards[0]?.id||null;
  return `<main class="perform-shell preview-shell ${ui.expanded?'preview-expanded':''}"><div class="perform-tools"><div class="preview-scope" role="group" aria-label="Preview scope"><button data-preview-scope="all" aria-pressed="${ui.scope==='all'}">All chapters</button><button data-preview-scope="chapter" aria-pressed="${ui.scope==='chapter'}">Selected chapter</button>${ui.scope==='chapter'?`<select data-preview-chapter aria-label="Preview chapter">${p.chapters.filter(c=>!c.unused).map(ch=>`<option value="${esc(ch.id)}" ${ch.id===ui.chapterId?'selected':''}>${esc(ch.name)}</option>`).join('')}</select>`:''}</div><button class="primary" data-preview-action="subtitler" ${ui.busy?'disabled':''}>${ui.busy?'Opening Subtitler…':'Match timing with Subtitler'}</button></div>
  <section class="perform-stage"><div class="perform-stage-top"><strong data-preview-heading>Perform</strong><strong data-preview-number></strong></div><div class="perform-stage-grid"><aside class="perform-tags"><div data-preview-tags></div><p data-preview-warning class="preview-warning"></p></aside><div class="perform-visual" data-preview-visual style="aspect-ratio:${p.ratio==='9:16'?'9/16':p.ratio==='4:3'?'4/3':'16/9'}"></div><aside class="preview-notes"><h3>Notes</h3><textarea data-preview-notes aria-label="Card notes" placeholder=""></textarea></aside></div><div class="preview-script" data-preview-script></div><div class="perform-stage-footer"><button data-preview-recording data-change-project-audio></button><div class="preview-stage-actions"><span data-preview-missing hidden>Audio missing</span><button data-locate-project-audio data-preview-locate hidden>Locate audio…</button><button data-recover-project-audio data-preview-recover hidden>Recover audio…</button><span class="preview-clock" data-preview-clock>00:00.000</span><button data-preview-action="expand" aria-label="Expand drawing and script" aria-pressed="${ui.expanded}">⛶</button></div></div></section>
  <div class="preview-player"><div class="preview-audio" data-preview-audio></div><div class="preview-seek"><div class="preview-flags">${chapterFlags(segments,p).map(f=>`<button type="button" data-preview-flag="${f.time}" class="chapter-flag" style="left:${total()?f.time/total()*100:0}%" data-tooltip="${esc(f.title)}" aria-label="${esc(f.title)}">⚑</button>`).join('')}</div><input data-preview-seek type="range" min="0" max="${total()||1}" step="0.001" value="0" aria-label="Audio position" ${!segments.length?'disabled':''}></div><span data-preview-duration>${clock(total())}</span><label class="preview-volume">Volume<input data-preview-volume aria-label="Volume" type="range" min="0" max="1" step="0.05" value="${audio.volume}"></label></div>
  <div class="perform-controls"><button data-preview-action="previous-chapter" aria-label="Previous chapter">«</button><button data-preview-action="previous">‹ Previous card</button><button class="primary" data-preview-action="play">▶ Play / pause</button><button data-preview-action="next">Next card ›</button><button data-preview-action="next-chapter" aria-label="Next chapter">»</button></div>
  <nav class="preview-strip" aria-label="Storyboard preview cards">${cards.map((card,i)=>`<div class="preview-slide">${i===0||cards[i-1].chapterId!==card.chapterId?`<span class="preview-chapter-start">⚑ ${esc(p.chapters.find(ch=>ch.id===card.chapterId)?.name)}</span>`:''}<button data-preview-card="${esc(card.id)}" class="${timed(card.id)?'':'untimed'}" title="Card ${esc(host.number(card.id))}${timed(card.id)?'':' · No audio timing'}">${host.image(card)}<span>${esc(host.number(card.id))}</span></button></div>`).join('')}</nav><p class="preview-notice" data-preview-notice role="status"></p></main>`;
 }
 function paint(force=false){
  if(!ui.active)return;const p=host.project(),s=segment(),cue=previewCueAt(s,audio.currentTime),card=p.stories.find(c=>c.id===(audio.paused&&ui.manual?ui.manual:cue?.cardId));
  const elapsed=Math.max(0,base()+(s?audio.currentTime-s.start:0));
  if($('clock'))$('clock').textContent=clock(elapsed);
  if($('seek')&&document.activeElement!==$('seek'))$('seek').value=elapsed;
  if($('notes'))$('notes').disabled=!audio.paused||!card;
  const missing=ui.missing||p.studioLink?.activeAudio?.missing,recording=$('recording');if(recording){const name=s?.track.source.name||p.studioLink?.activeAudio?.name||'Choose project audio';if(recording.textContent!==name)recording.textContent=name;recording.classList.toggle('audio-missing',!!missing);}for(const key of ['missing','locate','recover'])if($(key))$(key).hidden=!missing;
  for(const play of document.querySelectorAll('[data-preview-action="play"]')){const label=playIntent||!audio.paused?'Ⅱ Pause':'▶ Play';if(play.textContent!==label)play.textContent=label;play.setAttribute('aria-label',label.includes('Pause')?'Pause':'Play');}
  syncAnimation(cue);
  if(!force&&ui.painted===(card?.id||''))return;
  flush();ui.painted=card?.id||'';
  if($('heading'))$('heading').textContent=p.chapters.find(ch=>ch.id===card?.chapterId)?.name||'Perform';
  if($('number'))$('number').textContent=card?'Card '+host.number(card.id):'';
  void swapVisual(card,cue);
  if($('notes'))$('notes').value=card?.note||'';
  if($('tags'))$('tags').innerHTML=card?tags(p,card).map(id=>tagDefinition(p,id)).filter(Boolean).map(t=>`<span class="preview-tag" style="--tag:${esc(t.color)}">${esc(t.name)}</span>`).join(''):'';
  if($('script'))$('script').innerHTML=card?runsMarkup(p,cardScriptRuns(p,card.id,p.viewPrefs.hlView||'all')):'';
  if($('warning')){const linked=card&&p.chapters.some(ch=>ch.highlighter?.assignments.some(a=>a.cardId===card.id));$('warning').textContent=!card?'':!linked?'No linked script':!segments.some(s=>s.cues.some(c=>c.cardId===card.id))?'No audio timing':'';}
  document.querySelectorAll('[data-preview-card]').forEach(b=>b.classList.toggle('current',b.dataset.previewCard===card?.id));
  const strip=document.querySelector('.preview-strip'),selected=document.querySelector('.preview-strip .current');
  if(strip&&selected){const a=selected.getBoundingClientRect(),b=strip.getBoundingClientRect();if(a.left<b.left||a.right>b.right)strip.scrollLeft+=a.left-b.left-(b.width-a.width)/2;}
 }
 let visualGeneration=0;const prepared=new Map();
 function prepareVisual(card){const markup=card?host.image(card):'<div class="blank-art">No card assigned here</div>',key=(card?.id||'blank')+markup;if(prepared.has(key))return prepared.get(key);const promise=(async()=>{const wrap=document.createElement('div');wrap.innerHTML=markup;await Promise.all([...wrap.querySelectorAll('img[data-asset]')].map(async image=>{image.src=await assetUrl(image.dataset.asset);}));await Promise.all([...wrap.querySelectorAll('img')].map(image=>{image.loading='eager';return image.decode?image.decode().then(()=>image.classList.add("cleanup-media-loaded")).catch(()=>{}):new Promise(resolve=>{if(image.complete)return resolve();image.onload=image.onerror=resolve;});}));for(const composite of wrap.querySelectorAll('.cleanup-composite'))if(!composite.querySelector('video'))composite.setAttribute('aria-busy','false');return wrap;})();if(prepared.size>12)prepared.delete(prepared.keys().next().value);prepared.set(key,promise);return promise;}
 async function swapVisual(card,cue){const generation=++visualGeneration,visual=$('visual');if(!visual)return;const wrap=await prepareVisual(card);if(generation!==visualGeneration||!ui.active||visual!==$('visual'))return;visual.replaceChildren(...[...wrap.childNodes].map(n=>n.cloneNode(true)));host.attach(visual);syncAnimation(cue);const index=cards.findIndex(c=>c.id===card?.id);for(const next of cards.slice(index+1,index+3))void prepareVisual(next);}
 function syncAnimation(cue){for(const video of document.querySelectorAll('[data-preview-visual] video')){video.muted=true;const update=()=>{if(!Number.isFinite(video.duration))return;const time=Math.min(Math.max(0,video.duration-.03),Math.max(0,audio.currentTime-(cue?.start||0)));if(Math.abs(video.currentTime-time)>.12)video.currentTime=time;if(!audio.paused&&time<video.duration-.04)void video.play().catch(()=>{});else video.pause();};if(video.readyState)update();else video.onloadedmetadata=update;}}
 async function seekGlobal(value){flush();const playing=playIntent||!audio.paused,generation=++playGeneration;audio.pause();playIntent=playing;let target=+value,index=0;while(index<segments.length-1&&target>=length(segments[index])){target-=length(segments[index]);index++;}ui.index=index;ui.manual=null;notice();if(segment())await load(segment().start+target);if(playing&&playIntent&&generation===playGeneration)await audio.play();}
 async function load(time=null){
  const s=segment(),generation=++loadGeneration;if(s&&host.verifyAudio){ui.missing=!(await host.verifyAudio());if(generation!==loadGeneration)return false;if(ui.missing){pausePlayback();notice('Audio missing. Locate it or recover it from the Subtitler project.');paint(true);return false;}}if(!s){audio.pause();audio.removeAttribute('src');ui.key=null;paint(true);return false;}
  const key=JSON.stringify([host.project().id,s.track.id,s.track.audioPath||s.track.source.path||s.track.audioAssetId,s.track.source.modified]);
  if(key!==ui.key){audio.pause();let url='';if(s.track.audioPath||s.track.source.path)url=window.__TAURI__?.core?.convertFileSrc?.(s.track.audioPath||s.track.source.path)||'';else if(s.track.audioAssetId)url=(await window.SSDB.getAsset(s.track.audioAssetId))?.dataUrl||'';
   if(generation!==loadGeneration)return false;if(!url){notice('Audio file could not be found. Use Locate audio or Recover audio.');return false;}
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{clean();reject(Error('Audio could not finish loading. Use Locate audio or Recover audio.'));},15000);const clean=()=>{clearTimeout(timer);audio.removeEventListener('loadedmetadata',ready);audio.removeEventListener('error',failed);};const ready=()=>{clean();resolve();};const failed=()=>{clean();reject(Error('Audio file could not be read. Use Locate audio or Recover audio.'));};audio.addEventListener('loadedmetadata',ready);audio.addEventListener('error',failed);audio.src=url;audio.load();});
   if(generation!==loadGeneration)return false;ui.key=key;
  }
  const at=time??(audio.currentTime>=s.start&&audio.currentTime<s.end?audio.currentTime:s.start);audio.currentTime=Math.max(s.start,Math.min(s.end,at));paint(true);return true;
 }
 async function advance(){if(ui.advancing||!playIntent)return;const generation=playGeneration;ui.advancing=true;try{if(ui.index+1<segments.length){ui.index++;await load(segment().start);if(playIntent&&generation===playGeneration)await audio.play();}else{playIntent=false;audio.pause();}}catch(e){notice(e.message);}finally{ui.advancing=false;}}
 function tick(){cancelAnimationFrame(raf);if(!ui.active)return;paint();if(!audio.paused){if(audio.currentTime>=segment()?.end-0.002)void advance();raf=requestAnimationFrame(tick);}}
 async function toggle(){flush();const generation=++playGeneration;playIntent=!(playIntent||!audio.paused);if(!playIntent){notice();audio.pause();cancelAnimationFrame(raf);paint();return;}if(!segments.length){playIntent=false;notice('No audio timing for this chapter. Match timing with Subtitler.');return;}ui.manual=null;notice();try{if(await load(audio.currentTime>=segment().end?segment().start:null)&&playIntent&&generation===playGeneration)await audio.play();}catch(e){if(generation===playGeneration)playIntent=false;throw e;}}
 function pausePlayback(){playGeneration++;playIntent=false;audio.pause();cancelAnimationFrame(raf);}

 async function selectCard(id){if(!audio.paused||playIntent){notice('Pause playback to select another card.');return;}const generation=++selectionGeneration;flush();notice();ui.manual=id;paint(true);const si=segments.findIndex(s=>s.cues.some(c=>c.cardId===id));if(si>=0){ui.index=si;await load(segment().cues.find(c=>c.cardId===id).start);}if(generation!==selectionGeneration)return;ui.manual=id;paint(true);}
 async function moveCard(delta){const current=ui.manual||previewCueAt(segment(),audio.currentTime)?.cardId,index=cards.findIndex(c=>c.id===current);const card=cards[Math.max(0,Math.min(cards.length-1,index+delta))];if(card)await selectCard(card.id);}
 let measuredWidth=0,measuredProject='';
 function measureScript(){
  const target=$('script');if(!ui.active||!target)return;const width=target.clientWidth,p=host.project();
  const key=p.id+':'+p.chapters.map(c=>JSON.stringify(c.highlighter?.assignments)+c.highlighter?.text).join(':')+':'+innerHeight;
  if(width===measuredWidth&&key===measuredProject)return;measuredWidth=width;measuredProject=key;
  const probe=document.createElement('div');probe.className='preview-script';Object.assign(probe.style,{position:'fixed',visibility:'hidden',pointerEvents:'none',height:'auto',minHeight:'0',maxHeight:'none',width:width+'px',left:'-10000px'});document.body.append(probe);
  let height=25;for(const card of p.stories){probe.innerHTML=runsMarkup(p,cardScriptRuns(p,card.id,p.viewPrefs.hlView||'all'));height=Math.max(height,probe.scrollHeight);}probe.remove();target.style.setProperty('--preview-script-height',Math.ceil(Math.min(height,Math.max(70,innerHeight*.27)))+'px');
 }
 window.addEventListener?.('focus',()=>{if(ui.active)host.verifyAudio?.().then(ok=>{ui.missing=!ok;if(!ok)pausePlayback();paint(true);}).catch(()=>{});});
 function mount(active){visualGeneration++;flush();resizeObserver?.disconnect();ui.active=active;cancelAnimationFrame(raf);if(!active){playIntent=false;playGeneration++;audio.pause();return;}audio.controls=false;$('audio')?.append(audio);
  $('chapter')?.addEventListener('change',e=>{flush();pausePlayback();ui.chapterId=e.target.value;ui.index=0;ui.manual=null;ui.key=null;host.render();});
  $('notes')?.addEventListener('input',e=>{if(audio.paused&&ui.painted)noteDraft={id:ui.painted,text:e.target.value};});$('notes')?.addEventListener('change',flush);
  $('seek')?.addEventListener('change',async e=>{try{await seekGlobal(e.target.value);}catch(error){notice(error.message);}});
  $('volume')?.addEventListener('input',e=>{audio.volume=+e.target.value;});
  ui.painted=null;load().catch(e=>notice(e.message));paint(true);measureScript();if(window.ResizeObserver){resizeObserver=new ResizeObserver(measureScript);if($('script'))resizeObserver.observe($('script'));}if(!audio.paused)tick();
 }
 async function onClick(e){const scope=e.target.closest('[data-preview-scope]'),button=e.target.closest('[data-preview-action]'),card=e.target.closest('[data-preview-card]');
  if(scope){flush();pausePlayback();ui.scope=scope.dataset.previewScope;ui.index=0;ui.manual=null;ui.key=null;host.render();return true;}
  const flag=e.target.closest('[data-preview-flag]');if(flag){await seekGlobal(flag.dataset.previewFlag);return true;}
  if(card){await selectCard(card.dataset.previewCard);return true;}if(!button)return false;
  if(button.dataset.previewAction==='expand'){ui.expanded=!ui.expanded;document.querySelector('.preview-shell')?.classList.toggle('preview-expanded',ui.expanded);button.setAttribute('aria-pressed',String(ui.expanded));button.setAttribute('aria-label',ui.expanded?'Restore playback controls':'Expand drawing and script');measureScript();}if(button.dataset.previewAction==='play')await toggle();
  if(['previous-chapter','next-chapter'].includes(button.dataset.previewAction)){const now=base()+audio.currentTime-(segment()?.start||0),flags=chapterFlags(segments,host.project()),target=button.dataset.previewAction==='previous-chapter'?flags.filter(f=>f.time<now-.08).at(-1):flags.find(f=>f.time>now+.08);if(target)await seekGlobal(target.time);}
  if(button.dataset.previewAction==='previous')await moveCard(-1);
  if(button.dataset.previewAction==='next')await moveCard(1);
  if(button.dataset.previewAction==='subtitler'){flush();pausePlayback();ui.busy=true;host.render();try{await host.matchTiming();}catch(e){host.notify(e.message||String(e));}finally{ui.busy=false;host.render();}}
  return true;
 }
 audio.addEventListener('error',()=>{if(ui.active){ui.missing=true;pausePlayback();notice('Audio cannot be opened. Locate it or recover it from Subtitler.');paint(true);}});
 audio.addEventListener('ended',()=>{if(ui.index+1<segments.length&&playIntent)void advance();else{playIntent=false;paint();}});
 audio.addEventListener('seeked',()=>paint(true));
 audio.addEventListener('play',()=>{if(!playIntent){audio.pause();return;}ui.manual=null;notice();tick();});audio.addEventListener('pause',()=>{cancelAnimationFrame(raf);notice();paint();});audio.addEventListener('timeupdate',()=>{paint();if(!audio.paused&&audio.currentTime>=segment()?.end-0.002)void advance();});
 return {html,mount,onClick,flush,toggle,moveCard,pause:pausePlayback,isPlaying:()=>playIntent||!audio.paused};
}
