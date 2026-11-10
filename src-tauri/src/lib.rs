mod audio_package;
mod audio_recovery;
mod media_vault;
mod audio_identity;
mod media_organization;
mod folder_rename;
mod cleanup_files;
mod studio_files;
mod owned_output;
mod subtitler_handoff;
mod studio_link;
mod image_index_fs;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{fs, path::Path};
use tauri::{AppHandle, Manager, Emitter};
use std::sync::atomic::{AtomicBool,Ordering};
#[derive(Default)]struct CloseState{ready:AtomicBool,closing:AtomicBool,allow_exit:AtomicBool}
#[tauri::command]fn enable_managed_close(state:tauri::State<CloseState>){state.ready.store(true,Ordering::SeqCst);}
#[tauri::command]fn cancel_managed_close(state:tauri::State<CloseState>){state.closing.store(false,Ordering::SeqCst);}
#[tauri::command]fn finish_managed_close(app:AppHandle,state:tauri::State<CloseState>){state.allow_exit.store(true,Ordering::SeqCst);app.exit(0);}

#[tauri::command]
fn write_export_file(directory:String,relative_path:String,base64_data:String)->Result<String,String>{
 use std::io::Write;
 let root=studio_files::root(&directory)?;
 let relative=studio_files::relative(&relative_path)?;
 if relative.components().next().map(|x|x.as_os_str()=="Studio Link").unwrap_or(false){return Err("Choose an export location outside Studio Link".into())}
 let mut target=root.join(&relative);let bytes=STANDARD.decode(base64_data).map_err(|e|e.to_string())?;
 if bytes.len()>128*1024*1024{return Err("Export exceeds 128 MB".into())}
 if target.exists(){if !target.canonicalize().map_err(|e|e.to_string())?.starts_with(&root){return Err("Export points outside the selected folder".into())}if fs::read(&target).map_err(|e|e.to_string())?==bytes{return Ok(target.to_string_lossy().into())}
 let result=rfd::MessageDialog::new().set_title("Existing export").set_description(format!("{} already exists. Yes: replace it. No: keep both. Cancel: stop exporting.",relative_path)).set_buttons(rfd::MessageButtons::YesNoCancel).show();
 match result{rfd::MessageDialogResult::Yes=>{},rfd::MessageDialogResult::No=>{let stem=target.file_stem().unwrap_or_default().to_string_lossy().into_owned();let ext=target.extension().unwrap_or_default().to_string_lossy().into_owned();let parent=target.parent().unwrap().to_path_buf();let mut found=None;for i in 2..10000{let next=parent.join(format!("{stem}_{i}.{ext}"));if !next.exists(){found=Some(next);break;}}target=found.ok_or("Too many exported copies")?;},_=>return Err("Export cancelled".into())}}
 let parent=target.parent().ok_or("Invalid export folder")?;let rel=parent.strip_prefix(&root).map_err(|e|e.to_string())?;if !rel.as_os_str().is_empty(){studio_files::subdir(&root,&rel.to_string_lossy())?;}
 let temp=parent.join(format!(".export-{}-{}.tmp",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));let mut file=fs::OpenOptions::new().create_new(true).write(true).open(&temp).map_err(|e|e.to_string())?;file.write_all(&bytes).and_then(|_|file.sync_all()).map_err(|e|e.to_string())?;drop(file);studio_files::replace_file(&temp,&target)?;Ok(target.to_string_lossy().into())
}

#[tauri::command]
fn pick_export_directory() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Choose Export Folder")
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_asset_directory() -> Option<String> {
    rfd::FileDialog::new().set_title("Link Reusable Asset Folder").pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn scan_asset_directory(directory: String) -> Result<Vec<String>, String> {
    fn visit(root: &Path, dir: &Path, depth: usize, out: &mut Vec<String>) -> Result<(), String> {
        if depth > 32 { return Err("Asset folder nesting is too deep".into()); }
        for entry in fs::read_dir(dir).map_err(|e| format!("Cannot read asset folder: {e}"))? {
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() { continue; }
            let path = entry.path();
            if kind.is_dir() { visit(root, &path, depth + 1, out)?; }
            else if kind.is_file() {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                if ["png", "jpg", "jpeg", "webp", "gif", "bmp"].contains(&ext.as_str()) {
                    out.push(path.strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/"));
                    if out.len() > 2048 { return Err("Choose a folder with at most 2048 images".into()); }
                }
            }
        }
        Ok(())
    }
    let root = Path::new(&directory).canonicalize().map_err(|e| format!("Asset folder is missing: {e}"))?;
    let mut result = Vec::new();
    visit(&root, &root, 0, &mut result)?;
    result.sort();
    Ok(result)
}

#[tauri::command]
fn read_asset_image(directory: String, relative_path: String) -> Result<String, String> {
    let root = Path::new(&directory).canonicalize().map_err(|e| e.to_string())?;
    let path = root.join(relative_path).canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(&root) { return Err("Image is outside the linked folder".into()); }
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 50 * 1024 * 1024 {
        return Err("Asset images must be smaller than 50 MB".into());
    }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "webp" => "image/webp",
        "gif" => "image/gif", "bmp" => "image/bmp", "tif" | "tiff" => "image/tiff", _ => return Err("Unsupported asset image".into())
    };
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
fn pick_image_index() -> Result<Option<serde_json::Value>, String> {
    let chosen=rfd::FileDialog::new().set_title("Import FolderExporter image index").add_filter("FolderExporter image index", &["json"]).pick_file();
    match chosen {None=>Ok(None),Some(path)=>{let mut data=image_index_fs::read_index(&path)?;
    if let Ok(raw)=serde_json::from_str::<serde_json::Value>(&data.text){if let Some(relative)=raw["mediaRoot"].as_str(){let mut base=std::path::PathBuf::from(&data.directory);if base.file_name().and_then(|s|s.to_str())==Some("Studio Link"){base=base.parent().ok_or("Missing project folder")?.to_path_buf();}if relative!="."{base=base.join(studio_files::relative(relative)?);}let actual=base.canonicalize().map_err(|e|e.to_string())?;if !actual.is_dir(){return Err("Media root is missing".into())}data.directory=actual.to_string_lossy().into_owned();}}
    Ok(Some(serde_json::json!({"directory":data.directory,"filename":data.filename,"text":data.text})))}}
}

#[tauri::command]
fn pick_image_export_directory() -> Option<String> {
    rfd::FileDialog::new().set_title("Locate folder containing the exported image index").pick_folder().map(|p|p.to_string_lossy().into_owned())
}

#[tauri::command]
fn inspect_image_index_files(directory: String, relative_paths: Vec<String>) -> Result<Vec<serde_json::Value>, String> {
    Ok(image_index_fs::inspect_images(Path::new(&directory),&relative_paths)?.into_iter().map(|f|serde_json::json!({"path":f.path,"state":f.state,"size":f.size,"modified":f.modified})).collect())
}

#[tauri::command]
async fn copy_project_workspace(directory:String,destination:String,project_id:String)->Result<String,String>{tauri::async_runtime::spawn_blocking(move||media_vault::copy_workspace(directory,destination,project_id)).await.map_err(|e|e.to_string())?}
#[tauri::command]
async fn manage_cleanup_media(directory:String,project_id:String,files:Vec<serde_json::Value>,action:String,stage:Option<bool>,retained:Option<Vec<serde_json::Value>>)->Result<serde_json::Value,String>{tauri::async_runtime::spawn_blocking(move||match action.as_str(){"copy-audio"=>media_vault::copy_audio(directory,project_id,files.first().and_then(|f|f["path"].as_str()).unwrap_or("").to_string()).map(serde_json::Value::String),"preserve"=>media_vault::preserve(directory,project_id,files,stage.unwrap_or(false)),"restore"=>media_vault::restore(directory,project_id,files),"audit"=>media_vault::audit(directory,project_id,files),"compare"=>media_vault::compare(directory,project_id,files),"retire-superseded"=>media_vault::retire_superseded(directory,project_id,files,retained.unwrap_or_default()),"trash"=>media_vault::trash(directory,project_id,files,retained.unwrap_or_default()),_=>Err("Unknown media operation".into())}).await.map_err(|e|e.to_string())?}
#[tauri::command]
async fn save_project_backup(app:AppHandle,project_id:String,snapshot:String,closing:bool)->Result<serde_json::Value,String>{let folder=app.path().app_data_dir().map_err(|e|e.to_string())?.join("backups");tauri::async_runtime::spawn_blocking(move||media_vault::backup(&folder,&project_id,&snapshot,closing)).await.map_err(|e|e.to_string())?}
#[tauri::command]async fn inspect_project_backups(app:AppHandle,project_id:String)->Result<serde_json::Value,String>{let folder=app.path().app_data_dir().map_err(|e|e.to_string())?.join("backups");tauri::async_runtime::spawn_blocking(move||media_vault::backup_health(&folder,&project_id)).await.map_err(|e|e.to_string())?}
#[tauri::command]
fn show_project_backups(app:AppHandle)->Result<String,String>{let folder=app.path().app_data_dir().map_err(|e|e.to_string())?.join("backups");fs::create_dir_all(&folder).map_err(|e|e.to_string())?;let path=folder.to_string_lossy().into_owned();cleanup_files::reveal_cleanup_file(path.clone())?;Ok(path)}
#[tauri::command]
fn pick_project_backup(app:AppHandle,project_id:String)->Result<Option<String>,String>{let dir=app.path().app_data_dir().map_err(|e|e.to_string())?.join("backups").join(&project_id);let path=rfd::FileDialog::new().set_title("Restore a Storyboard Studio backup").set_directory(dir).add_filter("Storyboard Studio",&["StoryboardStudio"]).pick_file();match path{Some(path)=>Ok(Some(fs::read_to_string(path).map_err(|e|e.to_string())?)),None=>Ok(None)}}
#[tauri::command]
fn pick_project_directory()->Option<String>{rfd::FileDialog::new().set_title("Choose or create a project folder — cards are saved in separate chapter folders").pick_folder().map(|p|p.to_string_lossy().into_owned())}
#[tauri::command]
fn probe_project_folder(directory:String)->Result<serde_json::Value,String>{let root=studio_files::root(&directory)?;let link=root.join("Studio Link");let manifest=link.join("project.json");if manifest.exists(){let v:serde_json::Value=serde_json::from_slice(&fs::read(manifest).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;Ok(serde_json::json!({"directory":root.to_string_lossy(),"projectId":v["project"]["id"],"exists":true}))}else if link.exists()&&!link.is_dir(){Err("Studio Link is blocked by a file".into())}else{Ok(serde_json::json!({"directory":root.to_string_lossy(),"exists":false}))}}
#[tauri::command]
fn update_file_menu(app:AppHandle,active:bool,linked:bool)->Result<(),String>{use tauri::menu::MenuItemKind;if let Some(menu)=app.menu(){for(id,enabled)in [("file-choose",active&&!linked),("file-change",active&&linked),("file-locate",active&&linked),("file-show",active&&linked),("file-save",active),("file-duplicate",active),("file-export",active),("file-pdf",active),("file-png",active),("file-cards",active),("file-check",active&&linked),("file-restore",active)]{for outer in menu.items().map_err(|e|e.to_string())?{if let MenuItemKind::Submenu(sub)=outer{if let Some(MenuItemKind::MenuItem(item))=sub.get(id){item.set_enabled(enabled).map_err(|e|e.to_string())?;}}}}}Ok(())}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app|{use tauri::menu::*;let mut file=SubmenuBuilder::new(app,"File");for(id,title,shortcut)in [("file-save","Save",Some("CmdOrCtrl+S")),("file-duplicate","Duplicate Project…",None),("file-choose","Choose project folder…",None),("file-change","Change project folder…",None),("file-locate","Locate project folder…",None),("file-show","Show project folder",None),("file-export","Export Storyboard Studio Project…",None),("file-pdf","Export PDF…",None),("file-png","Export PNG Pages…",None),("file-cards","Export PNG Cards…",None),("file-check","Check Project…",None),("file-restore","Restore Backup…",None),("file-backups","Show Backups Folder",None)]{if ["file-choose","file-export","file-check","file-restore"].contains(&id){file=file.separator();}file=file.item(&MenuItem::with_id(app,id,title,id=="file-backups",shortcut)?);}let app_menu=SubmenuBuilder::new(app,"Storyboard Studio").quit().build()?;let edit=SubmenuBuilder::new(app,"Edit").undo().redo().separator().cut().copy().paste().select_all().build()?;app.set_menu(MenuBuilder::new(app).item(&app_menu).item(&file.build()?).item(&edit).build()?)?;Ok(())})
        .on_menu_event(|app,event|{let id:&str=event.id().as_ref();let _=app.emit("studio-file-action",id);})
        .manage(CloseState::default())
        .on_window_event(|window,event|{if let tauri::WindowEvent::CloseRequested{api,..}=event{
          let state=window.state::<CloseState>();
          if state.ready.load(Ordering::SeqCst){api.prevent_close();if !state.closing.swap(true,Ordering::SeqCst){if window.emit("studio-close-requested",()).is_err(){state.closing.store(false,Ordering::SeqCst);}}}
          else{window.app_handle().exit(0);}
        }})
        .invoke_handler(tauri::generate_handler![
            audio_recovery::locate_project_audio,audio_recovery::recover_subtitler_audio,enable_managed_close,cancel_managed_close,finish_managed_close,write_export_file,copy_project_workspace,manage_cleanup_media,save_project_backup,inspect_project_backups,show_project_backups,pick_project_backup,pick_project_directory,probe_project_folder,update_file_menu,
            folder_rename::rename_project_folders,media_organization::retire_storyboard_output,media_organization::snapshot_project_media,media_organization::organize_project_media,media_organization::resolve_storyboard_collision,cleanup_files::scan_project_cleanup, cleanup_files::prepare_mono_audio, cleanup_files::inspect_cleanup_media,cleanup_files::pick_cleanup_media,cleanup_files::search_missing_cleanup,cleanup_files::sync_cleanup_catalog,cleanup_files::reveal_cleanup_file,cleanup_files::read_dropped_document,cleanup_files::create_cleanup_hold_frame,
            pick_export_directory,
            studio_link::sync_studio_link,
            subtitler_handoff::open_subtitler,
            studio_link::inspect_studio_link,
            studio_link::write_project_output,
            studio_link::pick_project_audio, studio_link::inspect_linked_audio,
            studio_link::pick_timing_audio,
            studio_link::reserve_project_timeline,
            studio_link::write_linked_timeline,
            pick_asset_directory,
            scan_asset_directory,
            read_asset_image,
            pick_image_index,
            pick_image_export_directory,
            inspect_image_index_files
        ])
        .build(tauri::generate_context!())
        .expect("error while starting Storyboard Studio")
        .run(|app,event|{
            if let tauri::RunEvent::ExitRequested{api,code,..}=event {
                let state=app.state::<CloseState>();
                // Route ordinary Quit requests through the same save as the red close button.
                // finish_managed_close explicitly releases this guard after saving.
                if (code.is_none()||code==Some(0))&&state.ready.load(Ordering::SeqCst)&&!state.allow_exit.load(Ordering::SeqCst){
                    api.prevent_exit();
                    if !state.closing.swap(true,Ordering::SeqCst){
                        if app.emit("studio-close-requested",()).is_err(){state.closing.store(false,Ordering::SeqCst);}
                    }
                }
            }
        });
}
