import {detachProjectMedia} from './project-copy.js';
import {
  assemblyPreviewAssetIds,
  unlinkImportedAssemblyRoots,
} from "./image-assembly-model.js";
import { usedAssetReferences } from "./asset-folders.js";
import { ensureProject } from "./highlighter-model.js";
import { store, visual } from "./state.js";
const urls = new Map();
async function unpadLegacyAsset(a) {
  if (!a?.dataUrl || !a.originalWidth || !a.originalHeight)
    return a?.dataUrl || "";
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const tw = im.naturalWidth,
        th = im.naturalHeight,
        scale = Math.min(tw / a.originalWidth, th / a.originalHeight);
      const iw = Math.round(a.originalWidth * scale),
        ih = Math.round(a.originalHeight * scale);
      if (iw >= tw - 2 && ih >= th - 2) {
        resolve(a.dataUrl);
        return;
      }
      const c = document.createElement("canvas");
      c.width = iw;
      c.height = ih;
      c.getContext("2d").drawImage(
        im,
        Math.round((tw - iw) / 2),
        Math.round((th - ih) / 2),
        iw,
        ih,
        0,
        0,
        iw,
        ih,
      );
      resolve(c.toDataURL("image/png"));
    };
    im.onerror = () => resolve(a.dataUrl);
    im.src = a.dataUrl;
  });
}
export async function assetUrl(id) {
  if (!id) return "";
  if (urls.has(id)) return urls.get(id);
  const a = await window.SSDB.getAsset(id);
  if (!a) return "";
  const url = await unpadLegacyAsset(a);
  urls.set(id, url);
  return url;
}

export function attachImages(root = document) {
  root.querySelectorAll("img[data-asset]").forEach(async (el) => {
    const id = el.dataset.asset;
    const url = await assetUrl(id);
    if (el.isConnected && el.dataset.asset === id) el.src = url;
  });
}
export async function loadAssets(ids) {
  await Promise.all([...new Set(ids)].map(assetUrl));
}
export async function importImageFiles(files, project, onItems, options = {}) {
  const all = [];
  for (const f of files) {
    const result = await SSImporter.importImageFile(f, project.ratio, {
      forceSingleImage:
        options.forceSingleImage ??
        store.state.settings.autoSplitSheets === false,
    });
    if (result.kind === "sheet")
      all.push(...result.panels.map((x) => x.assetId));
    else all.push(result.assetId);
  }
  await onItems(all);
}
export async function chooseExportDirectory() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return undefined;
  return await invoke("pick_export_directory");
}
export async function saveBlob(blob, name, directory = undefined) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke) {
    const folder =
      directory === undefined
        ? store.project?.studioLink?.directory ||
          (await chooseExportDirectory())
        : directory;
    if (!folder) return false;
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const managed=folder===store.project?.studioLink?.directory;
    await invoke(managed?"write_project_output":"write_export_file", {
      directory: folder,
      relativePath: name,
      base64Data: data,
      projectId: store.project?.id || "standalone",
      ownerKey: "export:" + name,
    });
    return true;
  }
  const a = document.createElement("a"),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}
export async function projectDocument(p) {
  const ids = new Set([
    ...assemblyPreviewAssetIds(p),
    ...(p.videoTiming?.tracks || []).map((t) => t.audioAssetId).filter(Boolean),
  ]);
  for (const s of [...p.stories, ...p.unassigned, ...p.lost, ...p.archived])
    for (const v of s.variants || []) if (v.assetId) ids.add(v.assetId);
  if (p.perform?.audioAssetId) ids.add(p.perform.audioAssetId);
  const assets = await window.SSDB.listAssets([...ids]);
  const payload = {
    format: "storyboardstudio-v01",
    exportedAt: new Date().toISOString(),
    project: structuredClone(p),
    assets,
    assetReferences: usedAssetReferences(p, store.state.assetFolders || []),
  };
  return payload;
}
export async function exportProject(p) {
  const payload=await projectDocument(p);
  await saveBlob(
    new Blob([JSON.stringify(payload)], { type: "application/json" }),
    `${safe(p.name)}.StoryboardStudio`,
    await chooseExportDirectory(),
  );
}
export async function importProject(f) {
  const raw = JSON.parse(await f.text());
  if (
    !["storyboardstudio-v01", "storyboardstudio-highlighter-test-v01"].includes(
      raw.format,
    ) ||
    !raw.project ||
    !Array.isArray(raw.project.chapters)
  )
    throw Error("Invalid Storyboard Studio project file");
  for (const a of raw.assets || []) await window.SSDB.putAsset(a);
  const incoming = raw.project,sourceRoot=incoming.studioLink?.directory;
  incoming.folderId = "root";
  if (incoming.studioLink) incoming.studioLink.directory = null;
  ensureProject(incoming);
  unlinkImportedAssemblyRoots(incoming);

  store.change("Import project", (s) => {
    if (s.projects.some((p) => p.id === incoming.id)) {
      detachProjectMedia(incoming,sourceRoot,{recovery:true});
      incoming.id = crypto.randomUUID();
      incoming.name += " (Imported)";
    }
    s.projects.push(incoming);
    s.assetFolders ||= [];
    for (const ref of raw.assetReferences || []) {
      if (
        ref.folderId &&
        ref.folderPath &&
        !s.assetFolders.some((f) => f.id === ref.folderId)
      )
        s.assetFolders.push({
          id: ref.folderId,
          path: ref.folderPath,
          name: ref.folderPath.split(/[\\/]/).filter(Boolean).at(-1),
          status: "unchecked",
          missing: [],
        });
    }
  });
  return incoming;
}
export const safe = (s) =>
  String(s || "Storyboard")
    .replace(/[^a-z0-9 _-]/gi, "")
    .trim()
    .replace(/\s+/g, "_") || "Storyboard";
export async function drawVisual(canvas, p, s, { blankWhite = true } = {}) {
  const c = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height;
  const v = visual(p, s);
  c.fillStyle = v.blank
    ? "#fff"
    : store.state.settings.letterbox === "white"
      ? "#fff"
      : "#000";
  c.fillRect(0, 0, w, h);
  if (v.blank) {
    if (!blankWhite) {
      c.fillStyle = "#9295a0";
      c.textAlign = "center";
      c.font = `${Math.round(h * 0.04)}px sans-serif`;
      c.fillText("BLANK", w / 2, h / 2);
    }
    return;
  }
  const url = await assetUrl(v.variant.assetId);
  if (!url) return;
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  const scale = Math.min(w / img.width, h / img.height),
    dw = img.width * scale,
    dh = img.height * scale;
  c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
