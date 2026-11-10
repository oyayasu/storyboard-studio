#!/usr/bin/env python3
"""Compile real filesystem modules and the lib.rs standalone export command.

GUI runtime/dialogs are stubbed here. A target-OS cargo check/build is still
required for Tauri macros, menu APIs and the actual native shell.
"""
from pathlib import Path
import tempfile,subprocess
r=Path(__file__).resolve().parents[1]/'src-tauri/src'
with tempfile.TemporaryDirectory(prefix='studio-native-tests-') as temporary:
 h=Path(temporary);(h/'src').mkdir()
 (h/'Cargo.toml').write_text('[package]\nname="studio-files-test"\nversion="0.1.0"\nedition="2021"\n[dependencies]\nserde_json="1"\nserde={version="1",features=["derive"]}\nbase64="0.22"\n')
 mods=['folder_rename','media_vault','audio_identity','studio_files','owned_output','cleanup_files','media_organization','image_index_fs','studio_link']
 for name in mods:
  s=(r/(name+'.rs')).read_text().replace('#[tauri::command]','').replace('rfd::','crate::rfd::').replace('tauri::','crate::tauri::')
  (h/'src'/(name+'.rs')).write_text(s)
 # Compile the actual production command instead of maintaining a test copy.
 entry=(r/'lib.rs').read_text()
 command='fn write_export_file('+entry.split('fn write_export_file(',1)[1].split('\n#[tauri::command]',1)[0]
 command=command.replace('rfd::','crate::rfd::')
 (h/'src/export_command.rs').write_text('use base64::{engine::general_purpose::STANDARD,Engine as _};\nuse std::fs;\nuse crate::studio_files;\n'+command+'\n'+(r.parents[1]/'scripts/native_export_tests.rs').read_text())
 mods.append('export_command')
 (h/'src/lib.rs').write_text('''#![allow(dead_code)]
 pub mod tauri{pub mod async_runtime{pub async fn spawn_blocking<F:FnOnce()->T,T>(f:F)->Result<T,std::io::Error>{Ok(f())}}}
 pub mod rfd{
 use std::path::PathBuf;
 pub struct FileDialog;impl FileDialog{pub fn new()->Self{Self}pub fn set_title(self,_:&str)->Self{self}pub fn add_filter(self,_:&str,_:&[&str])->Self{self}pub fn pick_files(self)->Option<Vec<PathBuf>>{None}pub fn pick_file(self)->Option<PathBuf>{None}pub fn pick_folder(self)->Option<PathBuf>{None}}
 #[derive(Clone,Copy)]pub enum MessageDialogResult{Yes,No,Cancel}
 pub enum MessageButtons{YesNoCancel}
 std::thread_local!{static CHOICE:std::cell::Cell<MessageDialogResult>=std::cell::Cell::new(MessageDialogResult::Cancel);}
 pub fn choose(value:MessageDialogResult){CHOICE.with(|c|c.set(value));}
 pub struct MessageDialog;impl MessageDialog{pub fn new()->Self{Self}pub fn set_title(self,_:&str)->Self{self}pub fn set_description(self,_:impl Into<String>)->Self{self}pub fn set_buttons(self,_:MessageButtons)->Self{self}pub fn show(self)->MessageDialogResult{CHOICE.with(|c|c.get())}}
 }
 '''+''.join('mod '+name+';\n' for name in mods))
 subprocess.run(['cargo','test','--lib','--manifest-path',str(h/'Cargo.toml')],check=True)
