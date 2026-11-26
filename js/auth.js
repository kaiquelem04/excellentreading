// Tela de login: Google, (Apple), e-mail/senha, cadastro, "esqueci a senha", "manter conectado".
import {
  onAuthStateChanged, setPersistence, browserLocalPersistence, browserSessionPersistence,
  GoogleAuthProvider, OAuthProvider, signInWithPopup, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile, signOut, signInWithCredential,
  terminate, clearIndexedDbPersistence, waitForPendingWrites,
} from '../vendor/firebase/firebase.js';
import { auth, configured, setSessionOnly, dbStarted } from './firebase.js';
import { enableApple, googleSignInMode, googleClientId } from './firebase-config.js';

const $ = (id) => document.getElementById(id);

export function watchAuth(cb) {
  if (!configured) { cb(null); return; }
  onAuthStateChanged(auth, cb);
}

export const currentUser = () => (auth ? auth.currentUser : null);

// ---------- Mensagens de erro em português ----------

function errorMessage(err) {
  const code = (err && err.code) || '';
  const map = {
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/invalid-email': 'Esse e-mail não parece válido.',
    'auth/missing-password': 'Digite a senha.',
    'auth/email-already-in-use': 'Já existe uma conta com esse e-mail. Use a aba "Entrar".',
    'auth/weak-password': 'Senha fraca demais. Use pelo menos 8 caracteres.',
    'auth/password-does-not-meet-requirements': 'A senha não atende às regras do site. Tente uma mais longa, com letras e números.',
    'auth/too-many-requests': 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.',
    'auth/network-request-failed': 'Sem conexão com a internet. Verifique e tente de novo.',
    'auth/popup-blocked': 'O navegador bloqueou a janela do Google. Clique de novo no botão; se continuar, permita pop-ups para este site.',
    'auth/account-exists-with-different-credential': 'Esse e-mail já tem conta com outro jeito de entrar. Tente e-mail e senha.',
    'auth/unauthorized-domain': 'Este endereço não está autorizado no Firebase (Authentication → Settings → Authorized domains).',
    'auth/operation-not-allowed': 'Esse jeito de entrar não está ativado no Firebase (Authentication → Sign-in method).',
    'auth/user-disabled': 'Esta conta foi desativada.',
  };
  return map[code] || 'Não deu certo. Tente de novo.' + (code ? ` (${code})` : '');
}

const SILENT = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);

// ---------- Tela ----------

let busy = false;

function setMsg(text, kind = 'error') {
  const el = $('authMsg');
  el.textContent = text || '';
  el.className = 'auth-msg ' + kind;
  el.hidden = !text;
}

function setBusy(on, btn, label) {
  busy = on;
  $('auth').classList.toggle('busy', on);
  for (const b of document.querySelectorAll('#auth button')) b.disabled = on;
  if (btn) {
    const lab = btn.querySelector('.btn-label') || btn; // preserva o ícone do botão
    if (on) { btn.dataset.label = lab.textContent; lab.textContent = label; }
    else if (btn.dataset.label) { lab.textContent = btn.dataset.label; }
  }
}

function setTab(tab) {
  for (const t of document.querySelectorAll('[data-auth-tab]')) {
    const on = t.dataset.authTab === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  }
  $('signinForm').hidden = tab !== 'signin';
  $('signupForm').hidden = tab !== 'signup';
  $('authTitle').textContent = tab === 'signin' ? 'Entre para continuar lendo' : 'Crie sua conta';
  setMsg('');
}

const remembered = () => $('siRemember').checked; // as duas caixas andam juntas

// Aplica "Manter conectado" já quando a caixa muda (e ao abrir a tela), e não no clique de
// entrar: o Safari bloqueia a janela do Google se houver qualquer espera antes de abri-la.
let persistenceReady = Promise.resolve();
function applyRemember() {
  if (!auth) return persistenceReady;
  const keep = remembered();
  setSessionOnly(!keep);
  try { localStorage.setItem('er.keep', keep ? '1' : '0'); } catch { /* ignora */ }
  persistenceReady = setPersistence(auth, keep ? browserLocalPersistence : browserSessionPersistence).catch((e) => console.warn(e));
  return persistenceReady;
}

function popupSignIn(btn, label, provider) {
  if (busy) return;
  setMsg('');
  const pending = signInWithPopup(auth, provider); // primeira coisa do clique
  setBusy(true, btn, label);
  pending
    .catch((err) => {
      if (!SILENT.has(err && err.code)) { console.error(err); setMsg(errorMessage(err)); }
    })
    .finally(() => setBusy(false, btn));
}

function rememberEmail(email) {
  try {
    if (remembered() && email) localStorage.setItem('er.email', email);
    else localStorage.removeItem('er.email');
  } catch { /* ignora */ }
}

async function run(btn, label, fn) {
  if (busy) return;
  setMsg('');
  setBusy(true, btn, label);
  try {
    await persistenceReady;
    await fn();
  } catch (err) {
    if (!SILENT.has(err && err.code)) {
      console.error(err);
      setMsg(errorMessage(err));
    }
  } finally {
    setBusy(false, btn);
  }
}

export function initAuthUI() {
  // Abas
  for (const t of document.querySelectorAll('[data-auth-tab]')) {
    t.addEventListener('click', () => setTab(t.dataset.authTab));
  }
  // Mostrar/ocultar senha
  for (const b of document.querySelectorAll('[data-toggle-pass]')) {
    b.addEventListener('click', () => {
      const input = $(b.dataset.togglePass);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.setAttribute('aria-pressed', String(show));
      b.title = show ? 'Ocultar senha' : 'Mostrar senha';
    });
  }
  // As duas caixas "Manter conectado" ficam iguais
  const r1 = $('siRemember'), r2 = $('suRemember');
  r1.addEventListener('change', () => { r2.checked = r1.checked; applyRemember(); });
  r2.addEventListener('change', () => { r1.checked = r2.checked; applyRemember(); });
  try {
    const keep = localStorage.getItem('er.keep') !== '0';
    r1.checked = r2.checked = keep;
    const email = localStorage.getItem('er.email');
    if (email) $('siEmail').value = email;
  } catch { /* ignora */ }

  $('btnApple').hidden = !enableApple;

  if (!configured) {
    $('authConfigWarn').hidden = false;
    for (const b of document.querySelectorAll('#auth button:not([data-auth-tab])')) b.disabled = true;
    return;
  }

  const google = new GoogleAuthProvider();
  google.setCustomParameters({ prompt: 'select_account' });
  $('btnGoogle').addEventListener('click', (e) => popupSignIn(e.currentTarget, 'Abrindo o Google…', google));

  const apple = new OAuthProvider('apple.com');
  apple.addScope('email');
  apple.addScope('name');
  apple.setCustomParameters({ locale: 'pt_BR' });
  $('btnApple').addEventListener('click', (e) => popupSignIn(e.currentTarget, 'Abrindo a Apple…', apple));

  $('signinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('siEmail').value.trim();
    const pass = $('siPass').value;
    if (!email || !pass) { setMsg('Preencha e-mail e senha.'); return; }
    run($('btnSignin'), 'Entrando…', async () => {
      await signInWithEmailAndPassword(auth, email, pass);
      rememberEmail(email);
    });
  });

  $('signupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('suName').value.replace(/\s+/g, ' ').trim();
    const email = $('suEmail').value.trim();
    const pass = $('suPass').value;
    if (!name) { setMsg('Digite seu nome.'); return; }
    if (!email) { setMsg('Digite seu e-mail.'); return; }
    if (pass.length < 8) { setMsg('A senha precisa ter pelo menos 8 caracteres.'); return; }
    run($('btnSignup'), 'Criando conta…', async () => {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
      rememberEmail(email);
      window.dispatchEvent(new CustomEvent('er-profile'));
    });
  });

  $('btnForgot').addEventListener('click', async () => {
    const email = $('siEmail').value.trim();
    if (!email) { setMsg('Digite seu e-mail no campo acima e clique de novo em "Esqueci a senha".', 'info'); $('siEmail').focus(); return; }
    if (busy) return;
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email);
      // Mesma resposta exista ou não a conta, para não revelar quem tem cadastro.
      setMsg(`Se existir uma conta com ${email}, enviamos um link para criar uma nova senha. Confira também o spam.`, 'info');
    } catch (err) {
      if (err && err.code === 'auth/user-not-found') {
        setMsg(`Se existir uma conta com ${email}, enviamos um link para criar uma nova senha. Confira também o spam.`, 'info');
      } else {
        setMsg(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  });
}

// ---------- Google ----------

// A janela do Firebase só abre depois de carregar um iframe de apoio. Se isso acontecer no
// clique, a demora faz o navegador achar que a janela não veio do usuário e bloquear.
// Carregar antes, quando a tela de login aparece, deixa o clique abrir a janela na hora.
// (_initialize é interno do SDK; a versão está fixada em vendor/, então é estável aqui.)
function preloadPopup() {
  try {
    const r = auth && auth._popupRedirectResolver;
    if (r && typeof r._initialize === 'function') Promise.resolve(r._initialize(auth)).catch(() => {});
  } catch { /* opcional */ }
}

let gisScript = null;
function loadGis() {
  if (!gisScript) {
    gisScript = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => (window.google && google.accounts && google.accounts.id ? resolve(google) : reject(new Error('GIS sem API')));
      s.onerror = () => { gisScript = null; reject(new Error('Não carregou o script do Google')); };
      document.head.appendChild(s);
    });
  }
  return gisScript;
}

// Recebe o "crachá" (ID token) que o botão oficial do Google entrega e entra no Firebase com ele.
export async function signInWithGoogleCredential(idToken) {
  if (busy) return;
  setMsg('');
  setBusy(true);
  try {
    await persistenceReady;
    await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  } catch (err) {
    console.error(err);
    setMsg(errorMessage(err));
  } finally {
    setBusy(false);
  }
}

// Botão oficial do Google (Google Identity Services). Se não carregar, fica o botão do Firebase.
let googleSetup = false;
async function setupGoogleButton() {
  if (googleSetup) return;
  googleSetup = true;
  if (googleSignInMode !== 'google-button' || !googleClientId) { preloadPopup(); return; }
  try {
    const g = await loadGis();
    g.accounts.id.initialize({
      client_id: googleClientId,
      callback: (resp) => signInWithGoogleCredential(resp.credential),
      ux_mode: 'popup',
      auto_select: false,
      context: 'signin',
      itp_support: true,
    });
    const box = $('googleBtnBox');
    box.hidden = false;
    $('btnGoogle').hidden = true;
    const dark = document.documentElement.dataset.theme === 'dark'
      || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    const width = Math.max(220, Math.min(400, Math.floor(box.getBoundingClientRect().width || 352)));
    g.accounts.id.renderButton(box, {
      type: 'standard', theme: dark ? 'filled_black' : 'outline', size: 'large', text: 'continue_with',
      shape: 'rectangular', logo_alignment: 'center', width, locale: 'pt-BR',
    });
  } catch (err) {
    console.warn('Botão oficial do Google indisponível; usando a janela do Firebase.', err);
    $('googleBtnBox').hidden = true;
    $('btnGoogle').hidden = false;
    preloadPopup();
  }
}

export function showAuth() {
  setTab('signin');
  if (configured) setupGoogleButton();
  applyRemember();
  clearLocalCache();
  $('auth').hidden = false;
  document.body.classList.add('auth-open');
  const email = $('siEmail');
  setTimeout(() => (email.value ? $('siPass') : email).focus({ preventScroll: true }), 50);
}

export function hideAuth() {
  $('auth').hidden = true;
  document.body.classList.remove('auth-open');
  $('siPass').value = '';
  $('suPass').value = '';
  setMsg('');
}

// Ninguém conectado nesta aba = não deve sobrar cópia de textos no navegador.
// (Rede de segurança caso a limpeza ao sair não tenha terminado, ex.: outra aba aberta.)
async function clearLocalCache() {
  try {
    if (!indexedDB.databases) return;
    const names = (await indexedDB.databases()).map((d) => d.name).filter((n) => n && n.startsWith('firestore/'));
    await Promise.all(names.map((n) => new Promise((r) => {
      const q = indexedDB.deleteDatabase(n);
      q.onsuccess = q.onerror = q.onblocked = () => r();
    })));
  } catch { /* opcional */ }
}

// Sai da conta. Antes, tenta enviar o que ainda não subiu e apaga a cópia local dos textos.
export async function logout() {
  const db = dbStarted();
  if (db) {
    const sent = await Promise.race([
      waitForPendingWrites(db).then(() => true, () => true),
      new Promise((r) => setTimeout(() => r(false), 4000)),
    ]);
    if (!sent && !confirm('Algumas mudanças ainda não foram enviadas para a nuvem (parece que você está sem internet). Se sair agora, elas se perdem. Sair mesmo assim?')) {
      return false;
    }
  }
  try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch { /* opcional */ }
  await signOut(auth);
  if (db) {
    try { await terminate(db); await clearIndexedDbPersistence(db); } catch (e) { console.warn('Cache local será limpo na próxima abertura', e); }
  }
  await clearLocalCache();
  setSessionOnly(false);
  location.reload();
  return true;
}
