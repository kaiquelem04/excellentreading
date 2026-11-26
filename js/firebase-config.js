// Configuração do projeto Firebase.
//
// Onde pegar: console.firebase.google.com → seu projeto → ⚙ Configurações do projeto →
// "Seus apps" → app da Web → "Configuração do SDK" → opção "Config".
//
// Esses valores NÃO são segredos: eles só identificam o projeto e aparecem no código de
// qualquer site que usa Firebase. Quem protege os dados de cada pessoa são as regras do
// Firestore (arquivo firestore.rules), que só deixam cada usuário ler e gravar o que é dele.

export const firebaseConfig = {apiKey: "AIzaSyDlrtEPSLS4QxKGF-4ADkbEa1VbtKSNOcw",
  authDomain: "excellentreading-5faea.firebaseapp.com",
  projectId: "excellentreading-5faea",
  storageBucket: "excellentreading-5faea.firebasestorage.app",
  messagingSenderId: "478178477502",
  appId: "1:478178477502:web:9e9b8affc3a50e307065ef",
  measurementId: "G-4NJPQ9H37D"};

/* Exemplo do formato (troque `null` acima por algo assim):
export const firebaseConfig = {
  apiKey: 'AIza...',
  authDomain: 'seu-projeto.firebaseapp.com',
  projectId: 'seu-projeto',
  storageBucket: 'seu-projeto.firebasestorage.app',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abc123',
};
*/

// Botão "Continuar com Google":
//  - 'popup': janela do Firebase. Funciona sem configurar nada a mais, mas o Google mostra
//    "Prosseguir para excellentreading-5faea.firebaseapp.com" e alguns navegadores bloqueiam a janela.
//  - 'google-button': botão oficial do Google. Mostra o endereço do site e não é bloqueado.
//    ANTES de ligar, autorize o endereço do site no Google Cloud (veja o README, seção
//    "Botão oficial do Google"), senão o Google responde "origin_mismatch".
export const googleSignInMode = 'popup';

// ID do cliente OAuth "Web client (auto created by Google Service)" do projeto (não é segredo).
export const googleClientId = '478178477502-v9sffg17tu25r4g1mgcnq69h19e5rcm0.apps.googleusercontent.com';

// "Entrar com Apple": mude para true depois de configurar a Apple no Firebase
// (exige conta Apple Developer, US$ 99/ano). Veja o README.
export const enableApple = false;
