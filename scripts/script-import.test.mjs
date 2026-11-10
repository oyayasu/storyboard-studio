import test from 'node:test';
import assert from 'node:assert/strict';
import {canImportDocx,suggestChapterTargets,applyDocxImport} from '../src/script-import-model.js';
import {buildProjectReference} from '../src/project-reference.js';
import {ensureProject} from '../src/highlighter-model.js';
const saved=new Map();globalThis.localStorage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};globalThis.document={dispatchEvent(){}};
const {Store,chapter,card}=await import('../src/state.js');
test.beforeEach(()=>saved.clear());
function fixture(){const ch=chapter('Chapter 1'),p={id:'project',name:'Example',ratio:'16:9',chapters:[ch],stories:[]};ensureProject(p);return {p,ch};}
const section=(key,name,level=1,parentKey=null,text='Spoken line.')=>({key,name,level,parentKey,text,marks:[]});
const document=()=>({sections:[section('a','Opening'),section('b','A detail',2,'a'),section('c','Ending')],warnings:[]});
test('whole-project gate includes subchapters and unused chapters, and clears only after every text is removed',()=>{
 const {p,ch}=fixture(),sub=chapter('Sub',ch.id),unused=chapter('Unused');unused.unused=true;p.chapters.push(sub,unused);ensureProject(p);assert.equal(canImportDocx(p),true);
 unused.highlighter.text='Keep me';assert.equal(canImportDocx(p),false);unused.highlighter.text=null;sub.highlighter.text='Other text';assert.equal(canImportDocx(p),false);sub.highlighter.text=' \n\t ';assert.equal(canImportDocx(p),true);
});
test('import reuses the initial empty chapter and builds Heading 1/2 structure',()=>{
 const {p,ch}=fixture(),parsed=document(),mapping=suggestChapterTargets(p,parsed.sections);assert.equal(mapping.a,ch.id);
 const result=applyDocxImport(p,parsed,mapping,chapter,'script.docx');assert.equal(p.chapters.length,3);assert.equal(p.chapters[0].id,ch.id);assert.equal(p.chapters[0].name,'Opening');assert.equal(p.chapters[1].parentId,ch.id);assert.equal(p.chapters[2].parentId,null);assert.equal(result.firstChapterId,ch.id);assert.equal(canImportDocx(p),false);
});
test('matching keeps card, chapter, note, and sticky identities',()=>{
 const {p,ch}=fixture();ch.name='Opening';const sub=chapter('A detail',ch.id),end=chapter('Ending');p.chapters.push(sub,end);ensureProject(p);const drawing=card(ch.id,'image');drawing.note='Keep drawing note';p.stories.push(drawing);p.stickyNotes.push({id:'sticky',chapterId:sub.id,text:'Keep sticky'});
 const parsed=document(),mapping=suggestChapterTargets(p,parsed.sections);assert.deepEqual(mapping,{a:ch.id,b:sub.id,c:end.id});applyDocxImport(p,parsed,mapping,chapter,'script.docx');assert.equal(p.stories[0].id,drawing.id);assert.equal(p.stories[0].chapterId,ch.id);assert.equal(p.stories[0].variants[0].assetId,'image');assert.equal(p.stories[0].note,'Keep drawing note');assert.equal(p.stickyNotes[0].chapterId,sub.id);assert.equal(p.chapters[1].id,sub.id);
});
test('manual matches preserve existing names and unmatched chapters stay in place',()=>{
 const {p,ch}=fixture();ch.name='Existing opening';p.stories.push(card(ch.id));const extra=chapter('Leave empty');p.chapters.push(extra);ensureProject(p);const parsed={sections:[section('a','New document title')]};applyDocxImport(p,parsed,{a:ch.id},chapter,'doc.docx');assert.deepEqual(p.chapters.map(c=>c.id),[ch.id,extra.id]);assert.equal(p.chapters[0].name,'Existing opening');assert.equal(p.stories[0].chapterId,ch.id);assert.equal(p.chapters[1].highlighter.text,null);
});
test('duplicate, invalid, and newly blocked destinations fail atomically',()=>{
 const {p,ch}=fixture(),parsed={sections:[section('a','First'),section('b','Second')]};let before=structuredClone(p);assert.throws(()=>applyDocxImport(p,parsed,{a:ch.id,b:ch.id},chapter,'doc.docx'),/different destination/);assert.deepEqual(p,before);
 ch.highlighter.text='Added during preview';before=structuredClone(p);assert.throws(()=>applyDocxImport(p,parsed,{a:ch.id,b:'new'},chapter,'doc.docx'),/Delete all/);assert.deepEqual(p,before);
});
test('annotation colors preserve speech exclusion and category typography',()=>{
 const {p}=fixture(),parsed={sections:[{...section('a','Opening',1,null,'Hi. [wave] Bye.'),marks:[{from:4,to:10,color:'#123456',style:'bold-italic'}]}]};const map=suggestChapterTargets(p,parsed.sections);applyDocxImport(p,parsed,map,chapter,'doc.docx');const mark=p.chapters[0].highlighter.marks[0],category=p.highlighter.categories.find(c=>c.id===mark.categoryId);assert.equal(category.style,'bold-italic');assert.equal(category.color,'#123456');assert.equal(p.chapters[0].highlighter.text.slice(mark.from,mark.to),'[wave]');
});
test('import and all chapter creation are one Undo/Redo operation',()=>{
 const {p}=fixture(),store=new Store();store.state.projects.push(p);store.open(p.id);const before=structuredClone(p);store.change('Import DOCX',()=>applyDocxImport(store.project,document(),suggestChapterTargets(store.project,document().sections),chapter,'script.docx'));const after=structuredClone(store.project);store.undoNow();assert.deepEqual(store.project,before);store.redoNow();assert.deepEqual(store.project,after);store.save();const reopened=new Store();reopened.open(p.id);assert.deepEqual(reopened.project.chapters.map(c=>[c.id,c.name,c.parentId,c.highlighter.text]),after.chapters.map(c=>[c.id,c.name,c.parentId,c.highlighter.text]));
});
test('reference contains stable IDs, correct chapter/card numbers, and bottom-to-top component order',()=>{
 const {p,ch}=fixture(),sub=chapter('Sub',ch.id),next=chapter('Next'),unused=chapter('Unused');unused.unused=true;p.chapters.push(sub,next,unused);ensureProject(p);p.stories=[card(ch.id),card(ch.id),card(sub.id),card(next.id),card(unused.id)];const r=buildProjectReference(p,'chapter','fixed');assert.equal(r.chapters.length,3);assert.deepEqual(r.chapters.map(c=>c.number),['1','1.1','2']);assert.deepEqual(r.chapters.flatMap(c=>c.cards.map(f=>f.globalNumber)),[1,2,3,4]);assert.deepEqual(r.chapters.flatMap(c=>c.cards.map(f=>f.number)),[1,2,1,1]);assert.equal(r.chapters[0].cards[0].id,p.stories[0].id);assert.deepEqual(r.componentOrder,{direction:'bottom-to-top',startIndex:1});
});
test('reference omits script, notes, image blobs, and unused cards; signature detects structural changes',()=>{
 const {p,ch}=fixture();ch.highlighter.text='Private script';const c=card(ch.id,'image');c.note='Private note';p.stories.push(c);const first=buildProjectReference(p),second=buildProjectReference(p,'chapter','later');assert.equal(first.structuralSignature,second.structuralSignature);assert.doesNotMatch(JSON.stringify(first),/Private|variants|dataUrl/);p.stories.unshift(card(ch.id));const changed=buildProjectReference(p);assert.notEqual(first.structuralSignature,changed.structuralSignature);assert.equal(changed.chapters[0].cards[1].id,c.id);assert.equal(changed.chapters[0].cards[1].number,2);
});
