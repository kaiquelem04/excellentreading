// Guarda os textos no navegador (IndexedDB). "meta" fica leve para listar a biblioteca;
// "content" guarda o texto em si.

const DB_NAME = 'excellentreading';
const VERSION = 1;

let dbPromise = null;
let memory = null; // fallback se o IndexedDB não estiver disponível (ex.: aba anônima restrita)

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
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Banco de dados bloqueado'));
    }).catch((err) => {
      memory = { meta: new Map(), content: new Map() };
      console.warn('IndexedDB indisponível, usando memória temporária.', err);
      return null;
    });
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

export async function listDocs() {
  const db = await open();
  let all;
  if (!db) all = [...memory.meta.values()];
  else all = await reqValue(db.transaction('meta').objectStore('meta').getAll());
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
    return;
  }
  await tx(db, ['meta', 'content'], 'readwrite', (t) => {
    t.objectStore('meta').delete(id);
    t.objectStore('content').delete(id);
  });
}

export function newId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
