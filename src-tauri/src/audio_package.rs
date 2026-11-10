//! Portable audio plus append-only, checksummed project checkpoints.
use serde_json::Value;
use std::{fs, io::{Read, Seek, SeekFrom, Write}, path::{Path, PathBuf}};
const MAGIC: &[u8;8] = b"SUBAUD2\n";
const END: &[u8;8] = b"SUBJSON2";
const MAX_JSON:u64=50*1024*1024;
fn err(e:impl std::fmt::Display)->String{e.to_string()}
fn hash(bytes:&[u8])->u64{bytes.iter().fold(14695981039346656037,|h,b|(h ^ *b as u64).wrapping_mul(1099511628211))}
fn copy_hash(input:&mut impl Read,output:&mut impl Write,length:u64)->Result<u64,String>{
 let mut left=length;let mut h=14695981039346656037u64;let mut buf=[0u8;65536];
 while left>0{let n=input.read(&mut buf[..left.min(65536) as usize]).map_err(err)?;if n==0{return Err("Embedded audio is incomplete. The previous project was kept.".into());}output.write_all(&buf[..n]).map_err(err)?;for b in &buf[..n]{h=(h ^ *b as u64).wrapping_mul(1099511628211);}left-=n as u64;}Ok(h)
}
pub struct Document{pub project:Value,pub audio:Value,audio_end:u64}
pub fn read(path:&Path)->Result<Document,String>{
 let mut f=fs::File::open(path).map_err(|_|"Project not found. Use File → Open to select its current location.".to_string())?;let size=f.metadata().map_err(err)?.len();let mut header=[0u8;16];
 if f.read_exact(&mut header).is_err()||&header[..8]!=MAGIC{if size>MAX_JSON{return Err("Legacy project exceeds 50 MB".into());}f.seek(SeekFrom::Start(0)).map_err(err)?;let mut text=String::new();f.read_to_string(&mut text).map_err(err)?;let project=serde_json::from_str(&text).map_err(|e|format!("The project cannot be read: {e}"))?;return Ok(Document{project,audio:Value::Null,audio_end:0});}
 let length=u64::from_le_bytes(header[8..16].try_into().unwrap());let audio_end=16u64.checked_add(length).filter(|n|*n<=size).ok_or("Embedded audio is incomplete")?;let tail_start=audio_end.max(size.saturating_sub(MAX_JSON*2+48));f.seek(SeekFrom::Start(tail_start)).map_err(err)?;let mut tail=Vec::new();f.read_to_end(&mut tail).map_err(err)?;
 for at in (16..tail.len().saturating_sub(7)).rev(){if &tail[at..at+8]!=END{continue;}let len=u64::from_le_bytes(tail[at-16..at-8].try_into().unwrap());if len>MAX_JSON||len>at as u64-16{continue;}let start=at-16-len as usize;let bytes=&tail[start..at-16];if hash(bytes)!=u64::from_le_bytes(tail[at-8..at].try_into().unwrap()){continue;}if let Ok(v)=serde_json::from_slice::<Value>(bytes){if v["format"]=="subtitler-container-v2"&&v["audio"]["length"].as_u64().unwrap_or(0)==length{return Ok(Document{project:v["project"].clone(),audio:v["audio"].clone(),audio_end});}}}
 Err("No complete project checkpoint was found. The file was not changed.".into())
}
fn stamp()->u128{std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()}
// Some removable filesystems (including exFAT) do not implement hard links.
// Exclusive creation retains no-clobber protection on those filesystems.
fn copy_exclusive(source:&Path,destination:&Path)->Result<(),String>{
 let mut out=fs::OpenOptions::new().write(true).create_new(true).open(destination).map_err(err)?;
 let result=(||{let mut input=fs::File::open(source).map_err(err)?;std::io::copy(&mut input,&mut out).map_err(err)?;out.sync_all().map_err(err)})();
 drop(out);if result.is_err(){let _=fs::remove_file(destination);}result
}
pub fn extract(path:&Path,destination:&Path,expected:Option<&str>)->Result<PathBuf,String>{
 let d=read(path)?;if d.audio_end<=16{return Err("This project has no embedded audio. Locate the original recording instead.".into());}if expected.is_some_and(|v|Some(v)!=d.audio["fingerprint"].as_str()){return Err("This Subtitler project contains a different recording.".into());}
 let mut input=fs::File::open(path).map_err(err)?;input.seek(SeekFrom::Start(16)).map_err(err)?;
 if destination.exists(){let digest=copy_hash(&mut fs::File::open(destination).map_err(err)?,&mut std::io::sink(),fs::metadata(destination).map_err(err)?.len())?;if fs::metadata(destination).map_err(err)?.len()==d.audio_end-16&&Some(digest)==d.audio["hash"].as_u64(){return Ok(destination.to_path_buf());}return Err("A different file already uses this audio location. Choose another destination.".into());}
 let temp=destination.with_extension(format!("audio-recovering-{}",stamp()));let result=(||{let mut out=fs::OpenOptions::new().create_new(true).write(true).open(&temp).map_err(err)?;let digest=copy_hash(&mut input,&mut out,d.audio_end-16)?;if Some(digest)!=d.audio["hash"].as_u64(){return Err("Embedded audio is damaged. Locate the original recording instead.".into());}out.sync_all().map_err(err)?;drop(out);if fs::hard_link(&temp,destination).is_err(){copy_exclusive(&temp,destination)?;}fs::remove_file(&temp).map_err(err)?;Ok(destination.to_path_buf())})();if result.is_err(){let _=fs::remove_file(&temp);}result
}

#[cfg(test)]mod install_tests{use super::*;
 #[test]fn exclusive_copy_fallback_preserves_an_existing_destination(){let root=std::env::temp_dir().join(format!("sub-audio-install-{}-{}",std::process::id(),stamp()));fs::create_dir_all(&root).unwrap();let source=root.join("source");let dest=root.join("dest");fs::write(&source,b"audio").unwrap();copy_exclusive(&source,&dest).unwrap();fs::write(&source,b"changed").unwrap();assert!(copy_exclusive(&source,&dest).is_err());assert_eq!(fs::read(dest).unwrap(),b"audio");fs::remove_dir_all(root).unwrap();}
}
