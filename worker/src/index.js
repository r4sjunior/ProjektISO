// API do PS1 Web: login do admin, upload em partes para o R2 e entrega dos jogos.

const ALLOWED_EXT = [".chd", ".pbp", ".iso", ".img", ".bin", ".zip", ".7z"];
const TOKEN_TTL = 60 * 60 * 12; // 12 horas
const enc = new TextEncoder();
const dec = new TextDecoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
const fail = (msg, status = 400) => json({ error: msg }, status);

/* ---------- CORS ---------- */
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const h = { Vary: "Origin" };
  // Aceita entradas com "*" (ex.: https://projektiso-*-r4sjuniors-projects.vercel.app)
  const matches = (o) =>
    allowed.some((a) =>
      a.includes("*")
        ? new RegExp("^" + a.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[a-z0-9-]+") + "$").test(o)
        : a === o
    );
  if (origin && matches(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET,HEAD,POST,PUT,DELETE,OPTIONS";
    h["Access-Control-Allow-Headers"] = "Authorization,Content-Type,Range";
    h["Access-Control-Expose-Headers"] = "Content-Length,Content-Range,Accept-Ranges,ETag";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

/* ---------- Token assinado (HMAC-SHA256) ---------- */
function b64u(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uDecode(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const hmacKey = (secret) =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

async function signToken(env, payload) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env.JWT_SECRET), enc.encode(body));
  return body + "." + b64u(sig);
}
async function verifyToken(env, token) {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env.JWT_SECRET), b64uDecode(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64uDecode(body)));
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch {
    return null;
  }
}
async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}
async function isAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  return !!(await verifyToken(env, auth.slice(7)));
}

/* ---------- Utilidades ---------- */
const slug = (name) =>
  name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(-80) || "arquivo";
const extOf = (name) => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
};

async function readCatalog(env) {
  const o = await env.GAMES.get("catalog.json");
  if (!o) return { games: [] };
  try {
    const c = await o.json();
    return Array.isArray(c.games) ? c : { games: [] };
  } catch {
    return { games: [] };
  }
}
const writeCatalog = (env, c) =>
  env.GAMES.put("catalog.json", JSON.stringify(c), { httpMetadata: { contentType: "application/json" } });

/* ---------- Rotas públicas ---------- */
async function listGames(env, url) {
  const c = await readCatalog(env);
  const base = url.origin + "/files/";
  const games = c.games.map((g) => ({
    id: g.id,
    title: g.title,
    year: g.year,
    genre: g.genre,
    size: g.size,
    file: base + encodeURI(g.key),
    cover: g.coverKey ? base + encodeURI(g.coverKey) : null,
  }));
  return json({ games });
}

function fileHeaders(o) {
  const h = new Headers();
  o.writeHttpMetadata(h);
  h.set("ETag", o.httpEtag);
  h.set("Accept-Ranges", "bytes");
  h.set("Content-Length", String(o.size));
  h.set("Cache-Control", "public, max-age=3600");
  h.set("Cross-Origin-Resource-Policy", "cross-origin"); // necessário com COEP no site
  return h;
}
function resolveRange(o) {
  const r = o.range;
  if ("suffix" in r) return { start: o.size - r.suffix, end: o.size - 1 };
  const start = r.offset ?? 0;
  const end = r.length !== undefined ? start + r.length - 1 : o.size - 1;
  return { start, end };
}
async function serveFile(request, env, key) {
  if (!/^(games|covers)\/[^/]+$/.test(key)) return fail("Não encontrado.", 404);
  if (request.method === "HEAD") {
    const o = await env.GAMES.head(key);
    if (!o) return fail("Não encontrado.", 404);
    return new Response(null, { status: 200, headers: fileHeaders(o) });
  }
  const hasRange = request.headers.has("Range");
  const o = await env.GAMES.get(key, hasRange ? { range: request.headers } : undefined);
  if (!o) return fail("Não encontrado.", 404);
  const headers = fileHeaders(o);
  let status = 200;
  if (hasRange && o.range) {
    const { start, end } = resolveRange(o);
    headers.set("Content-Range", `bytes ${start}-${end}/${o.size}`);
    headers.set("Content-Length", String(end - start + 1));
    status = 206;
  }
  return new Response(o.body, { status, headers });
}

/* ---------- Login ---------- */
async function login(request, env) {
  const b = await request.json().catch(() => null);
  const user = b && typeof b.user === "string" ? b.user : "";
  const pass = b && typeof b.pass === "string" ? b.pass : "";
  const okUser = await safeEqual(user, env.ADMIN_USER);
  const okPass = await safeEqual(pass, env.ADMIN_PASS);
  if (!(okUser && okPass)) {
    await sleep(800);
    return fail("Usuário ou senha incorretos.", 401);
  }
  const token = await signToken(env, { sub: "admin", exp: Math.floor(Date.now() / 1000) + TOKEN_TTL });
  return json({ token, expiresIn: TOKEN_TTL });
}

/* ---------- Rotas do admin ---------- */
async function uploadCover(request, env, url) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.startsWith("image/")) return fail("Envie uma imagem.");
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (!len || len > 5 * 1024 * 1024) return fail("A imagem deve ter até 5 MB.");
  const key = `covers/${Date.now().toString(36)}-${slug(url.searchParams.get("name") || "capa.jpg")}`;
  await env.GAMES.put(key, request.body, { httpMetadata: { contentType: type } });
  return json({ key });
}

async function uploadStart(request, env) {
  const b = await request.json().catch(() => null);
  if (!b || typeof b.filename !== "string") return fail("Nome do arquivo ausente.");
  if (!ALLOWED_EXT.includes(extOf(b.filename))) return fail("Formato não permitido. Use: " + ALLOWED_EXT.join(" "));
  const key = `games/${Date.now().toString(36)}-${slug(b.filename)}`;
  const mpu = await env.GAMES.createMultipartUpload(key, {
    httpMetadata: { contentType: "application/octet-stream" },
  });
  return json({ key, uploadId: mpu.uploadId });
}

async function uploadPart(request, env, url) {
  const key = url.searchParams.get("key") || "";
  const uploadId = url.searchParams.get("uploadId") || "";
  const n = parseInt(url.searchParams.get("partNumber"), 10);
  if (!key.startsWith("games/") || !uploadId || !(n >= 1 && n <= 10000)) return fail("Parâmetros inválidos.");
  if (!request.body) return fail("Corpo vazio.");
  const mpu = env.GAMES.resumeMultipartUpload(key, uploadId);
  const part = await mpu.uploadPart(n, request.body);
  return json({ partNumber: part.partNumber, etag: part.etag });
}

async function uploadComplete(request, env) {
  const b = await request.json().catch(() => null);
  if (!b || typeof b.key !== "string" || !b.key.startsWith("games/") || typeof b.uploadId !== "string")
    return fail("Dados inválidos.");
  if (!Array.isArray(b.parts) || !b.parts.length) return fail("Partes ausentes.");
  const g = b.game || {};
  const title = typeof g.title === "string" ? g.title.trim().slice(0, 80) : "";
  if (!title) return fail("Título obrigatório.");
  const year = Number.isInteger(parseInt(g.year, 10)) ? parseInt(g.year, 10) : null;
  const genre = typeof g.genre === "string" && g.genre.trim() ? g.genre.trim().slice(0, 40) : null;
  const coverKey = typeof g.coverKey === "string" && g.coverKey.startsWith("covers/") ? g.coverKey : null;

  const parts = b.parts
    .map((p) => ({ partNumber: p.partNumber, etag: p.etag }))
    .sort((a, c) => a.partNumber - c.partNumber);
  const mpu = env.GAMES.resumeMultipartUpload(b.key, b.uploadId);
  const obj = await mpu.complete(parts);

  const catalog = await readCatalog(env);
  const game = {
    id: crypto.randomUUID().slice(0, 8),
    title,
    year,
    genre,
    key: b.key,
    coverKey,
    size: obj.size,
    addedAt: new Date().toISOString(),
  };
  catalog.games.push(game);
  await writeCatalog(env, catalog);
  return json({ ok: true, id: game.id });
}

async function uploadAbort(request, env) {
  const b = await request.json().catch(() => null);
  if (b && typeof b.key === "string" && b.key.startsWith("games/") && typeof b.uploadId === "string") {
    try {
      await env.GAMES.resumeMultipartUpload(b.key, b.uploadId).abort();
    } catch {}
  }
  return json({ ok: true });
}

async function deleteGame(env, id) {
  const catalog = await readCatalog(env);
  const g = catalog.games.find((x) => x.id === id);
  if (!g) return fail("Jogo não encontrado.", 404);
  catalog.games = catalog.games.filter((x) => x.id !== id);
  await writeCatalog(env, catalog);
  await env.GAMES.delete([g.key, g.coverKey].filter(Boolean));
  return json({ ok: true });
}

/* ---------- Roteador ---------- */
async function route(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/games" && method === "GET") return listGames(env, url);
  if (path.startsWith("/files/") && (method === "GET" || method === "HEAD")) {
    let key;
    try {
      key = decodeURIComponent(path.slice(7));
    } catch {
      return fail("Caminho inválido.");
    }
    return serveFile(request, env, key);
  }

  const needsSecrets = path === "/api/login" || path.startsWith("/api/admin/");
  if (needsSecrets && !(env.JWT_SECRET && env.ADMIN_USER && env.ADMIN_PASS))
    return fail("Servidor sem segredos configurados.", 500);

  if (path === "/api/login" && method === "POST") return login(request, env);

  if (path.startsWith("/api/admin/")) {
    if (!(await isAdmin(request, env))) return fail("Não autorizado.", 401);
    if (path === "/api/admin/cover" && method === "PUT") return uploadCover(request, env, url);
    if (path === "/api/admin/upload/start" && method === "POST") return uploadStart(request, env);
    if (path === "/api/admin/upload/part" && method === "PUT") return uploadPart(request, env, url);
    if (path === "/api/admin/upload/complete" && method === "POST") return uploadComplete(request, env);
    if (path === "/api/admin/upload/abort" && method === "POST") return uploadAbort(request, env);
    const m = path.match(/^\/api\/admin\/games\/([\w-]+)$/);
    if (m && method === "DELETE") return deleteGame(env, m[1]);
  }
  return fail("Não encontrado.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let res;
    try {
      res = await route(request, env, url);
    } catch (e) {
      res = fail("Erro interno.", 500);
    }
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  },
};
