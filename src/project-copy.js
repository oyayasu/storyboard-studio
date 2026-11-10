// A copied/recovered project must never publish into the original project's folder.
export function detachProjectMedia(project,sourceRoot=project.studioLink?.directory,{recovery=false}={}){
 const audio=project.studioLink?.activeAudio?.path||project.videoTiming?.tracks?.[0]?.audioPath;
 const detached=(file,preferRecovery=false)=>{const f={...file};f.path=sourceRoot&&(preferRecovery||recovery)&&f.vaultRelativePath?sourceRoot+'/'+f.vaultRelativePath:f.path||(sourceRoot&&f.relativePath?sourceRoot+'/'+f.relativePath:'');delete f.relativePath;delete f.vaultRelativePath;delete f.historyRestore;f.managed=false;return f;};
 for(const e of Object.values(project.cleanup?.entries||{})){for(const field of ['files','referenceFiles','ignoredFiles'])e[field]=(e[field]||[]).map(f=>detached(f,field==='ignoredFiles'));e.updatedAt=new Date().toISOString();e.revision=crypto.randomUUID();}
 for(const a of project.cleanup?.archive||[])a.files=a.files.map(f=>detached(f,true));
 project.studioLink={directory:null,storyboards:{},pendingAudioCopy:audio||null};project.imageAssembly={batches:[],bindings:{},representations:{}};return project;
}
