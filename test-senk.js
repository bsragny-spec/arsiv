/* Otomatik eşitleme sınaması: ikinci açılışta Drive'daki değişiklikler yakalanıyor mu? */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const KLASOR = "application/vnd.google-apps.folder";

/* ---- paylaşılan sahte Drive ---- */
let sayac = 0;
const D = new Map();
function ekle(ad, mime, ust, zaman) {
  const id = "id" + (++sayac);
  D.set(id, { id, name: ad, mimeType: mime, parents: ust ? [ust] : [],
              trashed: false, size: "100", modifiedTime: zaman || "2026-01-01T00:00:00Z" });
  return id;
}
const kok = ekle("HASTA KAYIT STANDART", KLASOR, null);
const kapak = ekle("KAPAK", KLASOR, kok);
const koroid = ekle("KOROID", KLASOR, kok);
const h1 = ekle("VAHDİ KAMIŞ", KLASOR, kapak);
const h2 = ekle("AHMET GÜLAÇTI", KLASOR, koroid);
const v1 = ekle("20260724", KLASOR, h1);
const t1 = ekle("EKSTERNAL", KLASOR, v1);
for (let i = 1; i <= 3; i++) ekle("a" + i + ".jpg", "image/jpeg", t1);
const v2 = ekle("20250124", KLASOR, h2);
const t2 = ekle("UWFP", KLASOR, v2);
for (let i = 1; i <= 2; i++) ekle("b" + i + ".jpg", "image/jpeg", t2);

function sorgula(q) {
  let l = [...D.values()];
  if (/trashed = false/.test(q)) l = l.filter(f => !f.trashed);
  let m;
  if ((m = /name = '([^']*)'/.exec(q))) l = l.filter(f => f.name === m[1].replace(/\\'/g, "'"));
  if ((m = /mimeType = '([^']*)'/.exec(q))) l = l.filter(f => f.mimeType === m[1]);
  if ((m = /mimeType != '([^']*)'/.exec(q))) l = l.filter(f => f.mimeType !== m[1]);
  if ((m = /'([^']*)' in parents/.exec(q))) l = l.filter(f => (f.parents || []).includes(m[1]));
  if ((m = /modifiedTime > '([^']*)'/.exec(q))) l = l.filter(f => f.modifiedTime > m[1]);
  return l;
}

const sayim = { get: 0 };
function oturum(depo) {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const sayfa = html
    .replace('<script src="https://accounts.google.com/gsi/client" async defer></script>', "")
    .replace('<script src="config.js"></script>', "")
    .replace('<script src="app.js"></script>', "<script>" + js + "</script>");
  const dom = new JSDOM(sayfa, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://o.github.io/arsiv/",
    beforeParse(w) {
      if (depo) Object.keys(depo).forEach(k => w.localStorage.setItem(k, depo[k]));
      w.google = { accounts: { oauth2: {
        initTokenClient(cfg) {
          return { callback: cfg.callback,
                   requestAccessToken() { setTimeout(() => this.callback({ access_token: "J", expires_in: 3600 }), 0); } };
        }, revoke() {} } } };
      w.URL.createObjectURL = () => "blob:x"; w.URL.revokeObjectURL = () => {};
      w.fetch = async (url, opt) => {
        opt = opt || {};
        const u = String(url);
        const yanit = (g, st = 200) => ({ ok: st < 300, status: st,
          headers: { get: k => k.toLowerCase() === "content-type" ? "application/json" : null },
          json: async () => g, text: async () => JSON.stringify(g) });
        if ((opt.method || "GET").toUpperCase() !== "GET") return yanit({ id: "x" });
        sayim.get++;
        const mid = /\/files\/([^?]+)/.exec(u);
        if (mid && !/[?&]q=/.test(u)) {
          const f = D.get(mid[1]);
          return yanit(f ? { id: f.id, name: f.name, parents: f.parents } : {});
        }
        const q = decodeURIComponent((/[?&]q=([^&]*)/.exec(u) || [, ""])[1]);
        return yanit({ files: sorgula(q).map(f => ({ id: f.id, name: f.name, parents: f.parents,
                                                     mimeType: f.mimeType, size: f.size })) });
      };
    }
  });
  return dom;
}

const b = ms => new Promise(r => setTimeout(r, ms));
let gecti = 0, kaldi = 0;
const T = (a, k) => { console.log((k ? "  OK   " : "  HATA ") + a); k ? gecti++ : kaldi++; };

(async () => {
  /* ---------- 1. oturum: ilk okuma ---------- */
  const d1 = oturum(null);
  const w1 = d1.window;
  await b(150);
  w1.document.getElementById("cid").value = "1-a.apps.googleusercontent.com";
  w1.document.getElementById("baglan").dispatchEvent(new w1.MouseEvent("click", { bubbles: true }));
  await b(900);
  console.log("--- 1. oturum (ilk okuma) ---");
  console.log("     ", w1.document.getElementById("sayim").textContent);
  T("2 hasta kuruldu", /2 hasta/.test(w1.document.getElementById("sayim").textContent));
  const depo = {};
  for (let i = 0; i < w1.localStorage.length; i++) {
    const k = w1.localStorage.key(i); depo[k] = w1.localStorage.getItem(k);
  }
  T("senk zamanı kaydedildi", !!depo["arsiv-son-senk"]);

  /* ---------- Drive'da değişiklik ---------- */
  await b(1200);
  const GEC = new Date().toISOString().replace(/\.\d+Z$/, "Z");  /* 1. oturumdan sonra, 2. oturumdan önce */
  // (a) var olan hastaya yeni vizit + görüntü
  const v3 = ekle("20260914", KLASOR, h1, GEC);
  const t3 = ekle("UWFP", KLASOR, v3, GEC);
  ekle("yeni1.jpg", "image/jpeg", t3, GEC);
  ekle("yeni2.jpg", "image/jpeg", t3, GEC);
  // (b) var olan hastaya tanı dosyası
  ekle("TANI - KAPAK BCC.txt", "text/plain", h1, GEC);
  // (c) Drive'da elle açılmış yepyeni hasta
  const h3 = ekle("YENİ HASTA", KLASOR, koroid, GEC);
  const v4 = ekle("20260901", KLASOR, h3, GEC);
  const t4 = ekle("ASP", KLASOR, v4, GEC);
  ekle("c1.jpg", "image/jpeg", t4, GEC);

  /* ---------- 2. oturum: önbellekten açılış + otomatik eşitleme ---------- */
  sayim.get = 0;
  const d2 = oturum(depo);
  const w2 = d2.window, dd = w2.document;
  await b(2600);
  console.log("--- 2. oturum (otomatik eşitleme) ---");
  console.log("     durum:", dd.getElementById("genel").textContent);
  console.log("     ", dd.getElementById("sayim").textContent);
  T("yeni hasta listeye eklendi (3)", /3 hasta/.test(dd.getElementById("sayim").textContent));

  const q = dd.getElementById("q");
  q.value = "vahdi"; q.dispatchEvent(new w2.Event("input", { bubbles: true }));
  await b(150);
  const meta = (dd.querySelector(".kmeta") || {}).textContent || "";
  console.log("     ", meta.replace(/\s+/g, " "));
  T("yeni vizit geldi (2 vizit)", /2 vizit/.test(meta));
  T("yeni görüntüler sayıldı (5)", /5 görüntü/.test(meta));
  T("tanı okundu", /KAPAK BCC/.test(meta));

  q.value = "yeni hasta"; q.dispatchEvent(new w2.Event("input", { bubbles: true }));
  await b(150);
  T("Drive'da açılan hasta bulundu", dd.querySelectorAll(".kart").length === 1);

  console.log("--- maliyet ---");
  console.log("     2. oturumdaki istek sayısı:", sayim.get);
  T("az istekle yapıldı (<25)", sayim.get < 25);

  /* ---------- 3. oturum: değişiklik yokken ---------- */
  const depo2 = {};
  for (let i = 0; i < w2.localStorage.length; i++) {
    const k = w2.localStorage.key(i); depo2[k] = w2.localStorage.getItem(k);
  }
  sayim.get = 0;
  const d3 = oturum(depo2);
  await b(2200);
  console.log("--- 3. oturum (değişiklik yok) ---");
  console.log("     durum:", d3.window.document.getElementById("genel").textContent);
  console.log("     istek sayısı:", sayim.get);
  T("boşuna okuma yapmadı (≤3 istek)", sayim.get <= 3);
  T("liste bozulmadı", /3 hasta/.test(d3.window.document.getElementById("sayim").textContent));

  console.log("\n" + gecti + " geçti, " + kaldi + " kaldı");
  process.exit(kaldi ? 1 : 0);
})().catch(e => { console.log("ÇÖKTÜ:", e && e.stack); process.exit(1); });
