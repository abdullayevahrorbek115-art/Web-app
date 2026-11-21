// Donat Shop ilovasi (PWA / Android qobig'i). Hamma narx, balans va ID tekshiruvlari serverda qayta bajariladi.
(function () {
  "use strict";

  const $app = document.getElementById("app");
  const $sheetRoot = document.getElementById("sheet-root");
  const $toast = document.getElementById("toast");

  // ---------- Holat ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* xotira yopiq bo'lishi mumkin */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ... */ } },
  };
  const S = {
    token: store.get("ds_token"),
    me: null,
    games: null,
    tab: "shop",
    gameId: null,
    sheet: null,
    bot: store.get("ds_bot") || "",
    loginError: "",
    topup: { amount: "", result: null, error: "", busy: false },
    installEvt: null,
    timer: null,
  };

  // ---------- Yordamchilar ----------
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => Number(n || 0).toLocaleString("ru-RU").replace(/ /g, " ");
  const when = (ts) =>
    new Date(ts).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  let toastTimer = null;
  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $toast.classList.remove("show"), 3200);
  }

  async function api(path, body, timeout = 30000) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch("../api/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", ...(S.token ? { Authorization: "Bearer " + S.token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      let json = null;
      try { json = await res.json(); } catch (e) { /* JSON emas */ }
      if (res.status === 401 && path !== "login") {
        signOut();
        throw new Error("Qayta kiring: seans tugagan.");
      }
      if (!res.ok) {
        const err = new Error((json && json.error) || "Xatolik yuz berdi.");
        err.status = res.status;
        err.data = json || {};
        throw err;
      }
      return json;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("Server javob bermadi. Internetni tekshirib, qayta urinib ko'ring.");
      if (e instanceof TypeError) throw new Error("Internetga ulanib bo'lmadi. Aloqani tekshiring.");
      throw e;
    } finally {
      clearTimeout(to);
    }
  }

  function signOut() {
    store.del("ds_token");
    S.token = null; S.me = null; S.games = null; S.sheet = null; S.tab = "shop"; S.gameId = null;
    closeSheetDom();
    render();
  }

  const ICONS = {
    shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h16l-1.4 9.2a2 2 0 0 1-2 1.8H7.4a2 2 0 0 1-2-1.8L4 9z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/></svg>',
    orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/></svg>',
    account: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.4-3.6 4.4-5 8-5s6.6 1.4 8 5"/></svg>',
  };

  // ---------- Chizish ----------
  function render() {
    if (!S.token) return renderLogin();
    if (!S.me || !S.games) {
      $app.innerHTML = topbar() + '<div class="screen"><div class="skeleton"></div></div>';
      load();
      return;
    }
    let body = "";
    if (S.tab === "shop") body = S.gameId ? viewGame() : viewShop();
    else if (S.tab === "orders") body = viewOrders();
    else body = viewAccount();
    $app.innerHTML = topbar() + '<main class="screen">' + body + "</main>" + nav();
    afterRender();
  }

  function topbar() {
    const initial = S.me && S.me.user.name ? esc(S.me.user.name.trim().charAt(0).toUpperCase()) : "";
    return (
      '<header class="topbar"><div class="brand"><img class="brand-mark" src="icons/icon-192.png" alt="">Donat Shop</div>' +
      (initial ? '<button class="avatar" data-act="tab" data-tab="account" aria-label="Hisob">' + initial + "</button>" : "") +
      "</header>"
    );
  }

  function nav() {
    const item = (id, label) =>
      '<button data-act="tab" data-tab="' + id + '"' + (S.tab === id ? ' aria-current="page"' : "") + ">" + ICONS[id] + "<span>" + label + "</span></button>";
    return '<nav class="nav" aria-label="Asosiy menyu">' + item("shop", "Do'kon") + item("orders", "Buyurtmalar") + item("account", "Hisob") + "</nav>";
  }

  function wallet(withButton) {
    return (
      '<section class="wallet" aria-label="Balans"><div class="wallet-label">Balansingiz</div>' +
      '<div class="wallet-amount"><span class="coin" aria-hidden="true"></span><span class="amount">' + money(S.me.user.balance) + "<small>so'm</small></span></div>" +
      (withButton ? '<button class="btn gold slim" data-act="tab" data-tab="account" data-focus="amount">Hisobni to\'ldirish</button>' : "") + "</section>"
    );
  }

  function viewShop() {
    if (!S.games.length) {
      return (
        wallet(true) +
        '<div class="empty"><div class="game-emoji" aria-hidden="true">🎮</div><h3>Hozircha o\'yinlar yo\'q</h3><p class="muted">Paketlar qo\'shilgach shu yerda ko\'rinadi. Keyinroq qaytib ko\'ring.</p></div>'
      );
    }
    const tiles = S.games
      .map(
        (g) =>
          '<button class="game" data-act="game" data-id="' + g.id + '"><span class="game-emoji" aria-hidden="true">' + esc(g.emoji) + '</span><span><span class="game-name">' +
          esc(g.name) + '</span><span class="game-count">' + g.packages.length + ' ta paket</span></span></button>'
      )
      .join("");
    return wallet(true) + '<h2 class="h2">O\'yinni tanlang</h2><div class="games">' + tiles + "</div>";
  }

  function viewGame() {
    const g = S.games.find((x) => x.id === S.gameId);
    if (!g) { S.gameId = null; return viewShop(); }
    const tickets = g.packages
      .map(
        (p) =>
          '<button class="ticket" data-act="buy" data-id="' + p.id + '"><span class="ticket-main"><span class="ticket-name">' + esc(p.name) +
          '</span><span class="ticket-sub">' + (g.kind === "tg" ? "Telegram akkauntingizga" : "O'yin akkauntingizga") + '</span></span><span class="ticket-stub"><span class="price">' +
          money(p.price) + '</span><span class="price-unit">so\'m</span></span></button>'
      )
      .join("");
    return (
      '<button class="back" data-act="back" aria-label="O\'yinlarga qaytish">‹ O\'yinlar</button>' +
      '<div class="game-head"><span class="game-emoji" aria-hidden="true">' + esc(g.emoji) + "</span><h1>" + esc(g.name) + "</h1></div>" +
      '<div class="tickets">' + tickets + "</div>"
    );
  }

  const STATUS = {
    done: ["done", "Bajarildi"],
    pending: ["wait", "Yetkazilmoqda"],
    processing: ["wait", "Jarayonda"],
    failed: ["fail", "Bekor qilindi, pul qaytarildi"],
  };

  function viewOrders() {
    const list = S.me.orders;
    const head = '<div class="row"><h2 class="h2">Buyurtmalar</h2><button class="btn ghost slim" data-act="refresh">Yangilash</button></div>';
    if (!list.length) {
      return (
        head +
        '<div class="empty"><div class="game-emoji" aria-hidden="true">🧾</div><h3>Hali buyurtma yo\'q</h3><p class="muted">Do\'kondan o\'yin va paketni tanlang, buyurtmangiz shu yerda chiqadi.</p>' +
        '<button class="btn" data-act="tab" data-tab="shop">Do\'konga o\'tish</button></div>'
      );
    }
    const items = list
      .map((o) => {
        const st = STATUS[o.status] || ["wait", o.status];
        return (
          '<article class="receipt"><div class="receipt-top"><div><div class="receipt-title">' + esc(o.game) + " " + esc(o.pkg) +
          '</div><span class="chip ' + st[0] + '">' + st[1] + '</span></div><div class="receipt-sum">' + money(o.price) + " so'm</div></div>" +
          '<div class="receipt-rows"><div>Buyurtma raqami: <b>#' + o.id + "</b></div><div>ID: <b>" + esc(o.playerId) + (o.serverId ? " (" + esc(o.serverId) + ")" : "") + "</b></div>" +
          (o.nickname ? "<div>Nik: <b>" + esc(o.nickname) + "</b></div>" : "") + "<div>Vaqt: <b>" + when(o.createdAt) + "</b></div></div></article>"
        );
      })
      .join("");
    return head + '<div class="receipts">' + items + "</div>";
  }

  function viewAccount() {
    const u = S.me.user;
    const t = S.topup;
    const presets = [10000, 25000, 50000, 100000]
      .map((v) => '<button class="pill" data-act="preset" data-v="' + v + '">' + money(v) + "</button>")
      .join("");
    const methods = S.me.topup.methods.length
      ? '<div class="methods">' + S.me.topup.methods.map((m) => '<button class="method" data-act="topup" data-m="' + esc(m.id) + '"' + (t.busy ? " disabled" : "") + ">" + esc(m.label) + "</button>").join("") + "</div>"
      : '<p class="hint">To\'ldirish usullari hozircha yo\'q. Admin bilan bog\'laning: ' + esc(S.me.contact) + "</p>";
    return (
      wallet(false) +
      '<div class="panel"><h3>Hisobni to\'ldirish</h3><label class="field" for="amount"><span>Summa, so\'m</span>' +
      '<input class="input" id="amount" inputmode="numeric" autocomplete="off" placeholder="Masalan: 50 000" value="' + esc(t.amount) + '"></label>' +
      '<div class="chips">' + presets + "</div>" + (t.error ? '<p class="error">' + esc(t.error) + "</p>" : "") + methods + topupResult() + "</div>" +
      '<div class="panel"><h3>Profil</h3><div class="row"><span class="muted">Ism</span><b>' + esc(u.name) + "</b></div>" +
      (u.username ? '<div class="row"><span class="muted">Username</span><b>@' + esc(u.username) + "</b></div>" : "") +
      '<div class="row"><span class="muted">Telegram ID</span><b>' + u.id + '</b></div><div class="row"><span class="muted">Aloqa</span><b>' + esc(S.me.contact) + "</b></div></div>" +
      '<div class="panel">' +
      (S.installEvt ? '<button class="btn stack" data-act="install">Ilovani telefonga o\'rnatish</button>' : "") +
      '<button class="btn ghost stack" data-act="refresh">Balansni yangilash</button><button class="btn danger-ghost stack" data-act="logout">Chiqish</button></div>'
    );
  }

  function topupResult() {
    const r = S.topup.result;
    if (!r) return "";
    if (r.url) {
      return (
        '<div class="copyrow"><span>To\'lov tayyor: ' + money(S.topup.amountNum) + ' so\'m</span></div>' +
        '<div class="sheet-actions"><button class="btn" data-act="openpay" data-url="' + esc(r.url) + '">To\'lov sahifasini ochish</button>' +
        '<p class="hint">To\'lagach shu yerga qayting. Balans avtomatik yangilanadi yoki «Balansni yangilash» ni bosing.</p></div>'
      );
    }
    if (r.card) {
      return (
        '<p class="hint">Quyidagi kartaga <b>aynan shu summani</b> o\'tkazing. Summa boshqacha bo\'lsa, to\'lov avtomatik tushmaydi.</p>' +
        '<div class="copyrow"><code>' + esc(r.card) + '</code><button class="btn slim" data-act="copy" data-v="' + esc(r.card.replace(/\s+/g, "")) + '">Nusxalash</button></div>' +
        '<div class="copyrow"><code>' + money(r.amount) + ' so\'m</code><button class="btn slim" data-act="copy" data-v="' + r.amount + '">Nusxalash</button></div>' +
        '<p class="hint">Karta egasi: ' + esc(r.owner) + '. Qolgan vaqt: <b id="countdown" data-exp="' + r.expiresAt + '"></b></p>'
      );
    }
    return "";
  }

  function afterRender() {
    clearInterval(S.timer);
    const cd = document.getElementById("countdown");
    if (cd) {
      const tick = () => {
        const left = Math.max(0, Math.floor((Number(cd.dataset.exp) - Date.now()) / 1000));
        cd.textContent = left ? Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0") : "muddat tugadi";
      };
      tick();
      S.timer = setInterval(tick, 1000);
    }
  }

  // ---------- Kirish ----------
  function renderLogin() {
    const bot = S.bot ? "@" + esc(S.bot) : "botimiz";
    $app.innerHTML =
      '<header class="login-hero"><img src="icons/icon-192.png" alt=""><h1>Donat Shop</h1><p>O\'yin hisobingizni bir necha soniyada to\'ldiring.</p></header>' +
      '<main class="login-card"><ol class="steps"><li><span>Telegramda ' + bot + " botini oching.</span></li>" +
      "<li><span>«📱 Ilovaga kirish» tugmasini bosing.</span></li><li><span>Bot bergan 8 xonali kodni kiriting.</span></li></ol>" +
      '<label class="field" for="code"><span>Kirish kodi</span><input class="input code-input" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="00000000"></label>' +
      (S.loginError ? '<p class="error" role="alert">' + esc(S.loginError) + "</p>" : "") +
      '<div class="sheet-actions"><button class="btn" data-act="login">Kirish</button>' +
      (S.bot ? '<a class="btn ghost" href="https://t.me/' + esc(S.bot) + '">Botni ochish</a>' : "") + "</div></main>";
    if (!S.bot) {
      api("info").then((r) => {
        if (r && r.bot) { S.bot = r.bot; store.set("ds_bot", r.bot); if (!S.token) renderLogin(); }
      }).catch(() => {});
    }
  }

  async function doLogin() {
    const input = document.getElementById("code");
    const code = (input ? input.value : "").replace(/\D/g, "");
    if (code.length !== 8) { S.loginError = "Kod 8 ta raqamdan iborat."; renderLogin(); return; }
    const btn = document.querySelector('[data-act="login"]');
    if (btn) { btn.disabled = true; btn.textContent = "Tekshirilmoqda..."; }
    try {
      const r = await api("login", { code });
      S.token = r.token; store.set("ds_token", r.token); S.loginError = "";
      render();
    } catch (e) {
      S.loginError = e.message;
      renderLogin();
    }
  }

  // ---------- Ma'lumotlarni yuklash ----------
  let loading = false;
  async function load(force) {
    if (loading) return;
    loading = true;
    try {
      const [me, cat] = await Promise.all([api("me"), api("catalog")]);
      S.me = me; S.games = cat.games;
      if (me.bot) { S.bot = me.bot; store.set("ds_bot", me.bot); }
    } catch (e) {
      if (S.token) {
        $app.innerHTML = topbar() + '<div class="screen"><div class="empty"><div class="game-emoji" aria-hidden="true">📡</div><h3>Ulanib bo\'lmadi</h3><p class="muted">' +
          esc(e.message) + '</p><button class="btn" data-act="refresh">Qayta urinish</button></div></div>';
      }
      loading = false;
      return;
    }
    loading = false;
    if (force) toast("Yangilandi");
    render();
  }

  // ---------- Sotib olish oynasi ----------
  function findPkg(id) {
    for (const g of S.games) for (const p of g.packages) if (p.id === id) return { game: g, pkg: p };
    return null;
  }

  function openSheet(pkgId) {
    const f = findPkg(pkgId);
    if (!f) return;
    S.sheet = { step: "form", game: f.game, pkg: f.pkg, playerId: "", serverId: "", error: "", busy: false, check: null, result: null, need: 0 };
    drawSheet();
  }

  function closeSheetDom() {
    $sheetRoot.innerHTML = "";
    document.body.style.overflow = "";
  }

  function closeSheet() {
    if (S.sheet && S.sheet.busy) return;
    const sheet = $sheetRoot.querySelector(".sheet");
    const bd = $sheetRoot.querySelector(".backdrop");
    if (sheet) sheet.classList.remove("open");
    if (bd) bd.classList.remove("open");
    S.sheet = null;
    setTimeout(() => { if (!S.sheet) closeSheetDom(); }, 260);
  }

  function drawSheet() {
    const sh = S.sheet;
    if (!sh) return closeSheetDom();
    const g = sh.game, p = sh.pkg;
    const idLabel = g.kind === "tg" ? "Telegram username" : "Player ID";
    const idHint = g.kind === "tg" ? "Masalan: @username" : "O'yin ichida profilingizdan ko'rasiz";
    let inner = "";

    if (sh.step === "form") {
      inner =
        "<h2>" + esc(g.name) + " " + esc(p.name) + '</h2><p class="sheet-sub">' + money(p.price) + " so'm</p>" +
        '<label class="field" for="pid"><span>' + idLabel + '</span><input class="input" id="pid" autocomplete="off" inputmode="' + (g.kind === "tg" ? "text" : "numeric") + '" value="' + esc(sh.playerId) + '" placeholder="' + idHint + '"></label>' +
        (g.needsServer ? '<label class="field" for="sid"><span>Server (Zone) ID</span><input class="input" id="sid" autocomplete="off" inputmode="numeric" value="' + esc(sh.serverId) + '" placeholder="Masalan: 2001"></label>' : "") +
        (sh.error ? '<p class="error" role="alert">' + esc(sh.error) + "</p>" : "") +
        '<div class="sheet-actions"><button class="btn" data-act="check"' + (sh.busy ? " disabled" : "") + ">" + (sh.busy ? "Tekshirilmoqda..." : "Tekshirish") + '</button><button class="btn ghost" data-act="close">Bekor qilish</button></div>';
    } else if (sh.step === "confirm") {
      const c = sh.check;
      const bal = S.me.user.balance;
      const short = bal < p.price;
      const ident = c.nickname
        ? '<div class="ident ok"><div class="ident-nick">' + esc(c.nickname) + '</div><div class="ident-id">ID ' + esc(c.playerId) + (c.serverId ? " (" + esc(c.serverId) + ")" : "") + "</div></div>"
        : '<div class="ident warn"><div class="ident-title">ID avtomatik tekshirilmadi</div><div class="ident-id">' + (g.kind === "tg" ? "" : "ID ") + esc(c.playerId) + (c.serverId ? " (" + esc(c.serverId) + ")" : "") +
          '</div><p class="small muted">Qayta tekshiring: noto\'g\'ri ID ga yuborilgan donat qaytarilmaydi.</p></div>';
      inner =
        "<h2>Buyurtmani tasdiqlang</h2><p class=\"sheet-sub\">" + esc(g.name) + " " + esc(p.name) + "</p>" + ident +
        '<div class="sum"><div><span>Narxi</span><b>' + money(p.price) + " so'm</b></div><div><span>Balansingiz</span><b>" + money(bal) + " so'm</b></div>" +
        '<div class="total"><span>Qoladi</span><b>' + money(Math.max(0, bal - p.price)) + " so'm</b></div></div>" +
        (short ? '<div class="notice" role="alert">Balansda ' + money(p.price - bal) + " so'm yetmayapti.</div>" : "") +
        (sh.error ? '<p class="error" role="alert">' + esc(sh.error) + "</p>" : "") +
        '<div class="sheet-actions">' +
        (short
          ? '<button class="btn gold" data-act="topup-need">Hisobni to\'ldirish</button>'
          : '<button class="btn" data-act="order"' + (sh.busy ? " disabled" : "") + ">" + (sh.busy ? "Yuborilmoqda..." : "Sotib olish") + "</button>") +
        '<button class="btn ghost" data-act="back-form"' + (sh.busy ? " disabled" : "") + ">ID ni o'zgartirish</button></div>";
    } else {
      const o = sh.result.order;
      const st = o.status === "done" ? ["done", "Yetkazildi"] : o.status === "failed" ? ["fail", "Bajarilmadi"] : ["wait", "Qabul qilindi"];
      const msg =
        o.status === "done"
          ? "Donat akkauntingizga yetkazildi."
          : o.status === "failed"
          ? "Buyurtma bajarilmadi. Pul balansingizga qaytarildi."
          : "Buyurtma #" + o.id + " qabul qilindi. Admin tez orada yetkazadi, tayyor bo'lganda botdan xabar keladi.";
      inner =
        '<div class="result"><h2>' + esc(g.name) + " " + esc(p.name) + '</h2><div class="stamp ' + st[0] + '">' + st[1] + '</div><p class="muted">' + msg + "</p></div>" +
        '<div class="sheet-actions"><button class="btn" data-act="to-orders">Buyurtmalarim</button><button class="btn ghost" data-act="close">Yopish</button></div>';
    }

    const existing = $sheetRoot.querySelector(".sheet");
    const keepFocus = existing && document.activeElement && existing.contains(document.activeElement) ? document.activeElement.id : "";
    const cls = existing ? " open" : ""; // faqat birinchi ochilishda pastdan chiqadi
    $sheetRoot.innerHTML =
      '<div class="backdrop' + cls + '" data-act="close"></div><div class="sheet' + cls + '" role="dialog" aria-modal="true" aria-label="Buyurtma"><div class="grab"></div>' + inner + "</div>";
    document.body.style.overflow = "hidden";
    const focusTarget = () => {
      const target = (keepFocus && document.getElementById(keepFocus)) || (sh.step === "form" ? document.getElementById("pid") : null);
      if (target) target.focus();
    };
    if (existing) return focusTarget();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $sheetRoot.querySelector(".sheet").classList.add("open");
      $sheetRoot.querySelector(".backdrop").classList.add("open");
      focusTarget();
    }));
  }

  function readForm() {
    const pid = document.getElementById("pid");
    const sid = document.getElementById("sid");
    if (pid) S.sheet.playerId = pid.value.trim();
    if (sid) S.sheet.serverId = sid.value.trim();
  }

  async function doCheck() {
    const sh = S.sheet;
    readForm();
    if (!sh.playerId) { sh.error = sh.game.kind === "tg" ? "Username kiriting." : "Player ID kiriting."; return drawSheet(); }
    if (sh.game.needsServer && !sh.serverId && !/[\s(:,]/.test(sh.playerId)) { sh.error = "Server (Zone) ID kiriting."; return drawSheet(); }
    sh.busy = true; sh.error = ""; drawSheet();
    try {
      const r = await api("check", { pkgId: sh.pkg.id, playerId: sh.playerId, serverId: sh.serverId });
      sh.busy = false;
      if (!r.ok) { sh.error = r.error || "ID topilmadi."; sh.step = "form"; return drawSheet(); }
      sh.check = r; sh.step = "confirm"; sh.error = "";
    } catch (e) {
      sh.busy = false; sh.error = e.message; sh.step = "form";
    }
    if (S.sheet) drawSheet();
  }

  async function doOrder() {
    const sh = S.sheet;
    sh.busy = true; sh.error = ""; drawSheet();
    try {
      const r = await api("order", { pkgId: sh.pkg.id, playerId: sh.check.playerId, serverId: sh.check.serverId }, 70000);
      sh.busy = false; sh.result = r; sh.step = "done";
      S.me.user.balance = r.balance;
      load();
    } catch (e) {
      sh.busy = false;
      sh.error = e.message;
      if (e.status === 402) S.me.user.balance = e.data.balance ?? S.me.user.balance;
      // Natija noaniq bo'lsa (tarmoq uzilishi): buyurtma yaratilgan bo'lishi mumkin
      if (!e.status) sh.error += " Buyurtmalar bo'limini tekshiring: u yaratilgan bo'lishi mumkin.";
    }
    if (S.sheet) drawSheet();
  }

  // ---------- Hisobni to'ldirish ----------
  async function doTopup(method) {
    const t = S.topup;
    const input = document.getElementById("amount");
    if (input) t.amount = input.value;
    const n = parseInt(String(t.amount).replace(/\D/g, ""), 10);
    const min = S.me.topup.min;
    t.error = ""; t.result = null;
    if (!Number.isFinite(n) || n < min) { t.error = "Summa kamida " + money(min) + " so'm bo'lishi kerak."; return render(); }
    t.busy = true; t.amountNum = n; render();
    try {
      t.result = await api("topup", { amount: n, method });
    } catch (e) {
      t.error = e.message;
      if (e.data && e.data.bot) {
        t.error = "Chek bilan to'lash botda bajariladi: rasm yuborasiz, admin tasdiqlaydi.";
        t.result = null;
        t.botLink = e.data.bot;
      }
    }
    t.busy = false;
    render();
    if (t.botLink) { window.location.href = "https://t.me/" + t.botLink; t.botLink = null; }
  }

  // ---------- Hodisalar ----------
  document.addEventListener("click", async (ev) => {
    const el = ev.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    switch (act) {
      case "login": return doLogin();
      case "tab":
        S.tab = el.dataset.tab; if (S.tab !== "shop") S.gameId = null;
        render();
        if (el.dataset.focus === "amount") { const a = document.getElementById("amount"); if (a) a.focus(); }
        window.scrollTo(0, 0);
        return;
      case "game": S.gameId = Number(el.dataset.id); render(); window.scrollTo(0, 0); return;
      case "back": S.gameId = null; render(); return;
      case "buy": return openSheet(Number(el.dataset.id));
      case "close": return closeSheet();
      case "check": return doCheck();
      case "back-form": S.sheet.step = "form"; S.sheet.error = ""; return drawSheet();
      case "order": return doOrder();
      case "to-orders": closeSheet(); S.tab = "orders"; S.gameId = null; render(); window.scrollTo(0, 0); return;
      case "topup-need": {
        const need = Math.max(S.me.topup.min, Math.ceil((S.sheet.pkg.price - S.me.user.balance) / 1000) * 1000);
        S.topup = { amount: money(need), result: null, error: "", busy: false };
        S.sheet.busy = false; closeSheet(); S.tab = "account"; S.gameId = null; render(); window.scrollTo(0, 0);
        return;
      }
      case "preset": { S.topup.amount = money(el.dataset.v); S.topup.result = null; S.topup.error = ""; render(); return; }
      case "topup": return doTopup(el.dataset.m);
      case "openpay": window.location.href = el.dataset.url; return;
      case "copy":
        try { await navigator.clipboard.writeText(el.dataset.v); toast("Nusxalandi"); } catch (e) { toast("Nusxalab bo'lmadi: qo'lda belgilab oling"); }
        return;
      case "refresh": S.me = null; return load(true);
      case "install":
        if (S.installEvt) { S.installEvt.prompt(); S.installEvt = null; render(); }
        return;
      case "logout":
        try { await api("logout", {}); } catch (e) { /* baribir chiqamiz */ }
        return signOut();
    }
  });

  document.addEventListener("input", (ev) => {
    const t = ev.target;
    if (t.id === "code") {
      t.value = t.value.replace(/\D/g, "").slice(0, 8);
      if (t.value.length === 8) doLogin();
    } else if (t.id === "amount") {
      const digits = t.value.replace(/\D/g, "");
      t.value = digits ? money(digits) : "";
      S.topup.amount = t.value;
    } else if (t.id === "pid" && S.sheet) {
      S.sheet.playerId = t.value;
    } else if (t.id === "sid" && S.sheet) {
      S.sheet.serverId = t.value;
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && S.sheet) closeSheet();
    if (ev.key === "Enter") {
      const id = ev.target && ev.target.id;
      if (id === "code") doLogin();
      else if ((id === "pid" || id === "sid") && S.sheet && S.sheet.step === "form") doCheck();
    }
  });

  // Telefonda to'lov sahifasidan qaytganda balansni yangilash
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && S.token && S.me && S.tab === "account") { S.me = null; load(); }
  });
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installEvt = e; if (S.token && S.me && S.tab === "account") render(); });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  render();
})();
