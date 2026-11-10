#!/usr/bin/env python3
"""Build a tiny JSON CLI around the real filesystem code for browser integration tests."""
from pathlib import Path
import sys,subprocess,os
root=Path(__file__).resolve().parents[1]/'src-tauri/src';out=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/studio-native-bridge');(out/'src').mkdir(parents=True,exist_ok=True)
(out/'Cargo.toml').write_text('[package]\nname="studio-native-bridge"\nversion="0.1.0"\nedition="2021"\n[dependencies]\nserde_json="1"\nserde={version="1",features=["derive"]}\nbase64="0.22"\n')
mods=['folder_rename','media_vault','audio_identity','studio_files','owned_output','cleanup_files','media_organization','image_index_fs','studio_link']
for name in mods:(out/'src'/f'{name}.rs').write_text((root/f'{name}.rs').read_text().replace('#[tauri::command]','').replace('rfd::','crate::rfd::').replace('tauri::','crate::tauri::'))
entry=(root/'lib.rs').read_text();probe='pub fn probe_project_folder('+entry.split('fn probe_project_folder(',1)[1].split('\n#[tauri::command]',1)[0]
(out/'src/project_folder.rs').write_text('use std::fs;use crate::studio_files;\n'+probe)
mods.append('project_folder')
stubs='''#![allow(dead_code)]
mod tauri{pub mod async_runtime{pub async fn spawn_blocking<F:FnOnce()->T,T>(f:F)->Result<T,std::io::Error>{Ok(f())}}}
mod rfd{use std::path::PathBuf;pub struct FileDialog;impl FileDialog{pub fn new()->Self{Self}pub fn set_title(self,_:&str)->Self{self}pub fn add_filter(self,_:&str,_:&[&str])->Self{self}pub fn pick_files(self)->Option<Vec<PathBuf>>{None}pub fn pick_file(self)->Option<PathBuf>{None}pub fn pick_folder(self)->Option<PathBuf>{None}}}
'''
main='''
use serde_json::{Value,json};use std::{io::Read,sync::Arc,task::{Context,Wake,Waker,Poll}};
fn run<F:std::future::Future>(future:F)->F::Output{struct W;impl Wake for W{fn wake(self:Arc<Self>) {}}let w=Waker::from(Arc::new(W));let mut cx=Context::from_waker(&w);let mut f=std::pin::pin!(future);loop{if let Poll::Ready(v)=f.as_mut().poll(&mut cx){return v}}}
fn call(n:&str,a:Value)->Result<Value,String>{let s=|k:&str|a[k].as_str().unwrap_or("").to_string();let v=|k:&str|a[k].as_array().cloned().unwrap_or_default();Ok(match n{
 "rename_project_folders"=>folder_rename::rename(s("directory"),s("projectId"),v("moves"),a.get("naming").cloned())?,
 "probe_project_folder"=>project_folder::probe_project_folder(s("directory"))?,
 "sync_studio_link"=>json!(run(studio_link::sync_studio_link(s("directory"),s("projectId"),s("manifest"),s("reference"),s("script")))?),
 "inspect_studio_link"=>run(studio_link::inspect_studio_link(s("directory"),s("projectId")))?,
 "sync_cleanup_catalog"=>run(cleanup_files::sync_cleanup_catalog(s("directory"),s("projectId"),a["catalog"].clone()))?,
 "scan_project_cleanup"=>json!(run(cleanup_files::scan_project_cleanup(s("directory"),v("folders").iter().map(|v|v.as_str().unwrap().to_string()).collect()))?),
 "inspect_cleanup_media"=>json!(run(cleanup_files::inspect_cleanup_media(v("paths").iter().map(|v|v.as_str().unwrap().to_string()).collect(),Some(s("directory"))))?),
 "snapshot_project_media"=>media_organization::snapshot_project_media(s("directory"),s("projectId"))?,
 "organize_project_media"=>run(media_organization::organize_project_media(s("directory"),s("projectId"),v("moves")))?,
 "write_project_output"=>studio_link::write_project_output(s("directory"),s("relativePath"),s("base64Data"),s("projectId"),s("ownerKey"))?,
 "inspect_image_index_files"=>json!(image_index_fs::inspect_images(std::path::Path::new(&s("directory")),&v("relativePaths").iter().map(|v|v.as_str().unwrap().to_string()).collect::<Vec<_>>())?.iter().map(|f|json!({"path":f.path,"state":f.state,"size":f.size,"modified":f.modified})).collect::<Vec<_>>()),
 "retire_storyboard_output"=>{let root=studio_files::root(&s("directory"))?;owned_output::retire(&root,&s("relativePath"),&s("projectId"),&s("cardId"),&s("sourceCardId"),a["ownerKey"].as_str())?;json!(null)},
 "manage_cleanup_media"=>match s("action").as_str(){"preserve"=>media_vault::preserve(s("directory"),s("projectId"),v("files"),a["stage"].as_bool().unwrap_or(false))?,"restore"=>media_vault::restore(s("directory"),s("projectId"),v("files"))?,"audit"=>media_vault::audit(s("directory"),s("projectId"),v("files"))?,"compare"=>media_vault::compare(s("directory"),s("projectId"),v("files"))?,"trash"=>media_vault::trash(s("directory"),s("projectId"),v("files"),v("retained"))?,"retire-superseded"=>media_vault::retire_superseded(s("directory"),s("projectId"),v("files"),v("retained"))?,_=>return Err("Unknown operation".into())},
 "copy_project_workspace"=>json!(media_vault::copy_workspace(s("directory"),s("destination"),s("projectId"))?),
 "save_project_backup"=>media_vault::backup(std::path::Path::new(&s("backupFolder")),&s("projectId"),&s("snapshot"),a["closing"].as_bool().unwrap_or(false))?,
 _=>return Err(format!("Unknown command {n}"))})}
fn main(){let mut input=String::new();std::io::stdin().read_to_string(&mut input).unwrap();let v:Value=serde_json::from_str(&input).unwrap();let result=match call(v["name"].as_str().unwrap(),v["args"].clone()){Ok(value)=>json!({"ok":true,"value":value}),Err(error)=>json!({"ok":false,"error":error})};println!("{result}");}
'''
(out/'src/main.rs').write_text(stubs+''.join(f'mod {name};\n'for name in mods)+main)
subprocess.run(['cargo','build','--manifest-path',str(out/'Cargo.toml')],check=True)
print(Path(os.environ.get('CARGO_TARGET_DIR',str(out/'target')))/'debug/studio-native-bridge')
