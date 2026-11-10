// Human labels and sequence positions never replace permanent card IDs.
export const everyCard=p=>['stories','unassigned','lost','archived'].flatMap(k=>p[k]||[]);
export const sequenceCards=p=>(p.chapters||[]).filter(c=>!c.unused).flatMap(ch=>(p.stories||[]).filter(c=>c.chapterId===ch.id));
export const isInsertion=c=>!!c?.modifiedOf&&!c.numberAsRegular;
export function letterIndex(n){let s='';for(n++;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
export function modificationRoot(p,c){const seen=new Set();let root=c;while(isInsertion(root)&&!seen.has(root.id)){seen.add(root.id);const parent=everyCard(p).find(x=>x.id===root.modifiedOf);if(!parent){const id=root.modifiedBaseId||root.modifiedOf,base=everyCard(p).find(x=>x.id===id);return {id,card:base||null,history:p.deletedCardOrigins?.[id]};}if(parent.numberAsRegular||!isInsertion(parent))return{id:parent.id,card:parent};root=parent;}return{id:root.id,card:root};}
export function baseNumber(p,c,scope='chapter'){
 const root=isInsertion(c)?modificationRoot(p,c):{id:c.id,card:c};
 if(!root.card)return Number(root.history?.[scope==='global'?'globalNumber':'number'])||Number(c[scope==='global'?'modifiedBaseGlobalNumber':'modifiedBaseNumber'])||Number(c.modifiedSourceNumber)||1;
 const list=scope==='global'?sequenceCards(p):(p.stories||[]).filter(x=>x.chapterId===root.card.chapterId);
 const index=list.filter(x=>!isInsertion(x)).findIndex(x=>x.id===root.card.id);return index>=0?index+1:Number(c[scope==='global'?'modifiedBaseGlobalNumber':'modifiedBaseNumber'])||Number(c.modifiedSourceNumber)||1;
}
export function ensureCardLabels(p){
 const all=everyCard(p),used=new Map();p.modificationFamilies||={};
 const reserved=new Map(Object.entries(p.modificationFamilies).map(([id,letters])=>[id,new Set(letters)]));
 for(const c of all.filter(isInsertion)){const id=modificationRoot(p,c).id;if(!reserved.has(id))reserved.set(id,new Set());if(c.modifyLetter)reserved.get(id).add(c.modifyLetter);}
 const groups=c=>[modificationRoot(p,c).id,'local:'+c.chapterId+':'+baseNumber(p,c,'chapter'),'global:'+baseNumber(p,c,'global')];
 const mods=all.filter(isInsertion).sort((a,b)=>Number(!!modificationRoot(p,a).card)-Number(!!modificationRoot(p,b).card));
 for(const c of mods){const root=modificationRoot(p,c);c.modifiedBaseId=root.id;if(sequenceCards(p).some(x=>x.id===root.id)){c.modifiedBaseNumber=baseNumber(p,c,'chapter');c.modifiedBaseGlobalNumber=baseNumber(p,c,'global');}let letter=c.modifyLetter;const available=l=>groups(c).every(id=>!used.get(id)?.has(l));if(!letter||!available(letter)){let n=0;while(reserved.get(root.id)?.has(letterIndex(n))||!available(letterIndex(n)))n++;letter=c.modifyLetter=letterIndex(n);}for(const id of groups(c)){if(!used.has(id))used.set(id,new Set());used.get(id).add(letter);}if(!reserved.has(root.id))reserved.set(root.id,new Set());reserved.get(root.id).add(letter);p.modificationFamilies[root.id]=[...reserved.get(root.id)];}

}
export function exportLabel(p,c,scope='chapter'){const number=baseNumber(p,c,scope);return{number,suffix:isInsertion(c)?c.modifyLetter||'A':'',label:String(number)+(isInsertion(c)?c.modifyLetter||'A':'')};}
export function displayNumber(p,id,scope='global'){
 const c=everyCard(p).find(c=>c.id===id);if(!c)return 0;
 const list=scope==='chapter'?(p.stories||[]).filter(x=>x.chapterId===c.chapterId):sequenceCards(p);
 if(!list.some(x=>x.id===id))return 0;
 return p.viewPrefs?.slightModifyLetters?exportLabel(p,c,scope).label:list.findIndex(x=>x.id===id)+1;
}
export function deletionBlockers(p,ids){const selected=new Set(ids);return everyCard(p).filter(c=>c.reuseOf&&selected.has(c.reuseOf)&&!selected.has(c.id));}
export function rememberDeletedOrigins(p,ids){
 ensureCardLabels(p);p.deletedCardOrigins||={};
 for(const id of ids){const c=everyCard(p).find(c=>c.id===id);if(!c)continue;p.deletedCardOrigins[id]={id,chapterId:c.chapterId,number:baseNumber(p,c,'chapter'),globalNumber:baseNumber(p,c,'global'),label:exportLabel(p,c).label,globalLabel:exportLabel(p,c,'global').label};}
}
export function promoteModification(c){c.numberAsRegular=true;}

export function renameFamilyInOrder(p,card){if(!isInsertion(card))return [];const root=modificationRoot(p,card).id,family=[...new Map([...sequenceCards(p),...everyCard(p)].map(c=>[c.id,c])).values()].filter(c=>isInsertion(c)&&modificationRoot(p,c).id===root);family.forEach((c,i)=>c.modifyLetter=letterIndex(i));p.modificationFamilies||={};p.modificationFamilies[root]=family.map(c=>c.modifyLetter);return family.map(c=>c.id);}
