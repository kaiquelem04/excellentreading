// Guarda os textos no navegador (IndexedDB).
// "meta": dados leves para listar a biblioteca; "content": o texto em si;
// "highlights": trechos sublinhados (por índice de palavra) de cada texto.

const DB_NAME = 'excellentreading';
const VERSION = 2;

let dbPromise = null;
let memory = null; // fallback se o IndexedDB não estiver disponível (ex.: aba anônima restrita)

function useMemory(err) {
  memory = { meta: new Map(), content: new Map(), highlights: new Map() };
  console.warn('IndexedDB indisponível, usando memória temporária.', err);
  return null;
}

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('content')) db.createObjectStore('content', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('highlights')) {
          db.createObjectStore('highlights', { keyPath: 'id' }).createIndex('docId', 'docId');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Se uma versão mais nova do site abrir em outra aba, libera o banco para ela atualizar.
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      // Outra aba com a versão antiga do site está segurando o banco: espera ela fechar.
      req.onblocked = () => window.dispatchEvent(new CustomEvent('er-db-blocked'));
    }).catch(useMemory);
  }
  return dbPromise;
}

export async function isPersistent() {
  return (await open()) !== null;
}

function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    result = fn(t);
  });
}

function reqValue(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- Textos ----------

export async function listDocs() {
  const db = await open();
  const all = db ? await reqValue(db.transaction('meta').objectStore('meta').getAll()) : [...memory.meta.values()];
  return all.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
}

export async function getMeta(id) {
  const db = await open();
  if (!db) return memory.meta.get(id) || null;
  return (await reqValue(db.transaction('meta').objectStore('meta').get(id))) || null;
}

export async function getContent(id) {
  const db = await open();
  if (!db) return memory.content.get(id) || null;
  return (await reqValue(db.transaction('content').objectStore('content').get(id))) || null;
}

export async function addDoc(meta, blocks) {
  const db = await open();
  if (!db) {
    memory.meta.set(meta.id, meta);
    memory.content.set(meta.id, { id: meta.id, blocks });
    return;
  }
  await tx(db, ['meta', 'content'], 'readwrite', (t) => {
    t.objectStore('meta').put(meta);
    t.objectStore('content').put({ id: meta.id, blocks });
  });
}

export async function updateMeta(id, patch) {
  const db = await open();
  if (!db) {
    const m = memory.meta.get(id);
    if (m) Object.assign(m, patch);
    return;
  }
  await tx(db, ['meta'], 'readwrite', (t) => {
    const store = t.objectStore('meta');
    const r = store.get(id);
    r.onsuccess = () => {
      if (r.result) store.put({ ...r.result, ...patch });
    };
  });
}

export async function deleteDoc(id) {
  const db = await open();
  if (!db) {
    memory.meta.delete(id);
    memory.content.delete(id);
    for (const [hid, h] of memory.highlights) if (h.docId === id) memory.highlights.delete(hid);
    return;
  }
  await tx(db, ['meta', 'content', 'highlights'], 'readwrite', (t) => {
    t.objectStore('meta').delete(id);
    t.objectStore('content').delete(id);
    const store = t.objectStore('highlights');
    const cur = store.index('docId').openKeyCursor(IDBKeyRange.only(id));
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) {
        store.delete(c.primaryKey);
        c.continue();
      }
    };
  });
}

// ---------- Sublinhados ----------

export async function listHighlights(docId) {
  const db = await open();
  const all = db
    ? await reqValue(db.transaction('highlights').objectStore('highlights').index('docId').getAll(IDBKeyRange.only(docId)))
    : [...memory.highlights.values()].filter((h) => h.docId === docId);
  return all.sort((a, b) => a.start - b.start);
}

// Grava um sublinhado e apaga, na mesma operação, os que foram fundidos nele.
export async function saveHighlight(h, removeIds = []) {
  const db = await open();
  if (!db) {
    for (const id of removeIds) memory.highlights.delete(id);
    memory.highlights.set(h.id, h);
    return;
  }
  await tx(db, ['highlights'], 'readwrite', (t) => {
    const store = t.objectStore('highlights');
    for (const id of removeIds) store.delete(id);
    store.put(h);
  });
}

export async function deleteHighlight(id) {
  const db = await open();
  if (!db) {
    memory.highlights.delete(id);
    return;
  }
  await tx(db, ['highlights'], 'readwrite', (t) => t.objectStore('highlights').delete(id));
}

// Quantos sublinhados cada texto tem (sem carregar os textos dos trechos).
export async function highlightCounts() {
  const counts = new Map();
  const db = await open();
  if (!db) {
    for (const h of memory.highlights.values()) counts.set(h.docId, (counts.get(h.docId) || 0) + 1);
    return counts;
  }
  await tx(db, ['highlights'], 'readonly', (t) => {
    const cur = t.objectStore('highlights').index('docId').openKeyCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) {
        counts.set(c.key, (counts.get(c.key) || 0) + 1);
        c.continue();
      }
    };
  });
  return counts;
}

export function newId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
