import { assemblyHtml } from "./image-assembly-view.js";
import {
  parseImageIndex,
  ensureAssembly,
  addImageBatch,
  resolveCardImages,
  removeImageBatch,
} from "./image-assembly-model.js";

const MAX_BYTES = 50 * 1024 * 1024;
const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
const native = () => !!window.__TAURI__?.core?.invoke;
async function previewAsset(data, name) {
  const url = typeof data === "string" ? data : URL.createObjectURL(data);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(Error("Preview unavailable"));
      image.src = url;
    });
    const scale = Math.min(
      1,
      1024 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    const asset = {
      id: crypto.randomUUID(),
      name,
      kind: "assembly-preview",
      dataUrl: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
    };
    await window.SSDB.putAsset(asset);
    return asset.id;
  } finally {
    if (typeof data !== "string") URL.revokeObjectURL(url);
  }
}
export function createImageAssembly(host) {
  const ui = {
    cardId: null,



    batchId: null,
    busy: false,
    progress: "",
  };
  const browserFolders = new Map();
  let ticket = 0;
  // Browser file handles cannot survive a restart. Cached previews still do.
  for (const project of host.projects())
    for (const b of project.imageAssembly?.batches || [])
      if (b.sourceMode === "browser") b.sourceStatus = "cached";
  const batch = () =>
    ensureAssembly(host.project()).batches.find((b) => b.id === ui.batchId);
  const update = (fn) => host.cacheUpdate(fn);
  function cancel() {
    ticket++;
    ui.busy = false;
    ui.progress = "";
    host.render();
  }
  async function guarded(fn) {
    try {
      await fn();
    } catch (e) {
      console.error(e);
      host.notify(e.message || "Could not import the images.");
    }
  }
  async function importText(text, name, directory = null) {
    const parsed = parseImageIndex(text, name);
    let added;
    host.commit("Import cleaned image index", () => {
      added = addImageBatch(host.project(), parsed, {
        directory,
        sourceMode: directory ? "native" : "browser",
      });
    });
    ui.batchId = added.id;



    host.render();
    if (directory) await load(added.id, true);
    else
      host.notify(
        "Index imported. Choose its export folder to load image previews.",
      );
  }
  async function chooseIndex() {
    if (native()) {
      const selected = await invoke("pick_image_index");
      if (selected)
        await importText(selected.text, selected.filename, selected.directory);
    } else document.querySelector("[data-assembly-index]")?.click();
  }
  async function chooseFolder() {
    const b = batch();
    if (!b) return;
    if (native()) {
      const directory = await invoke("pick_image_export_directory");
      if (!directory) return;
      host.commit("Relink cleaned image folder", () => {
        const current = batch();
        current.directory = directory;
        current.sourceMode = "native";
        current.sourceStatus = "unchecked";
      });
      await load(b.id, true);
    } else document.querySelector("[data-assembly-folder]")?.click();
  }
  async function browserFolder(files) {
    const b = batch();
    if (!b || !files.length) return;
    // Locate the recorded index, allowing selection of its parent folder too.
    let prefix = null;
    for (const file of files.filter(
      (f) => f.name === b.filename && f.size <= 16 * 1024 * 1024,
    )) {
      try {
        if (JSON.parse(await file.text()).exportId === b.exportId) {
          prefix = (file.webkitRelativePath || file.name).slice(
            0,
            -file.name.length,
          );
          if (b.mediaRoot === "." && prefix.endsWith("Studio Link/"))
            prefix = prefix.slice(0, -"Studio Link/".length);
          break;
        }
      } catch {}
    }
    if (prefix === null)
      throw Error("Choose the export folder containing this image index.");
    const map = new Map(
      files
        .filter((f) => (f.webkitRelativePath || f.name).startsWith(prefix))
        .map((f) => [(f.webkitRelativePath || f.name).slice(prefix.length), f])
        .filter(([path]) => path && !path.startsWith("../")),
    );
    browserFolders.set(b.id, map);
    host.commit("Choose cleaned image folder", () => {
      const current = batch();
      current.directory = null;
      current.sourceMode = "browser";
      current.folderName = prefix.replace(/\/$/, "");
      current.sourceStatus = "unchecked";
    });
    await load(b.id, true);
  }
  async function load(batchId, refresh = false, quiet = false) {
    if (ui.busy) return;
    const projectId = host.project()?.id,
      b = ensureAssembly(host.project()).batches.find((x) => x.id === batchId);
    if (!b) return;
    const myTicket = ++ticket,
      root = b.directory,
      mode = b.sourceMode;
    const current = () =>
      ticket === myTicket && host.project()?.id === projectId
        ? host
            .project()
            .imageAssembly?.batches.find(
              (x) =>
                x.id === batchId &&
                x.directory === root &&
                x.sourceMode === mode,
            )
        : null;
    const paths = [
        ...new Set(b.frames.flatMap((f) => f.files.map((x) => x.path))),
      ],
      map = browserFolders.get(batchId);
    if (!root && !map) {
      if (!quiet)
        host.notify("Choose the export folder to reconnect its files.");
      return;
    }
    ui.busy = true;
    ui.progress = "Checking image files…";
    host.render();
    try {
      let stats;
      if (mode === "native" && root)
        stats = await invoke("inspect_image_index_files", {
          directory: root,
          relativePaths: paths,
        });
      else
        stats = paths.map((path) => {
          const f = map?.get(path);
          return {
            path,
            state: !f ? "missing" : f.size > MAX_BYTES ? "too-large" : "ok",
            size: f?.size || 0,
            modified: f?.lastModified || 0,
          };
        });
      if (!current()) return;
      const states = {},
        previews = {};
      for (let i = 0; i < stats.length; i++) {
        if (!current()) return;
        const stat = stats[i],
          previous = current().fileStates[stat.path],
          hasPreview = !!current().previews[stat.path];
        let state = { ...stat };
        delete state.path;
        if (stat.state === "ok") {
          const changed =
            !!previous &&
            previous.size !== undefined &&
            (previous.size !== stat.size ||
              previous.modified !== stat.modified);
          if (!refresh && (changed || previous?.state === "changed"))
            state.state = "changed";
          else if (refresh || !hasPreview) {
            ui.progress = `Loading preview ${i + 1} of ${stats.length}`;
            const el = document.querySelector("[data-assembly-progress]");
            if (el) el.textContent = ui.progress;
            let data;
            try {
              data =
                mode === "native"
                  ? await invoke("read_asset_image", {
                      directory: root,
                      relativePath: stat.path,
                    })
                  : map.get(stat.path);
            } catch {
              state.state = "unreadable";
            }
            if (data)
              try {
                previews[stat.path] = await previewAsset(
                  data,
                  stat.path.split("/").at(-1),
                );
              } catch {
                state.state = "preview-unavailable";
              }
          } else if (previous?.state === "preview-unavailable")
            state.state = "preview-unavailable";
        }
        states[stat.path] = state;
      }
      if (current())
        update(() => {
          const target = current();
          Object.assign(target.fileStates, states);
          Object.assign(target.previews, previews);
          target.sourceStatus = "ok";
          target.checkedAt = new Date().toISOString();
        });
    } catch (e) {
      if (current())
        update(() => {
          current().sourceStatus = "missing";
        });
      if (!quiet)
        host.notify(
          e.message ||
            "The export folder is unavailable. Relink it to reconnect.",
        );
    } finally {
      if (ticket === myTicket) {
        ui.busy = false;
        ui.progress = "";
        host.render();
      }
    }
  }
  async function action(name) {
    if(name==='cleanup')return host.openCleanup(ui.cardId);
    if (name === "cancel") return cancel();
    if (ui.busy) return;
    if (name === "import") return chooseIndex();
    if (name === "relink") return chooseFolder();
    if (name === "check" || name === "refresh") {
      if (!batch()) return;
      return load(batch().id, name === "refresh");
    }
    if (name === "remove") {
      const b = batch();
      if (b) {
        host.commit("Remove cleaned image import", () =>
          removeImageBatch(host.project(), b.id),
        );
        ui.batchId = null;


        host.render();
      }
      return;
    }

  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".assembly-view")) return;
    const el = e.target.closest(
      "[data-assembly-action],[data-assembly-card]",
    );
    if (!el) return;
    if (el.dataset.assemblyAction)
      return void guarded(() => action(el.dataset.assemblyAction));
    if (ui.busy) return;
    if (el.dataset.assemblyCard) {
      ui.cardId = el.dataset.assemblyCard;



    }
    host.render();
  });
  document.addEventListener("change", (e) => {
    if (!e.target.closest(".assembly-view")) return;
    const el = e.target;
    guarded(async () => {
      if (el.matches("[data-assembly-index]")) {
        const f = el.files[0];
        if (f) {
          if (f.size > 16 * 1024 * 1024)
            throw Error("The image index exceeds 16 MB.");
          await importText(await f.text(), f.name);
        }
        return;
      }
      if (el.matches("[data-assembly-folder]"))
        return browserFolder([...el.files]);
      if (ui.busy) return;
      if (el.matches("[data-assembly-manage]")) ui.batchId = el.value;
      if (el.matches("[data-assembly-variant]"))
        host.commit("Choose storyboard variant", () => {
          host.project().stories.find((c) => c.id === ui.cardId).activeVariant =
            +el.value;
        });
      host.render();
    });
  });
  return {
    html: () => assemblyHtml(host, ui),
    cancel,
    importText,
    checkAll: async () => {
      for (const b of ensureAssembly(host.project()).batches)
        if (b.directory && !ui.busy) await load(b.id, false, true);
    },
    check: async (quiet = true) => {
      if (batch() && !ui.busy && native() && batch().directory)
        await load(batch().id, false, quiet);
    },
  };
}
