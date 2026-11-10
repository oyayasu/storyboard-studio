# Storyboard Studio — Windows 10

Storyboard Studio: storyboard cards, chapters, Highlighter, timeline and Studio Link workflows.

Original version: **0.12.0**. Technology: Tauri 2 / Rust / JavaScript.

This repository has Windows build automation. The complete source, preserved interface, and project compatibility come from the original source archive, not a rewritten application.

The Windows build workflow is in `.github/workflows/windows-release.yml`. It builds a Windows x64 executable, publishes a downloadable build artifact, and creates a GitHub Release when a `v*` tag is pushed. To build successfully, the complete source files must be present in this repository.

**Status:** Windows build workflow prepared; full application source import and successful Windows build are still pending.
