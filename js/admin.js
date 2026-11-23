(() => {
  const $ = (id) => document.getElementById(id);
  const API = ((window.PS1_CONFIG || {}).API_BASE || "").replace(/\/$/, "");
  const PART_SIZE = 50 * 1024 * 1024; // 50 MiB por parte
  const KEY = "ps1_admin_token";
  let token = sessionStorage.getItem(KEY) || "";
  let busy = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmtSize = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + " GB" : (n / 1e6).toFixed(1) + " MB");

  function setMsg(id, text, isError) {
    const el = $(id);
    el.textContent = text || "";
    el.className = "msg" + (isError ? " error" : "");
  }

  function show() {
    $("login").hidden = !!token;
    $("panel").hidden = !token;
    if (token) loadList();
  }

  function logout() {
    token = "";
    sessionStorage.removeItem(KEY);
    show();
  }

  async function call(path, opts = {}) {
    const headers = new Headers(opts.headers || {});
    if (token) headers.set("Authorization", "Bearer " + token);
    const r = await fetch(API + path, { ...opts, headers });
    const data = await r.json().catch(() => null);
    if (r.status === 401 && token) {
      logout();
      throw new Error("Sessão expirada. Entre novamente.");
    }
    if (!r.ok) throw new Error((data && data.error) || "Erro " + r.status);
    return data;
  }

  function putPart(url, blob, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", url);
      x.setRequestHeader("Authorization", "Bearer " + token);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) {
          try { resolve(JSON.parse(x.responseText)); } catch { reject(new Error("Resposta inválida")); }
        } else reject(new Error("Falha no envio (" + x.status + ")"));
      };
      x.onerror = () => reject(new Error("Falha de rede"));
      x.send(blob);
    });
  }

  function progress(done, total) {
    const pct = Math.min(100, (done / total) * 100);
    $("bar").value = pct;
    setMsg("upMsg", `Enviando... ${pct.toFixed(0)}% (${fmtSize(done)} de ${fmtSize(total)})`);
  }

  /* Login */
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg("loginMsg", "Entrando...");
    try {
      const r = await fetch(API + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: $("user").value.trim(), pass: $("pass").value }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Falha no login");
      token = d.token;
      sessionStorage.setItem(KEY, token);
      $("pass").value = "";
      setMsg("loginMsg", "");
      show();
    } catch (err) {
      setMsg("loginMsg", err.message, true);
    }
  });
  $("logout").addEventListener("click", logout);

  /* Upload */
  $("uploadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const title = $("title").value.trim();
    const file = $("gameFile").files[0];
    const cover = $("coverFile").files[0];
    if (!title || !file) { setMsg("upMsg", "Informe o título e o arquivo do jogo.", true); return; }

    busy = true;
    $("sendBtn").disabled = true;
    $("bar").hidden = false;
    $("bar").value = 0;
    let session = null;
    try {
      let coverKey = null;
      if (cover) {
        setMsg("upMsg", "Enviando capa...");
        const c = await call("/api/admin/cover?name=" + encodeURIComponent(cover.name), {
          method: "PUT",
          headers: { "Content-Type": cover.type || "image/jpeg" },
          body: cover,
        });
        coverKey = c.key;
      }

      session = await call("/api/admin/upload/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name }),
      });

      const total = Math.max(1, Math.ceil(file.size / PART_SIZE));
      const parts = [];
      let done = 0;
      for (let i = 0; i < total; i++) {
        const blob = file.slice(i * PART_SIZE, (i + 1) * PART_SIZE);
        const url = `${API}/api/admin/upload/part?key=${encodeURIComponent(session.key)}&uploadId=${encodeURIComponent(session.uploadId)}&partNumber=${i + 1}`;
        let res, attempt = 0;
        for (;;) {
          try {
            res = await putPart(url, blob, (loaded) => progress(done + loaded, file.size));
            break;
          } catch (err) {
            if (++attempt >= 3) throw err;
            await sleep(1500 * attempt);
          }
        }
        done += blob.size;
        parts.push(res);
        progress(done, file.size);
      }

      setMsg("upMsg", "Finalizando...");
      await call("/api/admin/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: session.key,
          uploadId: session.uploadId,
          parts,
          game: {
            title,
            year: $("year").value || null,
            genre: $("genre").value.trim() || null,
            coverKey,
          },
        }),
      });
      session = null;
      $("uploadForm").reset();
      $("bar").hidden = true;
      setMsg("upMsg", "Jogo publicado com sucesso.");
      loadList();
    } catch (err) {
      setMsg("upMsg", err.message, true);
      if (session) {
        call("/api/admin/upload/abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(session),
        }).catch(() => {});
      }
    } finally {
      busy = false;
      $("sendBtn").disabled = false;
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (busy) { e.preventDefault(); e.returnValue = ""; }
  });

  /* Lista */
  async function loadList() {
    const ul = $("list");
    ul.textContent = "";
    setMsg("listMsg", "");
    try {
      const r = await fetch(API + "/api/games", { cache: "no-store" });
      const d = await r.json();
      if (!d.games.length) { setMsg("listMsg", "Nenhum jogo publicado ainda."); return; }
      for (const g of d.games) {
        const li = document.createElement("li");
        const info = document.createElement("div");
        const t = document.createElement("strong");
        t.textContent = g.title;
        const m = document.createElement("span");
        m.className = "meta";
        m.textContent = [g.year, g.genre, g.size ? fmtSize(g.size) : null].filter(Boolean).join(" · ");
        info.append(t, document.createElement("br"), m);
        const del = document.createElement("button");
        del.className = "btn ghost";
        del.type = "button";
        del.textContent = "Excluir";
        del.addEventListener("click", async () => {
          if (!confirm(`Excluir "${g.title}"? Esta ação não pode ser desfeita.`)) return;
          try {
            await call("/api/admin/games/" + encodeURIComponent(g.id), { method: "DELETE" });
            loadList();
          } catch (err) { setMsg("listMsg", err.message, true); }
        });
        li.append(info, del);
        ul.appendChild(li);
      }
    } catch {
      setMsg("listMsg", "Não consegui carregar a lista.", true);
    }
  }

  if (!API) {
    $("login").hidden = false;
    setMsg("loginMsg", "Configure API_BASE em js/config.js com a URL do seu Worker.", true);
    $("loginForm").querySelector("button").disabled = true;
  } else {
    show();
  }
})();
