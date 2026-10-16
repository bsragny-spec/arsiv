/* Hasta listesi denetimi: telefonda eklenen/silinen/adı değişen hasta masaüstünde
   eksiksiz görünüyor mu?  (APP=yol ile başka bir app.js sınanabilir) */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const KLASOR = "application/vnd.google-apps.folder";
const APP = process.env.APP || path.join(__dirname, "app.js");

/* ---------------- sahte Drive ---------------- */
let sayac = 0;
const D = new Map();
const ESKI = "2026-01-01T00:00:00Z";
const simdi = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
function ekle(ad, mime, ust, zaman) {
  const id = "id" + (++sayac);
  D.set(id, { id, name: ad, mimeType: mime, parents: ust ? [ust] : [], trashed: false, modifiedTime: zaman || ESKI });
  return id;
}
function hastaEkle(doku, ad, vizitler, zaman) {      /* vizitler: [{t, tek, n}] */
  const h = ekle(ad, KLASOR, doku, zaman);
  (vizitler || []).forEach(v => {
    const vz = ekle(v.t, KLASOR, h, zaman);
    const tk = ekle(v.tek, KLASOR, vz, zaman);
    for (let i = 0; i < v.n; i++) ekle(ad.replace(/\s/g, "_") + "_" + v.t + "_" + i + ".jpg", "image/jpeg", tk, zaman);
  });
  return h;
}
const kok = ekle("HASTA KAYIT STANDART", KLASOR, null);
ekle("_ARAC", KLASOR, kok);
const KAPAK = ekle("KAPAK", KLASOR, kok);
const KOROID = ekle("KOROID", KLASOR, kok);
const KONJ = ekle("KONJONKTIVA", KLASOR, kok);
const dokular = [KAPAK, KOROID, KONJ];
const P = {};
for (let i = 1; i <= 20; i++) {
  const ad = "HASTA " + String(i).padStart(2, "0");
  P[i] = i === 5 ? hastaEkle(KAPAK, ad, [])                          /* vizitsiz boş hasta klasörü */
                 : hastaEkle(dokular[i % 3], ad, [{ t: "20250101", tek: "UWFP", n: 2 }]);
}
ekle("TANI - KAPAK BCC.txt", "text/plain", P[6]);

let bozuk = new Set(), kesik = false;
const say = { get: 0 };
function sorgula(q) {
  let l = [...D.values()];
  if (/trashed = false/.test(q)) l = l.filter(f => !f.trashed);
  let m;
  if ((m = /name = '([^']*)'/.exec(q))) l = l.filter(f => f.name === m[1].replace(/\\'/g, "'"));
  if ((m = /mimeType = '([^']*)'/.exec(q))) l = l.filter(f => f.mimeType === m[1]);
  if ((m = /mimeType != '([^']*)'/.exec(q))) l = l.filter(f => f.mimeType !== m[1]);
  const eb = [...q.matchAll(/'([^']*)' in parents/g)].map(x => x[1]);
  if (eb.length) l = l.filter(f => f.parents.some(u => eb.includes(u)));
  if ((m = /modifiedTime > '([^']*)'/.exec(q))) l = l.filter(f => f.modifiedTime > m[1]);
  /* "çöpteki klasörün içindekiler" Drive'da da listelenmez */
  if (/trashed = false/.test(q)) l = l.filter(f => !ataCopte(f));
  return l;
}
function ataCopte(f) {
  let u = f.parents[0], adim = 0;
  while (u && adim++ < 8) { const x = D.get(u); if (!x) return false; if (x.trashed) return true; u = x.parents[0]; }
  return false;
}

function oturum(depo) {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const js = fs.readFileSync(APP, "utf8");
  const sayfa = html
    .replace('<script src="https://accounts.google.com/gsi/client" async defer></script>', "")
    .replace(/<script src="config\.js[^"]*"><\/script>/, "")
    .replace(/<script src="app\.js[^"]*"><\/script>/, "<script>" + js + "</script>");
  return new JSDOM(sayfa, {
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
        say.get++;
        const mid = /\/files\/([^?]+)/.exec(u);
        if (mid && !/[?&]q=/.test(u)) {
          const f = D.get(mid[1]);
          return yanit(f ? { id: f.id, name: f.name, parents: f.parents } : {});
        }
        const q = decodeURIComponent((/[?&]q=([^&]*)/.exec(u) || [, ""])[1]);
        const eb = [...q.matchAll(/'([^']*)' in parents/g)].map(x => x[1]);
        if (eb.some(x => bozuk.has(x))) return yanit({ error: { message: "Backend Error" } }, 500);
        let l = sorgula(q);
        if (kesik && / or /.test(q)) l = l.slice(0, 5);          /* Drive'ın eksik yanıt verdiği durum */
        return yanit({ files: l.map(f => ({ id: f.id, name: f.name, parents: f.parents, mimeType: f.mimeType,
                                            size: "100", modifiedTime: f.modifiedTime })) });
      };
    }
  });
}

const b = ms => new Promise(r => setTimeout(r, ms));
let gecti = 0, kaldi = 0;
const T = (a, k) => { console.log((k ? "  OK   " : "  HATA ") + a); k ? gecti++ : kaldi++; };
const depoAl = w => { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; };
function sayi(w) {                                   /* aramayı temizleyip toplam sayıyı oku */
  const q = w.document.getElementById("q");
  if (q.value) { q.value = ""; q.dispatchEvent(new w.Event("input", { bubbles: true })); }
  return +((/(\d+)/.exec(w.document.getElementById("sayim").textContent) || [, -1])[1]);
}
const durum = w => w.document.getElementById("genel").textContent;
const driveHasta = () => [...D.values()].filter(f => f.mimeType === KLASOR && !f.trashed && dokular.includes(f.parents[0])).length;
function ara(w, metin) {
  const q = w.document.getElementById("q");
  q.value = metin; q.dispatchEvent(new w.Event("input", { bubbles: true }));
  return [...w.document.querySelectorAll(".kart")].map(k => k.textContent.replace(/\s+/g, " "))
    .filter(k => k.toUpperCase().includes(metin.toUpperCase()));   /* tarih eşleşmesini ayıkla */
}

(async () => {
  /* ---------- 1. masaüstü: ilk açılış (tam tarama) ---------- */
  const d1 = oturum(null), w1 = d1.window;
  await b(150);
  w1.document.getElementById("cid").value = "1-a.apps.googleusercontent.com";
  w1.document.getElementById("baglan").dispatchEvent(new w1.MouseEvent("click", { bubbles: true }));
  await b(900);
  console.log("--- 1. masaüstü ilk açılış ---");
  T("20 hasta (vizitsiz olan dahil)", sayi(w1) === 20);
  let depo = depoAl(w1);

  /* ---------- telefonda yapılanlar ---------- */
  await b(1200);
  const Z = simdi();
  const yeniler = [];
  for (let i = 1; i <= 14; i++)
    yeniler.push(hastaEkle(i % 2 ? KOROID : KONJ, "YENI " + String(i).padStart(2, "0"), [{ t: "20261014", tek: "UWFP", n: 3 }], Z));
  ekle("TANI - UVEA MELANOM.txt", "text/plain", yeniler[6], Z);
  D.get(P[3]).trashed = true;                                         /* telefonda silinen hasta */
  Object.assign(D.get(P[4]), { name: "HASTA 04 DUZELTILDI", modifiedTime: Z });   /* adı düzeltilen */
  const v2 = ekle("20261015", KLASOR, P[2], Z), t2 = ekle("OCT", KLASOR, v2, Z);  /* var olan hastaya yeni vizit */
  for (let i = 0; i < 4; i++) ekle("oct" + i + ".jpg", "image/jpeg", t2, Z);
  ekle("baska-belge.docx", "application/msword", null, Z);           /* arşiv dışı dosya */
  const DOGRU = driveHasta();

  /* ---------- 2. masaüstü: önbellekle açılış + otomatik eşitleme ---------- */
  say.get = 0;
  const d2 = oturum(depo), w2 = d2.window;
  await b(3500);
  console.log("--- 2. masaüstü: telefondaki değişiklikler ---");
  console.log("     durum:", durum(w2));
  console.log("     liste:", sayi(w2), "· Drive:", DOGRU, "· istek:", say.get);
  T("sayı Drive'daki hasta klasörü sayısıyla aynı (" + DOGRU + ")", sayi(w2) === DOGRU);
  T("14 yeni hastanın hepsi geldi (eski sınır 12'ydi)", ara(w2, "yeni").length === 14);
  T("yeni hastaların vizit ve görüntüleri okundu", ara(w2, "yeni 05").some(k => /1 vizit/.test(k) && /3 görüntü/.test(k)));
  T("yeni hastanın tanısı okundu", ara(w2, "yeni 07").some(k => /UVEA MELANOM/.test(k)));
  T("vizitsiz hasta listeden düşmedi", ara(w2, "hasta 05").length === 1);
  T("telefonda silinen hasta listeden çıktı", ara(w2, "hasta 03").length === 0);
  T("adı düzeltilen hasta yeni adıyla görünüyor", ara(w2, "duzeltildi").length === 1);
  T("var olan hastaya eklenen vizit geldi", ara(w2, "hasta 02").some(k => /2 vizit/.test(k) && /6 görüntü/.test(k)));
  T("arşiv dışı dosya yüzünden klasör yürüyüşü yapılmadı (istek < 70)", say.get < 70);
  depo = depoAl(w2);

  /* ---------- 3. değişiklik yokken ---------- */
  say.get = 0;
  const d3 = oturum(depo), w3 = d3.window;
  await b(2000);
  console.log("--- 3. değişiklik yokken ---");
  console.log("     istek:", say.get);
  T("üç istekte bitti (doku + hasta listesi + değişenler)", say.get <= 3);
  T("liste bozulmadı", sayi(w3) === DOGRU);
  depo = depoAl(w3);

  /* ---------- 4. okuma hatası: hasta düşmemeli, sonra tamamlanmalı ---------- */
  await b(1200);
  const Z2 = simdi();
  hastaEkle(KAPAK, "YENI 15", [{ t: "20261016", tek: "ASP", n: 2 }], Z2);
  const h16 = hastaEkle(KAPAK, "YENI 16", [{ t: "20261016", tek: "ASP", n: 5 }], Z2);
  bozuk = new Set([h16]);
  const oncekiZaman = JSON.parse(depo["arsiv-son-senk"]);
  say.get = 0;
  const d4 = oturum(depo), w4 = d4.window;
  await b(6000);
  console.log("--- 4. bir hasta okunamıyor ---");
  console.log("     durum:", durum(w4));
  T("okunamayan hasta yine de listede", ara(w4, "yeni 16").length === 1);
  T("diğer yeni hasta tam okundu", ara(w4, "yeni 15").some(k => /2 görüntü/.test(k)));
  T("kullanıcıya söylendi", /okunamadı/.test(durum(w4)));
  T("eşitleme zamanı ilerlemedi (tekrar denenecek)", JSON.parse(w4.localStorage.getItem("arsiv-son-senk")) === oncekiZaman);
  bozuk = new Set();
  w4.document.getElementById("yenile").dispatchEvent(new w4.MouseEvent("click", { bubbles: true }));
  await b(2500);
  console.log("     Yenile sonrası:", durum(w4));
  T("Yenile ile tamamlandı", ara(w4, "yeni 16").some(k => /1 vizit/.test(k) && /5 görüntü/.test(k)));
  T("sayı yine Drive'la aynı (" + driveHasta() + ")", sayi(w4) === driveHasta());
  depo = depoAl(w4);

  /* ---------- 5. Drive eksik yanıt verirse liste toptan silinmemeli ---------- */
  kesik = true;
  say.get = 0;
  const d5 = oturum(depo), w5 = d5.window;
  await b(3000);
  kesik = false;
  console.log("--- 5. Drive eksik liste döndürdü ---");
  console.log("     durum:", durum(w5));
  T("hastalar toptan silinmedi, arşiv baştan okundu", sayi(w5) === driveHasta());

  /* ---------- 6. Yenile'ye art arda basmak ---------- */
  const yb = w5.document.getElementById("yenile");
  say.get = 0;
  yb.disabled = false; yb.dispatchEvent(new w5.MouseEvent("click", { bubbles: true }));
  await b(1500);
  console.log("--- 6. Yenile ---");
  console.log("     durum:", durum(w5));
  T("elle Yenile sonucu doğrulanmış sayıyla bildiriyor", /Drive ile karşılaştırıldı: \d+ hasta/.test(durum(w5)) || /toplam \d+ hasta/.test(durum(w5)));

  console.log("\n" + gecti + " geçti, " + kaldi + " kaldı");
  process.exit(kaldi ? 1 : 0);
})().catch(e => { console.log("ÇÖKTÜ:", e && e.stack); process.exit(1); });
