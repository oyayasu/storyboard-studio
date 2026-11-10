import test from 'node:test';
import assert from 'node:assert/strict';
import {usedAssetReferences,createAssetFolders} from '../src/asset-folders.js';
test('editing export references only the active variant of used artwork, including reusable copies',()=>{
 const source={assetId:'used',sourceFile:{folderId:'folder',relativePath:'poses/one.png',folderPath:'/old'}},unused={assetId:'unused',sourceFile:{folderId:'folder',relativePath:'two.png'}};
 const p={chapters:[{id:'active'},{id:'hidden',unused:true}],stories:[{id:'root',chapterId:'active',blank:false,variants:[unused,source],activeVariant:1},{id:'copy',chapterId:'active',blank:false,reuseOf:'root',activeVariant:1,variants:[]},{id:'hidden-card',chapterId:'hidden',variants:[unused]}]};
 const refs=usedAssetReferences(p,[{id:'folder',path:'/current',status:'ok',missing:[]}]);
 assert.equal(refs.length,1);assert.equal(refs[0].assetId,'used');assert.equal(refs[0].folderPath,'/current');
});
test('missing folders keep cached artwork and relinking preserves card and file identity',async()=>{
 const ref={folderId:'f',folderPath:'/old',relativePath:'pose.png'},card={id:'card',variants:[{assetId:'cached',sourceFile:ref}]};
 const state={assetFolders:[{id:'f',path:'/old',name:'old',status:'ok',missing:[]}],globalAssets:[card],projects:[{stories:[structuredClone(card)]}]},messages=[];
 let connected=false;
 globalThis.window={__TAURI__:{core:{invoke:async(command,args)=>{if(command==='pick_asset_directory')return '/new';if(command==='scan_asset_directory'){if(args.directory==='/old'&&!connected)throw Error('Missing');return ['pose.png'];}throw Error('Unexpected command');}}}};
 const api=createAssetFolders({store:{state,save(){}},render(){},notify:m=>messages.push(m),change:(_,fn)=>fn(state)});
 await api.check(true);assert.equal(state.assetFolders[0].status,'missing');assert.equal(card.variants[0].assetId,'cached');assert.equal(messages.length,1);
 await api.check(true);assert.equal(messages.length,1,'repeated focus checks do not repeat a warning');
 await api.relink('f');assert.equal(state.assetFolders[0].path,'/new');assert.equal(ref.folderPath,'/new');assert.equal(state.projects[0].stories[0].variants[0].sourceFile.folderPath,'/new');assert.equal(card.id,'card');assert.equal(card.variants[0].assetId,'cached');
});
