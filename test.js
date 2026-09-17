/* Uygulamanın sahte bir Drive üzerinde uçtan uca sınanması */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const DIZIN = __dirname;
const KLASOR = "application/vnd.google-apps.folder";

/* ---------------- sahte Drive ---------------- */
function sahteDrive() {
  let sayac = 0;
  const yeni = (ad, mime, ust) => {
    const id = "id" + (++sayac);
    d.set(id, { id, name: ad, mimeType: mime, parents: ust ? [ust] : [], trashed: false, size: "0" });
    return id;
  };
  const d = new Map();
  const kok = yeni("HASTA KAYIT STANDART", KLASOR, null);
  const arac = yeni("_ARAC", KLASOR, kok);
  const kapak = yeni("KAPAK", KLASOR, kok);
  const koroid = yeni("KOROID", KLASOR, kok);
  const h1 = yeni("VAHDİ KAMIŞ", KLASOR, kapak);
  const h2 = yeni("AHMET GÜLAÇTI", KLASOR, koroid);
  const v1 = yeni("20260724", KLASOR, h1);
  const v2 = yeni("20260903", KLASOR, h1);
  const v3 = yeni("20250124", KLASOR, h2);
  const t1 = yeni("EKSTERNAL", KLASOR, v1);
  const t2 = yeni("EKSTERNAL", KLASOR, v2);
  const t3 = yeni("UWFP", KLASOR, v3);
  const t4 = yeni("OCT", KLASOR, v3);
  for (let i = 1; i <= 5; i++) yeni("ext_" + i + ".jpg", "image/jpeg", t1);
  for (let i = 1; i <= 4; i++) yeni("ext2_" + i + ".jpg", "image/jpeg", t2);
  for (let i = 1; i <= 7; i++) yeni("uwf_" + i + ".jpg", "image/jpeg", t3);
  for (let i = 1; i <= 2; i++) yeni("oct_" + i + ".e2e", "application/octet-stream", t4);
  yeni("TANI - KAPAK BCC.txt", "text/plain", h1);
  yeni("alakasiz.pdf", "application/pdf", "BASKA");     /* arşiv dışı */
  return { d, kok, ids: { kapak, koroid, h1, h2, v1, v2, v3, t1, t2, t3, t4, arac } };
}

/* çok basit Drive sorgu çözümleyici */
function sorgula(d, q) {
  let liste = [...d.values()];
  const trashed = /trashed = false/.test(q);
  if (trashed) liste = liste.filter(f => !f.trashed);
  let m;
  if ((m = /name = '([^']*)'/.exec(q))) liste = liste.filter(f => f.name === m[1].replace(/\\'/g, "'"));
  if ((m = /mimeType = '([^']*)'/.exec(q))) liste = liste.filter(f => f.mimeType === m[1]);
  if ((m = /mimeType != '([^']*)'/.exec(q))) liste = liste.filter(f => f.mimeType !== m[1]);
  if ((m = /'([^']*)' in parents/.exec(q))) liste = liste.filter(f => (f.parents || []).includes(m[1]));
  return liste;
}

function kur() {
  const drive = sahteDrive();
  const cagrilar = { get: 0, post: 0, patch: 0, upload: 0, put: [] };
  const yuklenen = [];
  let oturumlar = {};

  const html = fs.readFileSync(path.join(DIZIN, "index.html"), "utf8");
  const js = fs.readFileSync(path.join(DIZIN, "app.js"), "utf8");
  const sayfa = html.replace('<script src="https://accounts.google.com/gsi/client" async defer></script>', "")
                    .replace(/<script src="config\.js[^"]*"><\/script>/, "")
                    .replace(/<script src="app\.js[^"]*"><\/script>/, "<script>" + js + "</script>");

  const dom = new JSDOM(sayfa, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://ornek.github.io/arsiv/",
    beforeParse(w) {
      w.google = {
        accounts: {
          oauth2: {
            initTokenClient(cfg) {
              return {
                callback: cfg.callback,
                requestAccessToken() {
                  setTimeout(() => this.callback({ access_token: "SAHTE_JETON", expires_in: 3600 }), 0);
                }
              };
            },
            revoke() {}
          }
        }
      };
      w.URL.createObjectURL = () => "blob:sahte";
      w.URL.revokeObjectURL = () => {};
      w.fetch = async (url, opt) => {
        opt = opt || {};
        const u = String(url);
        const yanit = (govde, durum = 200, baslik = {}) => ({
          ok: durum >= 200 && durum < 300, status: durum,
          headers: { get: k => (Object.assign({ "content-type": "application/json; charset=UTF-8" }, baslik))[String(k).toLowerCase()] || null },
          json: async () => govde, text: async () => JSON.stringify(govde), blob: async () => ({})
        });

        /* --- parçalı yükleme oturumu --- */
        if (u.includes("uploadType=resumable")) {
          cagrilar.upload++;
          const g = JSON.parse(opt.body);
          const oid = "https://upload.test/o" + (Object.keys(oturumlar).length + 1);
          oturumlar[oid] = { ad: g.name, ust: g.parents[0], alinan: 0,
                             toplam: parseInt(opt.headers["X-Upload-Content-Length"], 10) };
          return yanit({}, 200, { location: oid });
        }
        if (oturumlar[u]) {
          const o = oturumlar[u];
          const cr = opt.headers["Content-Range"];
          cagrilar.put.push(cr);
          const mm = /bytes (\d+)-(\d+)\/(\d+)/.exec(cr);
          if (!mm) return yanit({}, 308, { range: "bytes=0-" + (o.alinan - 1) });
          o.alinan = parseInt(mm[2], 10) + 1;
          if (o.alinan >= o.toplam) {
            const id = "up" + (yuklenen.length + 1);
            drive.d.set(id, { id, name: o.ad, mimeType: "image/jpeg", parents: [o.ust], trashed: false, size: String(o.toplam) });
            yuklenen.push({ ad: o.ad, bayt: o.toplam, ust: o.ust });
            return yanit({ id, name: o.ad });
          }
          return yanit({}, 308, { range: "bytes=0-" + (o.alinan - 1) });
        }
        /* --- çok parçalı (metin dosyası) --- */
        if (u.includes("uploadType=multipart")) {
          const mm = /"name":"([^"]*)"[\s\S]*?"parents":\["([^"]*)"\]/.exec(opt.body);
          const id = "txt" + (++cagrilar.post);
          drive.d.set(id, { id, name: mm ? mm[1] : "?", mimeType: "text/plain", parents: [mm ? mm[2] : ""], trashed: false, size: "10" });
          return yanit({ id });
        }
        /* --- normal API --- */
        const yont = (opt.method || "GET").toUpperCase();
        if (yont === "GET") {
          cagrilar.get++;
          const q = decodeURIComponent((/[?&]q=([^&]*)/.exec(u) || [, ""])[1]);
          const l = sorgula(drive.d, q).map(f => ({
            id: f.id, name: f.name, parents: f.parents, mimeType: f.mimeType, size: f.size,
            thumbnailLink: f.mimeType.startsWith("image/") ? "https://lh3.test/" + f.id + "=s220" : undefined,
            webViewLink: "https://drive.google.com/file/d/" + f.id + "/view"
          }));
          return yanit({ files: l });
        }
        if (yont === "POST") {
          cagrilar.post++;
          const g = JSON.parse(opt.body);
          const id = "yeni" + cagrilar.post;
          drive.d.set(id, { id, name: g.name, mimeType: g.mimeType || "application/octet-stream",
                            parents: g.parents || [], trashed: false, size: "0" });
          return yanit({ id, name: g.name });
        }
        if (yont === "PATCH") {
          cagrilar.patch++;
          const id = (/files\/([^?]+)/.exec(u) || [])[1];
          const g = JSON.parse(opt.body);
          const f = drive.d.get(id);
          if (f) { if (g.trashed) f.trashed = true; if (g.name) f.name = g.name; }
          return yanit({ id, name: f ? f.name : "" });
        }
        return yanit({}, 404);
      };
    }
  });
  return { dom, w: dom.window, d: dom.window.document, drive, cagrilar, yuklenen };
}

/* ---------------- koşum ---------------- */
const b = ms => new Promise(r => setTimeout(r, ms));
let gecti = 0, kaldi = 0;
const T = (ad, k) => { console.log((k ? "  OK   " : "  HATA ") + ad); k ? gecti++ : kaldi++; };

(async () => {
  const { w, d, drive, cagrilar, yuklenen } = kur();
  await b(120);

  console.log("--- 1. Kurulum ekranı ---");
  T("kapak görünüyor", !d.getElementById("kapak").hidden);
  T("Client ID alanı açık", !d.getElementById("kimlikalani").hidden);
  d.getElementById("cid").value = "yanlis";
  d.getElementById("baglan").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(60);
  T("hatalı ID reddedildi", /apps\.googleusercontent\.com/.test(d.getElementById("kapakdurum").textContent));

  console.log("--- 2. Bağlan ve dizini kur ---");
  d.getElementById("cid").value = "123-abc.apps.googleusercontent.com";
  d.getElementById("baglan").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(900);
  T("uygulama açıldı", !d.getElementById("uygulama").hidden);
  console.log("     sayım:", d.getElementById("sayim").textContent);
  T("2 hasta bulundu", /2 hasta/.test(d.getElementById("sayim").textContent));
  T("_ARAC klasörü hasta sayılmadı", !/_ARAC/.test(d.getElementById("sonuclar").textContent));
  console.log("     istek sayısı:", cagrilar.get);
  T("dizin az istekle kuruldu (≤6)", cagrilar.get <= 6);

  console.log("--- 3. Arama ve sayımlar ---");
  const q = d.getElementById("q");
  q.value = "vahdi"; q.dispatchEvent(new w.Event("input", { bubbles: true }));
  await b(60);
  const kart = d.querySelector(".kart");
  T("vahdi bulundu", d.querySelectorAll(".kart").length === 1);
  const meta = kart.querySelector(".kmeta").textContent.replace(/\s+/g, " ");
  console.log("     ", meta);
  T("2 vizit", /2 vizit/.test(meta));
  T("9 görüntü", /9 görüntü/.test(meta));
  T("tanı okundu", /KAPAK BCC/.test(meta));

  console.log("--- 4. Tanıya göre arama ---");
  q.value = "bcc"; q.dispatchEvent(new w.Event("input", { bubbles: true }));
  await b(60);
  T("tanıdan bulundu", d.querySelectorAll(".kart").length === 1);

  console.log("--- 5. Kartı aç, galeri ---");
  q.value = "vahdi"; q.dispatchEvent(new w.Event("input", { bubbles: true }));
  await b(60);
  d.querySelector(".kbas").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(80);
  T("vizitler çizildi", d.querySelectorAll(".vizit").length === 2);
  T("teknik düğmeleri var", d.querySelectorAll("[data-galeri]").length === 2);
  T("Drive bağlantısı hazır", !!d.querySelector('a[href*="drive.google.com/drive/folders/"]'));
  d.querySelector("[data-galeri]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(300);
  const kucukler = d.querySelectorAll(".kucuk");
  T("küçük resimler geldi", kucukler.length === 5);
  T("thumbnail adresi büyütüldü", /=s400/.test(d.querySelector(".kucuk img").getAttribute("src")));

  console.log("--- 6. Büyüteç ---");
  kucukler[1].dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(80);
  T("büyüteç açıldı", !!d.querySelector(".buyutec"));
  console.log("     ", d.querySelector(".buyutec .ust span").textContent);
  T("2/5 gösteriliyor", /2\/5/.test(d.querySelector(".buyutec .ust span").textContent));
  d.querySelector('.buyutec [data-gez="1"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(40);
  T("ileri gidildi", /3\/5/.test(d.querySelector(".buyutec .ust span").textContent));
  d.querySelector(".buyutec [data-kapat]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(40);
  T("büyüteç kapandı", !d.querySelector(".buyutec"));

  console.log("--- 7. Teknik silme (onaylı) ---");
  const once = cagrilar.patch;
  d.querySelector("[data-silteknik]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(60);
  T("onay soruldu", !!d.querySelector(".onay"));
  d.querySelector(".onay .hayir").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(60);
  T("vazgeçince silinmedi", cagrilar.patch === once);
  d.querySelector("[data-silteknik]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(60);
  d.querySelector(".onay .evet").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(300);
  T("çöp kutusuna taşındı", cagrilar.patch === once + 1);
  T("klasör gerçekten trashed", drive.d.get(drive.ids.t1).trashed === true);
  await b(60);
  const meta2 = d.querySelector(".kmeta").textContent.replace(/\s+/g, " ");
  console.log("     ", meta2);
  T("sayım düştü (4 görüntü)", /4 görüntü/.test(meta2));

  console.log("--- 8. Vizit ekle + parçalı yükleme (20 MB) ---");
  d.querySelector("[data-vizitekle]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(80);
  T("yeni kayıt sekmesi açıldı", d.getElementById("tab-yeni").getAttribute("aria-selected") === "true");
  T("hasta kilitlendi", d.getElementById("nad").readOnly === true && d.getElementById("nad").value === "VAHDİ KAMIŞ");
  d.getElementById("ntarih").value = "2026-09-14";
  d.getElementById("ntarih").dispatchEvent(new w.Event("input", { bubbles: true }));
  const uwfCip = [...d.querySelectorAll("#ntek .cip")].find(x => x.textContent === "UWFP");
  uwfCip.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(60);
  console.log("     ", d.getElementById("yolonizleme").textContent);
  T("yol doğru", /KAPAK \/ VAHDİ KAMIŞ \/ 20260914 \/ UWFP/.test(d.getElementById("yolonizleme").textContent));
  T("oluştur düğmesi aktif", d.getElementById("olustur").disabled === false);

  const buyuk = new w.File([new Uint8Array(20 * 1024 * 1024)], "BUYUK_FOTO.jpg", { type: "image/jpeg" });
  const kucuk = new w.File([new Uint8Array(300 * 1024)], "kucuk.jpg", { type: "image/jpeg" });
  w.__arsivTestDosyaEkle ? w.__arsivTestDosyaEkle([buyuk, kucuk]) : null;
  /* dosya girdisini doğrudan besle */
  const kutu = d.querySelector('[data-tbirak]');
  T("teknik icin birakma kutusu olustu", !!kutu);
  if (kutu) kutu.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const girdi = d.getElementById("ndosya");
  Object.defineProperty(girdi, "files", { value: [buyuk, kucuk], configurable: true });
  girdi.dispatchEvent(new w.Event("change", { bubbles: true }));
  await b(80);
  T("2 dosya listelendi", d.querySelectorAll(".sdosya").length === 2);

  d.getElementById("olustur").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(2500);
  console.log("     yüklenen:", yuklenen.map(x => x.ad + " " + (x.bayt / 1048576).toFixed(1) + "MB").join(", "));
  T("iki dosya da yüklendi", yuklenen.length === 2);
  T("20 MB dosya tam gitti", yuklenen.some(x => x.bayt === 20 * 1024 * 1024));
  const parcalar = cagrilar.put.filter(x => /\/20971520$/.test(x));
  console.log("     parçalar:", parcalar.join(" | "));
  T("parça parça gönderildi (3 dilim)", parcalar.length === 3);
  T("son parça doğru bitti", /20971519\/20971520$/.test(parcalar[parcalar.length - 1]));
  console.log("     sonuç:", d.getElementById("cikti").textContent.replace(/\s+/g, " ").slice(0, 150));

  console.log("--- 9. Dizin güncellendi mi ---");
  d.getElementById("tab-ara").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  q.value = "vahdi"; q.dispatchEvent(new w.Event("input", { bubbles: true }));
  await b(80);
  const meta3 = d.querySelector(".kmeta").textContent.replace(/\s+/g, " ");
  console.log("     ", meta3);
  T("3 vizit oldu", /3 vizit/.test(meta3));
  T("yerel kayda yazıldı", !!w.localStorage.getItem("arsiv-dizin-v1"));

  console.log("--- 10. Tanı değiştir ---");
  if (!d.querySelector("[data-taniduzenle]")) {
    d.querySelector(".kbas").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await b(80);
  }
  d.querySelector("[data-taniduzenle]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(60);
  const ti = d.querySelector("[data-taniform] input");
  T("tanı formu açıldı", !!ti);
  ti.value = "KAPAK BAZAL HÜCRELİ KARSİNOM";
  d.querySelector("[data-taniform] [data-kaydet]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await b(500);
  const meta4 = d.querySelector(".kmeta").textContent.replace(/\s+/g, " ");
  T("yeni tanı göründü", /BAZAL HÜCRELİ/.test(meta4));
  T("eski TANI dosyası çöpe gitti",
    [...drive.d.values()].some(f => f.name === "TANI - KAPAK BCC.txt" && f.trashed));
  T("yeni TANI dosyası açıldı",
    [...drive.d.values()].some(f => /^TANI - KAPAK BAZAL/.test(f.name) && !f.trashed));

  console.log("\n" + gecti + " geçti, " + kaldi + " kaldı");
  process.exit(kaldi ? 1 : 0);
})().catch(e => { console.log("ÇÖKTÜ:", e && e.stack); process.exit(1); });
