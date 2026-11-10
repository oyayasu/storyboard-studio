#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo 'Run this builder on your Apple Silicon Mac.'; exit 1; }
app_source="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$app_source"
if [[ -f "$HOME/.cargo/env" ]]; then source "$HOME/.cargo/env"; fi
echo 'Checking Storyboard Studio 0.12.0 native commands…'
cargo check --locked --manifest-path src-tauri/Cargo.toml
bash scripts/generate_macos_icon.sh
cargo tauri build --config src-tauri/tauri.macos.conf.json --bundles app,dmg
built_app="$app_source/src-tauri/target/release/bundle/macos/Storyboard Studio Next.app"
app_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$built_app/Contents/Info.plist")"
[[ "$app_version" == 0.12.0 ]] || { echo 'The built version is unexpected. Installation stopped.'; exit 1; }
installed_app='/Applications/Storyboard Studio Next.app'
backup_parent="$HOME/Library/Application Support/Storyboard Studio/App backups"
mkdir -p "$backup_parent"
previous_app="$backup_parent/Storyboard Studio Next-$(date +%Y%m%d-%H%M%S).app"
need_admin=false
if [[ ! -w /Applications ]] || { [[ -e "$installed_app" ]] && [[ ! -w "$installed_app" ]]; }; then need_admin=true; fi
install_run(){ if "$need_admin"; then sudo "$@"; else "$@"; fi; }
if [[ -e "$installed_app" ]]; then install_run mv "$installed_app" "$previous_app"; fi
if ! install_run ditto "$built_app" "$installed_app"; then
  install_run rm -rf "$installed_app"
  if [[ -e "$previous_app" ]]; then install_run mv "$previous_app" "$installed_app"; fi
  echo 'Installation failed; the previous app has been restored.'
  exit 1
fi
open -n "$installed_app"
printf '\nInstalled and opened Storyboard Studio 0.12.0. Existing project/storage identity is preserved.\n'
