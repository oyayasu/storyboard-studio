import {sameRecording} from './recording-identity.js';
import {pathInside} from './local-paths.js';
export function bindProjectAudio(project,info){
 const root=project.studioLink?.directory,old=project.studioLink?.activeAudio,source={...(old&&sameRecording(old,info)?old:{}),...info,missing:false};delete source.header;
 const rel=root?pathInside(root,source.path):null;if(rel)source.relativePath=rel;else delete source.relativePath;
 if(old&&sameRecording(old,source)&&old.subtitlerProjectFile&&!source.subtitlerProjectFile)source.subtitlerProjectFile=old.subtitlerProjectFile;
 (project.studioLink||={}).activeAudio=source;
 for(const track of project.videoTiming?.tracks||[]){if(!sameRecording(track,source))continue;track.audioPath=source.path;track.audioMissing=false;delete track.audioError;track.source={...track.source,...source};if(!source.relativePath)delete track.source.relativePath;}
 return source;
}
export function markAudioMissing(project,source){
 if(project.studioLink?.activeAudio&&sameRecording(project.studioLink.activeAudio,source))project.studioLink.activeAudio.missing=true;
 for(const track of project.videoTiming?.tracks||[])if(sameRecording(track,source))track.audioMissing=true;
}
