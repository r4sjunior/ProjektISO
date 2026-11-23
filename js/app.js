(() => {
  const $ = (id) => document.getElementById(id);
  const grid = $("grid"), msg = $("msg");
  const EJS_DATA = "https://cdn.emulatorjs.org/stable/data/";
  let manifest = { bios: null, games: [] };
  let started = false;

  function say(text, isError) {
    msg.textContent = text || "";
    msg.className = "msg" + (isError ? " error" : "");
  }

  async function loadManifest() {
    const games = [];
    try {
      const r = await fetch("games/games.json", { cache: "no-cache" });
      if (r.ok) {
        const m = await r.json();
        manifest.bios = m.bios || null;
        games.push(...(m.games || []));
      }
    } catch (e) { /* games.json é opcional */ }

    const api = ((window.PS1_CONFIG || {}).API_BASE || "").replace(/\/$/, "");
    if (api) {
      try {
        const r = await fetch(api + "/api/games", { cache: "no-cache" });
        if (!r.ok) throw new Error(r.status);
        const m = await r.json();
        games.push(...m.games);
      } catch (e) {
        say("Não consegui carregar os jogos do servidor. Tente novamente em instantes.", true);
      }
    }
    manifest.games = games;
    render();
  }

  function render() {
    grid.textContent = "";
    if (!manifest.games.length) { say("Nenhum jogo disponível ainda."); return; }
    for (const g of manifest.games) {
      const b = document.createElement("button");
      b.className = "card"; b.type = "button";
      const cover = document.createElement("div");
      cover.className = "cover";
      cover.textContent = (g.title || "?").trim().charAt(0).toUpperCase();
      if (g.cover) {
        const img = new Image();
        img.alt = ""; img.loading = "lazy";
        img.onload = () => { cover.textContent = ""; cover.appendChild(img); };
        img.src = g.cover;
      }
      const h = document.createElement("h3"); h.textContent = g.title;
      const m = document.createElement("span"); m.className = "meta";
      m.textContent = [g.year, g.genre].filter(Boolean).join(" · ");
      b.append(cover, h, m);
      b.addEventListener("click", () => playRemote(g));
      grid.appendChild(b);
    }
  }

  async function playRemote(g) {
    say("Verificando arquivo...");
    try {
      const r = await fetch(g.file, { method: "HEAD" });
      if (!r.ok) throw new Error();
    } catch (e) {
      say("Arquivo não encontrado: " + g.file + ". Coloque o jogo na pasta games/ e confira o games.json.", true);
      return;
    }
    say("");
    start({ url: g.file, name: g.id || g.title });
  }

  function start({ url, name, bios }) {
    if (started) return;
    started = true;
    $("library").hidden = true;
    $("player").hidden = false;
    $("rotate").hidden = false;
    setTimeout(() => ($("rotate").hidden = true), 5000);

    window.EJS_player = "#game";
    window.EJS_core = "psx";
    window.EJS_gameUrl = url;
    window.EJS_gameName = name;
    window.EJS_pathtodata = EJS_DATA;
    window.EJS_startOnLoaded = true;
    window.EJS_color = "#2a5db0";
    window.EJS_language = "pt-BR";
    window.EJS_mouse = false;
    // O gamepad virtual (direcional, botões e gatilhos) aparece sozinho em telas de toque.
    window.EJS_VirtualGamepadSettings = undefined;
    const biosUrl = bios || manifest.bios;
    if (biosUrl) window.EJS_biosUrl = biosUrl;

    const s = document.createElement("script");
    s.src = EJS_DATA + "loader.js";
    document.body.appendChild(s);
  }

  // Arquivo local
  $("localBtn").addEventListener("click", () => $("localRom").click());
  $("localRom").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) start({ url: URL.createObjectURL(f), name: f.name });
  });

  // Voltar: recarrega a página para liberar o emulador por completo
  $("back").addEventListener("click", () => location.reload());
  $("player").addEventListener("contextmenu", (e) => e.preventDefault());

  loadManifest();
})();
