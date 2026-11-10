import {sameRecording} from './recording-identity.js';
import {normalizePath,pathInside} from './local-paths.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function projectAudioState(p){
 const root=p.studioLink?.directory,source=p.studioLink?.activeAudio;
 const path=source?.relativePath&&root?normalizePath(root)+'/'+source.relativePath:source?.path||'';
 const tracks=(p.videoTiming?.tracks||[]).filter(t=>source&&sameRecording(t,source)&&!t.audioMissing);
 const ready=tracks.some(t=>t.words?.length&&t.words.every(w=>Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.start>=0&&w.end>w.start&&(!source.duration||w.end<=source.duration+.1)));
 return{source,path,missing:!!source?.missing,outside:!!(path&&root&&pathInside(root,path)===null),ready};
}
export function audioPage(p,busy=false){
 const {source,path,outside,ready,missing}=projectAudioState(p);
 return `<section class="project-audio-page"><h1>Audio</h1><div class="project-audio-recording ${missing?'audio-missing':''}"><button data-change-project-audio>${esc(path.split(/[\\/]/).at(-1)||source?.name||'Choose audio file…')}</button><button data-change-project-audio class="change-audio-button">Change…</button><p class="project-audio-path">${esc(path)||'No recording selected.'}</p>${missing?'<p role="alert">Audio missing</p><div class="audio-recovery-actions"><button data-locate-project-audio>Locate audio…</button><button data-recover-project-audio>Recover audio from Subtitler project…</button></div>':''}${outside?'<p class="project-audio-external" role="status">This audio is outside your Project Folder. Keep it in this location, or choose another file.</p>':''}</div><div class="project-audio-matching"><p>Matching timings — ${ready?'Audio’s timing is available.':'None'}</p><button class="primary" data-act="prepare-match-timing" ${busy?'disabled':''}>${busy?'Opening Subtitler…':'Match timing with Subtitler'}</button></div><p class="muted">Choose a different recording by clicking its name. Replacing the audio requires matching its timing again.</p></section>`;
}
