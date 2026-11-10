import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ensureProject,setChapterText,colorRange,insertLinkedCard,assignRange,removeAssignmentRange,splitAssignment,clearChapterText,cardScriptRuns,nextExistingCard,advanceExistingCard,splitPoint,cardPassages,textPieces} from '../src/highlighter-model.js';
const saved=new Map();
test.beforeEach(()=>saved.clear());
globalThis.localStorage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)};
globalThis.document={dispatchEvent(){}};
const {Store,KEY,chapter,card,position}=await import('../src/state.js');
function fixture(text='He opens the door. The room is empty. Then he finds a letter.') {
 const c=chapter('Opening'),p={id:'project-test',chapters:[c],stories:[]};ensureProject(p);setChapterText(c,text);return {p,c,h:c.highlighter};
}
test('chapter snapshots stay independent and cannot be overwritten by a later paste',()=>{
 const {p,c,h}=fixture('First chapter');const empty=chapter('Later');p.chapters.push(empty);ensureProject(p);
 assert.throws(()=>setChapterText(c,'Replacement'),/read-only/);assert.equal(h.text,'First chapter');
 setChapterText(empty,'Later chapter');assert.equal(h.text,'First chapter');assert.equal(empty.highlighter.text,'Later chapter');
});
test('inserting an earlier passage creates the card in script order while existing links retain identities',()=>{
 const {p,c,h}=fixture();const second=insertLinkedCard(p,c,19,37,card),secondCard=second.cardId;
 const first=insertLinkedCard(p,c,0,18,card);
 assert.deepEqual(p.stories.map(c=>c.id),[first.cardId,secondCard]);assert.equal(position(p,secondCard,'chapter'),2);
 p.stories.unshift(card(c.id));assert.equal(position(p,secondCard,'chapter'),3);assert.equal(h.assignments[1].cardId,secondCard);
});
test('expanding a card takes selected text from the following card without losing either drawing',()=>{
 const {p,c,h}=fixture('alpha beta gamma delta');const a=insertLinkedCard(p,c,0,10,card),b=insertLinkedCard(p,c,11,22,card);
 p.stories[1].variants=[{assetId:'existing'}];assignRange(c,6,16,a.cardId,a.id);
 assert.deepEqual(h.assignments.map(r=>[r.from,r.to,r.cardId]),[[0,16,a.cardId],[17,22,b.cardId]]);
 assert.equal(p.stories.length,2);assert.equal(p.stories[1].variants[0].assetId,'existing');
});
test('category marks are exclusive and reverse clears only the selected category',()=>{
 const {p,c,h}=fixture('alpha beta gamma');colorRange(p,c,0,5,'action');colorRange(p,c,3,16,'emotion');
 assert.deepEqual(h.marks.map(m=>[m.from,m.to,m.categoryId]),[[0,3,'action'],[3,16,'emotion']]);
 colorRange(p,c,0,16,'emotion',true);assert.deepEqual(h.marks.map(m=>m.categoryId),['action']);
});
test('split preserves existing drawings, notes, and annotations',()=>{
 const {p,c,h}=fixture('He opens the door and enters the room.');colorRange(p,c,0,h.text.length,'action');
 const original=insertLinkedCard(p,c,0,h.text.length,card);p.stories[0].note='Drawing note';p.stories[0].variants=[{assetId:'drawing-a'}];
 const split=splitAssignment(p,c,original.id,18,card);assert.equal(p.stories.length,2);assert.equal(h.assignments.length,2);assert.equal(h.marks.length,1);assert.equal(split.cardId,p.stories[1].id);
 assert.equal(p.stories[0].note,'Drawing note');assert.equal(p.stories[0].variants[0].assetId,'drawing-a');
});
test('reverse starting in unassigned text removes links and drops whitespace fragments',()=>{
 const {p,c,h}=fixture('alpha beta gamma');insertLinkedCard(p,c,0,10,card);removeAssignmentRange(c,6,16);
 assert.deepEqual(h.assignments.map(a=>h.text.slice(a.from,a.to)),['alpha']);removeAssignmentRange(c,0,5);assert.equal(h.assignments.length,0);assert.equal(p.stories.length,1);
});
test('spoken runs exclude all category highlights regardless of storyboard assignments',()=>{
 const {p,c,h}=fixture('Hello. [waves] Goodbye.');const a=insertLinkedCard(p,c,0,h.text.length,card);colorRange(p,c,7,14,'action');
 assert.equal(cardScriptRuns(p,a.cardId,'all').map(r=>r.text).join(''),h.text);
 assert.equal(cardScriptRuns(p,a.cardId,'spoken').map(r=>r.text).join(''),'Hello.  Goodbye.');
});
test('delete chapter text is one undoable operation and preserves cards and notes',()=>{
 const store=new Store(),{p,c,h}=fixture();insertLinkedCard(p,c,0,18,card);p.stories[0].note='Keep';colorRange(p,c,0,2,'action');store.state.projects.push(p);store.open(p.id);
 store.change('Delete chapter text',()=>clearChapterText(c));assert.equal(c.highlighter.text,null);assert.equal(p.stories[0].note,'Keep');store.undoNow();assert.equal(store.project.chapters[0].highlighter.text,h.text);assert.equal(store.project.chapters[0].highlighter.assignments.length,1);
});
test('unassigning text preserves both cards and supports separate ranges for one card',()=>{
 const {p,c,h}=fixture('alpha beta gamma');const a=insertLinkedCard(p,c,0,h.text.length,card);removeAssignmentRange(c,6,10);
 assert.equal(p.stories.length,1);assert.equal(h.assignments.length,2);assert.ok(h.assignments.every(x=>x.cardId===a.cardId));assert.equal(cardPassages(p,a.cardId).length,2);
});
test('Japanese, accented text, emoji, and multiline text retain exact UTF-16 anchors',()=>{
 const text='Olá 😀\n猫がドアを開ける。\nFim.';const {p,c,h}=fixture(text);const from=text.indexOf('猫'),to=text.indexOf('\nFim');const a=insertLinkedCard(p,c,from,to,card);
 colorRange(p,c,from,to,'character');assert.equal(cardPassages(p,a.cardId)[0].text,'猫がドアを開ける。');assert.equal(textPieces(p,c).map(x=>x.text).join(''),text);
 const b=splitAssignment(p,c,a.id,from+2,card);assert.ok(b.from>from);assert.equal(h.text,text);
});
test('one undo restores card creation and its assignment together; save/reopen preserves links and categories',()=>{
 const store=new Store(),{p,c}=fixture();store.state.projects.push(p);store.open(p.id);
 store.change('Assign passage',()=>insertLinkedCard(store.project,c,0,18,card));assert.equal(store.project.stories.length,1);
 store.undoNow();assert.equal(store.project.stories.length,0);assert.equal(store.project.chapters[0].highlighter.assignments.length,0);
 store.redoNow();assert.equal(store.project.stories.length,1);store.save();
 const reopened=new Store();reopened.open(p.id);assert.equal(reopened.project.chapters[0].highlighter.assignments[0].cardId,reopened.project.stories[0].id);
});
test('failed transactions roll back instead of leaving a partial project mutation',()=>{
 const store=new Store();const before=structuredClone(store.state);
 assert.throws(()=>store.change('Bad operation',s=>{s.projects=[];throw Error('fail');}));assert.deepEqual(store.state,before);
});
test('original saved projects and native artwork database retain their identities',()=>{
 saved.clear();const {p}=fixture();saved.set('storyboardStudio.next.v03.state',JSON.stringify({projects:[p]}));const store=new Store();assert.equal(store.state.projects.length,1);assert.equal(KEY,'storyboardStudio.next.v03.state');
 const base=new URL('../',import.meta.url),cfg=JSON.parse(fs.readFileSync(new URL('src-tauri/tauri.conf.json',base)));assert.equal(cfg.identifier,'local.filipe.storyboardstudio.next');assert.match(fs.readFileSync(new URL('src/db.js',base),'utf8'),/storyboard-studio-v01/);
});

test('existing-card cursor advances by identity, survives reopen, and is undone with an assignment',()=>{
 const {p,c}=fixture('One. Two. Three.');p.stories=[card(c.id),card(c.id)];const a=p.stories[0],b=p.stories[1],store=new Store();store.state.projects.push(p);store.open(p.id);
 assert.equal(nextExistingCard(p,c).id,a.id);store.change('Assign existing',()=>{assignRange(c,0,4,a.id);advanceExistingCard(p,c,a.id);});assert.equal(nextExistingCard(p,c).id,b.id);
 store.undoNow();assert.equal(nextExistingCard(store.project,store.project.chapters[0]).id,a.id);store.redoNow();const reopened=new Store();reopened.open(p.id);assert.equal(nextExistingCard(reopened.project,reopened.project.chapters[0]).id,b.id);
 assignRange(c,5,9,b.id);advanceExistingCard(p,c,b.id);assert.equal(nextExistingCard(p,c),null);assert.equal(p.stories.length,2);
});
test('scissors preview chooses exactly the boundary used by the real split',()=>{
 const {p,c,h}=fixture('alpha beta gamma');const a=insertLinkedCard(p,c,0,h.text.length,card),before=structuredClone(p);
 const preview=splitPoint(c,a.id,8);assert.deepEqual(p,before);const b=splitAssignment(p,c,a.id,8,card);assert.equal(b.from,preview.offset);assert.equal(a.to,preview.first.to);
});
test('combined category typography survives normalization',()=>{
 const {p}=fixture();p.highlighter.categories[0].style='bold-italic';ensureProject(p);assert.equal(p.highlighter.categories[0].style,'bold-italic');
});
