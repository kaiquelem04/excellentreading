// Guarda os textos na conta do usuário (Firestore), com cache no aparelho para abrir rápido
// e funcionar sem internet. Estrutura:
//   users/{uid}/docs/{docId}                 dados leves (título, posição, nº de sublinhados…)
//   users/{uid}/docs/{docId}/chunks/{i}      o texto em pedaços (limite de 1 MB por documento)
//   users/{uid}/docs/{docId}/highlights/{id} trechos sublinhados (por índice de palavra)

import {
  doc, collection, getDoc, getDocs, getDocsFromCache, writeBatch, increment,
} from '../vendor/firebase/firebase.js';
import { getDb } from './firebase.js';

let uid = null;
export function setUser(id) { uid = id; }

function need() {
  if (!uid) throw new Error('Nenhum usuário conectado.');
  return getDb();
}
const docsCol = () => collection(need(), 'users', uid, 'docs');
const docRef = (id) => doc(need(), 'users', uid, 'docs', id);
const chunksCol = (id) => collection(need(), 'users', uid, 'docs', id, 'chunks');
const hlCol = (docId) => collection(need(), 'users', uid, 'docs', docId, 'highlights');

const CHUNK_CHARS = 250000;      // ≤ 750 KB mesmo se todo caractere ocupar 3 bytes
const BATCH_MAX_OPS = 400;       // o Firestore aceita até 500 gravações por lote
const BATCH_MAX_CHARS = 6000000; // e ~10 MB por requisição

// Sem internet, o Firestore guarda a gravação e envia depois, mas a promessa só termina quando
// o servidor confirma. Para não travar a tela, esperamos no máximo `ms` e seguimos; se o
// servidor recusar depois, avisamos com o evento 'er-sync-error'.
function settle(promise, ms = 3000) {
  promise.catch((err) => {
    console.error(err);
    window.dispatchEvent(new CustomEvent('er-sync-error', { detail: err }));
  });
  return Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);
}

async function commitAll(ops, { strict = false } = {}) {
  // ops: [{ type: 'set'|'delete'|'update', ref, data }]
  const batches = [];
  let batch = writeBatch(need()), n = 0, chars = 0;
  for (const op of ops) {
    const size = op.type === 'set' ? JSON.stringify(op.data).length : 0;
    if (n >= BATCH_MAX_OPS || (n > 0 && chars + size > BATCH_MAX_CHARS)) {
      batches.push(batch);
      batch = writeBatch(need()); n = 0; chars = 0;
    }
    if (op.type === 'set') batch.set(op.ref, op.data);
    else if (op.type === 'update') batch.update(op.ref, op.data);
    else batch.delete(op.ref);
    n++; chars += size;
  }
  if (n) batches.push(batch);
  const all = (async () => { for (const b of batches) await b.commit(); })();
  return strict ? all : settle(all);
}

export async function isPersistent() { return true; }

// ---------- Textos ----------

export async function listDocs() {
  const snap = await getDocs(docsCol());
  return snap.docs.map((d) => d.data()).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
}

export async function getMeta(id) {
  const s = await getDoc(docRef(id));
  return s.exists() ? s.data() : null;
}

export async function getContent(id) {
  // O texto nunca muda depois de enviado: tenta o cache do aparelho antes de ir à rede.
  let snap = null;
  try { snap = await getDocsFromCache(chunksCol(id)); } catch { snap = null; }
  if (!snap || snap.empty) snap = await getDocs(chunksCol(id));
  if (snap.empty) return null;
  const parts = snap.docs.map((d) => d.data()).sort((a, b) => a.i - b.i);
  return { id, blocks: JSON.parse(parts.map((p) => p.data).join('')) };
}

export async function addDoc(meta, blocks, highlights = [], opts = {}) {
  const json = JSON.stringify(blocks);
  const n = Math.max(1, Math.ceil(json.length / CHUNK_CHARS));
  const ops = [];
  for (let i = 0; i < n; i++) {
    ops.push({ type: 'set', ref: doc(chunksCol(meta.id), String(i)), data: { i, data: json.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) } });
  }
  for (const h of highlights) ops.push({ type: 'set', ref: doc(hlCol(meta.id), h.id), data: h });
  // Os dados do texto vão por último: ele só aparece na biblioteca quando o conteúdo já está lá.
  ops.push({ type: 'set', ref: docRef(meta.id), data: { ...meta, chunks: n, highlightCount: highlights.length } });
  await commitAll(ops, opts);
}

export async function updateMeta(id, patch) {
  await commitAll([{ type: 'update', ref: docRef(id), data: patch }]);
}

export async function deleteDoc(id) {
  const [chunks, hls] = await Promise.all([getDocs(chunksCol(id)), getDocs(hlCol(id))]);
  const ops = [...chunks.docs, ...hls.docs].map((d) => ({ type: 'delete', ref: d.ref }));
  ops.push({ type: 'delete', ref: docRef(id) });
  await commitAll(ops);
}

// ---------- Sublinhados ----------

export async function listHighlights(docId) {
  const snap = await getDocs(hlCol(docId));
  return snap.docs.map((d) => d.data()).sort((a, b) => a.start - b.start);
}

// Grava um sublinhado e apaga, na mesma operação, os que foram fundidos nele.
export async function saveHighlight(h, removeIds = []) {
  const ops = removeIds.map((id) => ({ type: 'delete', ref: doc(hlCol(h.docId), id) }));
  ops.push({ type: 'set', ref: doc(hlCol(h.docId), h.id), data: h });
  ops.push({ type: 'update', ref: docRef(h.docId), data: { highlightCount: increment(1 - removeIds.length) } });
  await commitAll(ops);
}

export async function deleteHighlight(id, docId) {
  await commitAll([
    { type: 'delete', ref: doc(hlCol(docId), id) },
    { type: 'update', ref: docRef(docId), data: { highlightCount: increment(-1) } },
  ]);
}

export function newId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ---------- Biblioteca antiga (antes do login, guardada só no navegador) ----------

const LEGACY_DB = 'excellentreading';

function reqValue(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Lê os textos que estavam salvos só neste navegador. Retorna null se não houver nada.
export function readLegacyLocal() {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(LEGACY_DB); } catch { resolve(null); return; }
    req.onupgradeneeded = (e) => {
      // O banco não existia: cancela para não criar um vazio.
      if (e.oldVersion === 0) req.transaction.abort();
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
    req.onsuccess = async () => {
      const db = req.result;
      try {
        const stores = [...db.objectStoreNames];
        if (!stores.includes('meta') || !stores.includes('content')) { db.close(); resolve(null); return; }
        const t = db.transaction(stores, 'readonly');
        const all = (s) => (stores.includes(s) ? reqValue(t.objectStore(s).getAll()) : Promise.resolve([]));
        const [metas, contents, hls] = await Promise.all([all('meta'), all('content'), all('highlights')]);
        db.close();
        const byId = new Map(contents.map((c) => [c.id, c.blocks]));
        resolve(metas
          .filter((m) => byId.get(m.id))
          .map((m) => ({ meta: m, blocks: byId.get(m.id), highlights: hls.filter((h) => h.docId === m.id) })));
      } catch (err) {
        console.warn('Não consegui ler a biblioteca antiga', err);
        db.close();
        resolve(null);
      }
    };
  });
}

export function deleteLegacyLocal() {
  return new Promise((resolve) => {
    try {
      const q = indexedDB.deleteDatabase(LEGACY_DB);
      q.onsuccess = q.onerror = q.onblocked = () => resolve();
    } catch { resolve(); }
  });
}
