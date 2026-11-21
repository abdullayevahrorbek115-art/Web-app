// APP_URL va APP_NAME muhit o'zgaruvchilaridan capacitor.config.json yaratadi.
const fs = require("fs");
const path = require("path");
let url = String(process.env.APP_URL || "").trim().replace(/\/+$/, "");
if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(url)) {
  console.error("APP_URL noto'g'ri. Misol: https://mening-botim.onrender.com (https:// bilan, oxirida / siz)");
  process.exit(1);
}
let name = String(process.env.APP_NAME || "Donat Shop").replace(/[^\p{L}\p{N} ]/gu, "").trim().slice(0, 30) || "Donat Shop";
const cfg = {
  appId: "uz.donat.shop",
  appName: name,
  webDir: "www",
  server: { url: url + "/app/", cleartext: false },
  android: { allowMixedContent: false },
};
fs.writeFileSync(path.join(__dirname, "..", "capacitor.config.json"), JSON.stringify(cfg, null, 2));
console.log("Sozlama yozildi:", cfg.server.url, "|", name);
