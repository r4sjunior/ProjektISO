# PS1 Web

Biblioteca de jogos de PlayStation 1 que roda no navegador (desktop e celular), usando o [EmulatorJS](https://emulatorjs.org) com o núcleo PCSX ReARMed.

## Estrutura

```
index.html
css/style.css
js/app.js
games/
  games.json      <- lista de jogos exibida na biblioteca
  covers/         <- capas (opcional)
  jogo1.chd       <- seus jogos
bios/             <- BIOS opcional
.nojekyll
```

## Adicionar seus 2 jogos

1. Coloque os arquivos em `games/` (ex.: `games/jogo1.chd`).
2. Edite `games/games.json`: ajuste `title`, `file`, `cover`, `year` e `genre`.
3. (Opcional) Coloque as capas em `games/covers/`.

Se não houver capa, o card mostra a inicial do título.

### Formatos

Prefira **`.chd`** (compactado, 1 arquivo). Para converter um `.cue/.bin`:

```bash
chdman createcd -i jogo.cue -o jogo.chd
```

Também funcionam `.pbp`, `.iso`, `.zip` e `.7z`. Evite `.cue` + `.bin` separados.

### BIOS (opcional)

Coloque a BIOS do seu console em `bios/` e informe no `games.json`:

```json
"bios": "bios/scph1001.bin"
```

## Limites do GitHub (importante)

- Arquivos acima de **100 MB** são bloqueados em um push normal.
- Repositórios acima de ~1 GB não são recomendados.
- O GitHub Pages **não serve arquivos do Git LFS**.

Se seus jogos forem grandes, hospede os arquivos em outro lugar (bucket com CORS liberado) e use a URL completa em `file`:

```json
"file": "https://seu-storage.exemplo.com/jogo1.chd"
```

## Celular

- O gamepad virtual (direcional, botões, L/R) aparece automaticamente em telas de toque.
- Joga melhor na horizontal. Um aviso aparece se o celular estiver na vertical.
- O player ocupa a tela inteira. O botão **Jogos** volta para a biblioteca.

## Rodar localmente

```bash
python3 -m http.server 8000
```

Acesse `http://localhost:8000`.

## Publicar

Settings → Pages → Deploy from a branch → `main` / root.

## Aviso legal

O projeto não inclui jogos nem BIOS. Use apenas conteúdo que você possui legalmente.
