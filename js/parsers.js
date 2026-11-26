// Converte arquivos .txt, .md e .pdf em uma lista de blocos de texto.
// Bloco: { t: 'p' | 'h' | 'li' | 'q', x: string, l?: nível do título }

export async function parseFile(file, onProgress) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const title = file.name.replace(/\.[^.]+$/, '') || 'Sem título';

  if (ext === 'pdf' || file.type === 'application/pdf') {
    return { title, kind: 'pdf', blocks: await parsePdf(file, onProgress) };
  }
  const raw = decodeText(await file.arrayBuffer());
  if (ext === 'md' || ext === 'markdown' || file.type === 'text/markdown') {
    return { title, kind: 'md', blocks: parseMarkdown(raw) };
  }
  return { title, kind: 'txt', blocks: parsePlain(raw) };
}

// ---------- Texto puro ----------

function decodeText(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    // Arquivos antigos em português costumam estar em Latin-1 / Windows-1252.
    return new TextDecoder('windows-1252').decode(b);
  }
}

export function parsePlain(src) {
  const text = src.replace(/\r\n?/g, '\n').replace(/­/g, '').replace(/\t/g, ' ');
  const blocks = [];
  for (const chunk of text.split(/\n[  ]*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    // Linhas longas = um parágrafo por linha. Linhas curtas = texto quebrado em ~70 colunas.
    const lens = lines.map((l) => l.length).sort((a, b) => a - b);
    const median = lens[Math.floor(lens.length / 2)];
    if (lines.length > 1 && median > 100) {
      for (const l of lines) blocks.push({ t: 'p', x: collapse(l) });
    } else {
      blocks.push({ t: 'p', x: joinLines(lines) });
    }
  }
  return blocks.filter((b) => b.x);
}

function joinLines(lines) {
  let out = '';
  for (const line of lines) {
    if (!out) out = line;
    else if (/[A-Za-zÀ-ÿ]-$/.test(out) && /^[a-zà-ÿ]/.test(line)) out = out.slice(0, -1) + line;
    else out += ' ' + line;
  }
  return collapse(out);
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

// ---------- Markdown ----------

export function parseMarkdown(src) {
  src = src.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  src = src.replace(/^---\n[\s\S]*?\n(---|\.\.\.)\n/, ''); // front matter
  src = src.replace(/<!--[\s\S]*?-->/g, '');

  const blocks = [];
  let buf = [];
  let type = 'p';
  let fence = null;

  const flush = () => {
    if (buf.length) {
      const x = type === 'code' ? collapse(buf.join(' ')) : inlineMd(buf.join(' '));
      if (x) blocks.push({ t: type === 'code' ? 'p' : type, x });
    }
    buf = [];
    type = 'p';
  };

  for (const line of src.split('\n')) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) { flush(); fence = null; }
      else buf.push(line);
      continue;
    }
    if (f) { flush(); fence = f[1]; type = 'code'; continue; }

    if (/^\s*$/.test(line)) { flush(); continue; }
    if (/^\s{0,3}\[[^\]]+\]:\s*\S+/.test(line)) continue; // definição de link

    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { flush(); pushIf(blocks, { t: 'h', l: h[1].length, x: inlineMd(h[2]) }); continue; }

    if (buf.length && type === 'p' && /^\s{0,3}=+\s*$/.test(line)) {
      const x = inlineMd(buf.join(' ')); buf = []; pushIf(blocks, { t: 'h', l: 1, x }); continue;
    }
    if (buf.length && type === 'p' && /^\s{0,3}-+\s*$/.test(line)) {
      const x = inlineMd(buf.join(' ')); buf = []; pushIf(blocks, { t: 'h', l: 2, x }); continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); continue; } // linha horizontal

    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) continue; // separador de tabela
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      pushIf(blocks, { t: 'p', x: inlineMd(line.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim()).filter(Boolean).join(' · ')) });
      continue;
    }

    const li = line.match(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(.*)$/);
    if (li) { flush(); type = 'li'; buf.push(li[1].replace(/^\[[ xX]\]\s+/, '')); continue; }

    const q = line.match(/^\s*(?:>\s?)+(.*)$/);
    if (q) {
      if (type !== 'q') { flush(); type = 'q'; }
      if (q[1].trim()) buf.push(q[1]); else flush();
      continue;
    }

    buf.push(line.trim());
  }
  flush();
  return blocks;
}

function pushIf(arr, b) { if (b.x) arr.push(b); }

function inlineMd(s) {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/`+([^`]+)`+/g, '$1')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)(.+?)(?<=\S)\*(?!\*)/g, '$1$2')
    .replace(/(^|[^\w])_(?=\S)(.+?)(?<=\S)_(?![\w])/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- PDF ----------

let pdfjsPromise = null;

function loadPdfJs() {
  if (!pdfjsPromise) {
    const base = new URL('../vendor/pdfjs/', import.meta.url);
    pdfjsPromise = import(new URL('pdf.min.js', base).href)
      .then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.js', base).href;
        return lib;
      })
      .catch((err) => {
        pdfjsPromise = null;
        throw new Error('Não foi possível carregar o leitor de PDF. ' + (err && err.message ? err.message : ''));
      });
  }
  return pdfjsPromise;
}

export async function parsePdf(file, onProgress) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;

  const pages = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      pages.push(groupLines(tc.items, p));
      page.cleanup();
      if (onProgress) onProgress(p / doc.numPages);
    }
  } finally {
    doc.destroy();
  }

  stripRunningHeaders(pages);
  const lines = pages.flat().filter((l) => !/^\s*(\d{1,4}|[ivxlcdm]{1,6})\s*$/i.test(l.text));
  if (!lines.some((l) => /[\p{L}\p{N}]/u.test(l.text))) {
    throw new Error('Este PDF não tem texto selecionável (parece ser digitalizado como imagem).');
  }
  return linesToBlocks(lines);
}

function groupLines(items, page) {
  const lines = [];
  let cur = null;
  const close = () => {
    if (cur) {
      cur.text = cur.text.replace(/\s+/g, ' ').trim();
      if (cur.text) lines.push(cur);
    }
    cur = null;
  };
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const y = it.transform[5];
    const h = Math.abs(it.transform[3]) || it.height || 10;
    if (cur && it.str.trim() && Math.abs(y - cur.y) > Math.max(h, cur.h) * 0.6) close();
    if (!cur) cur = { text: '', y, h, page };
    cur.text += it.str;
    if (it.str.trim()) cur.h = Math.max(cur.h, h);
    if (it.hasEOL) close();
  }
  close();
  return lines;
}

// Remove cabeçalhos/rodapés que se repetem em muitas páginas (título do livro, "Página 3"...).
function stripRunningHeaders(pages) {
  if (pages.length < 2) return;
  const norm = (s) => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  // As 2 linhas mais altas e as 2 mais baixas de cada página (pela posição, não pela ordem no arquivo).
  const edgesOf = (lines) => {
    const byY = [...lines].sort((a, b) => b.y - a.y);
    return new Set([...byY.slice(0, 2), ...byY.slice(-2)]);
  };
  const edges = pages.map(edgesOf);
  const counts = new Map();
  for (const set of edges) {
    for (const k of new Set([...set].map((l) => norm(l.text)))) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const limit = pages.length < 5 ? pages.length : Math.max(3, pages.length * 0.4);
  const repeated = new Set([...counts].filter(([, n]) => n >= limit).map(([k]) => k));
  if (!repeated.size) return;
  for (let i = 0; i < pages.length; i++) {
    pages[i] = pages[i].filter((l) => !(edges[i].has(l) && repeated.has(norm(l.text))));
  }
}

function linesToBlocks(lines) {
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i];
    const g = a.y - b.y;
    if (a.page === b.page && g > 0 && g < a.h * 3) gaps.push(g);
  }
  gaps.sort((x, y) => x - y);
  const lineGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14;

  const lens = lines.map((l) => l.text.length).sort((x, y) => x - y);
  const typicalLen = lens[Math.floor(lens.length * 0.75)] || 60;

  const blocks = [];
  let buf = [];
  const flush = () => {
    if (buf.length) blocks.push({ t: 'p', x: joinLines(buf) });
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const prev = lines[i - 1];
    if (prev) {
      const endsSentence = /[.!?…:]["'”’»)\]]*$/.test(prev.text);
      let brk = false;
      if (prev.page === l.page) {
        const g = prev.y - l.y;
        if (g > lineGap * 1.45 || g < -lineGap) brk = true; // espaço extra ou nova coluna
      } else {
        brk = endsSentence && prev.text.length < typicalLen * 0.9;
      }
      if (!brk && endsSentence && prev.text.length < typicalLen * 0.7) brk = true; // última linha curta
      if (brk) flush();
    }
    buf.push(l.text);
  }
  flush();
  return blocks.filter((b) => b.x);
}
