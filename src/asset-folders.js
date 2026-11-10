const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function usedAssetReferences(project, folders = []) {
  const out = new Map();
  const everyone = ["stories", "unassigned", "lost", "archived"].flatMap(
    (key) => project[key] || [],
  );
  for (const card of project.stories || []) {
    if (
      card.blank ||
      project.chapters?.find((ch) => ch.id === card.chapterId)?.unused
    )
      continue;
    const source = card.reuseOf
      ? everyone.find((c) => c.id === card.reuseOf) || card
      : card;
    const variants = source.variants || [],
      variant =
        variants[
          Math.max(0, Math.min(card.activeVariant || 0, variants.length - 1))
        ];
    if (!variant?.sourceFile) continue;
    const ref = variant.sourceFile,
      folder = folders.find((f) => f.id === ref.folderId);
    out.set(variant.assetId, {
      assetId: variant.assetId,
      folderId: ref.folderId,
      relativePath: ref.relativePath,
      folderPath: folder?.path || ref.folderPath || null,
      missing:
        folder?.status === "missing" ||
        !!folder?.missing?.includes(ref.relativePath),
    });
  }
  return [...out.values()];
}
export function createAssetFolders(host) {
  const invoke = (command, args) =>
    window.__TAURI__?.core?.invoke(command, args);
  const folders = () => (host.store.state.assetFolders ||= []);
  let busy = false;
  function html() {
    return `<div class="asset-folder-tools"><button data-act="asset-link-folder" ${busy ? "disabled" : ""}>Link folder</button><button data-act="asset-check-folders" ${busy ? "disabled" : ""}>Check links</button></div><div class="asset-folder-list">${folders()
      .map(
        (f) =>
          `<div class="asset-folder-row"><span title="${esc(f.path)}">${esc(f.name)}${f.status === "missing" ? " · Folder missing" : f.missing?.length ? ` · ${f.missing.length} file(s) missing` : ""}</span><button data-act="asset-relink-folder" data-folder-id="${esc(f.id)}">Relink folder</button></div>`,
      )
      .join("")}</div>`;
  }
  async function scan(path) {
    return invoke("scan_asset_directory", { directory: path });
  }
  async function link() {
    if (!window.__TAURI__?.core?.invoke) {
      host.notify(
        "Folder links are available in the desktop app. Browser previews can import image copies.",
      );
      return;
    }
    const path = await invoke("pick_asset_directory");
    if (!path) return;
    if (folders().some((f) => f.path === path)) {
      host.notify(
        "That folder is already linked. Use Check links to inspect it.",
      );
      return;
    }
    busy = true;
    host.render();
    try {
      const entries = await scan(path),
        folder = {
          id: crypto.randomUUID(),
          name: path.split(/[\\/]/).filter(Boolean).at(-1),
          path,
          status: "ok",
          missing: [],
        },
        cards = [];
      if (!entries.length) {
        host.notify("No supported images were found in that folder.");
        return;
      }
      for (const relativePath of entries) {
        const dataUrl = await invoke("read_asset_image", {
          directory: path,
          relativePath,
        });
        const blob = await (await fetch(dataUrl)).blob(),
          file = new File([blob], relativePath.split("/").at(-1), {
            type: blob.type,
          });
        const imported = await SSImporter.importImageFile(file, "16:9", {
            forceSingleImage: true,
          }),
          c = host.card(null, imported.assetId);
        c.variants[0].sourceFile = {
          folderId: folder.id,
          folderPath: path,
          relativePath,
        };
        cards.push(c);
      }
      host.change("Link reusable asset folder", (s) => {
        s.assetFolders ||= [];
        s.assetFolders.push(folder);
        s.globalAssets.push(...cards);
      });
      host.notify(`Linked ${cards.length} reusable images`);
    } finally {
      busy = false;
      host.render();
    }
  }
  async function check(silent = false) {
    const previous = JSON.stringify(
      folders().map((f) => [f.id, f.status, f.missing]),
    );
    if (!window.__TAURI__?.core?.invoke) {
      host.notify("Open the desktop app to check original asset folders.");
      return;
    }
    for (const folder of folders()) {
      try {
        const entries = new Set(await scan(folder.path));
        folder.status = "ok";
        const refs = host.store.state.globalAssets
          .flatMap((c) => c.variants || [])
          .map((v) => v.sourceFile)
          .filter((r) => r?.folderId === folder.id);
        for (const project of host.store.state.projects)
          for (const card of project.stories)
            for (const v of card.variants || [])
              if (v.sourceFile?.folderId === folder.id) refs.push(v.sourceFile);
        folder.missing = [
          ...new Set(
            refs
              .map((r) => r.relativePath)
              .filter((path) => !entries.has(path)),
          ),
        ];
      } catch {
        folder.status = "missing";
      }
    }
    host.store.save();
    host.render();
    if (
      folders().some((f) => f.status === "missing" || f.missing?.length) &&
      (!silent ||
        previous !==
          JSON.stringify(folders().map((f) => [f.id, f.status, f.missing])))
    )
      host.notify(
        "Some original assets are missing. Cached previews remain available; use Relink folder.",
      );
    else if (!silent) host.notify("Asset folder links are connected");
  }
  async function relink(id) {
    if (!window.__TAURI__?.core?.invoke) {
      host.notify("Relink folders in the desktop app.");
      return;
    }
    const folder = folders().find((f) => f.id === id);
    if (!folder) return;
    const path = await invoke("pick_asset_directory");
    if (!path) return;
    const entries = new Set(await scan(path));
    host.change("Relink reusable asset folder", () => {
      folder.path = path;
      folder.name = path.split(/[\\/]/).filter(Boolean).at(-1);
      folder.status = "ok";
      const everyone = [
        ...host.store.state.globalAssets,
        ...host.store.state.projects.flatMap((p) =>
          ["stories", "unassigned", "lost", "archived"].flatMap(
            (key) => p[key] || [],
          ),
        ),
      ];
      const refs = everyone
        .flatMap((c) => c.variants || [])
        .map((v) => v.sourceFile)
        .filter((r) => r?.folderId === id);
      for (const ref of refs) ref.folderPath = path;
      folder.missing = [
        ...new Set(
          refs
            .filter((r) => !entries.has(r.relativePath))
            .map((r) => r.relativePath),
        ),
      ];
    });
    host.notify(
      folder.missing.length
        ? "Folder relinked; some filenames still need restoring."
        : "Folder relinked",
    );
  }
  return { html, link, check, relink };
}
