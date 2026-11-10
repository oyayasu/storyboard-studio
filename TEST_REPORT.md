# Storyboard Studio Next 0.12.0 validation

- 146 JavaScript/model/integration tests passed, zero skips. STUDIO_TEST_NATIVE enabled the production Rust bridge, including the full filesystem lifecycle and seven-card legacy upgrade scenarios.
- 42 compiled production Rust filesystem tests passed: ownership, swaps, rollback, PNG working-copy dimensions, accepting edited artwork/current recovery retirement, shared-file Trash protection/failure, backup read-only health, whole-folder rename/collision/interruption and inactive duplicate consolidation/recovery.
- Locked Apple Silicon Rust type-check passed using the supplied Cargo.lock and macOS target.
- Current workflow browser suite passed: tag appearance, alpha/dimensions, archive lasso/Trash/Undo isolation, Not Assigned restoration/drag, XML options, expanded player, external audio handoff, missing-audio relocation and root reconnection.
- Existing supervisor/family/review browser suite and original-update/editor-export browser regression passed after adapting expected restore behavior.
- Production JavaScript parses; Mac builder shell syntax/configuration/assets/identity/version checks pass.

Reproduction: `python3 scripts/build_test_bridge.py /tmp/studio-bridge`, then run `STUDIO_TEST_NATIVE=<printed-binary-path> node --test scripts/*.test.mjs`. Also `python3 scripts/test_native_files.py` and the documented browser scripts with PLAYWRIGHT_MODULE/TEST_BROWSER_PATH.

Limits: Native macOS app linking/installation, Finder/Trash dialogs, actual audio hardware, Resolve/Premiere imports and real WhisperX model jobs were not executed here. Target type-checking used a Linux-hosted Apple Silicon toolchain. FolderExporter was not changed. Original user projects/media/transcripts were not modified.
