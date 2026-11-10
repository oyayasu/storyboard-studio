(() => {
  const DB_NAME = "storyboard-studio-v01";
  const DB_VERSION = 2;
  const ASSET_STORE = "assets";
  const THUMB_STORE = "browser-thumbnails";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ASSET_STORE))
          db.createObjectStore(ASSET_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(THUMB_STORE))
          db.createObjectStore(THUMB_STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function putIn(store, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve(value?.id);
      tx.onerror = () => reject(tx.error);
    });
  }
  async function getFrom(store, id) {
    if (!id) return null;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, "readonly").objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  async function deleteFrom(store, id) {
    if (!id) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  const putAsset = (asset) => putIn(ASSET_STORE, asset);
  const getAsset = (id) => getFrom(ASSET_STORE, id);
  async function deleteAsset(id) {
    await Promise.allSettled([
      deleteFrom(ASSET_STORE, id),
      deleteFrom(THUMB_STORE, id),
    ]);
  }
  const putThumbnail = (id, dataUrl) => putIn(THUMB_STORE, { id, dataUrl });
  const getThumbnail = (id) => getFrom(THUMB_STORE, id);
  const deleteThumbnail = (id) => deleteFrom(THUMB_STORE, id);

  async function listAssets(ids) {
    const out = [];
    for (const id of ids) {
      const item = await getAsset(id);
      if (item) out.push(item);
    }
    return out;
  }

  window.SSDB = {
    putAsset,
    getAsset,
    deleteAsset,
    listAssets,
    putThumbnail,
    getThumbnail,
    deleteThumbnail,
  };
})();
