import {chapterDirectories,namingContext,renderName} from './studio-link-model.js';
import {currentCleanup} from './cleanup-model.js';
export function roughDestination(p,card){const ch=p.chapters.find(ch=>ch.id===card.chapterId),folder=chapterDirectories(p).find(f=>f.chapterId===ch?.id)?.path;if(!folder)return null;return{folder,path:folder+'/'+renderName(p.fileNaming,'card',namingContext(p,ch,card),'png')};}
export function archiveRough(p,card){const clean=currentCleanup(p,card);return clean.files.length>0;}
