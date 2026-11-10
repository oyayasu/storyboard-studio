//! Project-root exports. Original media are never renamed or overwritten.
use std::{fs,io::Write,path::{Path,PathBuf,Component},time::UNIX_EPOCH};
pub fn relative(value:&str)->Result<PathBuf,String>{if value.is_empty()||value.len()>4096||value.contains('\\')||value.contains(':')||value.chars().any(|c|c.is_control())||value.split('/').any(|p|p.is_empty()||p=="."||p=="..")||Path::new(value).components().any(|c|!matches!(c,Component::Normal(_))){return Err("Use a location inside the project folder".into())}Ok(PathBuf::from(value))}
pub fn root(directory:&str)->Result<PathBuf,String>{let p=Path::new(directory).canonicalize().map_err(|_|"Project folder is missing. Select its new location.".to_string())?;let p=if p.file_name().and_then(|s|s.to_str())==Some("Studio Link"){p.parent().ok_or("Choose the main project folder")?.to_path_buf()}else{p};if !p.is_dir(){return Err("Choose the main project folder".into())}Ok(p)}
pub fn subdir(root:&Path,value:&str)->Result<PathBuf,String>{let rel=relative(value)?;let mut path=root.to_path_buf();for part in rel.components(){path.push(part.as_os_str());if !path.exists(){fs::create_dir(&path).map_err(|e|e.to_string())?;}let actual=path.canonicalize().map_err(|e|e.to_string())?;if !actual.starts_with(root)||!actual.is_dir(){return Err("A project folder points outside the project".into())}}Ok(path)}
pub fn local_file(root:&Path,value:&str)->Result<PathBuf,String>{let p=root.join(relative(value)?).canonicalize().map_err(|_|format!("File is missing: {value}"))?;if !p.starts_with(root)||!p.is_file(){return Err("File is outside this project".into())}Ok(p)}
pub fn atomic_json(root:&Path,name:&str,data:&str)->Result<(),String>{let existing=root.join(relative(name)?);if let Ok(old)=fs::read_to_string(&existing){if old==data{return Ok(())}if let(Ok(mut a),Ok(mut b))=(serde_json::from_str::<serde_json::Value>(&old),serde_json::from_str::<serde_json::Value>(data)){for v in [&mut a,&mut b]{if let Some(o)=v.as_object_mut(){o.remove("updatedAt");o.remove("exportedAt");}}if a==b{return Ok(())}}}let rel=relative(name)?;let path=root.join(rel);let temp=root.join(format!(".{}.{}-{}.tmp",name,std::process::id(),std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()));let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e|e.to_string())?;if let Err(e)=file.write_all(data.as_bytes()).and_then(|_|file.sync_all()){let _=fs::remove_file(&temp);return Err(e.to_string())}drop(file);
 if let Err(e)=replace_file(&temp,&path){let _=fs::remove_file(&temp);return Err(e)}Ok(())}
pub fn replace_file(from:&Path,to:&Path)->Result<(),String>{
 #[cfg(windows)]{
 use std::os::windows::ffi::OsStrExt;
 #[link(name="kernel32")]extern "system"{fn MoveFileExW(from:*const u16,to:*const u16,flags:u32)->i32;}
 let a:Vec<u16>=from.as_os_str().encode_wide().chain(std::iter::once(0)).collect();let b:Vec<u16>=to.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
 // Both buffers are NUL-terminated and remain alive for this synchronous call.
 if unsafe{MoveFileExW(a.as_ptr(),b.as_ptr(),1|8)}==0{return Err(std::io::Error::last_os_error().to_string())}Ok(())
 }
 #[cfg(not(windows))]{fs::rename(from,to).map_err(|e|e.to_string())}
}

pub fn metadata(path:&Path)->Result<(u64,u64),String>{let m=fs::metadata(path).map_err(|e|e.to_string())?;if !m.is_file(){return Err("Select a media file".into())}Ok((m.len(),m.modified().ok().and_then(|t|t.duration_since(UNIX_EPOCH).ok()).map(|d|d.as_millis()as u64).unwrap_or(0)))}
#[cfg(test)]mod tests{use super::*;fn temp()->PathBuf{let r=std::env::temp_dir().join(format!("ss-studio-{}",std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));fs::create_dir(&r).unwrap();r.canonicalize().unwrap()}
#[test]fn nested_chapters_and_output_paths(){let r=temp();let dir=subdir(&r,"1 - Intro/Subchapter").unwrap();assert!(dir.is_dir());assert!(relative("1 - Intro/001.png").is_ok());assert!(relative("../bad.png").is_err());fs::remove_dir_all(r).unwrap();}
#[test]fn metadata_updates_are_owned_and_root_can_be_relocated(){let r=temp();let link=subdir(&r,"Studio Link").unwrap();atomic_json(&link,"project.json","first").unwrap();atomic_json(&link,"project.json","second").unwrap();assert_eq!(fs::read_to_string(link.join("project.json")).unwrap(),"second");assert_eq!(root(link.to_str().unwrap()).unwrap(),r);assert!(local_file(&r,"../outside").is_err());fs::remove_dir_all(r).unwrap();}
#[cfg(unix)]#[test]fn reject_external_symlink_directory(){let r=temp();std::os::unix::fs::symlink(std::env::temp_dir(),r.join("escape")).unwrap();assert!(subdir(&r,"escape/nested").is_err());fs::remove_dir_all(r).unwrap();}
}
