import {sameRecording,uniqueRecordings} from "./recording-identity.js";
import {
  ensureTiming,
  timingSignature,
  parseTiming,
  timingStale,
  attachTiming,
  rebuildTiming,
  buildTiming,
} from "./video-timing-model.js";
// Timing computation and automatic handoff intake only. Editing lives in Subtitler.
export function createVideoTiming(host) {
  const data = () => ensureTiming(host.project());
  function rematch() {
    const p=host.project(),tracks=uniqueRecordings(data().tracks);
    if(!tracks.some(t=>timingStale(p,t)||t.scopeSignature!==timingSignature(p,p.chapters.filter(c=>!c.unused).map(c=>c.id)))&&tracks.length===data().tracks.length)return;
    host.commit("Refresh script timings",()=>{
      data().tracks=tracks.map(old=>{
        try{return old.words?.length?buildCurrent(old,old):old;}catch(e){host.notify(e.message);return old;}
      });
    });
  }
  function buildCurrent(parsed,old=null){
    const p=host.project(),ids=p.chapters.filter(c=>!c.unused&&c.highlighter?.text?.trim()).map(c=>c.id);
    let built=buildTiming(p,parsed,ids);
    // With several recordings, retain chapters supported by each transcript.
    // With one recording, include newly added/split chapters for automatic rematching.
    const others=data().tracks.filter(t=>!sameRecording(t,parsed)&&t.id!==old?.id);
    if(others.length){
      let matched=ids.filter(id=>{const cues=built.cues.filter(c=>c.chapterId===id&&!c.excluded);return cues.length&&cues.some(c=>c.wordIds.length&&c.coverage>=0.5);});
      if(!matched.length)matched=(parsed.chapterIds||old?.chapterIds||[]).filter(id=>ids.includes(id));
      if(matched.length)built=buildTiming(p,parsed,matched);
    }
    built.scopeSignature=timingSignature(p,p.chapters.filter(c=>!c.unused).map(c=>c.id));
    if(old){const scope=built.scopeSignature;built=rebuildTiming(p,old,parsed,built.chapterIds);built.scopeSignature=scope;}
    return built;
  }
  async function importText(text, name, { automatic = false } = {}) {
    const parsed = parseTiming(text, name),
      p = host.project();
    if (automatic && parsed.studioProjectId !== p.id)
      throw Error("The timing belongs to another project.");
    if(automatic&&p.studioLink?.activeAudio&&!sameRecording(p.studioLink.activeAudio,parsed))throw Error('Timing is for another recording. Choose the project recording explicitly.');
    const old=data().tracks.find(t=>sameRecording(t,parsed));
    if (
      old &&
      JSON.stringify(old.words) === JSON.stringify(parsed.words) &&
      JSON.stringify(old.pauses || []) === JSON.stringify(parsed.pauses || [])
    ) {
      if(JSON.stringify(old.source)!==JSON.stringify(parsed.source)||old.projectId!==parsed.projectId)host.commit("Refresh recording location",()=>{old.source=parsed.source;old.audioPath=parsed.source.path||old.audioPath;old.audioMissing=false;delete old.audioError;old.projectId=parsed.projectId;old.exportedAt=parsed.exportedAt||old.exportedAt;});
      rematch();
      return;
    }
    const built=buildCurrent(parsed,old);
    host.commit("Import shared audio timing",()=>{
      data().tracks=uniqueRecordings(data().tracks.filter(t=>t!==old&&!sameRecording(t,built)));
      // Rebuild the existing recordings as well when their chapter scope changes.
      data().tracks.push(built);
      if(data().tracks.length>1)data().tracks=data().tracks.map(t=>buildCurrent(t,t));
    });
  }
  return { rematch, importText };
}
