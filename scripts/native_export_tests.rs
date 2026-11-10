// Appended to the actual lib.rs write_export_file command by test_native_files.py.
#[cfg(test)]
mod standalone_export_tests {
    use super::*;
    use std::path::PathBuf;

    struct Workspace(PathBuf);
    impl Workspace {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "studio-export-command-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn export(&self, path: &str, bytes: &[u8]) -> Result<String, String> {
            write_export_file(self.0.to_string_lossy().into_owned(), path.into(), STANDARD.encode(bytes))
        }
    }
    impl Drop for Workspace {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn standalone_export_creates_nested_output_without_studio_link() {
        let w = Workspace::new();
        let path = w.export("Chapter/cards.png", b"PNG-FIRST").unwrap();
        assert_eq!(fs::read(path).unwrap(), b"PNG-FIRST");
        assert!(!w.0.join("Studio Link").exists());
    }
    #[test]
    fn identical_export_keeps_the_existing_file() {
        let w = Workspace::new();
        let path = w.export("card.png", b"UNCHANGED").unwrap();
        let stamp = fs::metadata(&path).unwrap().modified().unwrap();
        crate::rfd::choose(crate::rfd::MessageDialogResult::Cancel);
        assert_eq!(w.export("card.png", b"UNCHANGED").unwrap(), path);
        assert_eq!(fs::metadata(path).unwrap().modified().unwrap(), stamp);
    }
    #[test]
    fn standalone_export_protects_shared_records_and_traversal() {
        let w = Workspace::new();
        assert!(w.export("Studio Link/project.json", b"BAD").is_err());
        assert!(w.export("../outside.png", b"BAD").is_err());
        assert!(!w.0.join("Studio Link").exists());
    }
    #[test]
    fn standalone_collision_cancel_and_keep_both_preserve_original() {
        let w = Workspace::new();
        w.export("card.png", b"ORIGINAL").unwrap();
        crate::rfd::choose(crate::rfd::MessageDialogResult::Cancel);
        assert!(w.export("card.png", b"NEW").is_err());
        assert_eq!(fs::read(w.0.join("card.png")).unwrap(), b"ORIGINAL");
        crate::rfd::choose(crate::rfd::MessageDialogResult::No);
        let path = w.export("card.png", b"NEW").unwrap();
        assert!(path.ends_with("card_2.png"));
        assert_eq!(fs::read(path).unwrap(), b"NEW");
        assert_eq!(fs::read(w.0.join("card.png")).unwrap(), b"ORIGINAL");
    }
    #[test]
    fn standalone_collision_replace_writes_only_the_chosen_target() {
        let w = Workspace::new();
        w.export("card.png", b"ORIGINAL").unwrap();
        crate::rfd::choose(crate::rfd::MessageDialogResult::Yes);
        let path = w.export("card.png", b"NEW").unwrap();
        assert_eq!(fs::read(path).unwrap(), b"NEW");
        assert_eq!(fs::read_dir(&w.0).unwrap().count(), 1);
    }
}
