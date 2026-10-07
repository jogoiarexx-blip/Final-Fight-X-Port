# Publicacao no GitHub Pages

1. Crie/abra o repositorio que vai hospedar o jogo.
2. Extraia `Final-Fight-X-Web-v0.3-GitHub-Pages.zip`.
3. Envie **todos os arquivos e a pasta `assets`** para a branch de publicacao.
4. Confirme que `index.html` esta na raiz da pasta publicada.
5. Em **Settings > Pages**, selecione `Deploy from a branch` e a branch/pasta correspondente (`/(root)` e o mais simples).
6. Abra o endereco fornecido pelo Pages.

O site usa somente caminhos relativos, portanto funciona em URL de projeto como:
`https://usuario.github.io/nome-do-repositorio/`.

### Importante
- O repositorio precisa manter a estrutura de pastas exatamente como esta no ZIP.
- Nao renomeie `ffx.js`, `ffx.wasm`, `assets`, `asset-meta.json` ou `webfs-config.json`.
- O primeiro acesso baixa apenas engine/configuracao e os assets necessarios para a tela atual; imagens seguintes sao carregadas sob demanda.
- Audio no navegador normalmente so e liberado depois do primeiro clique/toque/tecla do usuario.


### Teste recomendado depois de publicar

Abra a URL com `?diagnostics=1`, por exemplo:

`https://USUARIO.github.io/REPOSITORIO/?diagnostics=1`

O painel verificará automaticamente o runtime, os manifests, a primeira fase, áudio, save e assets essenciais.

### Atenção: não abrir por duplo clique

Se a barra de endereço começar com `file:///`, o jogo não poderá iniciar.
GitHub Pages sempre usa `https://`, que é o modo correto.

Para testar a pasta no Windows antes de publicar, use `INICIAR-LOCAL.bat`.
