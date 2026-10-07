# Final Fight X Web v0.3

Port web do Final Fight X Native v0.3.47 (Scene Remaster 50), compilado para WebAssembly com Emscripten.

## Executar
Este pacote precisa ser servido por HTTP/HTTPS. Nao abra `index.html` diretamente por `file://`.

Para teste local:

```bash
python -m http.server 8000
```

Depois abra `http://localhost:8000/`.

## GitHub Pages
Publique **o conteudo desta pasta na raiz do repositorio** (nao a pasta ZIP fechada). Em Settings > Pages escolha a branch/pasta que contem `index.html`.

Arquivos essenciais na raiz:
- `index.html`
- `style.css`
- `app.js`
- `ffx.js`
- `ffx.wasm`
- `asset-meta.json`
- `webfs-config.json`
- pasta `assets/`
- `.nojekyll`

Nenhum backend, PHP, Node.js ou servidor dedicado e necessario em producao.

## Controles
- Teclado: mesmos bindings do port nativo; setas/WASD no menu.
- Gamepad: Gamepad API do navegador (padrao XInput/standard mapping).
- Mobile: controles touch aparecem apenas em dispositivo de toque; jogar em paisagem.
- Fullscreen: botao `Tela cheia` ou opcao do menu quando suportado pelo navegador.

## Saves
Configuracoes e progresso sao gravados em `/save` usando IDBFS/IndexedDB do navegador. Limpar os dados do site pode apagar o save.

## Assets
- 1.519 imagens logicas originais em GIF.
- 1.519 substituicoes HD externas, incluindo o Scene Remaster 50 auditado.
- 41 musicas BOR convertidas para OGG para compatibilidade web.
- Efeitos WAV preservados.

As imagens HD sao carregadas sob demanda para evitar transferir todo o pacote no inicio.

## Base tecnica
- Game/core: C++20 preservado e compilado para WASM.
- Renderer: ponte Canvas 2D.
- Audio: Web Audio/HTML Audio.
- Input: Keyboard + Gamepad API + touch.
- Fullscreen: Fullscreen API.
- Persistencia: IndexedDB via Emscripten IDBFS.


## Novidades da v0.3

- Diagnóstico integrado pelo botão **Diagnóstico**.
- Testa WASM, Canvas, Web Audio, Gamepad API, Fullscreen, IndexedDB e filesystem de save.
- Confere `levels.txt`, `models.txt`, `menu.txt` e a definição da primeira fase.
- Confere assets essenciais da tela inicial e `64th.1`.
- Confere uma música OGG real.
- Mostra erros JavaScript/WASM capturados na sessão.
- Botão **VOLTAR** adicionado aos controles touch.
- Controles touch usam pointer capture para multitouch mais estável.
- Flush adicional do save ao sair/trocar de página.
- Preferência de mute persistente.
- Service Worker para cache do núcleo (`HTML/CSS/JS/WASM/manifests`) sem tentar armazenar todo o pacote HD.

## Correção principal da v0.3

O diagnóstico da v0.2 mostrou o padrão clássico de execução por `file://`:
imagens carregavam, mas `fetch()`, manifests, OGG e o bootstrap do WASM não.

A v0.3:
- detecta `file://` antes de carregar o engine;
- mostra uma mensagem clara em vez de ficar preso em "Inicializando";
- carrega `ffx.js` dinamicamente somente em HTTP/HTTPS;
- usa URLs absolutas baseadas em `document.baseURI`, incluindo GitHub Pages em subpastas;
- testa `asset-meta.json`, `webfs-config.json` e `ffx.wasm` separadamente;
- mostra HTTP 404/403 e erro de fetch individualmente;
- remove o teste de áudio com `Range`, evitando falso negativo;
- remove/desregistra o Service Worker de depuração da v0.2 e limpa seu cache antigo;
- inclui `INICIAR-LOCAL.bat` para teste local via HTTP em Windows.
