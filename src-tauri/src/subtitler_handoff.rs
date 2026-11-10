use std::{fs,path::PathBuf,process::Command};
use serde_json::json;
fn request_path()->PathBuf{if let Some(p)=std::env::var_os("SHARED_WHISPER_CONFIG"){return PathBuf::from(p).with_file_name("studio-request.json")}let home=std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();if cfg!(target_os="macos"){home.join("Library/Application Support/Shared Whisper/studio-request.json")}else if cfg!(windows){std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or(home.join("AppData/Local")).join("Shared Whisper/studio-request.json")}else{home.join(".config/shared-whisper/studio-request.json")}}
// NSIS installs per-user apps under %LOCALAPPDATA%\ProductName by default.
// Windows does not necessarily add installed GUI applications to PATH.
#[cfg(windows)]
fn launch_windows_subtitler() -> Result<(),String> {
 let mut candidates: Vec<PathBuf> = Vec::new();
 if let Some(p)=std::env::var_os("SUBTITLER_EXE") { candidates.push(PathBuf::from(p)); }
 if let Some(dir)=std::env::current_exe().ok().and_then(|p|p.parent().map(PathBuf::from)) {
  candidates.push(dir.join("Subtitler.exe"));
 }
 if let Some(root)=std::env::var_os("LOCALAPPDATA") {
  let root=PathBuf::from(root);
  candidates.push(root.join("Subtitler/Subtitler.exe"));
  candidates.push(root.join("Programs/Subtitler/Subtitler.exe"));
 }
 if let Some(root)=std::env::var_os("ProgramFiles") {
  candidates.push(PathBuf::from(root).join("Subtitler/Subtitler.exe"));
 }
 if let Some(root)=std::env::var_os("ProgramFiles(x86)") {
  candidates.push(PathBuf::from(root).join("Subtitler/Subtitler.exe"));
 }
 for candidate in candidates {
  if candidate.is_file() {
   return Command::new(&candidate).spawn().map(|_|()).map_err(|e|format!("Could not launch {}: {e}",candidate.display()));
  }
 }
 Command::new("Subtitler.exe").spawn().map(|_|()).map_err(|_|"Subtitler was not found. Install its Windows version first, or set SUBTITLER_EXE to the executable path.".to_string())
}

#[tauri::command]
pub async fn open_subtitler(directory:String,project_id:String)->Result<(),String>{tauri::async_runtime::spawn_blocking(move||{
 let root=crate::studio_files::root(&directory)?;let manifest:serde_json::Value=serde_json::from_slice(&fs::read(crate::studio_files::local_file(&root,"Studio Link/project.json")?).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;if manifest["format"]!="studio-link-project-v1"||manifest["project"]["id"]!=project_id{return Err("Reconnect this project's folder before opening Subtitler".into())}
 let path=request_path();let parent=path.parent().ok_or("Shared tools folder unavailable")?;fs::create_dir_all(parent).map_err(|e|e.to_string())?;let request=json!({"format":"studio-subtitler-request-v1","requestId":format!("{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()),"directory":root.to_string_lossy(),"projectId":project_id,"action":"match-timing","activeRecording":manifest["activeRecording"]});crate::studio_files::atomic_json(parent,"studio-request.json",&request.to_string())?;
 #[cfg(target_os="macos")]let result=Command::new("open").args(["-b","local.filipe.whisperdesk"]).status();
 #[cfg(windows)]let result=launch_windows_subtitler();
 #[cfg(all(not(windows),not(target_os="macos")))]let result=Command::new("Subtitler").spawn().map(|_|()).map_err(|e|e.to_string());
 #[cfg(target_os="macos")]if result.map_err(|e|e.to_string())?.success(){return Ok(())}else{return Err("Install the updated Subtitler app in Applications, then try again.".into())}
 #[cfg(not(target_os="macos"))]result.map_err(|e|e.to_string())
 }).await.map_err(|e|e.to_string())?}
