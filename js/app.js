import { parseFile, parsePlain } from './parsers.js';
import * as store from './storage.js';
import { SAMPLE } from './sample.js';

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
};

// ---------- Ajustes ----------

const WPM_MIN = 50;
const WPM_MAX = 1000;
const DEFAULTS = { wpm: 250, fontSize: 20, font: 'serif', natural: true, highlight: false, theme: 'auto' };

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
    if (now - lastSaveAt > 4000) { lastSaveAt = now; savePosition(); }
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
  lsSet('er.last', meta.id);
  updateStats();
  requestAnimationFrame(() => {
    placeDot(true);
    if (cur === 0) window.scrollTo(0, 0);
    else ensureVisible('instant', true);
  });
}

async function openDoc(id) {
  pause();
  const [meta, content] = await Promise.all([store.getMeta(id), store.getContent(id)]);
  if (!meta || !content) {
    lsSet('er.last', null);
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
  lsSet('er.last', null);
  window.scrollTo(0, 0);
  refreshLists();
  startDemo();
}

async function addParsed({ title, kind, blocks }) {
  const wordCount = countWords(blocks);
  if (!wordCount) throw new Error('Não encontrei nenhuma palavra nesse arquivo.');
  const existing = (await store.listDocs()).find((d) => d.title === title && d.wordCount === wordCount);
  if (existing) {
    await openDoc(existing.id);
    toast('Esse texto já estava na biblioteca. Continuando de onde você parou.');
    return;
  }
  const now = Date.now();
  const meta = { id: store.newId(), title, kind, wordCount, position: 0, createdAt: now, updatedAt: now, openedAt: now };
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

function renderDocList(ul, docs) {
  ul.innerHTML = '';
  for (const d of docs) {
    const li = document.createElement('li');
    li.className = 'doc-item' + (doc && d.id === doc.id ? ' current' : '');
    const pct = d.wordCount > 1 ? Math.round(((d.position || 0) / (d.wordCount - 1)) * 100) : 0;
    li.innerHTML =
      '<button class="doc-open" type="button"><span class="doc-name"></span>' +
      `<span class="doc-sub"><span class="badge"></span><span class="mini-bar"><i style="width:${pct}%"></i></span>` +
      `<span>${pct}% · ${fmtInt(d.wordCount)} palavras</span></span></button>` +
      `<button class="icon-btn doc-del" type="button" title="Apagar" aria-label="Apagar">${TRASH_SVG}</button>`;
    li.querySelector('.doc-name').textContent = d.title;
    li.querySelector('.badge').textContent = d.kind;
    li.querySelector('.doc-open').addEventListener('click', async () => {
      closeLibrary();
      if (!doc || doc.id !== d.id) {
        if (!(await openDoc(d.id))) { toast('Não encontrei esse texto.'); refreshLists(); }
      }
    });
    li.querySelector('.doc-del').addEventListener('click', async () => {
      if (!confirm(`Apagar "${d.title}" da biblioteca?`)) return;
      await store.deleteDoc(d.id);
      if (doc && doc.id === d.id) goHome();
      refreshLists();
    });
    ul.appendChild(li);
  }
}

async function refreshLists() {
  const docs = await store.listDocs();
  renderDocList(els.libraryList, docs);
  els.libraryEmpty.hidden = docs.length > 0;
  renderDocList(els.recentList, docs.slice(0, 4));
  els.recent.hidden = docs.length === 0;
  els.storageNote.textContent = (await store.isPersistent())
    ? 'Os textos ficam salvos só neste navegador, neste aparelho. Nada é enviado para servidor nenhum.'
    : 'Este navegador não está permitindo salvar. Os textos somem quando a aba é fechada.';
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
  els.scrim.hidden = true;
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

  // Clicar numa palavra pula até ela
  els.text.addEventListener('click', (e) => {
    const w = e.target.closest('.w');
    if (!w) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const i = words.indexOf(w);
    if (i >= 0) seek(i, { scroll: false });
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
    document.documentElement.dataset.theme = settings.theme;
    saveSettings();
  });

  // Biblioteca
  $('btnLibrary').addEventListener('click', () => (els.library.hidden ? openLibrary() : closeLibrary()));
  $('btnCloseLibrary').addEventListener('click', closeLibrary);
  els.scrim.addEventListener('click', closeLibrary);

  // Teclado
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const typing = t.closest && t.closest('textarea, input[type="text"], input[type="checkbox"], dialog');
    if (typing) return;
    const onRange = t.type === 'range';
    const reading = !els.reader.hidden;

    if (e.key === 'Escape') { closeSettings(); closeLibrary(); return; }
    if (e.key === 'b' || e.key === 'B') { if (els.library.hidden) openLibrary(); else closeLibrary(); return; }
    if (!reading) return;

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

// ---------- Início ----------

async function init() {
  applySettings();
  bind();
  const last = lsGet('er.last');
  if (last && (await openDoc(last))) {
    refreshLists();
    return;
  }
  els.welcome.hidden = false;
  refreshLists();
  startDemo();
}

init();
