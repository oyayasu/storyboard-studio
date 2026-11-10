// Stored absolute paths may belong to another computer. Prefer the relative path.
export const normalizePath=p=>String(p||'').replace(/\\/g,'/').replace(/^\/\/\?\/(?=[a-z]:\/)/i,'').replace(/\/+$/,'');
export const isAbsolutePath=p=>/^\/(?!\/)|^[a-z]:[\\/]/i.test(String(p||''));
export function sameLocalPath(a,b){a=normalizePath(a);b=normalizePath(b);return /^[a-z]:/i.test(a)||/^[a-z]:/i.test(b)?a.toLowerCase()===b.toLowerCase():a===b;}
export function pathInside(root,path){root=normalizePath(root);path=normalizePath(path);const a=/^[a-z]:/i.test(root)?root.toLowerCase():root,b=/^[a-z]:/i.test(root)?path.toLowerCase():path;return b.startsWith(a+'/')?path.slice(root.length+1):null;}
export function resolveLocalPath(root,relative,path){if(relative){if(relative.includes('\\')||/^[\/]|^[a-z]:/i.test(relative)||relative.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Invalid project-relative file location.');return normalizePath(root)+'/'+relative;}return normalizePath(path);}
