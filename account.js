// O'yin akkaunti ma'lumotlarini (ID, server, username) tekshirish — bot ham, ilova ham shu yerdan foydalanadi.
const provider = require("./provider");

// Telegram username yoki raqamli ID ni tozalab qaytaradi (yaroqsiz bo'lsa null)
function normalizeId(game, text) {
  const t = String(text || "").trim();
  if (game.kind === "tg") {
    const u = t.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "");
    return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(u) ? "@" + u : null;
  }
  const d = t.replace(/[\s\-_.,]/g, ""); // "1234 5678" yoki "1234-5678" ham qabul qilinadi
  return /^\d{5,15}$/.test(d) ? d : null;
}

function normalizeServer(text) {
  const d = String(text || "").trim().replace(/[\s()\-]/g, "");
  return /^\d{1,7}$/.test(d) ? d : null;
}

// "12345678 (2001)", "12345678 2001", "12345678:2001" kabi bitta xabardagi ID + server ni ajratadi.
// -> { playerId, serverId? } yoki null
function parseIdInput(game, text) {
  if (game.kind !== "tg" && game.needsServer) {
    const tokens = String(text || "").split(/[\s(),:\/]+/).filter(Boolean);
    if (tokens.length === 2 && /^\d{6,15}$/.test(tokens[0]) && /^\d{1,7}$/.test(tokens[1])) {
      return { playerId: tokens[0], serverId: tokens[1] };
    }
  }
  const id = normalizeId(game, text);
  return id ? { playerId: id } : null;
}

function idError(game) {
  return game.kind === "tg"
    ? "Username noto'g'ri. Masalan: @username (5–32 belgi: lotin harf, raqam va _)."
    : "ID faqat raqamlardan iborat bo'lishi kerak (5–15 ta raqam).";
}

// Provayder orqali tekshiradi.
// -> { ok, nickname, verified }
//   ok=false      — provayder ANIQ "bunday ID yo'q" dedi
//   verified=true — provayder tushunarli javob berdi (nik bo'lsa ko'rsatiladi)
//   verified=false— tekshirib bo'lmadi (API o'chiq, sozlanmagan yoki xato): xaridni to'xtatmaymiz, mijoz ogohlantiriladi
async function checkAccount(game, playerId, serverId) {
  try {
    const r = await provider.checkId(game, playerId, serverId);
    return { ok: !!r.ok, nickname: r.nickname || null, verified: !!r.verified };
  } catch (e) {
    console.error("ID tekshirish xizmati xatosi:", e.message);
    return { ok: true, nickname: null, verified: false };
  }
}

module.exports = { normalizeId, normalizeServer, parseIdInput, idError, checkAccount };
