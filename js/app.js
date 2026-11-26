import { parseFile, parsePlain } from './parsers.js';
import * as store from './storage.js';
import { SAMPLE } from './sample.js';
import { watchAuth, initAuthUI, showAuth, hideAuth, logout, currentUser } from './auth.js';

const $ = (id) => document.getElementById(id);
const els = {
  body: document.body,
  welcome: $('welcome'),
  reader: $('reader'),
  text: $('text'),
  dot: $('dot'),
  controls: $('controls'),
  topbar: document.querySelector('.topbar'),
  docTitle: $('docTitle'),
  btnPlay: $('btnPlay'),
  speed: $('speed'),
  speedOut: $('speedOut'),
  progress: $('progress'),
  progressFill: $('progressFill'),
  statPct: $('statPct'),
  statTime: $('statTime'),
  settings: $('settings'),
  btnSettings: $('btnSettings'),
  fontSize: $('fontSize'),
  fontSizeOut: $('fontSizeOut'),
  optNatural: $('optNatural'),
  optHighlight: $('optHighlight'),
  library: $('library'),
  scrim: $('scrim'),
  libraryList: $('libraryList'),
  libraryEmpty: $('libraryEmpty'),
  storageNote: $('storageNote'),
  recent: $('recent'),
  recentList: $('recentList'),
  file: $('file'),
  pasteDialog: $('pasteDialog'),
  pasteTitle: $('pasteTitle'),
  pasteText: $('pasteText'),
  dropOverlay: $('dropOverlay'),
  toast: $('toast'),
  notes: $('notes'),
  notesTab: $('notesTab'),
  notesTabCount: $('notesTabCount'),
  btnNotes: $('btnNotes'),
  notesBtnCount: $('notesBtnCount'),
  notesList: $('notesList'),
  notesCount: $('notesCount'),
  hlbar: $('hlbar'),
  hlAction: $('hlAction'),
  btnAvatar: $('btnAvatar'),
  headerAvatar: $('headerAvatar'),
  accountAvatar: $('accountAvatar'),
  accountName: $('accountName'),
  accountEmail: $('accountEmail'),
  btnLogout: $('btnLogout'),
  hello: $('hello'),
};

// ---------- Ajustes ----------

const WPM_MIN = 50;
const WPM_MAX = 1000;
const DEFAULTS = { wpm: 250, fontSize: 20, font: 'serif', natural: true, highlight: false, theme: 'auto', notesOpen: false };

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) {
  try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sem armazenamento */ }
}

const settings = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(lsGet('er.settings') || '{}') }; } catch { return { ...DEFAULTS }; }
})();
let settingsTimer = 0;
function saveSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => lsSet('er.settings', JSON.stringify(settings)), 300);
}

// ---------- Estado da leitura ----------

const WORDLIKE = /[\p{L}\p{N}]/u;
const SENTENCE_END = /[.!?…]["'”’»)\]]*$/;
const CLAUSE_END = /[,;:—–]["'”’»)\]]*$/;

let doc = null;          // metadados do texto aberto
let words = [];          // <span class="w"> de cada palavra
let tokens = [];         // texto de cada palavra
let blockEnds = new Set();
let weights = new Float64Array(0); // peso de tempo de cada palavra (média = 1)
let prefix = new Float64Array(1);  // somas acumuladas dos pesos
let sentenceStarts = [];
let cur = 0;
let playing = false;
let ended = false;
let nextAt = 0;
let rafId = 0;
let lastSaveAt = 0;
let dotY = null;
let curEl = null;
let wakeLock = null;
let highlights = [];     // sublinhados do texto aberto, em ordem de posição

const baseMs = () => 60000 / settings.wpm;
const delay = (i) => baseMs() * (weights[i] || 1);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtInt = (n) => n.toLocaleString('pt-BR');

// ---------- Renderização do texto ----------

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function countWords(blocks) {
  let n = 0;
  for (const b of blocks) for (const p of b.x.split(/\s+/)) if (p && WORDLIKE.test(p)) n++;
  return n;
}

function render(blocks) {
  let html = '';
  tokens = [];
  const ends = [];
  for (const b of blocks) {
    let tag = 'p';
    let attrs = '';
    if (b.t === 'h') tag = 'h' + Math.min((b.l || 1) + 1, 4);
    else if (b.t === 'q') tag = 'blockquote';
    else if (b.t === 'li') attrs = ' class="li"';
    const before = tokens.length;
    const out = [];
    for (const p of b.x.split(/\s+/)) {
      if (!p) continue;
      if (WORDLIKE.test(p)) {
        out.push('<span class="w">' + esc(p) + '</span>');
        tokens.push(p);
      } else {
        out.push(esc(p)); // pontuação solta: aparece, mas a bolinha não para nela
      }
    }
    if (tokens.length > before) ends.push(tokens.length - 1);
    html += `<${tag}${attrs}>${out.join(' ')}</${tag}>`;
  }
  blockEnds = new Set(ends);
  els.text.classList.toggle('big', tokens.length > 30000);
  els.text.innerHTML = html;
  words = Array.from(els.text.getElementsByClassName('w'));
  curEl = null;
  computeTiming();
}

function computeTiming() {
  const n = tokens.length;
  const w = new Float64Array(n);
  sentenceStarts = n ? [0] : [];
  for (let i = 0; i < n; i++) {
    const t = tokens[i];
    const isBlockEnd = blockEnds.has(i);
    const isSentenceEnd = SENTENCE_END.test(t);
    if ((isBlockEnd || isSentenceEnd) && i + 1 < n) sentenceStarts.push(i + 1);
    if (!settings.natural) { w[i] = 1; continue; }
    const letters = (t.match(/[\p{L}\p{N}]/gu) || []).length;
    let x = letters <= 3 ? 0.8 : letters >= 8 ? Math.min(1 + (letters - 7) * 0.07, 1.5) : 1;
    if (isBlockEnd) x += 1.2;
    else if (isSentenceEnd) x += 1;
    else if (CLAUSE_END.test(t)) x += 0.5;
    w[i] = x;
  }
  let sum = 0;
  for (let i = 0; i < n; i++) sum += w[i];
  const mean = n ? sum / n : 1;
  prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    w[i] /= mean; // normaliza: a média continua sendo a velocidade escolhida
    prefix[i + 1] = prefix[i] + w[i];
  }
  weights = w;
}

// ---------- Bolinha ----------

function placeDot(instant = false) {
  const el = words[cur];
  if (!el || els.reader.hidden) return;
  if (curEl !== el) {
    if (curEl) curEl.classList.remove('cur');
    el.classList.add('cur');
    curEl = el;
  }
  const r = el.getBoundingClientRect();
  const c = els.reader.getBoundingClientRect();
  const x = r.left - c.left + r.width / 2 - 4;
  const y = r.bottom - c.top + 1;
  const newLine = dotY === null || Math.abs(y - dotY) > 3;
  els.dot.classList.toggle('jump', instant || newLine);
  els.dot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  dotY = y;
  if (newLine && !instant && playing) ensureVisible();
}

function viewBounds() {
  const top = els.topbar.offsetHeight;
  const bottom = window.innerHeight - (els.controls.hidden ? 0 : els.controls.offsetHeight);
  return { top, bottom, height: bottom - top };
}

// Rola a página para a palavra atual quando ela sai da área confortável de leitura.
function ensureVisible(mode = 'smooth', always = false) {
  const el = words[cur];
  if (!el) return;
  const r = el.getBoundingClientRect();
  const v = viewBounds();
  const lower = v.top + v.height * 0.62;
  if (always || r.top < v.top + 12 || r.bottom > lower) {
    const target = v.top + v.height * 0.28;
    window.scrollBy({ top: r.top - target, behavior: mode === 'instant' ? 'auto' : 'smooth' });
  }
}

function updateGlide() {
  els.dot.style.setProperty('--glide', Math.round(Math.min(150, baseMs() * 0.6)) + 'ms');
}

// ---------- Play / pausa ----------

function play() {
  if (!words.length) return;
  if (ended) { cur = 0; ended = false; }
  playing = true;
  els.body.classList.add('playing');
  els.btnPlay.setAttribute('aria-label', 'Pausar');
  closeSettings();
  placeDot(true);
  ensureVisible('smooth');
  nextAt = performance.now() + delay(cur);
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
  requestWakeLock();
}

function pause() {
  if (playing) {
    playing = false;
    cancelAnimationFrame(rafId);
    els.body.classList.remove('playing');
    els.btnPlay.setAttribute('aria-label', 'Play');
    releaseWakeLock();
  }
  savePosition();
}

const toggle = () => (playing ? pause() : play());

function tick(now) {
  if (!playing) return;
  if (now - nextAt > 1000) nextAt = now; // a aba ficou parada: não sai pulando palavras
  let moved = false;
  while (now >= nextAt) {
    if (cur >= words.length - 1) { finish(); return; }
    cur++;
    nextAt += delay(cur);
    moved = true;
  }
  if (moved) {
    placeDot();
    updateStats();
    if (now - lastSaveAt > 10000) { lastSaveAt = now; savePosition(); }
  }
  rafId = requestAnimationFrame(tick);
}

function finish() {
  pause();
  ended = true;
  updateStats();
  toast('Fim do texto. Aperte play para recomeçar.');
}

function seek(i, { scroll = 'smooth' } = {}) {
  if (!words.length) return;
  cur = clamp(Math.round(i), 0, words.length - 1);
  ended = false;
  placeDot(true);
  if (scroll) ensureVisible(scroll);
  updateStats();
  if (playing) nextAt = performance.now() + delay(cur);
  else scheduleSave();
}

function sentenceIndex(i) {
  let lo = 0, hi = sentenceStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sentenceStarts[mid] <= i) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function prevSentence() {
  if (!words.length) return;
  const k = sentenceIndex(cur);
  let target = sentenceStarts[k];
  if (cur - target < 3 && k > 0) target = sentenceStarts[k - 1];
  seek(target);
}

function nextSentence() {
  if (!words.length) return;
  const k = sentenceIndex(cur);
  seek(k + 1 < sentenceStarts.length ? sentenceStarts[k + 1] : words.length - 1);
}

// ---------- Estatísticas e progresso ----------

function fmtDuration(ms) {
  const min = ms / 60000;
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return Math.round(min) + ' min';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

function updateStats() {
  const n = words.length;
  const frac = n > 1 ? cur / (n - 1) : 0;
  const pct = Math.round(frac * 100);
  els.progressFill.style.width = (frac * 100).toFixed(2) + '%';
  els.progress.setAttribute('aria-valuenow', String(pct));
  els.progress.setAttribute('aria-valuetext', `palavra ${fmtInt(cur + 1)} de ${fmtInt(n)}`);
  els.statPct.textContent = pct + '%';
  const left = n ? (prefix[n] - prefix[cur]) * baseMs() : 0;
  els.statTime.textContent = ended ? 'concluído' : fmtDuration(left) + ' restantes';
  els.statPct.parentElement.title = `Palavra ${fmtInt(cur + 1)} de ${fmtInt(n)}`;
}

function setWpm(v) {
  settings.wpm = clamp(Math.round(v / 10) * 10, WPM_MIN, WPM_MAX);
  els.speed.value = settings.wpm;
  els.speedOut.textContent = settings.wpm;
  setRangeFill(els.speed);
  updateGlide();
  updateStats();
  saveSettings();
}

function setRangeFill(input) {
  const min = +input.min, max = +input.max;
  input.style.setProperty('--pct', ((input.value - min) / (max - min)) * 100 + '%');
}

// ---------- Salvar posição ----------

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePosition, 600);
}
function savePosition() {
  clearTimeout(saveTimer);
  if (!doc) return Promise.resolve();
  doc.position = cur;
  return store.updateMeta(doc.id, { position: cur, updatedAt: Date.now() }).catch(() => {});
}

// ---------- Abrir textos ----------

function showDoc(meta, blocks) {
  doc = meta;
  els.welcome.hidden = true;
  els.reader.hidden = false;
  els.controls.hidden = false;
  els.body.classList.add('reading');
  els.docTitle.textContent = meta.title;
  document.title = meta.title + ' · excellentreading';
  stopDemo();
  render(blocks);
  cur = clamp(meta.position || 0, 0, Math.max(0, words.length - 1));
  ended = false;
  dotY = null;
  lsSet(lastKey(), meta.id);
  updateStats();
  hideHlBar();
  highlights = [];
  renderNotes();
  if (settings.notesOpen && isWide()) openNotes();
  requestAnimationFrame(() => {
    placeDot(true);
    if (cur === 0) window.scrollTo(0, 0);
    else ensureVisible('instant', true);
  });
  const id = meta.id;
  store.listHighlights(id).then((hs) => {
    if (!doc || doc.id !== id || !hs.length) return;
    highlights = hs;
    for (const h of hs) wrapHighlight(h);
    renderNotes();
  }).catch((e) => console.warn('Não consegui carregar os sublinhados', e));
}

async function openDoc(id) {
  pause();
  const [meta, content] = await Promise.all([store.getMeta(id), store.getContent(id)]);
  if (!meta || !content) {
    lsSet(lastKey(), null);
    return false;
  }
  meta.openedAt = Date.now();
  store.updateMeta(id, { openedAt: meta.openedAt }).catch(() => {});
  showDoc(meta, content.blocks);
  return true;
}

function goHome() {
  pause();
  doc = null;
  words = [];
  tokens = [];
  els.text.innerHTML = '';
  els.reader.hidden = true;
  els.controls.hidden = true;
  els.welcome.hidden = false;
  els.body.classList.remove('reading');
  els.docTitle.textContent = '';
  document.title = 'excellentreading';
  hideHlBar();
  highlights = [];
  renderNotes();
  if (!isWide()) closeNotes();
  lsSet(lastKey(), null);
  window.scrollTo(0, 0);
  refreshLists();
  startDemo();
}

async function addParsed({ title, kind, blocks }) {
  const wordCount = countWords(blocks);
  if (!wordCount) throw new Error('Não encontrei nenhuma palavra nesse arquivo.');
  // Compara pelo nome original do arquivo, para que renomear não gere duplicata ao reenviar.
  const existing = (await store.listDocs()).find((d) => (d.sourceName || d.title) === title && d.wordCount === wordCount);
  if (existing) {
    await openDoc(existing.id);
    toast('Esse texto já estava na biblioteca. Continuando de onde você parou.');
    return;
  }
  const now = Date.now();
  const meta = { id: store.newId(), title, sourceName: title, kind, wordCount, position: 0, createdAt: now, updatedAt: now, openedAt: now };
  await store.addDoc(meta, blocks);
  showDoc(meta, blocks);
  hideToast();
  refreshLists();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* opcional */ }
  if (!(await store.isPersistent())) toast('Este navegador não deixou salvar: o texto some quando você fechar a aba.', 7000);
}

async function importFile(file) {
  if (!file) return;
  const okExt = /\.(txt|text|md|markdown|pdf)$/i.test(file.name);
  const okType = ['text/plain', 'text/markdown', 'application/pdf'].includes(file.type);
  if (!okExt && !okType) {
    toast('Formato não suportado. Use .txt, .md ou .pdf.', 5000);
    return;
  }
  pause();
  toast('Lendo arquivo…', 0);
  try {
    const parsed = await parseFile(file, (p) => toast(`Lendo PDF… ${Math.round(p * 100)}%`, 0));
    await addParsed(parsed);
  } catch (err) {
    console.error(err);
    toast((err && err.message) || 'Não consegui ler esse arquivo.', 7000);
  }
}

// ---------- Biblioteca ----------

const TRASH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const PENCIL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5 4 4M4 20l1-4.5L15.8 4.7a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L8.5 19 4 20Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const COPY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const MARKER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 4.5 5 5L10 19H5v-5l9.5-9.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M4 22h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const plural = (n, one, many) => `${fmtInt(n)} ${n === 1 ? one : many}`;

function renderDocList(ul, docs) {
  ul.innerHTML = '';
  for (const d of docs) {
    const li = document.createElement('li');
    li.className = 'doc-item' + (doc && d.id === doc.id ? ' current' : '');
    const pct = d.wordCount > 1 ? Math.round(((d.position || 0) / (d.wordCount - 1)) * 100) : 0;
    const nh = Math.max(0, d.highlightCount || 0);
    li.innerHTML =
      '<button class="doc-open" type="button"><span class="doc-name"></span>' +
      `<span class="doc-sub"><span class="badge"></span><span class="mini-bar"><i style="width:${pct}%"></i></span>` +
      `<span>${pct}% · ${plural(d.wordCount, 'palavra', 'palavras')}${nh ? ' · ' + plural(nh, 'sublinhado', 'sublinhados') : ''}</span></span></button>` +
      `<button class="icon-btn doc-ren" type="button" title="Renomear" aria-label="Renomear">${PENCIL_SVG}</button>` +
      `<button class="icon-btn doc-del" type="button" title="Apagar" aria-label="Apagar">${TRASH_SVG}</button>`;
    li.querySelector('.doc-name').textContent = d.title;
    li.querySelector('.badge').textContent = d.kind;
    const openBtn = li.querySelector('.doc-open');
    openBtn.addEventListener('click', async () => {
      closeLibrary();
      if (!doc || doc.id !== d.id) {
        if (!(await openDoc(d.id))) { toast('Não encontrei esse texto.'); refreshLists(); }
      }
    });
    li.querySelector('.doc-ren').addEventListener('click', () => {
      startRename(openBtn, d.title, (title) => renameDoc(d.id, title), refreshLists);
    });
    li.querySelector('.doc-del').addEventListener('click', async () => {
      if (!confirm(`Apagar "${d.title}" da biblioteca? Os sublinhados dele também serão apagados.`)) return;
      await store.deleteDoc(d.id);
      if (doc && doc.id === d.id) goHome();
      refreshLists();
    });
    ul.appendChild(li);
  }
}

async function refreshLists() {
  let docs;
  try {
    docs = await store.listDocs();
  } catch (err) {
    console.error(err);
    toast(err && err.code === 'permission-denied'
      ? 'A nuvem recusou o acesso à biblioteca. Confira se as regras do Firestore (firestore.rules) foram publicadas.'
      : 'Não consegui carregar a biblioteca. Verifique a internet.', 8000);
    return;
  }
  renderDocList(els.libraryList, docs);
  els.libraryEmpty.hidden = docs.length > 0;
  renderDocList(els.recentList, docs.slice(0, 4));
  els.recent.hidden = docs.length === 0;
  els.storageNote.textContent = 'Seus textos ficam na sua conta: entre com ela em outro aparelho e a biblioteca estará lá.';
}

async function openLibrary() {
  closeSettings();
  await savePosition();
  await refreshLists();
  els.library.hidden = false;
  els.scrim.hidden = false;
}
function closeLibrary() {
  els.library.hidden = true;
  els.scrim.hidden = !(els.body.classList.contains('notes-open') && !isWide());
}

// ---------- Renomear ----------

// Troca o elemento `el` por um campo de texto. Enter ou clicar fora salva; Esc cancela.
function startRename(el, current, onSave, onEnd) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = current;
  input.maxLength = 120;
  input.setAttribute('aria-label', 'Novo nome');
  el.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const value = input.value.replace(/\s+/g, ' ').trim();
    if (input.isConnected) input.replaceWith(el);
    if (save && value && value !== current) {
      try { await onSave(value); } catch (e) { toast('Não consegui renomear.'); console.error(e); }
    }
    if (onEnd) onEnd();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // não deixa os atalhos de leitura reagirem enquanto digita
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

async function renameDoc(id, title) {
  await store.updateMeta(id, { title });
  if (doc && doc.id === id) {
    doc.title = title;
    els.docTitle.textContent = title;
    document.title = title + ' · excellentreading';
  }
}

// ---------- Sublinhados ----------

const isWide = () => window.matchMedia('(min-width: 1024px)').matches;

function blockOf(el) {
  let n = el;
  while (n && n.parentElement !== els.text) n = n.parentElement;
  return n;
}

// Envolve as palavras start..end num <mark> (um por parágrafo, para não quebrar o HTML).
function wrapHighlight(h) {
  const last = Math.min(h.end, words.length - 1);
  let i = h.start;
  while (i <= last) {
    const block = blockOf(words[i]);
    let j = i;
    while (j + 1 <= last && blockOf(words[j + 1]) === block) j++;
    const r = document.createRange();
    r.setStartBefore(words[i]);
    r.setEndAfter(words[j]);
    const mark = document.createElement('mark');
    mark.className = 'hl';
    mark.dataset.h = h.id;
    try {
      r.surroundContents(mark);
    } catch {
      mark.appendChild(r.extractContents());
      r.insertNode(mark);
    }
    i = j + 1;
  }
}

function marksOf(id) {
  return [...els.text.querySelectorAll('mark.hl')].filter((m) => m.dataset.h === id);
}

function unwrapHighlight(id) {
  for (const m of marksOf(id)) m.replaceWith(...m.childNodes);
}

async function addHighlight(s, e) {
  if (!doc || !words.length) return;
  s = clamp(s, 0, words.length - 1);
  e = clamp(e, s, words.length - 1);
  // Junta com os sublinhados que se sobrepõem, para não ter trechos repetidos.
  const merged = highlights.filter((h) => h.start <= e && h.end >= s);
  for (const h of merged) {
    s = Math.min(s, h.start);
    e = Math.max(e, h.end);
    unwrapHighlight(h.id);
  }
  const h = { id: store.newId(), docId: doc.id, start: s, end: e, text: '', createdAt: Date.now() };
  wrapHighlight(h);
  h.text = marksOf(h.id).map((m) => m.textContent.replace(/\s+/g, ' ').trim()).join('\n\n');
  highlights = highlights.filter((x) => !merged.includes(x)).concat(h).sort((a, b) => a.start - b.start);
  renderNotes(true);
  try {
    await store.saveHighlight(h, merged.map((x) => x.id));
  } catch (err) {
    console.error(err);
    toast('Não consegui salvar o sublinhado.');
  }
}

async function removeHighlight(id) {
  unwrapHighlight(id);
  highlights = highlights.filter((h) => h.id !== id);
  renderNotes();
  try { if (doc) await store.deleteHighlight(id, doc.id); } catch (err) { console.error(err); }
}

// Converte a seleção do usuário em índices de palavras inteiras (ou null).
function selectionWords() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount || !words.length) return null;
  const r = sel.getRangeAt(0);
  if (!r.intersectsNode(els.text)) return null;
  const n = words.length;
  // primeira palavra que termina depois do início da seleção
  let lo = 0, hi = n;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (r.comparePoint(words[m], words[m].childNodes.length) === -1) lo = m + 1; else hi = m;
  }
  let s = lo;
  // última palavra que começa antes do fim da seleção
  lo = -1; hi = n - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (r.comparePoint(words[m], 0) === 1) hi = m - 1; else lo = m;
  }
  let e = lo;
  if (s < n && r.startContainer === words[s].firstChild && r.startOffset >= words[s].firstChild.length) s++;
  if (e >= 0 && r.endContainer === words[e].firstChild && r.endOffset === 0) e--;
  if (s >= n || e < 0 || s > e) return null;
  return { s, e, rect: r.getBoundingClientRect() };
}

function currentSentence() {
  const k = sentenceIndex(cur);
  const s = sentenceStarts[k] || 0;
  const e = k + 1 < sentenceStarts.length ? sentenceStarts[k + 1] - 1 : words.length - 1;
  return { s, e };
}

// Barrinha flutuante: "Sublinhar" sobre uma seleção ou "Remover" sobre um sublinhado.
let hlPending = null;

function showHlBar(rect, action) {
  hlPending = action;
  els.hlAction.innerHTML = action.type === 'add'
    ? `${MARKER_SVG}<span>Sublinhar</span>`
    : `${TRASH_SVG}<span>Remover sublinhado</span>`;
  els.hlbar.hidden = false;
  positionHlBar(rect);
}

function positionHlBar(rect) {
  const v = viewBounds();
  const bw = els.hlbar.offsetWidth || 160;
  const x = clamp(rect.left + rect.width / 2, bw / 2 + 8, window.innerWidth - bw / 2 - 8);
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  // No celular fica embaixo, para não brigar com o menu nativo de copiar/colar.
  let y = coarse ? rect.bottom + 14 : rect.top - 48;
  if (!coarse && y < v.top + 6) y = rect.bottom + 10;
  if (coarse && y > v.bottom - 50) y = rect.top - 52;
  els.hlbar.style.left = x + 'px';
  els.hlbar.style.top = clamp(y, v.top + 6, v.bottom - 46) + 'px';
}

function hideHlBar() {
  hlPending = null;
  els.hlbar.hidden = true;
}

function updateHlBarFromSelection() {
  if (els.reader.hidden) return;
  const r = selectionWords();
  if (r) showHlBar(r.rect, { type: 'add', s: r.s, e: r.e });
  else if (hlPending && hlPending.type === 'add') hideHlBar();
}

function highlightNow() {
  if (!words.length) return;
  const r = selectionWords();
  const range = r || currentSentence();
  addHighlight(range.s, range.e);
  window.getSelection()?.removeAllRanges();
  hideHlBar();
  if (!r) toast('Frase sublinhada.', 1500);
}

// ---------- Painel de sublinhados ----------

function renderNotes(bump = false) {
  const n = highlights.length;
  els.notesCount.textContent = n ? `(${n})` : '';
  els.notesTabCount.textContent = n;
  els.notesTab.classList.toggle('has', n > 0);
  els.notesBtnCount.textContent = n;
  els.notesBtnCount.hidden = n === 0;
  if (bump) {
    els.notesTab.classList.remove('bump');
    void els.notesTab.offsetWidth;
    els.notesTab.classList.add('bump');
  }
  els.notesList.innerHTML = '';
  const total = Math.max(1, words.length - 1);
  for (const h of highlights) {
    const li = document.createElement('li');
    li.className = 'note';
    li.innerHTML =
      '<button class="note-quote" type="button" title="Ir para este trecho"></button>' +
      `<div class="note-meta"><span>${Math.round((h.start / total) * 100)}% do texto</span>` +
      `<button class="icon-btn" type="button" data-act="copy" title="Copiar" aria-label="Copiar">${COPY_SVG}</button>` +
      `<button class="icon-btn" type="button" data-act="del" title="Apagar" aria-label="Apagar">${TRASH_SVG}</button></div>`;
    li.querySelector('.note-quote').textContent = h.text;
    li.querySelector('.note-quote').addEventListener('click', () => jumpToHighlight(h));
    li.querySelector('[data-act="copy"]').addEventListener('click', () => copyText(h.text));
    li.querySelector('[data-act="del"]').addEventListener('click', () => removeHighlight(h.id));
    els.notesList.appendChild(li);
  }
}

function jumpToHighlight(h) {
  if (!isWide()) closeNotes();
  seek(h.start, { scroll: false });
  const first = words[h.start];
  if (first) {
    const r = first.getBoundingClientRect();
    const v = viewBounds();
    window.scrollBy({ top: r.top - (v.top + v.height * 0.28), behavior: 'smooth' });
  }
  for (const m of marksOf(h.id)) {
    m.classList.remove('flash');
    void m.offsetWidth;
    m.classList.add('flash');
  }
}

function openNotes() {
  closeSettings();
  els.body.classList.add('notes-open');
  els.notesTab.setAttribute('aria-expanded', 'true');
  els.btnNotes.setAttribute('aria-expanded', 'true');
  if (!isWide()) els.scrim.hidden = false;
  if (isWide()) { settings.notesOpen = true; saveSettings(); }
}

function closeNotes() {
  if (!els.body.classList.contains('notes-open')) return;
  els.body.classList.remove('notes-open');
  els.notesTab.setAttribute('aria-expanded', 'false');
  els.btnNotes.setAttribute('aria-expanded', 'false');
  if (els.library.hidden) els.scrim.hidden = true;
  if (isWide()) { settings.notesOpen = false; saveSettings(); }
}

const toggleNotes = () => (els.body.classList.contains('notes-open') ? closeNotes() : openNotes());

function notesAsMarkdown(withTitle) {
  const body = highlights.map((h) => '> ' + h.text.replace(/\n\n/g, '\n>\n> ')).join('\n\n');
  return withTitle && doc ? `# Sublinhados: ${doc.title}\n\n${body}\n` : body;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* sem jeito */ }
    ta.remove();
  }
  toast('Copiado.', 1500);
}

function exportNotes() {
  if (!highlights.length) { toast('Nenhum sublinhado para baixar.'); return; }
  const blob = new Blob([notesAsMarkdown(true)], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (doc.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'texto') + ' - sublinhados.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Ajustes (painel) ----------

function applySettings() {
  setWpm(settings.wpm);
  document.documentElement.style.setProperty('--fs', settings.fontSize + 'px');
  els.fontSize.value = settings.fontSize;
  els.fontSizeOut.textContent = settings.fontSize;
  setRangeFill(els.fontSize);
  document.documentElement.style.setProperty('--font-read', settings.font === 'sans' ? 'var(--font-ui)' : 'var(--font-serif)');
  for (const b of document.querySelectorAll('[data-font]')) b.setAttribute('aria-checked', String(b.dataset.font === settings.font));
  applyTheme();
  els.optNatural.checked = settings.natural;
  els.optHighlight.checked = settings.highlight;
  els.text.classList.toggle('highlight', settings.highlight);
}

function relayout() {
  requestAnimationFrame(() => {
    placeDot(true);
    ensureVisible('instant');
  });
}

function openSettings() {
  els.settings.hidden = false;
  els.btnSettings.setAttribute('aria-expanded', 'true');
}
function closeSettings() {
  els.settings.hidden = true;
  els.btnSettings.setAttribute('aria-expanded', 'false');
}

function applyTheme() {
  const t = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  for (const b of document.querySelectorAll('[data-theme-opt]')) b.setAttribute('aria-checked', String(b.dataset.themeOpt === t));
}

function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t) return t === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// ---------- Avisos ----------

let toastTimer = 0;
function toast(msg, ms = 3500) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(hideToast, ms);
}
function hideToast() {
  clearTimeout(toastTimer);
  els.toast.hidden = true;
}

// ---------- Manter a tela acesa durante a leitura ----------

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { wakeLock = null; }
}
function releaseWakeLock() {
  try { if (wakeLock) wakeLock.release(); } catch { /* ignora */ }
  wakeLock = null;
}

// ---------- Animação da tela inicial ----------

let demoTimer = 0;
function startDemo() {
  stopDemo();
  const demo = $('demo');
  const spans = [...demo.querySelectorAll('span')];
  const dot = demo.querySelector('.demo-dot');
  let i = 0;
  const step = () => {
    spans.forEach((s, j) => s.classList.toggle('on', j <= i));
    const s = spans[i];
    dot.style.transform = `translateX(${s.offsetLeft + s.offsetWidth / 2 - 4}px)`;
    i = (i + 1) % spans.length;
    demoTimer = setTimeout(step, i === 0 ? 1400 : 380);
  };
  step();
}
function stopDemo() { clearTimeout(demoTimer); }

// ---------- Eventos ----------

function bind() {
  $('btnOpen').addEventListener('click', () => els.file.click());
  $('btnOpen2').addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', () => {
    const f = els.file.files && els.file.files[0];
    els.file.value = '';
    importFile(f);
  });
  $('btnSample').addEventListener('click', () => addParsed(SAMPLE).catch((e) => toast(e.message)));
  $('btnHome').addEventListener('click', goHome);

  // Colar texto
  $('btnPaste').addEventListener('click', () => {
    els.pasteTitle.value = '';
    els.pasteText.value = '';
    els.pasteDialog.showModal();
    els.pasteText.focus();
  });
  $('pasteCancel').addEventListener('click', () => els.pasteDialog.close());
  $('pasteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.pasteText.value.trim();
    if (!text) return;
    const blocks = parsePlain(text);
    const first = text.split(/\s+/).slice(0, 6).join(' ');
    const title = els.pasteTitle.value.trim() || (first.length > 50 ? first.slice(0, 50) : first) + '…';
    els.pasteDialog.close();
    addParsed({ title, kind: 'txt', blocks }).catch((err) => toast(err.message));
  });

  // Controles
  els.btnPlay.addEventListener('click', toggle);
  $('btnBack').addEventListener('click', prevSentence);
  $('btnFwd').addEventListener('click', nextSentence);
  $('btnSlower').addEventListener('click', () => setWpm(settings.wpm - 10));
  $('btnFaster').addEventListener('click', () => setWpm(settings.wpm + 10));
  els.speed.addEventListener('input', () => setWpm(+els.speed.value));

  // Clicar numa palavra pula até ela; num trecho sublinhado, oferece remover
  els.text.addEventListener('click', (e) => {
    const w = e.target.closest('.w');
    if (!w) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const i = words.indexOf(w);
    if (i >= 0) seek(i, { scroll: false });
    const mark = e.target.closest('mark.hl');
    if (mark) showHlBar(mark.getBoundingClientRect(), { type: 'remove', id: mark.dataset.h });
  });

  // Sublinhar: barrinha que aparece quando há texto selecionado
  let pointerIsDown = false;
  let selTimer = 0;
  const scheduleSelCheck = () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(updateHlBarFromSelection, 220);
  };
  document.addEventListener('pointerdown', (e) => {
    pointerIsDown = true;
    if (!els.hlbar.contains(e.target)) hideHlBar();
  }, true);
  document.addEventListener('pointerup', () => { pointerIsDown = false; scheduleSelCheck(); }, true);
  document.addEventListener('selectionchange', () => {
    // Com mouse, espera soltar o botão; no toque, as alças de seleção não disparam pointerup.
    if (!pointerIsDown || window.matchMedia('(pointer: coarse)').matches) scheduleSelCheck();
  });
  els.hlbar.addEventListener('mousedown', (e) => e.preventDefault()); // não perde a seleção ao clicar
  els.hlAction.addEventListener('click', () => {
    const a = hlPending;
    if (!a) return;
    if (a.type === 'add') {
      addHighlight(a.s, a.e);
      window.getSelection()?.removeAllRanges();
    } else {
      removeHighlight(a.id);
    }
    hideHlBar();
  });
  let scrollRaf = 0;
  window.addEventListener('scroll', () => {
    if (els.hlbar.hidden || scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      if (!hlPending) return;
      if (hlPending.type === 'remove') { hideHlBar(); return; }
      const r = selectionWords();
      if (r) positionHlBar(r.rect); else hideHlBar();
    });
  }, { passive: true });

  // Painel de sublinhados
  els.notesTab.addEventListener('click', toggleNotes);
  els.btnNotes.addEventListener('click', toggleNotes);
  $('btnCloseNotes').addEventListener('click', closeNotes);
  $('btnCopyAll').addEventListener('click', () => {
    if (!highlights.length) { toast('Nenhum sublinhado para copiar.'); return; }
    copyText(notesAsMarkdown(false));
  });
  $('btnExport').addEventListener('click', exportNotes);
  window.addEventListener('resize', () => {
    if (els.body.classList.contains('notes-open') && els.library.hidden) els.scrim.hidden = isWide();
  });

  // Renomear clicando no título do topo
  els.docTitle.addEventListener('click', () => {
    if (!doc) return;
    const id = doc.id;
    startRename(els.docTitle, doc.title, (title) => renameDoc(id, title), null);
  });

  // Conta
  els.btnAvatar.addEventListener('click', (e) => { e.stopPropagation(); openSettings(); });
  els.btnLogout.addEventListener('click', async () => {
    pause();
    await savePosition();
    closeSettings();
    toast('Saindo…', 0);
    if (!(await logout())) hideToast();
  });
  window.addEventListener('er-profile', () => renderAccount(currentUser()));
  let syncErrorShown = false;
  window.addEventListener('er-sync-error', (e) => {
    if (syncErrorShown) return;
    syncErrorShown = true;
    const code = e.detail && e.detail.code;
    toast(code === 'permission-denied'
      ? 'A nuvem recusou a gravação (permissão negada). Confira as regras do Firestore.'
      : 'Não consegui salvar uma mudança na nuvem. Ela será tentada de novo.', 7000);
    setTimeout(() => { syncErrorShown = false; }, 15000);
  });

  // Barra de progresso (clicar/arrastar)
  let dragging = false;
  let resumeAfterDrag = false;
  const seekFromPointer = (e) => {
    const r = els.progress.getBoundingClientRect();
    const frac = clamp((e.clientX - r.left) / r.width, 0, 1);
    seek(frac * (words.length - 1), { scroll: 'instant' });
  };
  els.progress.addEventListener('pointerdown', (e) => {
    if (!words.length) return;
    dragging = true;
    resumeAfterDrag = playing;
    if (playing) pause();
    els.progress.classList.add('dragging');
    els.progress.setPointerCapture(e.pointerId);
    seekFromPointer(e);
  });
  els.progress.addEventListener('pointermove', (e) => { if (dragging) seekFromPointer(e); });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    els.progress.classList.remove('dragging');
    if (resumeAfterDrag) play(); else savePosition();
  };
  els.progress.addEventListener('pointerup', endDrag);
  els.progress.addEventListener('pointercancel', endDrag);

  // Ajustes
  els.btnSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    if (els.settings.hidden) openSettings(); else closeSettings();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!els.settings.hidden && !els.settings.contains(e.target) && !els.btnSettings.contains(e.target)) closeSettings();
  });
  els.fontSize.addEventListener('input', () => {
    settings.fontSize = +els.fontSize.value;
    applySettings();
    saveSettings();
    relayout();
  });
  for (const b of document.querySelectorAll('[data-font]')) {
    b.addEventListener('click', () => {
      settings.font = b.dataset.font;
      applySettings();
      saveSettings();
      relayout();
    });
  }
  els.optNatural.addEventListener('change', () => {
    settings.natural = els.optNatural.checked;
    saveSettings();
    if (tokens.length) {
      computeTiming();
      updateStats();
      if (playing) nextAt = performance.now() + delay(cur);
    }
  });
  els.optHighlight.addEventListener('change', () => {
    settings.highlight = els.optHighlight.checked;
    applySettings();
    saveSettings();
  });
  $('btnTheme').addEventListener('click', () => {
    settings.theme = isDark() ? 'light' : 'dark';
    applyTheme();
    saveSettings();
  });
  for (const b of document.querySelectorAll('[data-theme-opt]')) {
    b.addEventListener('click', () => {
      settings.theme = b.dataset.themeOpt;
      applyTheme();
      saveSettings();
    });
  }

  // Biblioteca
  $('btnLibrary').addEventListener('click', () => (els.library.hidden ? openLibrary() : closeLibrary()));
  $('btnCloseLibrary').addEventListener('click', closeLibrary);
  els.scrim.addEventListener('click', () => { closeLibrary(); closeNotes(); });

  // Teclado
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const typing = t.closest && t.closest('textarea, input[type="text"], input[type="checkbox"], dialog');
    if (typing) return;
    const onRange = t.type === 'range';
    const reading = !els.reader.hidden;

    if (e.key === 'Escape') { closeSettings(); hideHlBar(); if (!els.library.hidden) closeLibrary(); else closeNotes(); return; }
    if (e.key === 'b' || e.key === 'B') { if (els.library.hidden) openLibrary(); else closeLibrary(); return; }
    if (!reading) return;
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); highlightNow(); return; }
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); toggleNotes(); return; }

    switch (e.key) {
      case ' ':
      case 'Spacebar':
        e.preventDefault();
        if (t instanceof HTMLButtonElement || onRange) t.blur();
        toggle();
        break;
      case 'ArrowUp': case '+': case '=':
        if (onRange) return;
        e.preventDefault();
        setWpm(settings.wpm + (e.shiftKey ? 50 : 10));
        break;
      case 'ArrowDown': case '-': case '_':
        if (onRange) return;
        e.preventDefault();
        setWpm(settings.wpm - (e.shiftKey ? 50 : 10));
        break;
      case 'ArrowLeft':
        if (onRange) return;
        e.preventDefault();
        if (e.shiftKey) seek(cur - 1); else prevSentence();
        break;
      case 'ArrowRight':
        if (onRange) return;
        e.preventDefault();
        if (e.shiftKey) seek(cur + 1); else nextSentence();
        break;
      default:
    }
  });

  // Arrastar e soltar arquivos
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    els.dropOverlay.hidden = false;
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) els.dropOverlay.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    els.dropOverlay.hidden = true;
    importFile(e.dataTransfer.files[0]);
  });

  // Layout muda (janela, fonte carregando, letra maior) => reposiciona a bolinha
  let rafPending = false;
  const reposition = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; placeDot(true); });
  };
  window.addEventListener('resize', reposition);
  if ('ResizeObserver' in window) new ResizeObserver(reposition).observe(els.text);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(reposition);

  // Sair da aba pausa e salva
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else if (playing) requestWakeLock();
  });
  window.addEventListener('pagehide', () => { savePosition(); });
}

// ---------- Tela de abertura ----------
// A animação (CSS) começa assim que a página aparece. Ela só sai quando a animação
// terminou E o app terminou de carregar. Clique ou qualquer tecla pula.

const SPLASH_MS = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 700 : 2500;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Espera a bolinha chegar ao fim do nome (a animação começa na primeira pintura da
// página, que pode demorar numa conexão lenta), com um limite para nunca travar.
function splashAnimationDone() {
  const ink = document.querySelector('.splash-ink');
  const anims = ink && ink.getAnimations ? ink.getAnimations() : [];
  if (!anims.length) return wait(Math.max(0, SPLASH_MS - performance.now()));
  const done = Promise.all(anims.map((a) => a.finished)).then(() => wait(250), () => {});
  return Promise.race([done, wait(4500)]);
}

function onSplashKey(e) {
  e.preventDefault();
  e.stopPropagation(); // não deixa o espaço que pulou a abertura dar play no texto
  hideSplash();
}

function setupSplash() {
  const splash = $('splash');
  if (!splash) return;
  splash.addEventListener('pointerdown', hideSplash);
  window.addEventListener('keydown', onSplashKey, true);
}

function hideSplash() {
  const splash = $('splash');
  window.removeEventListener('keydown', onSplashKey, true);
  if (!splash || splash.classList.contains('out')) return;
  splash.classList.add('out');
  setTimeout(() => splash.remove(), 700);
}

// ---------- Início ----------

let sessionUser = null;
const lastKey = () => 'er.last.' + (sessionUser ? sessionUser.uid : 'anon');

function renderAccount(user) {
  if (!user) return;
  const name = user.displayName || (user.email ? user.email.split('@')[0] : 'Leitor');
  const initial = (name.trim()[0] || '?').toUpperCase();
  for (const av of [els.accountAvatar, els.headerAvatar]) {
    if (user.photoURL) {
      av.textContent = '';
      av.style.backgroundImage = `url("${user.photoURL.replace(/"/g, '%22')}")`;
    } else {
      av.textContent = initial;
      av.style.backgroundImage = '';
    }
  }
  els.accountName.textContent = name;
  els.accountEmail.textContent = user.email || '';
  els.btnAvatar.hidden = false;
  els.btnAvatar.title = `${name} (${user.email || 'sua conta'})`;
  els.hello.textContent = `Olá, ${name.split(' ')[0]}!`;
  els.hello.hidden = false;
}

// Leva para a conta os textos que estavam salvos só neste navegador (antes de existir login).
async function importLegacy() {
  const items = await store.readLegacyLocal();
  if (!items) return;
  if (!items.length) { await store.deleteLegacyLocal(); return; }
  toast(`Levando ${plural(items.length, 'texto', 'textos')} deste navegador para a sua conta…`, 0);
  try {
    const existing = await store.listDocs();
    const key = (m) => (m.sourceName || m.title) + '|' + m.wordCount;
    const have = new Set(existing.map(key));
    let moved = 0;
    for (const it of items) {
      if (have.has(key(it.meta))) continue;
      const meta = { ...it.meta, sourceName: it.meta.sourceName || it.meta.title };
      // Espera a confirmação do servidor antes de apagar a cópia local.
      await store.addDoc(meta, it.blocks, it.highlights, { strict: true });
      moved++;
    }
    await store.deleteLegacyLocal();
    try {
      const oldLast = localStorage.getItem('er.last');
      if (oldLast && !lsGet(lastKey())) lsSet(lastKey(), oldLast);
      localStorage.removeItem('er.last');
    } catch { /* ignora */ }
    toast(moved ? `Pronto: ${plural(moved, 'texto foi', 'textos foram')} para a sua conta.` : 'Sua biblioteca já estava na conta.', 5000);
  } catch (err) {
    console.error(err);
    toast('Não consegui levar seus textos antigos para a conta agora. Vou tentar de novo na próxima vez.', 7000);
  }
}

async function enterApp(user) {
  if (sessionUser && sessionUser.uid === user.uid) return;
  sessionUser = user;
  store.setUser(user.uid);
  hideAuth();
  renderAccount(user);
  // Se a migração demorar (internet lenta), não segura a tela além de 20 s.
  await Promise.race([importLegacy(), new Promise((r) => setTimeout(r, 20000))]);
  const last = lsGet(lastKey());
  if (last && (await openDoc(last).catch(() => false))) {
    refreshLists();
    return;
  }
  els.welcome.hidden = false;
  refreshLists();
  startDemo();
}

async function init() {
  setupSplash();
  applySettings();
  bind();
  initAuthUI();
  let first = true;
  const ready = () => {
    if (!first) return;
    first = false;
    splashAnimationDone().then(hideSplash);
  };
  try {
    watchAuth(async (user) => {
      try {
        if (user) await enterApp(user);
        else if (!sessionUser) showAuth();
        else location.reload(); // saiu em outra aba
      } catch (err) {
        console.error(err);
        toast('Algo deu errado ao abrir sua conta. Recarregue a página.', 0);
      } finally {
        ready();
      }
    });
  } catch (err) {
    console.error(err);
    showAuth();
    ready();
  }
}

init();
