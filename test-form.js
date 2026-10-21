/* Yeni kayıt / vizit ekle formu: hastalar arasında bilgi taşınmıyor mu, ✕ ve Esc doğru çalışıyor mu? */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const KLASOR = "application/vnd.google-apps.folder";

/* ---------------- sahte Drive ---------------- */
let sayac = 0;
const D = new Map();
function ekle(ad, mime, ust) {
  const id = "id" + (++sayac);
  D.set(id, { id, name: ad, mimeType: mime, parents: ust ? [ust] : [], trashed: false, size: "100" });
  return id;
}
const kok = ekle("HASTA KAYIT STANDART", KLASOR, null);
const KAPAK = ekle("KAPAK", KLASOR, kok), KOROID = ekle("KOROID", KLASOR, kok);
function hasta(doku, ad, tani, vt, tek, n) {
  const h = ekle(ad, KLASOR, doku), v = ekle(vt, KLASOR, h), t = ekle(tek, KLASOR, v);
  for (let i = 0; i < n; i++) ekle(ad[0] + i + ".jpg", "image/jpeg", t);
  if (tani) ekle("TANI - " + tani + ".txt", "text/plain", h);
  return h;
}
const A = hasta(KAPAK, "AYSE YILMAZ", "KAPAK BCC", "20250101", "UWFP", 2);
const B = hasta(KOROID, "BEKIR DEMIR", "UVEA MELANOM", "20250202", "OCT", 3);
const C = hasta(KOROID, "CEMAL KAYA", "", "20250303", "UWFP", 1);

function sorgula(q) {
  let l = [...D.values()];
  if (/trashed = false/.test(q)) l = l.filter(f => !f.trashed);
  let m;
  if ((m = /name = '([^']*)'/.exec(q))) l = l.filter(f => f.name === m[1].replace(/\\'/g, "'"));
  if ((m = /mimeType = '([^']*)'/.exec(q))) l = l.filter(f => f.mimeType === m[1]);
  if ((m = /mimeType != '([^']*)'/.exec(q))) l = l.filter(f => f.mimeType !== m[1]);
  const eb = [...q.matchAll(/'([^']*)' in parents/g)].map(x => x[1]);
  if (eb.length) l = l.filter(f => f.parents.some(u => eb.includes(u)));
  return l;
}

const kayit = { taniYazma: [], yuklenen: [] };
let bozukAd = null;
const oturumlar = {};
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const js = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const sayfa = html.replace('<script src="https://accounts.google.com/gsi/client" async defer></script>', "")
  .replace(/<script src="config\.js[^"]*"><\/script>/, "")
  .replace(/<script src="app\.js[^"]*"><\/script>/, "<script>" + js + "</script>");
const dom = new JSDOM(sayfa, {
  runScripts: "dangerously", pretendToBeVisual: true, url: "https://o.github.io/arsiv/",
  beforeParse(w) {
    w.google = { accounts: { oauth2: {
      initTokenClient(cfg) { return { callback: cfg.callback,
        requestAccessToken() { setTimeout(() => this.callback({ access_token: "J", expires_in: 3600 }), 0); } }; },
      revoke() {} } } };
    w.URL.createObjectURL = () => "blob:x"; w.URL.revokeObjectURL = () => {};
    w.fetch = async (url, opt) => {
      opt = opt || {};
      const u = String(url);
      const yanit = (g, st = 200, bas = {}) => ({ ok: st >= 200 && st < 300, status: st,
        headers: { get: k => (Object.assign({ "content-type": "application/json" }, bas))[String(k).toLowerCase()] || null },
        json: async () => g, text: async () => JSON.stringify(g) });
      if (u.includes("uploadType=resumable")) {
        const g = JSON.parse(opt.body);
        if (g.name === bozukAd) return yanit({ error: { message: "Backend Error" } }, 500);
        const oid = "https://upload.test/o" + (Object.keys(oturumlar).length + 1);
        oturumlar[oid] = { ad: g.name, ust: g.parents[0], toplam: parseInt(opt.headers["X-Upload-Content-Length"], 10) };
        return yanit({}, 200, { location: oid });
      }
      if (oturumlar[u]) {
        const o = oturumlar[u];
        const id = ekle(o.ad, "image/jpeg", o.ust);
        kayit.yuklenen.push(o.ad);
        return yanit({ id, name: o.ad });
      }
      if (u.includes("uploadType=multipart")) {
        const mm = /"name":"([^"]*)"[\s\S]*?"parents":\["([^"]*)"\]/.exec(opt.body);
        kayit.taniYazma.push(mm[1]);
        const id = ekle(mm[1], "text/plain", mm[2]);
        return yanit({ id });
      }
      const yont = (opt.method || "GET").toUpperCase();
      if (yont === "POST") {
        const g = JSON.parse(opt.body);
        const id = ekle(g.name, g.mimeType || "x", (g.parents || [])[0]);
        return yanit({ id, name: g.name });
      }
      if (yont === "PATCH") {
        const id = (/files\/([^?]+)/.exec(u) || [])[1];
        const g = JSON.parse(opt.body), f = D.get(id);
        if (f && g.trashed) f.trashed = true;
        return yanit({ id });
      }
      const q = decodeURIComponent((/[?&]q=([^&]*)/.exec(u) || [, ""])[1]);
      return yanit({ files: sorgula(q).map(f => ({ id: f.id, name: f.name, parents: f.parents, mimeType: f.mimeType, size: f.size })) });
    };
  }
});
const w = dom.window, d = w.document, $ = id => d.getElementById(id);
const b = ms => new Promise(r => setTimeout(r, ms));
let gecti = 0, kaldi = 0;
const T = (a, k) => { console.log((k ? "  OK   " : "  HATA ") + a); k ? gecti++ : kaldi++; };
const tikla = el => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const tus = k => d.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true }));
const cip = (kap, ad) => [...d.querySelectorAll("#" + kap + " .cip")].find(x => x.textContent === ad);
function dosyaVer(adlar) {
  tikla(d.querySelector("[data-tbirak]"));
  const g = $("ndosya");
  Object.defineProperty(g, "files", { value: adlar.map(a => new w.File([new Uint8Array(1000)], a, { type: "image/jpeg" })), configurable: true });
  g.dispatchEvent(new w.Event("change", { bubbles: true }));
}
async function vizitEkle(arama) {
  tikla($("tab-ara"));
  const q = $("q"); q.value = arama; q.dispatchEvent(new w.Event("input", { bubbles: true }));
  await b(60);
  if (!d.querySelector(".kart [data-vizitekle]")) { tikla(d.querySelector(".kbas")); await b(60); }
  tikla(d.querySelector(".kart [data-vizitekle]"));
  await b(60);
}
function tarih(v) { $("ntarih").value = v; $("ntarih").dispatchEvent(new w.Event("input", { bubbles: true })); }
const metin = el => el.textContent.replace(/\s+/g, " ").trim();
function kartMeta(arama) {
  tikla($("tab-ara"));
  const q = $("q"); q.value = arama; q.dispatchEvent(new w.Event("input", { bubbles: true }));
  return metin(d.querySelector(".kart .kmeta") || d.createElement("i"));
}

(async () => {
  await b(120);
  $("cid").value = "1-a.apps.googleusercontent.com";
  tikla($("baglan"));
  await b(900);

  console.log("--- 1. A hastasına vizit ekle ---");
  await vizitEkle("ayse");
  T("başlık 'Vizit ekle'", $("formbaslik").textContent === "Vizit ekle");
  T("başlıkta hasta adı", /AYSE YILMAZ/.test(metin($("formalt"))));
  T("sekme adı 'Vizit ekle'", $("tab-yeni").textContent === "Vizit ekle");
  T("ad kilitli", $("nad").readOnly && $("nad").value === "AYSE YILMAZ");
  T("tanı alanında A'nın kendi tanısı", $("ntani").value === "KAPAK BCC");
  T("tanı ipucu görünüyor", !$("tanipucu").hidden);
  tarih("2026-10-20");
  tikla(cip("ntek", "UWFP")); await b(30);
  dosyaVer(["a_yeni.jpg"]); await b(30);
  $("ntani").value = "A ICIN YAZILAN";

  console.log("--- 2. Bitirmeden B hastasına geç ---");
  await vizitEkle("bekir");
  T("tanı alanında B'nin tanısı (A'nınki taşınmadı)", $("ntani").value === "UVEA MELANOM");
  T("tarih temizlendi", $("ntarih").value === "");
  T("teknik seçimi temizlendi", !d.querySelector('#ntek .cip[aria-pressed="true"]'));
  T("seçili dosyalar temizlendi", d.querySelectorAll(".sdosya").length === 0);
  T("başlıkta B", /BEKIR DEMIR/.test(metin($("formalt"))));

  console.log("--- 3. Tanısı olmayan hasta ---");
  await vizitEkle("cemal");
  T("tanı alanı boş", $("ntani").value === "");
  T("'kayıtlı tanısı yok' yazıyor", /kayıtlı tanısı yok/.test($("tanipucu").textContent));

  console.log("--- 4. ✕: değişiklik yoksa hemen kapanır ---");
  tikla($("formkapat")); await b(30);
  T("Ara sekmesine dönüldü", !$("panel-ara").hidden && $("panel-yeni").hidden);
  T("sekme adı yine 'Yeni kayıt'", $("tab-yeni").textContent === "Yeni kayıt");
  T("kilit kalktı", !$("nad").readOnly && $("nad").value === "");

  console.log("--- 5. Yeni hasta taslağı: ✕ önce sorar ---");
  tikla($("tab-yeni")); await b(30);
  T("başlık 'Yeni hasta'", $("formbaslik").textContent === "Yeni hasta");
  tikla(cip("ndoku", "KAPAK")); await b(20);
  $("nad").value = "DENEME HASTA"; $("nad").dispatchEvent(new w.Event("input", { bubbles: true }));
  tikla($("formkapat")); await b(20);
  T("onay soruldu", !!$("formsag").querySelector(".onay"));
  tikla($("formsag").querySelector(".onay .hayir")); await b(20);
  T("Vazgeç: taslak duruyor", $("nad").value === "DENEME HASTA" && !$("formsag").querySelector(".onay"));
  tus("Escape"); await b(20);
  T("Esc de önce soruyor", !!$("formsag").querySelector(".onay"));
  tus("Escape"); await b(20);
  T("ikinci Esc soruyu kapatır", !$("formsag").querySelector(".onay") && $("nad").value === "DENEME HASTA");
  tikla($("formkapat")); await b(20);
  tikla($("formsag").querySelector(".onay .evet")); await b(30);
  T("Kapat: form temizlendi, Ara'ya dönüldü", $("nad").value === "" && !$("panel-ara").hidden);

  console.log("--- 6. B'ye vizit: tanı değişmediyse dosyası yazılmaz, sonra form temizlenir ---");
  await vizitEkle("bekir");
  tarih("2026-10-21");
  tikla(cip("ntek", "UWFP")); await b(30);
  dosyaVer(["b1.jpg", "b2.jpg"]); await b(30);
  tikla($("olustur"));
  T("yükleme sürerken ✕ pasif", $("formkapat").disabled === true);
  await b(800);
  T("TANI dosyası yazılmadı", kayit.taniYazma.length === 0);
  T("form sıfırlandı (ad boş, kilit yok)", $("nad").value === "" && !$("nad").readOnly);
  T("tanı alanı boş", $("ntani").value === "");
  T("başlık yine 'Yeni hasta'", $("formbaslik").textContent === "Yeni hasta");
  T("sonuç mesajı duruyor", /Kayıt hazır/.test(metin($("cikti"))) && /temizlendi/.test(metin($("cikti"))));
  T("✕ yeniden etkin", $("formkapat").disabled === false);
  T("B kartı: 2 vizit, 5 görüntü", /2 vizit/.test(kartMeta("bekir")) && /5 görüntü/.test(kartMeta("bekir")));

  console.log("--- 7. 'Bu vizite başka görüntü ekle' ---");
  tikla($("tab-yeni")); await b(20);
  tikla(d.querySelector("[data-aynivizit]")); await b(40);
  T("aynı hasta ve tarih açıldı", $("nad").value === "BEKIR DEMIR" && $("ntarih").value === "2026-10-21");
  T("tanı yine B'nin", $("ntani").value === "UVEA MELANOM");
  tikla(cip("ntek", "OCT")); await b(30);
  dosyaVer(["b3.jpg"]); await b(30);
  tikla($("olustur")); await b(800);
  T("B kartı: 2 vizit, 6 görüntü (sayım toplandı)", /2 vizit/.test(kartMeta("bekir")) && /6 görüntü/.test(kartMeta("bekir")));

  console.log("--- 8. Tanı değiştirilirse yazılır ---");
  await vizitEkle("ayse");
  tarih("2026-10-21");
  tikla(cip("ntek", "EKSTERNAL")); await b(30);
  dosyaVer(["a1.jpg"]); await b(30);
  $("ntani").value = "KAPAK SKC";
  tikla($("olustur")); await b(800);
  T("yeni TANI dosyası yazıldı", kayit.taniYazma.includes("TANI - KAPAK SKC.txt"));
  T("eski TANI çöpe gitti", [...D.values()].some(f => f.name === "TANI - KAPAK BCC.txt" && f.trashed));
  T("kartta yeni tanı", /KAPAK SKC/.test(kartMeta("ayse")));

  console.log("--- 9. Bir dosya gitmezse form açık kalır, yalnızca o bekler ---");
  bozukAd = "c_bozuk.jpg";
  await vizitEkle("cemal");
  tarih("2026-10-21");
  tikla(cip("ntek", "UWFP")); await b(30);
  dosyaVer(["c1.jpg", "c_bozuk.jpg", "c2.jpg"]); await b(30);
  tikla($("olustur")); await b(2600);
  T("form C'de açık kaldı", $("nad").value === "CEMAL KAYA" && $("nad").readOnly);
  T("yalnızca giden olmayan listede", d.querySelectorAll(".sdosya").length === 1 && /c_bozuk/.test(metin(d.querySelector(".sdosya"))));
  T("uyarı gösterildi", /1 görüntü gönderilemedi/.test(metin($("cikti"))));
  bozukAd = null;
  const once = kayit.yuklenen.length;
  tikla($("olustur")); await b(800);
  T("ikinci denemede yalnızca o gitti", kayit.yuklenen.length === once + 1 && kayit.yuklenen[once] === "c_bozuk.jpg");
  T("ardından form temizlendi", $("nad").value === "" && /Kayıt hazır/.test(metin($("cikti"))));

  console.log("\n" + gecti + " geçti, " + kaldi + " kaldı");
  process.exit(kaldi ? 1 : 0);
})().catch(e => { console.log("ÇÖKTÜ:", e && e.stack); process.exit(1); });
