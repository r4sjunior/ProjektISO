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
    // Aparelho "leve": celular/tablet ou máquina com poucos núcleos/memória
    const weak =
      matchMedia("(pointer: coarse)").matches ||
      (navigator.hardwareConcurrency || 4) <= 4 ||
      (navigator.deviceMemory || 8) <= 4;
    // Threads só em computadores fortes: o núcleo com threads reserva 512 MB de memória
    // logo no início e derruba a página em celulares (tela branca).
    window.EJS_threads = !weak && !!window.crossOriginIsolated;
    // Em aparelhos leves, não guarda jogos grandes no cache do navegador: a gravação
    // mantém mais uma cópia do jogo na memória e estoura o limite em jogos de 600 MB+.
    if (weak) window.EJS_CacheLimit = 300 * 1024 * 1024;
    window.EJS_defaultOptions = {
      // Pula quadros só quando o áudio está para faltar: mantém o som contínuo
      pcsx_rearmed_frameskip_type: "auto",
      pcsx_rearmed_spu_interpolation: "simple",
      pcsx_rearmed_dithering: weak ? "disabled" : "enabled",
      // O eco (reverb) é a parte mais pesada do áudio do PS1
      pcsx_rearmed_spu_reverb: weak ? "disabled" : "enabled",
    };
    // Buffer de áudio maior (o padrão do EmulatorJS é 64 ms, curto demais e causa cortes)
    patchAudioLatency(weak ? 128 : 96);
    // O gamepad virtual (direcional, botões e gatilhos) aparece sozinho em telas de toque.
    window.EJS_VirtualGamepadSettings = undefined;
    window.EJS_onGameStart = installDpad;
    const biosUrl = bios || manifest.bios;
    if (biosUrl) window.EJS_biosUrl = biosUrl;

    const s = document.createElement("script");
    s.src = EJS_DATA + "loader.js";
    document.body.appendChild(s);
  }

  // O EmulatorJS grava "audio_latency = 64" no retroarch.cfg. Ajusta esse valor
  // assim que a classe EJS_GameManager é definida (antes de o jogo iniciar).
  function patchAudioLatency(ms) {
    const patch = (GM) => {
      if (!GM || !GM.prototype || GM.prototype.__latencyPatched) return GM;
      const orig = GM.prototype.getRetroArchCfg;
      GM.prototype.getRetroArchCfg = function () {
        return orig.call(this).replace(/audio_latency = \d+/, "audio_latency = " + ms);
      };
      GM.prototype.__latencyPatched = true;
      return GM;
    };
    if (window.EJS_GameManager) { patch(window.EJS_GameManager); return; }
    let value;
    Object.defineProperty(window, "EJS_GameManager", {
      configurable: true,
      get: () => value,
      set: (v) => { value = patch(v); },
    });
  }

  // Direcional próprio (substitui o do EmulatorJS): maior, 8 direções, zona morta
  // proporcional e continua funcionando se o dedo escorregar para fora.
  const DIR = { up: 4, down: 5, left: 6, right: 7 }; // índices do RetroPad
  function installDpad() {
    const area = document.querySelector(".ejs_virtualGamepad_left");
    const emu = window.EJS_emulator;
    if (!area || !emu || area.querySelector(".pad")) return;

    const pad = document.createElement("div");
    pad.className = "pad";
    pad.innerHTML =
      '<span class="pad-arm up"></span><span class="pad-arm down"></span>' +
      '<span class="pad-arm left"></span><span class="pad-arm right"></span>';
    area.appendChild(pad);

    const held = { up: 0, down: 0, left: 0, right: 0 };
    const send = (next) => {
      let changed = false;
      for (const k in held) {
        if (held[k] !== next[k]) {
          held[k] = next[k];
          changed = true;
          emu.gameManager.simulateInput(0, DIR[k], next[k]);
          pad.classList.toggle("on-" + k, !!next[k]);
        }
      }
      if (changed && navigator.vibrate && (next.up || next.down || next.left || next.right)) navigator.vibrate(8);
    };

    let pointer = null;
    const update = (e) => {
      const r = pad.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      const next = { up: 0, down: 0, left: 0, right: 0 };
      if (Math.hypot(x, y) > r.width * 0.12) {
        // 8 setores de 45°: 0 = direita, sentido horário
        const s = Math.round(Math.atan2(y, x) / (Math.PI / 4));
        const sector = (s + 8) % 8;
        if ([7, 0, 1].includes(sector)) next.right = 1;
        if ([1, 2, 3].includes(sector)) next.down = 1;
        if ([3, 4, 5].includes(sector)) next.left = 1;
        if ([5, 6, 7].includes(sector)) next.up = 1;
      }
      send(next);
    };
    const release = (e) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      send({ up: 0, down: 0, left: 0, right: 0 });
    };

    pad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pointer = e.pointerId;
      pad.setPointerCapture(pointer);
      update(e);
    });
    pad.addEventListener("pointermove", (e) => { if (e.pointerId === pointer) update(e); });
    pad.addEventListener("pointerup", release);
    pad.addEventListener("pointercancel", release);
    pad.addEventListener("lostpointercapture", release);
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
