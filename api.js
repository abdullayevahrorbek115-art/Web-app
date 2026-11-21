// Ilova (veb-ilova PWA va Android APK) uchun API va statik fayllar.
//
// Kirish: botda «📱 Ilovaga kirish» (yoki /app) bosiladi -> 8 xonali bir martalik kod (5 daqiqa).
// Ilova kodni /api/login ga yuboradi va uzoq muddatli token oladi (serverda faqat hash saqlanadi).
// Hamma o'zgartiruvchi amallar (buyurtma, to'lov) serverda qayta tekshiriladi: narx, balans, ID, holat.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { data, save } = require("./db");
const account = require("./account");
const orders = require("./orders");
const payments = require("./payments");

const APP_DIR = path.join(__dirname, "app");
const SESSION_MS = 60 * 24 * 60 * 60 * 1000; // 60 kun
const CODE_MS = 5 * 60 * 1000;
const MAX_SESSIONS_PER_USER = 5;

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

// ---------- Bir martalik kirish kodlari (xotirada) ----------
const codes = new Map(); // kod -> { userId, exp }

function createCode(userId) {
  const now = Date.now();
  for (const [c, v] of codes) if (v.userId === userId || v.exp < now) codes.delete(c);
  let code;
  do {
    code = String(crypto.randomInt(0, 100000000)).padStart(8, "0");
  } while (codes.has(code));
  codes.set(code, { userId, exp: now + CODE_MS });
  return code;
}

// ---------- Urinishlarni cheklash ----------
function makeLimiter(max, windowMs) {
  const hits = new Map(); // kalit -> [vaqtlar]
  const fresh = (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length) hits.set(key, arr);
    else hits.delete(key);
    return arr;
  };
  return {
    blocked: (key) => fresh(key).length >= max,
    hit: (key) => {
      const arr = fresh(key);
      arr.push(Date.now());
      hits.set(key, arr);
    },
  };
}
const loginFailIp = makeLimiter(10, 10 * 60 * 1000); // bitta manzildan 10 ta xato / 10 daqiqa
const loginFailAll = makeLimiter(300, 10 * 60 * 1000); // umumiy: 8 xonali kodni taxmin qilishga qarshi
const checkLimit = makeLimiter(20, 60 * 1000); // foydalanuvchi: ID tekshirish
const topupLimit = makeLimiter(10, 60 * 1000); // foydalanuvchi: to'lov yaratish

// Proksi orqasida: oxirgi X-Forwarded-For yozuvi (eng yaqin ishonchli proksi qo'shgan)
function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : (req.socket && req.socket.remoteAddress) || "?";
}

// ---------- Sessiyalar ----------
function issueToken(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const sess = data().sessions || (data().sessions = {});
  const now = Date.now();
  for (const [h, v] of Object.entries(sess)) if (now - v.created > SESSION_MS) delete sess[h];
  const mine = Object.entries(sess).filter(([, v]) => v.userId === userId).sort((a, b) => a[1].created - b[1].created);
  while (mine.length >= MAX_SESSIONS_PER_USER) delete sess[mine.shift()[0]];
  sess[sha(token)] = { userId, created: now };
  save();
  return token;
}

function tokenOf(req) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || "");
  return m ? m[1] : null;
}

function authUser(req) {
  const t = tokenOf(req);
  if (!t) return null;
  const s = (data().sessions || {})[sha(t)];
  if (!s || Date.now() - s.created > SESSION_MS) return null;
  return data().users[s.userId] || null;
}

// ---------- Yordamchilar ----------
const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SEC_HEADERS });
  res.end(JSON.stringify(obj));
}

function readJson(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let size = 0;
    req.on("data", (d) => {
      size += d.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      raw += d;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        const j = JSON.parse(raw);
        resolve(j && typeof j === "object" && !Array.isArray(j) ? j : {});
      } catch (e) {
        reject(new Error("bad json"));
      }
    });
    req.on("error", reject);
  });
}

const pubUser = (u) => ({ id: u.id, name: u.name, username: u.username, balance: u.balance });
const pubOrder = (o) => ({
  id: o.id,
  game: o.gameName,
  pkg: o.pkgName,
  price: o.price,
  status: o.status,
  playerId: o.playerId,
  serverId: o.serverId || "",
  nickname: o.nickname || "",
  createdAt: o.createdAt,
});

function catalog() {
  const games = data()
    .games.filter((g) => g.active)
    .map((g) => ({
      id: g.id,
      name: g.name,
      emoji: g.emoji,
      kind: g.kind === "tg" ? "tg" : "game",
      needsServer: !!g.needsServer && g.kind !== "tg",
      packages: data()
        .packages.filter((p) => p.gameId === g.id && p.active)
        .map((p) => ({ id: p.id, name: p.name, price: p.price })),
    }))
    .filter((g) => g.packages.length);
  return games;
}

function lookupPkg(id) {
  const pkg = data().packages.find((p) => p.id === Number(id));
  const game = pkg && data().games.find((g) => g.id === pkg.gameId);
  if (!pkg || !game || !pkg.active || !game.active) return {};
  return { pkg, game };
}

// So'rovdagi ID va server maydonlarini tekshiradi -> { playerId, serverId } yoki { error }
function readTarget(game, body) {
  const parsed = account.parseIdInput(game, String(body.playerId ?? ""));
  if (!parsed) return { error: account.idError(game) };
  let serverId = "";
  if (game.needsServer && game.kind !== "tg") {
    serverId = parsed.serverId || account.normalizeServer(body.serverId) || "";
    if (!serverId) return { error: "Server (Zone) ID kerak. Faqat raqamlar, masalan 2001." };
  }
  return { playerId: parsed.playerId, serverId };
}

let botUsername = "";
async function getBotUsername(getApi) {
  if (!botUsername) {
    try {
      botUsername = (await getApi().getMe()).username || "";
    } catch (e) {
      console.error("Bot nomini olib bo'lmadi:", e.message);
    }
  }
  return botUsername;
}

// ---------- Statik fayllar (/app/*) ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};
const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function serveStatic(rawPath, req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }
  let rel;
  try {
    rel = decodeURIComponent(rawPath.slice("/app/".length));
  } catch (e) {
    res.writeHead(400);
    return res.end("Bad request");
  }
  if (!rel || rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(APP_DIR, rel));
  if (rel.includes("\0") || !file.startsWith(APP_DIR + path.sep)) {
    res.writeHead(404);
    return res.end("Not found");
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "no-cache",
      ...SEC_HEADERS,
    };
    if (ext === ".html") headers["Content-Security-Policy"] = CSP;
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- Asosiy yo'naltiruvchi ----------
// true qaytarsa — so'rov shu yerda bajarildi
async function handle(req, res, getApi) {
  const rawPath = (req.url || "/").split("?")[0];
  const p = rawPath.replace(/\/+$/, "") || "/";

  if (rawPath === "/app") {
    res.writeHead(301, { Location: "/app/" });
    res.end();
    return true;
  }
  if (rawPath.startsWith("/app/")) {
    serveStatic(rawPath, req, res);
    return true;
  }
  if (!p.startsWith("/api/")) return false;

  try {
    await route(p, req, res, getApi);
  } catch (e) {
    if (e.message === "bad json" || e.message === "too large") {
      if (!res.headersSent) send(res, 400, { error: "So'rov noto'g'ri" });
    } else {
      console.error("API xatosi:", p, e.message);
      if (!res.headersSent) send(res, 500, { error: "Server xatosi. Birozdan keyin urinib ko'ring." });
    }
  }
  return true;
}

async function route(p, req, res, getApi) {
  const method = req.method;
  if (method === "OPTIONS") {
    res.writeHead(204, SEC_HEADERS);
    return res.end();
  }

  // Ochiq: bot nomi (kirish ekrani uchun)
  if (p === "/api/info" && method === "GET") {
    return send(res, 200, { bot: await getBotUsername(getApi) });
  }

  // Kirish
  if (p === "/api/login" && method === "POST") {
    const ip = clientIp(req);
    if (loginFailIp.blocked(ip) || loginFailAll.blocked("all")) {
      return send(res, 429, { error: "Juda ko'p urinish. 10 daqiqadan keyin qayta urinib ko'ring." });
    }
    const body = await readJson(req);
    const code = String(body.code ?? "").replace(/\D/g, "");
    const rec = code.length === 8 ? codes.get(code) : null;
    const user = rec && rec.exp > Date.now() ? data().users[rec.userId] : null;
    if (!user) {
      loginFailIp.hit(ip);
      loginFailAll.hit("all");
      return send(res, 401, { error: "Kod noto'g'ri yoki muddati tugagan. Botdan yangi kod oling." });
    }
    codes.delete(code); // bir martalik
    return send(res, 200, { token: issueToken(user.id), user: pubUser(user) });
  }

  // Quyidagilar uchun kirish kerak
  const user = authUser(req);
  if (!user) return send(res, 401, { error: "auth" });

  if (p === "/api/logout" && method === "POST") {
    const sess = data().sessions || {};
    delete sess[sha(tokenOf(req))];
    save();
    return send(res, 200, { ok: true });
  }

  if (p === "/api/catalog" && method === "GET") {
    return send(res, 200, { games: catalog() });
  }

  if (p === "/api/me" && method === "GET") {
    const st = data().settings;
    const mine = data().orders.filter((o) => o.userId === user.id).slice(-30).reverse().map(pubOrder);
    return send(res, 200, {
      user: pubUser(user),
      orders: mine,
      bot: await getBotUsername(getApi),
      contact: st.contact,
      topup: { methods: payments.methods(), min: st.minTopup, max: 50000000 },
    });
  }

  if (p === "/api/check" && method === "POST") {
    if (checkLimit.blocked(user.id)) return send(res, 429, { error: "Juda tez-tez so'rov. Biroz kuting." });
    checkLimit.hit(user.id);
    const body = await readJson(req);
    const { pkg, game } = lookupPkg(body.pkgId);
    if (!pkg) return send(res, 404, { error: "Bu paket hozir mavjud emas." });
    const t = readTarget(game, body);
    if (t.error) return send(res, 400, { error: t.error });
    const r = await account.checkAccount(game, t.playerId, t.serverId);
    if (!r.ok) {
      return send(res, 200, { ok: false, error: game.kind === "tg" ? "Bunday username topilmadi." : "Bunday ID topilmadi. ID ni tekshirib, qayta kiriting." });
    }
    return send(res, 200, { ok: true, verified: r.verified, nickname: r.nickname, playerId: t.playerId, serverId: t.serverId });
  }

  if (p === "/api/order" && method === "POST") {
    if (busy.has(user.id)) return send(res, 429, { error: "Oldingi buyurtma hali bajarilmoqda. Biroz kuting." });
    busy.add(user.id);
    try {
      const body = await readJson(req);
      const { pkg, game } = lookupPkg(body.pkgId);
      if (!pkg) return send(res, 404, { error: "Bu paket hozir mavjud emas." });
      const t = readTarget(game, body);
      if (t.error) return send(res, 400, { error: t.error });
      if (user.balance < pkg.price) {
        return send(res, 402, { error: "Balans yetarli emas.", balance: user.balance, need: pkg.price - user.balance });
      }
      const r = await account.checkAccount(game, t.playerId, t.serverId);
      if (!r.ok) return send(res, 400, { error: "Bunday ID topilmadi. ID ni tekshirib, qayta kiriting." });
      const order = orders.placeOrder(user, pkg, game, { playerId: t.playerId, serverId: t.serverId, nickname: r.nickname });
      if (!order) {
        return send(res, 402, { error: "Balans yetarli emas.", balance: user.balance, need: pkg.price - user.balance });
      }
      await orders.processOrder(getApi(), order);
      return send(res, 200, { order: pubOrder(order), balance: user.balance });
    } finally {
      busy.delete(user.id);
    }
  }

  if (p === "/api/topup" && method === "POST") {
    if (topupLimit.blocked(user.id)) return send(res, 429, { error: "Juda tez-tez so'rov. Biroz kuting." });
    topupLimit.hit(user.id);
    const body = await readJson(req);
    const st = data().settings;
    const amount = Number.parseInt(String(body.amount ?? "").replace(/\D/g, ""), 10);
    if (!Number.isFinite(amount) || amount < st.minTopup || amount > 50000000) {
      return send(res, 400, { error: `Summa ${st.minTopup.toLocaleString("ru-RU")} dan 50 000 000 gacha bo'lishi kerak.` });
    }
    const method2 = String(body.method || "");
    if (!payments.methods().some((m) => m.id === method2)) return send(res, 400, { error: "Bu to'lov usuli mavjud emas." });
    if (method2 === "click" || method2 === "payme") {
      const pay = payments.createPayment(user.id, amount, method2);
      return send(res, 200, { url: payments.payUrl(pay, await getBotUsername(getApi)), paymentId: pay.id });
    }
    if (method2 === "cardauto") {
      const cp = payments.createCardPayment(user.id, amount);
      if (!cp) return send(res, 503, { error: "Hozir to'lovlar ko'p. 1–2 daqiqadan keyin qayta urinib ko'ring." });
      return send(res, 200, { card: st.cardNumber, owner: st.cardOwner, amount: cp.amount, expiresAt: cp.expiresAt, paymentId: cp.id });
    }
    // "card" (chek yuborish) — rasm yuborish botda bajariladi
    return send(res, 400, { error: "Bu usul uchun botga o'ting va chek rasmini yuboring.", bot: await getBotUsername(getApi) });
  }

  send(res, 404, { error: "not found" });
}

const busy = new Set(); // bir vaqtda bitta buyurtma (ikki marta bosishdan himoya)

module.exports = { handle, createCode };
