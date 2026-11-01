/*
 * Personal dua audio: files the user adds or records on their own device.
 * Stored in IndexedDB on this device only. Nothing is uploaded or shipped with the app.
 *   files: { id, name, type, blob, added }
 *   clips: { dua, file, start, end }   (seconds; end null = to the end of the file)
 */
(function (root) {
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('sakina-audio', 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          d.createObjectStore('files', { keyPath: 'id' });
          d.createObjectStore('clips', { keyPath: 'dua' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Storage was refused'));
    });
  }

  const urls = {};
  const MyAudio = {
    async addFile(blob, name) {
      const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await tx('files', 'readwrite', (s) => s.put({ id, name: name || 'Recording', type: blob.type, blob, added: Date.now() }));
      return id;
    },
    files() { return tx('files', 'readonly', (s) => s.getAll()); },
    getFile(id) { return tx('files', 'readonly', (s) => s.get(id)); },
    async fileUrl(id) {
      if (urls[id]) return urls[id];
      const f = await MyAudio.getFile(id);
      if (!f) return null;
      urls[id] = URL.createObjectURL(f.blob);
      return urls[id];
    },
    getClip(dua) { return tx('clips', 'readonly', (s) => s.get(dua)); },
    clips() { return tx('clips', 'readonly', (s) => s.getAll()); },
    setClip(dua, file, start = 0, end = null) { return tx('clips', 'readwrite', (s) => s.put({ dua, file, start, end })); },
    async removeClip(dua) {
      const c = await MyAudio.getClip(dua);
      await tx('clips', 'readwrite', (s) => s.delete(dua));
      if (!c) return;
      // delete the file too if no other dua uses it
      const still = (await MyAudio.clips()).some((x) => x.file === c.file);
      if (!still) {
        await tx('files', 'readwrite', (s) => s.delete(c.file));
        if (urls[c.file]) { URL.revokeObjectURL(urls[c.file]); delete urls[c.file]; }
      }
    },
  };

  const pad = (n) => String(n).padStart(2, '0');
  MyAudio.fmt = (t) => (t == null || isNaN(t) ? '' : `${Math.floor(t / 60)}:${pad(Math.floor(t % 60))}${t % 1 >= 0.05 ? '.' + Math.round((t % 1) * 10) : ''}`);
  MyAudio.parse = (s) => {
    s = String(s || '').trim();
    if (!s) return null;
    const m = s.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
    return m ? (Number(m[1] || 0) * 60 + Number(m[2])) : NaN;
  };

  root.MyAudio = MyAudio;
})(window);
