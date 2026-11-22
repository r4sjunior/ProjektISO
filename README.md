# PS1 Web

Biblioteca de jogos de PlayStation 1 que roda no navegador (desktop e celular) com o [EmulatorJS](https://emulatorjs.org).
O admin envia os jogos pelo painel `admin.html`; eles ficam guardados no **Cloudflare R2** e aparecem para todos os jogadores.

```
Navegador (GitHub Pages)  ──►  Worker (login + upload + entrega)  ──►  R2 (arquivos dos jogos)
```

## Estrutura

```
index.html        biblioteca + player
admin.html        painel do admin (login e upload)
css/ js/          front-end (js/config.js guarda a URL do Worker)
worker/           API (Cloudflare Worker)
games/games.json  jogos fixos opcionais (pode ficar vazio)
```

## 1. Publicar o Worker (uma vez)

Você precisa de uma conta gratuita na Cloudflare e do Node.js. O R2 pode pedir o cadastro de um cartão para ser ativado; o plano grátis inclui 10 GB.

```bash
cd worker
npm install
npx wrangler login
npx wrangler r2 bucket create ps1-games
```

Edite `worker/wrangler.toml` e troque `SEU-USUARIO` pela sua conta do GitHub em `ALLOWED_ORIGINS`.

Defina os segredos (o usuário e a senha **não** ficam no código):

```bash
npx wrangler secret put ADMIN_USER     # digite o usuário do admin
npx wrangler secret put ADMIN_PASS     # digite uma senha forte
npx wrangler secret put JWT_SECRET     # cole um texto aleatório longo
```

Para gerar o `JWT_SECRET`: `openssl rand -hex 32`

Publique:

```bash
npx wrangler deploy
```

O terminal mostra a URL, algo como `https://ps1-web-api.SUA-CONTA.workers.dev`.

## 2. Ligar o site ao Worker

Abra `js/config.js` e cole a URL:

```js
window.PS1_CONFIG = { API_BASE: "https://ps1-web-api.SUA-CONTA.workers.dev" };
```

Faça commit e push. Ative o GitHub Pages em Settings → Pages (branch `main`, pasta root).

## 3. Usar

1. Abra `https://SEU-USUARIO.github.io/NOME-DO-REPO/admin.html`
2. Entre com o usuário e a senha definidos nos segredos.
3. Preencha título, ano, gênero, escolha o arquivo do jogo (e a capa, se quiser) e clique em **Enviar jogo**.
4. O jogo aparece na biblioteca para todos.

Arquivos grandes são enviados em partes de 50 MB, com barra de progresso e nova tentativa automática. Não feche a aba durante o envio.

## Testar localmente

```bash
# terminal 1
cd worker
echo 'ADMIN_USER=admin' > .dev.vars
echo 'ADMIN_PASS=teste123' >> .dev.vars
echo 'JWT_SECRET=segredo-local' >> .dev.vars
npx wrangler dev          # http://localhost:8787

# terminal 2 (na raiz do projeto)
python3 -m http.server 8000
```

Use `http://localhost:8787` em `js/config.js` durante o teste. O arquivo `.dev.vars` já está no `.gitignore`.

## Segurança

- Usuário e senha ficam só nos segredos do Cloudflare. A senha nunca vai para o GitHub.
- O login gera um token assinado que expira em 12 horas.
- Só o admin consegue enviar ou excluir. A biblioteca é pública para leitura.
- Recomendado: no painel da Cloudflare, crie uma regra de **Rate Limiting** para `/api/login` (limita tentativas de senha).
- Troque a senha se ela já foi compartilhada em algum lugar.

## Formatos

Prefira `.chd` (1 arquivo compactado). Para converter um `.cue/.bin`:

```bash
chdman createcd -i jogo.cue -o jogo.chd
```

Também funcionam `.pbp`, `.iso`, `.zip`, `.7z`.

## Celular

O gamepad virtual (direcional, botões, L/R) aparece automaticamente em telas de toque. O player ocupa a tela inteira e funciona melhor na horizontal.

## Aviso legal

O projeto não inclui jogos nem BIOS. Publique apenas conteúdo que você tem direito de distribuir. Hospedar jogos comerciais para o público pode violar direitos autorais e levar a remoção do site.
