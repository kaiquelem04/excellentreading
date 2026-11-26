# excellentreading

Leitor guiado para acelerar a leitura. Você envia um texto em **.txt**, **.md** ou **.pdf** e uma bolinha passa por baixo de cada palavra na velocidade que você escolher num slider (50 a 1000 palavras por minuto).

## O que ele faz

- **Bolinha guia** que desliza de palavra em palavra e rola a página sozinha.
- **Slider de velocidade** (com botões − / + e setas do teclado).
- **Ritmo natural** (opcional): pausa um pouco mais em vírgulas, pontos finais e palavras longas, e compensa nas curtas. A média continua sendo a velocidade escolhida.
- **Conta com login** (Google ou e-mail e senha; Apple pronto para ativar). A biblioteca, a posição de leitura e os sublinhados ficam na conta e aparecem em qualquer aparelho. Fica salvo também no aparelho, para abrir rápido e funcionar sem internet.
- **Sublinhador**: selecione um trecho e toque em *Sublinhar* (ou aperte `H` para sublinhar a frase em que a bolinha está). Os trechos ficam numa abinha na lateral, em ordem de leitura: clique para voltar ao trecho, copie, apague, ou baixe todos como `.md`.
- **Renomear** textos pelo lápis na biblioteca ou clicando no título no topo.
- **Clique em qualquer palavra** para recomeçar dali; arraste a barra de progresso para pular.
- Tela de abertura, tema claro/escuro/sistema, tamanho e tipo de letra, funciona no celular, mantém a tela acesa enquanto lê.

### Atalhos

| Tecla | Ação |
|---|---|
| `Espaço` | play / pausa |
| `↑` / `↓` | +10 / −10 palavras por minuto (`Shift` = 50) |
| `←` / `→` | frase anterior / próxima (`Shift` = uma palavra) |
| `H` | sublinhar a seleção (ou a frase atual) |
| `S` | abrir / fechar os sublinhados |
| `B` | abrir a biblioteca |

## Configurar o login (Firebase) — uma vez só

O site é estático (GitHub Pages), então as contas e o banco de dados ficam no **Firebase**, do Google. O plano gratuito (Spark) sobra para uso pessoal.

1. **Criar o projeto:** em <https://console.firebase.google.com>, *Adicionar projeto* → dê um nome (ex.: `excellentreading`) → pode desativar o Google Analytics → *Criar*.
2. **Registrar o site:** na página do projeto, clique no ícone **`</>`** (Web) → apelido `excellentreading` → *Registrar app* (não precisa marcar Hosting). Copie o objeto `firebaseConfig` que aparece e cole em [`js/firebase-config.js`](js/firebase-config.js) no lugar de `null`. Esses valores não são secretos.
3. **Ligar os jeitos de entrar:** menu *Criação* → **Authentication** → *Vamos começar* → aba **Sign-in method**:
   - **E-mail/senha** → ativar → salvar.
   - **Google** → ativar → escolha o e-mail de suporte → salvar.
4. **Autorizar o endereço do site:** ainda em Authentication → aba **Configurações** → **Domínios autorizados** → *Adicionar domínio* → `kaiquelem04.github.io`.
5. **Criar o banco:** menu *Criação* → **Firestore Database** → *Criar banco de dados* → local `southamerica-east1 (São Paulo)` → **modo de produção** → *Criar*.
6. **Proteger os dados:** no Firestore, aba **Regras** → apague tudo, cole o conteúdo de [`firestore.rules`](firestore.rules) → *Publicar*. Sem isso, ninguém consegue gravar (o modo de produção bloqueia tudo por padrão).

Pronto: o login funciona no site publicado. Para testar no seu computador, use `http://localhost` (já autorizado por padrão).

### Botão oficial do Google (recomendado)

Por padrão, o login com Google abre uma janela do Firebase: o Google mostra "Prosseguir para excellentreading-5faea.firebaseapp.com" e alguns navegadores bloqueiam a janela. O botão oficial do Google resolve os dois (mostra o endereço do site e não é bloqueado). Para ligar:

1. Abra <https://console.cloud.google.com/apis/credentials?project=excellentreading-5faea>.
2. Em **IDs do cliente OAuth 2.0**, clique em **Web client (auto created by Google Service)**.
3. Em **Origens JavaScript autorizadas**, adicione `https://kaiquelem04.github.io` (e, se quiser testar no computador, `http://localhost` e `http://localhost:8000`). Salve. O Google avisa que pode levar de 5 minutos a algumas horas para valer.
4. Em [`js/firebase-config.js`](js/firebase-config.js), troque `googleSignInMode = 'popup'` por `googleSignInMode = 'google-button'`.

### Mostrar "excellentreading" nas telas do Google e nos e-mails

- **E-mails** (redefinição de senha): no Firebase, ⚙ **Configurações do projeto** → **Geral** → **Nome voltado ao público** → `excellentreading`.
- **Tela de login do Google**: o nome do app só aparece no lugar do endereço depois que a marca é verificada pelo Google. Em <https://console.cloud.google.com/auth/branding?project=excellentreading-5faea>, preencha o nome `excellentreading`, e-mail de suporte, página inicial e política de privacidade, e envie para verificação. O Google pode pedir para provar que o domínio é seu.

### Ativar "Entrar com Apple" (depois)

Exige uma conta no [Apple Developer Program](https://developer.apple.com/programs/) (US$ 99/ano). Com ela:

1. No portal da Apple, crie um **Services ID**, ative *Sign in with Apple* nele e cadastre o domínio `SEU-PROJETO.firebaseapp.com` com a URL de retorno `https://SEU-PROJETO.firebaseapp.com/__/auth/handler`.
2. Crie uma **Key** com *Sign in with Apple* e baixe o arquivo `.p8`.
3. No Firebase, Authentication → Sign-in method → **Apple** → ativar → preencha Services ID, Team ID, Key ID e a chave privada.
4. Em [`js/firebase-config.js`](js/firebase-config.js), mude `enableApple` para `true`.

## Como rodar no computador

É um site estático, sem build. Qualquer servidor serve:

```bash
python3 -m http.server 8000
```

Depois abra `http://localhost:8000`. (Abrir o `index.html` direto do disco não funciona porque o navegador bloqueia módulos JavaScript em `file://`.)

Para testar sem mexer no projeto real, dá para usar os emuladores do Firebase (precisa de Node e Java): rode `npx firebase-tools emulators:start --only auth,firestore --project demo-excellentreading` e abra `http://localhost:8000/?emulator`.

### Publicar no GitHub Pages

1. No repositório, vá em **Settings → Pages**.
2. Em **Source**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`.
3. Em um ou dois minutos o site fica em `https://<seu-usuario>.github.io/excellentreading/`.

## Privacidade

- Os textos que você envia, a posição de leitura e os sublinhados ficam guardados no Firestore, dentro da sua conta. As regras do banco só deixam cada pessoa ler e gravar o que é dela.
- Uma cópia fica no navegador para abrir rápido e funcionar sem internet. Ao **sair da conta**, essa cópia é apagada. Se você desmarcar **Manter conectado**, nada fica salvo no navegador e o login vale só para aquela aba.
- Senhas não passam pelo código do site: quem cuida delas é o Firebase Authentication.

## Limitações conhecidas

- **PDF digitalizado** (página escaneada como imagem) não tem texto para extrair; o site avisa quando é o caso.
- Em PDFs, a separação de parágrafos e a remoção de cabeçalhos/rodapés são feitas por heurística. Funciona bem em livros e artigos comuns; layouts em várias colunas ou com muitas tabelas podem sair embaralhados.
- Palavras hifenizadas no fim da linha do PDF são juntadas ("exem-plo" → "exemplo"). Isso também junta palavras compostas que caíram exatamente na quebra ("guarda-chuva" → "guardachuva").
- O e-mail não é verificado no cadastro (qualquer e-mail é aceito). "Esqueci a senha" só funciona para e-mails reais.

## Estrutura

```
index.html              página
css/style.css           visual
js/app.js               leitura, bolinha, controles, biblioteca, sublinhados
js/auth.js              tela de login, cadastro, sair
js/firebase.js          inicialização do Firebase
js/firebase-config.js   configuração do seu projeto Firebase (preencher)
js/storage.js           textos e sublinhados na nuvem (Firestore)
js/parsers.js           leitura de .txt / .md / .pdf
js/sample.js            texto de exemplo
firestore.rules         regras de segurança do banco
vendor/pdfjs/           pdf.js 5.7.284 (Mozilla, Apache-2.0), carregado só quando você abre um PDF
vendor/firebase/        Firebase JS SDK 12.19.0 (Google, Apache-2.0): app, auth e firestore
```
