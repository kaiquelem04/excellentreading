// Inicializa o Firebase (contas + banco na nuvem).
import {
  initializeApp, getAuth, connectAuthEmulator,
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
} from '../vendor/firebase/firebase.js';
import { firebaseConfig } from './firebase-config.js';

// Para testes locais: abrir http://localhost:PORTA/?emulator usa os emuladores do Firebase.
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
export const useEmulator = isLocal && new URLSearchParams(location.search).has('emulator');

const config = useEmulator
  ? { apiKey: 'demo-key', authDomain: 'demo-excellentreading.firebaseapp.com', projectId: 'demo-excellentreading' }
  : firebaseConfig;

export const configured = !!(config && config.apiKey && config.projectId);
export const app = configured ? initializeApp(config) : null;
export const auth = app ? getAuth(app) : null;

if (auth) {
  auth.languageCode = 'pt-BR'; // e-mails de redefinição de senha e janela do Google em português
  if (useEmulator) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}

// Quem desmarca "Manter conectado" (computador compartilhado) não deixa cópia dos textos no navegador.
export function sessionOnly() {
  try { return sessionStorage.getItem('er.sessionOnly') === '1'; } catch { return false; }
}
export function setSessionOnly(on) {
  try { if (on) sessionStorage.setItem('er.sessionOnly', '1'); else sessionStorage.removeItem('er.sessionOnly'); } catch { /* ignora */ }
}

let db = null;

// O banco só é criado depois do login, para saber se pode guardar cache no aparelho.
export function getDb() {
  if (!db) {
    let localCache;
    try {
      localCache = sessionOnly() ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() });
    } catch {
      localCache = memoryLocalCache();
    }
    db = initializeFirestore(app, { localCache, ignoreUndefinedProperties: true });
    if (useEmulator) connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  return db;
}

export const dbStarted = () => db;
