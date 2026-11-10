# Storyboard Studio Next 0.12.0

This patch fixes tags, cleanup archive/recovery behavior, acceptance of working-file edits, PNG working copies, folder renaming and Perform transitions. It adds independent XML audio/marker options and an observational supervisor report.

- **PATCH_TESTING.md:** complete patch checklist.
- **WORKFLOW_MANUAL.md:** practical workflow rules and deferred features.
- **AUDIT_REPORT.md / TEST_REPORT.md:** findings, validation and limits.
- **STUDIO_LINK_CONTRACT.md:** shared records and identities.

## Install on Apple Silicon macOS

Quit Storyboard Studio Next, extract the source ZIP and run `bash BUILD_MACOS.sh` in this directory, or use the release's pasteable Terminal command. The builder validates native code before packaging and backs up the previously installed app. It preserves `/Applications/Storyboard Studio Next.app` and the existing separate application identity. No `.command` launcher is required.

The source includes the frontend and pinned Cargo.lock. A Rust/Tauri build environment is required. Run `python3 scripts/check_project.py`, `node --test scripts/*.test.mjs` and `python3 scripts/test_native_files.py` for automated checks. Browser regression scripts support PLAYWRIGHT_MODULE and TEST_BROWSER_PATH.

Actual macOS installation, Finder/Trash behavior, audio hardware and Resolve/Premiere imports require target-platform testing; they are not certified by browser/native filesystem tests.
