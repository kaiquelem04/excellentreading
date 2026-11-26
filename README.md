# excellentreading

Leitor guiado para acelerar a leitura. Você envia um texto em **.txt**, **.md** ou **.pdf** e uma bolinha passa por baixo de cada palavra na velocidade que você escolher num slider (50 a 1000 palavras por minuto).

## O que ele faz

- **Bolinha guia** que desliza de palavra em palavra e rola a página sozinha.
- **Slider de velocidade** (com botões − / + e setas do teclado).
- **Ritmo natural** (opcional): pausa um pouco mais em vírgulas, pontos finais e palavras longas, e compensa nas curtas. A média continua sendo a velocidade escolhida.
- **Biblioteca salva no navegador**: os textos e o ponto onde você parou ficam guardados (IndexedDB). Nada é enviado para servidor nenhum.
- **Sublinhador**: selecione um trecho e toque em *Sublinhar* (ou aperte `H` para sublinhar a frase em que a bolinha está). Os trechos ficam numa abinha na lateral, em ordem de leitura: clique para voltar ao trecho, copie, apague, ou baixe todos como `.md`.
- **Renomear** textos pelo lápis na biblioteca ou clicando no título no topo.
- **Clique em qualquer palavra** para recomeçar dali; arraste a barra de progresso para pular.
- Tema claro/escuro, tamanho e tipo de letra, funciona no celular, mantém a tela acesa enquanto lê.

### Atalhos

| Tecla | Ação |
|---|---|
| `Espaço` | play / pausa |
| `↑` / `↓` | +10 / −10 palavras por minuto (`Shift` = 50) |
| `←` / `→` | frase anterior / próxima (`Shift` = uma palavra) |
| `H` | sublinhar a seleção (ou a frase atual) |
| `S` | abrir / fechar os sublinhados |
| `B` | abrir a biblioteca |

## Como rodar

É um site estático, sem build. Qualquer servidor serve:

```bash
python3 -m http.server 8000
```

Depois abra `http://localhost:8000`. (Abrir o `index.html` direto do disco não funciona porque o navegador bloqueia módulos JavaScript em `file://`.)

### Publicar no GitHub Pages

1. No repositório, vá em **Settings → Pages**.
2. Em **Source**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`.
3. Em um ou dois minutos o site fica em `https://<seu-usuario>.github.io/excellentreading/`.

## Limitações conhecidas

- **PDF digitalizado** (página escaneada como imagem) não tem texto para extrair; o site avisa quando é o caso.
- Em PDFs, a separação de parágrafos e a remoção de cabeçalhos/rodapés são feitas por heurística. Funciona bem em livros e artigos comuns; layouts em várias colunas ou com muitas tabelas podem sair embaralhados.
- Palavras hifenizadas no fim da linha do PDF são juntadas ("exem-plo" → "exemplo"). Isso também junta palavras compostas que caíram exatamente na quebra ("guarda-chuva" → "guardachuva").
- A biblioteca (e os sublinhados) fica só no navegador e aparelho em que você abriu o texto. Limpar os dados do site apaga tudo; use *baixar .md* para guardar os sublinhados fora do navegador.

## Estrutura

```
index.html          página
css/style.css       visual
js/app.js           leitura, bolinha, controles, biblioteca
js/parsers.js       leitura de .txt / .md / .pdf
js/storage.js       IndexedDB
js/sample.js        texto de exemplo
vendor/pdfjs/       pdf.js 5.7.284 (Mozilla, Apache-2.0), carregado só quando você abre um PDF
```
