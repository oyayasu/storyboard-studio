use std::{fs, io::Read, path::{Component, Path, PathBuf}, time::UNIX_EPOCH};

pub struct IndexSource { pub directory: String, pub filename: String, pub text: String }
pub struct FileInspection { pub path: String, pub state: &'static str, pub size: Option<u64>, pub modified: Option<u64> }

pub fn read_index(path: &Path) -> Result<IndexSource, String> {
    let path=path.canonicalize().map_err(|e| format!("Cannot locate image index: {e}"))?;
    if path.extension().and_then(|x|x.to_str()).unwrap_or("").to_lowercase()!="json" { return Err("Choose a FolderExporter JSON image index".into()); }
    let mut text=String::new();
    fs::File::open(&path).map_err(|e|e.to_string())?.take(16*1024*1024+1).read_to_string(&mut text).map_err(|e|format!("Cannot read image index: {e}"))?;
    if text.len()>16*1024*1024 { return Err("The image index exceeds 16 MB".into()); }
    Ok(IndexSource {directory:path.parent().ok_or("Index has no folder")?.to_string_lossy().into_owned(),filename:path.file_name().ok_or("Index has no filename")?.to_string_lossy().into_owned(),text})
}

pub fn resolve_image(root: &Path, relative: &str) -> Result<PathBuf,String> {
    if relative.is_empty() || relative.len()>4096 || relative.contains('\\') || relative.contains(':') || relative.chars().any(|c|c.is_control()) || relative.split('/').any(|p|p.is_empty()||p=="."||p=="..") { return Err("Invalid image location".into()); }
    let relative=Path::new(relative);
    if relative.components().any(|c|!matches!(c,Component::Normal(_))) { return Err("Image location must be relative".into()); }
    let ext=relative.extension().and_then(|x|x.to_str()).unwrap_or("").to_lowercase();
    if !["png","jpg","jpeg","webp","gif","bmp","tif","tiff","mov","mp4","m4v","webm"].contains(&ext.as_str()) { return Err("Unsupported image type".into()); }
    let path=root.join(relative).canonicalize().map_err(|e|format!("Image is missing: {e}"))?;
    if !path.starts_with(root) { return Err("Image is outside the export folder".into()); }
    if !path.is_file() { return Err("Image is not a file".into()); }
    Ok(path)
}

pub fn inspect_images(directory: &Path, relatives: &[String]) -> Result<Vec<FileInspection>,String> {
    if relatives.len()>4096 { return Err("Check at most 4096 images at a time".into()); }
    let root=directory.canonicalize().map_err(|e|format!("Export folder is missing: {e}"))?;
    if !root.is_dir() { return Err("Choose an export folder".into()); }
    Ok(relatives.iter().map(|relative| {
        let metadata=resolve_image(&root,relative).and_then(|p|fs::metadata(p).map_err(|e|e.to_string()));
        match metadata {
            Ok(m)=>FileInspection {path:relative.clone(),state:if m.len()>50*1024*1024 && !["mov","mp4","m4v","webm"].contains(&Path::new(relative).extension().and_then(|s|s.to_str()).unwrap_or("").to_lowercase().as_str()) {"too-large"} else {"ok"},size:Some(m.len()),modified:m.modified().ok().and_then(|t|t.duration_since(UNIX_EPOCH).ok()).map(|d|d.as_millis() as u64)},
            Err(_)=>FileInspection {path:relative.clone(),state:"missing",size:None,modified:None}
        }
    }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp()->PathBuf { let p=std::env::temp_dir().join(format!("ss-image-index-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));fs::create_dir_all(&p).unwrap();p.canonicalize().unwrap() }
    #[test] fn metadata_and_missing_files() {let root=temp();fs::write(root.join("a.png"),b"test").unwrap();let results=inspect_images(&root,&["a.png".into(),"missing.png".into()]).unwrap();assert_eq!(results[0].state,"ok");assert_eq!(results[0].size,Some(4));assert_eq!(results[1].state,"missing");fs::remove_dir_all(root).unwrap();}
    #[test] fn reject_escape_and_invalid_types() {let root=temp();for name in ["../secret.png","/secret.png","C:/a.png","folder\\a.png","a/./b.png","a//b.png","a.json"] {assert!(resolve_image(&root,name).is_err(),"{}",name);}fs::remove_dir_all(root).unwrap();}
    #[test] fn read_index_next_to_images() {let root=temp();fs::write(root.join("index.json"),b"{}").unwrap();let source=read_index(&root.join("index.json")).unwrap();assert_eq!(source.directory,root.to_string_lossy());assert_eq!(source.text,"{}");fs::remove_dir_all(root).unwrap();}
    #[cfg(unix)]
    #[test] fn symlinked_root_and_external_image() {use std::os::unix::fs::symlink;let base=temp();let root=base.join("export");fs::create_dir(&root).unwrap();fs::write(root.join("ok.png"),b"ok").unwrap();fs::write(base.join("outside.png"),b"private").unwrap();symlink(&root,base.join("alias")).unwrap();symlink(base.join("outside.png"),root.join("escape.png")).unwrap();let result=inspect_images(&base.join("alias"),&["ok.png".into(),"escape.png".into()]).unwrap();assert_eq!(result[0].state,"ok");assert_eq!(result[1].state,"missing");fs::remove_dir_all(base).unwrap();}
}
