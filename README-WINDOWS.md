# Windows 10 x64 release

This is the original application with the same interface, project formats, and features. It is not a Windows rewrite. Windows-specific changes are limited to packaging and OS integration.

- Windows 10 version 1903 or newer, 64-bit (WebView2 runtime; installer bootstraps it when missing).
- Run `build_windows.ps1` in PowerShell after installing Node.js 20+, Rust MSVC and Microsoft C++ Build Tools, or use the GitHub Actions workflow.
- The NSIS setup `.exe` is generated under `src-tauri/target/release/bundle/nsis/`.
- Existing audio and image formats and shared project directories are preserved.
- Subtitler can be launched from this app when both applications are installed. Subtitler is a separate installation.
- The app does not include FFmpeg. Video export features that require it use an existing installation.
