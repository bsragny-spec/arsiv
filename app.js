/* ============================================================
   Oküler Onkoloji Arşivi — Google Drive'a doğrudan bağlanan arayüz
   Veri GitHub'a gitmez; her şey kullanıcının kendi Drive'ında kalır.
   ============================================================ */
(function () {
"use strict";

/* ---------------- sabitler ---------------- */
var KOK_AD    = "HASTA KAYIT STANDART";
var KLASOR    = "application/vnd.google-apps.folder";
var API       = "https://www.googleapis.com/drive/v3";
var YUKLE_API = "https://www.googleapis.com/upload/drive/v3/files";
var KAPSAM    = "https://www.googleapis.com/auth/drive";
var PARCA     = 8 * 1024 * 1024;          /* parçalı yükleme dilimi */

var TEKNIKLER = ["UWFP","FAF","FA","OCT","ASOCT","ASP","USG","UBM","RETCAM","ICG","GONIO","EKSTERNAL","ANAMNEZ","RADYOLOJI"];
var TEKNIK_ACIK = {
  UWFP:"Ultra geniş açı fundus fotoğrafı", FAF:"Fundus otofloresans", FA:"Fundus floresein anjiyografi",
  OCT:"Optik koherens tomografi", ASOCT:"Ön segment OCT", ASP:"Ön segment fotoğrafı",
  USG:"Ultrasonografi", UBM:"Ultrason biyomikroskopi", RETCAM:"RetCam", ICG:"İndosiyanin yeşili anjiyografi",
  GONIO:"Gonyoskopi", EKSTERNAL:"Eksternal fotoğraf", ANAMNEZ:"Anamnez / belge", RADYOLOJI:"Radyoloji"
};

var AY_CID   = "arsiv-client-id";
var AY_DIZIN = "arsiv-dizin-v1";
var AY_KOK   = "arsiv-kok-id";
var AY_SENK  = "arsiv-son-senk";

/* ---------------- küçük yardımcılar ---------------- */
var TRMAP = {"Ç":"C","ç":"C","Ğ":"G","ğ":"G","İ":"I","ı":"I","Ö":"O","ö":"O","Ş":"S","ş":"S","Ü":"U","ü":"U"};
function nrm(s){ return String(s||"").replace(/[ÇçĞğİıÖöŞşÜü]/g, function(c){ return TRMAP[c]; }).toUpperCase(); }
function trUpper(s){ try{ return String(s||"").toLocaleUpperCase("tr"); }catch(e){ return String(s||"").toUpperCase(); } }
/* Yazarken büyük harfe çevirir ama imleci bulunduğu yerde bırakır.
   (input.value'ya atama yapmak imleci sona atar; bu yüzden konum geri konuyor.) */
function buyukHarfBagla(inp, kosul){
  inp.addEventListener("input", function(){
    if(kosul && !kosul()) return;
    var bas = inp.selectionStart, son = inp.selectionEnd;
    var yeni = trUpper(inp.value);
    if(yeni === inp.value) return;
    inp.value = yeni;
    if(bas !== null){ try{ inp.setSelectionRange(bas, son); }catch(e){} }
  });
}
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }
function $(id){ return document.getElementById(id); }
/* Doku adını CSS renk belirtecine çevirir: "OKULER MELANOSIS" -> var(--d-okuler-melanosis) */
var DOKU_SLUG = { "KAPAK":"kapak","KONJONKTIVA":"konjonktiva","KOROID":"koroid","IRIS":"iris",
                  "ORBIT":"orbit","RETINA":"retina","OKULER MELANOSIS":"okuler-melanosis" };
function dokuRenk(d){ return "--d:var(--d-" + (DOKU_SLUG[nrm(d)] || "diger") + ")"; }
function gunAy(t){
  if(!/^\d{8}$/.test(t)) return t;
  return t.slice(6,8) + "." + t.slice(4,6) + "." + t.slice(0,4);
}
function boyutYaz(b){
  if(b == null) return "";
  if(b < 1024) return b + " B";
  if(b < 1048576) return (b/1024).toFixed(0) + " KB";
  return (b/1048576).toFixed(b < 10485760 ? 1 : 0).replace(".", ",") + " MB";
}
function bekle(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
function depoOku(k, v){ try{ var x = localStorage.getItem(k); return x == null ? v : JSON.parse(x); }catch(e){ return v; } }
function depoYaz(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }

/* =========================================================
   1. KİMLİK — Google Identity Services
   ========================================================= */
var clientId = null, jeton = null, jetonBitis = 0, jetonIstemci = null;

function jetonGecerli(){ return jeton && Date.now() < jetonBitis - 60000; }

function jetonIste(sessiz){
  return new Promise(function(coz, red){
    if(!jetonIstemci){ red(new Error("Google bağlantısı hazır değil.")); return; }
    jetonIstemci.callback = function(yanit){
      if(yanit && yanit.access_token){
        jeton = yanit.access_token;
        jetonBitis = Date.now() + (parseInt(yanit.expires_in, 10) || 3600) * 1000;
        try{ sessionStorage.setItem("arsiv-jeton", JSON.stringify({ j: jeton, b: jetonBitis })); }catch(e){}
        coz(jeton);
      } else {
        red(new Error((yanit && (yanit.error_description || yanit.error)) || "Yetki alınamadı."));
      }
    };
    jetonIstemci.error_callback = function(h){ red(new Error((h && h.type) || "Giriş penceresi kapatıldı.")); };
    try{ jetonIstemci.requestAccessToken({ prompt: sessiz ? "" : "consent" }); }
    catch(e){ red(e); }
  });
}

function jetonSagla(){
  if(jetonGecerli()) return Promise.resolve(jeton);
  return jetonIste(true);
}

function jetonKur(){
  if(!window.google || !google.accounts || !google.accounts.oauth2) return false;
  jetonIstemci = google.accounts.oauth2.initTokenClient({
    client_id: clientId, scope: KAPSAM, callback: function(){}
  });
  return true;
}

/* =========================================================
   2. DRIVE API katmanı
   ========================================================= */
function driveHata(yanit, govde){
  var m = (govde && govde.error && govde.error.message) || ("HTTP " + yanit.status);
  var e = new Error(m); e.durum = yanit.status; return e;
}

function istek(url, secenek, tekrar){
  secenek = secenek || {};
  return jetonSagla().then(function(j){
    var bas = Object.assign({}, secenek.headers || {});
    bas["Authorization"] = "Bearer " + j;
    return fetch(url, Object.assign({}, secenek, { headers: bas }));
  }).then(function(y){
    if(y.status === 401 && !tekrar){
      jeton = null; jetonBitis = 0;
      return jetonIste(true).then(function(){ return istek(url, secenek, true); });
    }
    if((y.status === 429 || y.status >= 500) && !tekrar){
      return bekle(1500).then(function(){ return istek(url, secenek, true); });
    }
    if(!y.ok){
      return y.json().catch(function(){ return null; }).then(function(g){ throw driveHata(y, g); });
    }
    if(y.status === 204) return null;
    var tip = y.headers.get("content-type") || "";
    return tip.indexOf("json") >= 0 ? y.json() : y;
  });
}

function jsonIstek(url, yontem, govde){
  return istek(url, {
    method: yontem,
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(govde)
  });
}

/* sayfalı liste — tüm sonuçları toplar */
function hepsiniListele(q, alanlar, ilerle){
  var cikti = [], jeton2 = null, tur = 0;
  function sonraki(){
    var u = API + "/files?q=" + encodeURIComponent(q)
          + "&fields=" + encodeURIComponent("nextPageToken,files(" + alanlar + ")")
          + "&pageSize=1000&spaces=drive&orderBy=name";
    if(jeton2) u += "&pageToken=" + encodeURIComponent(jeton2);
    return istek(u).then(function(r){
      cikti = cikti.concat(r.files || []);
      jeton2 = r.nextPageToken || null;
      tur++;
      if(ilerle) ilerle(cikti.length, tur);
      if(jeton2 && tur < 200) return sonraki();
      return cikti;
    });
  }
  return sonraki();
}

function klasorAc(ad, ustId){
  return jsonIstek(API + "/files?fields=id,name", "POST",
    { name: ad, mimeType: KLASOR, parents: ustId ? [ustId] : undefined });
}
function klasorBul(ad, ustId){
  var q = "name = '" + ad.replace(/'/g, "\\'") + "' and mimeType = '" + KLASOR + "' and trashed = false"
        + (ustId ? " and '" + ustId + "' in parents" : "");
  return istek(API + "/files?q=" + encodeURIComponent(q) + "&fields=files(id,name)&pageSize=10")
    .then(function(r){ return (r.files && r.files[0]) || null; });
}
function klasorSagla(ad, ustId){
  return klasorBul(ad, ustId).then(function(f){ return f || klasorAc(ad, ustId); });
}
function copeAt(id){ return jsonIstek(API + "/files/" + id, "PATCH", { trashed: true }); }
function yenidenAdlandir(id, ad){ return jsonIstek(API + "/files/" + id + "?fields=id,name", "PATCH", { name: ad }); }

/* ---- parçalı (resumable) yükleme: boyut sınırı yok ---- */
function dosyaYukle(dosya, ustId, ad, ilerle){
  var toplam = dosya.size;
  return jetonSagla().then(function(j){
    return fetch(YUKLE_API + "?uploadType=resumable&fields=id,name", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + j,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": dosya.type || "application/octet-stream",
        "X-Upload-Content-Length": String(toplam)
      },
      body: JSON.stringify({ name: ad || dosya.name, parents: [ustId] })
    });
  }).then(function(y){
    if(!y.ok) return y.text().then(function(t){ throw new Error("Oturum açılamadı: " + (t || y.status)); });
    var oturum = y.headers.get("location") || y.headers.get("Location");
    if(!oturum) throw new Error("Yükleme oturumu adresi alınamadı.");
    return parcaGonder(oturum, dosya, toplam, 0, ilerle, 0);
  });
}

function parcaGonder(oturum, dosya, toplam, bas, ilerle, hataSayisi){
  if(toplam === 0){
    return fetch(oturum, { method: "PUT", headers: { "Content-Range": "bytes */0" } })
      .then(function(y){ return y.json().catch(function(){ return {}; }); });
  }
  var son = Math.min(bas + PARCA, toplam);
  var dilim = dosya.slice(bas, son);
  return fetch(oturum, {
    method: "PUT",
    headers: { "Content-Range": "bytes " + bas + "-" + (son - 1) + "/" + toplam },
    body: dilim
  }).then(function(y){
    if(y.status === 308){
      var r = y.headers.get("range");
      var yeniBas = r ? (parseInt(r.split("-")[1], 10) + 1) : son;
      if(ilerle) ilerle(yeniBas, toplam);
      return parcaGonder(oturum, dosya, toplam, yeniBas, ilerle, 0);
    }
    if(y.ok){
      if(ilerle) ilerle(toplam, toplam);
      return y.json().catch(function(){ return {}; });
    }
    if((y.status === 429 || y.status >= 500) && hataSayisi < 4){
      return bekle(1200 * Math.pow(2, hataSayisi))
        .then(function(){ return durumSor(oturum, toplam); })
        .then(function(nerede){
          if(nerede === -1) return {};                    /* zaten bitmiş */
          return parcaGonder(oturum, dosya, toplam, nerede, ilerle, hataSayisi + 1);
        });
    }
    return y.text().then(function(t){ throw new Error(t || ("Yükleme hatası " + y.status)); });
  }).catch(function(err){
    /* ağ koptuysa kaldığı yerden devam et */
    if(hataSayisi < 4 && err && !err.durum){
      return bekle(1500 * Math.pow(2, hataSayisi))
        .then(function(){ return durumSor(oturum, toplam); })
        .then(function(nerede){
          if(nerede === -1) return {};
          return parcaGonder(oturum, dosya, toplam, nerede, ilerle, hataSayisi + 1);
        });
    }
    throw err;
  });
}

function durumSor(oturum, toplam){
  return fetch(oturum, { method: "PUT", headers: { "Content-Range": "bytes */" + toplam } })
    .then(function(y){
      if(y.ok) return -1;
      if(y.status === 308){
        var r = y.headers.get("range");
        return r ? (parseInt(r.split("-")[1], 10) + 1) : 0;
      }
      return 0;
    }).catch(function(){ return 0; });
}

/* =========================================================
   3. DİZİN — tüm arşiv yapısını Drive'dan kur
   ========================================================= */
var VERI = [];          /* [{d,h,t,g,v:[{t,id,k:{TEK:{id,n}}}]}] */
var DOKULAR = [], TEK_VAR = {}, DOKU_ID = {};
var kokId = null;

function dizinKaydet(){
  var ok = depoYaz(AY_DIZIN, { z: Date.now(), kok: kokId, d: DOKU_ID, p: VERI });
  if(!ok) durumYaz("Dizin tarayıcıya sığmadı — her açılışta Drive'dan okunacak.", "");
}
function dizinYukle(){
  var x = depoOku(AY_DIZIN, null);
  if(x && x.p && x.p.length){ VERI = x.p; kokId = x.kok || kokId; DOKU_ID = x.d || {}; hazirla(); return x.z; }
  return 0;
}

function hazirla(){
  DOKULAR = []; TEK_VAR = {};
  VERI.forEach(function(p){
    if(DOKULAR.indexOf(p.d) < 0) DOKULAR.push(p.d);
    p._n = nrm(p.h); p._tn = nrm(p.t || ""); p._tek = {}; p._dosya = 0;
    (p.v || []).forEach(function(v){
      for(var k in v.k){ p._tek[k] = 1; TEK_VAR[k] = 1; p._dosya += (v.k[k].n || 0); }
    });
    p.v.sort(function(a, b){ return a.t < b.t ? -1 : 1; });
  });
  DOKULAR.sort();
  VERI.sort(function(a, b){ return a._n < b._n ? -1 : (a._n > b._n ? 1 : 0); });
}

function dizinKur(ilerle){
  var tumKlasor = null;
  return kokBul().then(function(){
    ilerle("Klasörler okunuyor…");
    return hepsiniListele(
      "mimeType = '" + KLASOR + "' and trashed = false",
      "id,name,parents",
      function(n){ ilerle("Klasörler okunuyor… " + n); }
    );
  }).then(function(klasorler){
    tumKlasor = klasorler;
    var cocuk = {};
    klasorler.forEach(function(f){
      (f.parents || []).forEach(function(u){ (cocuk[u] = cocuk[u] || []).push(f); });
    });
    VERI = []; DOKU_ID = {};
    var teknikHarita = {};                       /* teknik klasör id -> {p, v, ad} */
    (cocuk[kokId] || []).forEach(function(doku){
      if(doku.name.charAt(0) === "_") return;    /* _ARAC gibi yardımcı klasörler */
      DOKU_ID[doku.id] = doku.name;
      (cocuk[doku.id] || []).forEach(function(hasta){
        var p = { d: doku.name, h: hasta.name, t: "", g: hasta.id, v: [] };
        (cocuk[hasta.id] || []).forEach(function(vz){
          var v = { t: vz.name, id: vz.id, k: {} };
          (cocuk[vz.id] || []).forEach(function(tk){
            v.k[tk.name] = { id: tk.id, n: 0 };
            teknikHarita[tk.id] = { p: p, v: v, ad: tk.name };
          });
          p.v.push(v);
        });
        VERI.push(p);
      });
    });
    hazirla();
    ilerle(VERI.length + " hasta bulundu, görüntüler sayılıyor…");
    return { teknikHarita: teknikHarita };
  }).then(function(durum){
    /* Dosyalar: tek seferde çekilir, üst klasörüne göre eşlenir. */
    var hastaHarita = {};
    VERI.forEach(function(p){ hastaHarita[p.g] = p; });
    return hepsiniListele(
      "mimeType != '" + KLASOR + "' and trashed = false",
      "id,name,parents,mimeType,size",
      function(n){ ilerle("Görüntüler sayılıyor… " + n); }
    ).then(function(dosyalar){
      dosyalar.forEach(function(f){
        var u = (f.parents || [])[0];
        if(!u) return;
        var t = durum.teknikHarita[u];
        if(t){ t.v.k[t.ad].n++; return; }
        var p = hastaHarita[u];
        if(p && f.name.indexOf("TANI - ") === 0) p.t = f.name.slice(7).replace(/\.txt$/i, "");
      });
      hazirla();
      senkZamaniYaz(new Date().toISOString().replace(/\.\d+Z$/, "Z"));
      dizinKaydet();
      return VERI.length;
    });
  });
}

function kokBul(){
  if(kokId) return Promise.resolve(kokId);
  var kayitli = depoOku(AY_KOK, null);
  if(kayitli){ kokId = kayitli; return Promise.resolve(kokId); }
  return klasorBul(KOK_AD, null).then(function(f){
    if(!f) throw new Error("Drive'da \"" + KOK_AD + "\" klasörü bulunamadı.");
    kokId = f.id; depoYaz(AY_KOK, kokId); return kokId;
  });
}

/* ---------- otomatik eşitleme ----------
   Arşivin tamamını yeniden okumak binlerce istek demek. Onun yerine Drive'a
   "son bakıştan beri hangi dosyalar değişti" diye tek sorgu sorulur; değişen
   dosyaların hangi hastaya ait olduğu klasör zinciri yürünerek bulunur ve
   yalnızca o hastalar yeniden okunur. Hiçbir şey değişmemişse tek istek. */
function senkZamani(){ return depoOku(AY_SENK, null); }
function senkZamaniYaz(t){ depoYaz(AY_SENK, t); }

var ustBilgi = {};
function ustAl(id){
  if(ustBilgi[id]) return Promise.resolve(ustBilgi[id]);
  return istek(API + "/files/" + id + "?fields=id,name,parents")
    .then(function(r){ ustBilgi[id] = { ad: r.name || "", ust: (r.parents || [])[0] || null }; return ustBilgi[id]; })
    .catch(function(){ ustBilgi[id] = { ad: "", ust: null }; return ustBilgi[id]; });
}

/* Tek bir hastanın vizit/teknik/tanı yapısını Drive'dan yeniden okur. */
function hastaTazele(p){
  return hepsiniListele("'" + p.g + "' in parents and trashed = false", "id,name,mimeType")
    .then(function(ic){
      var tani = "";
      ic.forEach(function(f){
        if(f.mimeType !== KLASOR && f.name.indexOf("TANI - ") === 0) tani = f.name.slice(7).replace(/\.txt$/i, "");
      });
      var vk = ic.filter(function(f){ return f.mimeType === KLASOR; })
                 .sort(function(a, b){ return a.name < b.name ? -1 : 1; });
      var yeni = [], zincir = Promise.resolve();
      vk.forEach(function(v){
        zincir = zincir.then(function(){
          return hepsiniListele("'" + v.id + "' in parents and trashed = false", "id,name,mimeType")
            .then(function(ic2){
              var tk = ic2.filter(function(f){ return f.mimeType === KLASOR; });
              var sayilar = {}, alt = Promise.resolve();
              tk.forEach(function(t){
                alt = alt.then(function(){
                  return hepsiniListele("'" + t.id + "' in parents and trashed = false", "id,mimeType")
                    .then(function(ic3){
                      sayilar[t.name] = { id: t.id, n: ic3.filter(function(f){ return f.mimeType !== KLASOR; }).length };
                    }).catch(function(){ sayilar[t.name] = { id: t.id, n: 0 }; });
                });
              });
              return alt.then(function(){ yeni.push({ t: v.name, id: v.id, k: sayilar }); });
            }).catch(function(){});
        });
      });
      return zincir.then(function(){ p.v = yeni; p.t = tani; });
    });
}

/* Değişen bir klasörün hangi hastaya ait olduğunu bulur. */
function sahipBul(id, haritalar){
  var yol = [];
  function adim(x, kalan){
    if(!x || kalan <= 0 || x === kokId) return Promise.resolve(null);
    if(haritalar.hasta[x]) return Promise.resolve({ p: haritalar.hasta[x] });
    if(haritalar.alt[x])   return Promise.resolve({ p: haritalar.alt[x] });
    if(DOKU_ID[x])         return Promise.resolve({ yeniDoku: DOKU_ID[x], klasor: yol[yol.length - 1] || null });
    yol.push(x);
    return ustAl(x).then(function(b){ return adim(b.ust, kalan - 1); });
  }
  return adim(id, 4);
}

function otoSenk(sessiz){
  if(!jetonGecerli() && !jeton) return Promise.resolve(0);
  var basla = senkZamani();
  if(!basla){ senkZamaniYaz(new Date().toISOString().replace(/\.\d+Z$/, "Z")); return Promise.resolve(0); }
  var simdi = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  var haritalar = { hasta: {}, alt: {} };
  VERI.forEach(function(p){
    if(p.g) haritalar.hasta[p.g] = p;
    (p.v || []).forEach(function(v){
      if(v.id) haritalar.alt[v.id] = p;
      for(var k in v.k){ if(v.k[k].id) haritalar.alt[v.k[k].id] = p; }
    });
  });

  if(!sessiz) durumYaz("Drive kontrol ediliyor…", "");
  return hepsiniListele(
      "modifiedTime > '" + basla + "' and mimeType != '" + KLASOR + "' and trashed = false",
      "id,parents")
    .then(function(dosyalar){
      var ustler = {};
      dosyalar.forEach(function(f){ var u = (f.parents || [])[0]; if(u) ustler[u] = 1; });
      var idler = Object.keys(ustler);
      if(!idler.length) return [];
      var hastalar = [], yeniler = [], zincir = Promise.resolve();
      idler.forEach(function(id){
        zincir = zincir.then(function(){
          return sahipBul(id, haritalar).then(function(r){
            if(!r) return;
            if(r.p){ if(hastalar.indexOf(r.p) < 0) hastalar.push(r.p); }
            else if(r.yeniDoku && r.klasor && yeniler.indexOf(r.yeniDoku + "|" + r.klasor) < 0)
              yeniler.push(r.yeniDoku + "|" + r.klasor);
          });
        });
      });
      return zincir.then(function(){
        var ek = Promise.resolve();
        yeniler.slice(0, 12).forEach(function(v){
          var doku = v.slice(0, v.indexOf("|")), kid = v.slice(v.indexOf("|") + 1);
          ek = ek.then(function(){
            return ustAl(kid).then(function(b){
              if(!b.ad) return;
              var p = hastaBul(doku, b.ad);
              if(!p){ p = { d: doku, h: b.ad, t: "", g: kid, v: [] }; VERI.push(p); }
              else if(!p.g) p.g = kid;
              if(hastalar.indexOf(p) < 0) hastalar.push(p);
            });
          });
        });
        return ek.then(function(){ return hastalar; });
      });
    })
    .then(function(hastalar){
      if(!hastalar.length){ senkZamaniYaz(simdi); if(!sessiz) durumYaz("Her şey güncel.", "iyi"); return 0; }
      var sinir = hastalar.slice(0, 25), bitti = 0, zincir = Promise.resolve();
      durumYaz("Drive'da " + hastalar.length + " hastada değişiklik var, okunuyor…", "");
      sinir.forEach(function(p){
        zincir = zincir.then(function(){
          return hastaTazele(p).then(function(){ bitti++; }).catch(function(){});
        });
      });
      return zincir.then(function(){
        /* vizit kaydı kalmayan hasta listeden düşsün */
        for(var i = VERI.length - 1; i >= 0; i--){ if(!VERI[i].v || !VERI[i].v.length) VERI.splice(i, 1); }
        hazirla(); dizinKaydet(); cipleriKur(); ciz(); formCiz();
        senkZamaniYaz(simdi);
        durumYaz(bitti + " hasta güncellendi.", "iyi");
        return bitti;
      });
    })
    .catch(function(err){ if(!sessiz) durumYaz("Eşitleme yapılamadı: " + err.message, "kotu"); return 0; });
}

/* =========================================================
   4. ARAMA VE LİSTE
   ========================================================= */
var qEl, sonucEl, sayimEl, acik = {};
var fDoku = null, fTek = null, fTani = null;

function eslesenler(){
  var ham = qEl.value.trim(), a = nrm(ham).split(/\s+/).filter(Boolean);
  return VERI.filter(function(p){
    if(fDoku && p.d !== fDoku) return false;
    if(fTek && !p._tek[fTek]) return false;
    if(fTani === "var" && !p.t) return false;
    if(fTani === "yok" && p.t) return false;
    if(!a.length) return true;
    return a.every(function(k){
      if(p._n.indexOf(k) >= 0) return true;
      if(p._tn.indexOf(k) >= 0) return true;
      if(nrm(p.d).indexOf(k) >= 0) return true;
      if(p._tek[k]) return true;
      for(var i = 0; i < p.v.length; i++){
        if(p.v[i].t.indexOf(k) >= 0) return true;
        for(var t in p.v[i].k){ if(nrm(t).indexOf(k) >= 0) return true; }
      }
      return false;
    });
  });
}

function vizitHTML(p, v){
  var t = Object.keys(v.k).sort();
  return '<div class="vizit" data-vt="' + esc(v.t) + '">'
    + '<div class="vbas"><div class="vtarih sayi">' + esc(gunAy(v.t)) + '</div>'
    +   '<button class="x" type="button" data-silvizit="' + esc(v.t) + '" title="Bu viziti sil">✕</button></div>'
    + '<div class="teknikler">' + (t.length ? t.map(function(k){
        return '<button class="teknik" type="button" aria-expanded="false" data-galeri="' + esc(k) + '" data-vt="' + esc(v.t) + '"'
          + ' title="' + esc(TEKNIK_ACIK[k] || k) + ' — görüntüleri aç"><b>' + esc(k) + '</b>'
          + '<i class="sayi">' + (v.k[k].n || 0) + '</i>'
          + '<span class="x" data-silteknik="' + esc(k) + '" data-vt="' + esc(v.t) + '" title="Klasörü sil">✕</span>'
          + '</button>';
      }).join("") : '<span class="not">teknik klasörü yok</span>')
    + '</div><div data-galerikutu></div></div>';
}

function ciz(){
  var liste = eslesenler();
  sayimEl.innerHTML = liste.length === VERI.length
    ? '<b class="sayi">' + VERI.length + '</b> hastanın tamamı listeleniyor'
    : '<b class="sayi">' + liste.length + '</b> hasta bulundu';
  if(!liste.length){
    sonucEl.innerHTML = '<div class="serit">Eşleşen hasta yok. Adın yazılışını ya da filtreleri değiştirmeyi dene.</div>';
    return;
  }
  sonucEl.innerHTML = liste.slice(0, 400).map(function(p){
    var id = p.d + "|" + p.h, ac = !!acik[id];
    return '<article class="kart' + (ac ? ' acik' : '') + '" data-id="' + esc(id) + '" style="' + dokuRenk(p.d) + '">'
      + '<button class="kbas" type="button" aria-expanded="' + ac + '">'
      +   '<span><span class="kad">' + esc(p.h) + '</span>'
      +     '<span class="kmeta"><span class="doku-rozet">' + esc(p.d) + '</span>'
      +       '<span class="sayi">' + p.v.length + ' vizit</span><span class="ayrac">·</span>'
      +       '<span class="sayi">' + p._dosya + ' görüntü</span>'
      +       (p.t ? '<span class="tani-rozet">' + esc(p.t) + '</span>'
                   : '<span class="tani-yok">tanı girilmemiş</span>')
      +     '</span></span>'
      +   '<span class="knum sayi">' + (p.v.length ? gunAy(p.v[p.v.length - 1].t) : "—") + '</span>'
      + '</button>'
      + (ac ? '<div class="kgovde"><div class="tl">'
              + p.v.map(function(v){ return vizitHTML(p, v); }).join("")
              + '</div><div class="eylemler">'
              + '<a class="dg dg-ana" href="https://drive.google.com/drive/folders/' + esc(p.g) + '" target="_blank" rel="noopener">Drive’da aç →</a>'
              + '<button class="dg" data-vizitekle="1">Vizit ekle</button>'
              + '<button class="dg" data-taniduzenle="1">' + (p.t ? "Tanıyı değiştir" : "Tanı ekle") + '</button>'
              + '<button class="dg" data-adduzenle="1">Adı değiştir</button>'
              + '<button class="x" data-silhasta="1" title="Hastanın tamamını sil" style="margin-left:auto">✕</button>'
              + '</div><div class="durum" data-kdurum></div></div>'
            : "")
      + '</article>';
  }).join("") + (liste.length > 400 ? '<p class="not" style="margin:12px 2px 0">İlk 400 hasta gösteriliyor — aramayı daraltın.</p>' : "");
}

function hastaBul(doku, ad){
  for(var i = 0; i < VERI.length; i++){ if(VERI[i].d === doku && nrm(VERI[i].h) === nrm(ad)) return VERI[i]; }
  return null;
}
function kartHastasi(el){
  var k = el.closest(".kart"); if(!k) return null;
  var id = k.dataset.id;
  for(var i = 0; i < VERI.length; i++){ if(VERI[i].d + "|" + VERI[i].h === id) return VERI[i]; }
  return null;
}
function kartDurum(el, metin, sinif){
  var k = el.closest(".kart"); if(!k) return;
  var d = k.querySelector("[data-kdurum]"); if(!d) return;
  d.className = "durum" + (sinif ? " " + sinif : ""); d.textContent = metin;
}
function durumYaz(metin, sinif){
  var d = $("genel"); if(!d) return;
  d.className = "durum" + (sinif ? " " + sinif : ""); d.textContent = metin;
  clearTimeout(durumYaz._z);
  if(metin) durumYaz._z = setTimeout(function(){ d.textContent = ""; d.className = "durum"; }, 7000);
}

/* ---------------- filtre çipleri ---------------- */
function cipleriKur(){
  function doldur(kap, degerler, secili, sec){
    var eski = kap.querySelectorAll(".cip");
    Array.prototype.forEach.call(eski, function(x){ x.remove(); });
    degerler.forEach(function(d){
      var b = document.createElement("button");
      b.className = "cip"; b.type = "button";
      b.textContent = d.ad;
      b.setAttribute("aria-pressed", String(secili === d.v));
      b.addEventListener("click", function(){ sec(secili === d.v ? null : d.v); });
      kap.appendChild(b);
    });
  }
  doldur($("fdoku"), DOKULAR.map(function(d){ return { ad: d, v: d }; }), fDoku,
    function(v){ fDoku = v; cipleriKur(); ciz(); });
  doldur($("ftek"), Object.keys(TEK_VAR).sort().map(function(t){ return { ad: t, v: t }; }), fTek,
    function(v){ fTek = v; cipleriKur(); ciz(); });
  doldur($("ftani"), [{ ad: "Tanısı olanlar", v: "var" }, { ad: "Tanısı olmayanlar", v: "yok" }], fTani,
    function(v){ fTani = v; cipleriKur(); ciz(); });
}

/* =========================================================
   5. GALERİ — küçük resim ve büyütme
   ========================================================= */
var galeriOnbellek = {};

function galeriAc(dugme, p, vt, tek){
  var vizitEl = dugme.closest(".vizit");
  var kutu = vizitEl.querySelector("[data-galerikutu]");
  var anahtar = p.g + "|" + vt + "|" + tek;
  if(kutu.dataset.acik === anahtar){ kutu.innerHTML = ""; kutu.dataset.acik = ""; dugme.setAttribute("aria-expanded","false"); return; }
  kutu.dataset.acik = anahtar;
  dugme.setAttribute("aria-expanded","true");
  kutu.innerHTML = '<p class="not" style="margin:10px 0 0">' + esc(tek) + ' açılıyor…</p>';

  var v = null;
  for(var i = 0; i < p.v.length; i++){ if(p.v[i].t === vt){ v = p.v[i]; break; } }
  if(!v || !v.k[tek]){ kutu.innerHTML = '<p class="not">Klasör bulunamadı.</p>'; return; }
  var tid = v.k[tek].id;

  var hazir = galeriOnbellek[anahtar]
    ? Promise.resolve(galeriOnbellek[anahtar])
    : hepsiniListele("'" + tid + "' in parents and trashed = false",
        "id,name,mimeType,size,thumbnailLink,webViewLink")
        .then(function(d){ galeriOnbellek[anahtar] = d; return d; });

  hazir.then(function(dosyalar){
    if(kutu.dataset.acik !== anahtar) return;
    v.k[tek].n = dosyalar.length;
    if(!dosyalar.length){ kutu.innerHTML = '<p class="not" style="margin:10px 0 0">Bu klasör boş.</p>'; return; }
    kutu.innerHTML = '<div class="galeri">' + dosyalar.map(function(f, i){
      var kucuk = f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+$/, "=s400") : "";
      return '<button class="kucuk" type="button" data-ac="' + i + '">'
        + (kucuk
            ? '<img loading="lazy" src="' + esc(kucuk) + '" alt="' + esc(f.name) + '" referrerpolicy="no-referrer">'
            : '<span class="yok">' + esc(f.name) + '</span>')
        + '<span class="ad">' + esc(f.name) + '</span></button>';
    }).join("") + '</div>'
    + '<div class="galeri-alt"><span class="not sayi">' + dosyalar.length + " dosya · "
    + boyutYaz(dosyalar.reduce(function(a, f){ return a + (parseInt(f.size, 10) || 0); }, 0)) + "</span></div>";

    kutu.querySelectorAll("[data-ac]").forEach(function(b){
      b.addEventListener("click", function(){ buyutecAc(dosyalar, parseInt(b.dataset.ac, 10), tek + " · " + gunAy(vt)); });
    });
  }).catch(function(err){
    if(kutu.dataset.acik === anahtar) kutu.innerHTML = '<p class="durum kotu" style="margin:10px 0 0">' + esc(err.message) + '</p>';
  });
}

var buyutecDurum = null;
function buyutecAc(dosyalar, i, baslik){
  buyutecKapat();
  var kap = document.createElement("div");
  kap.className = "buyutec";
  kap.innerHTML =
      '<div class="ust"><span class="baslik" data-bas></span><span class="sag">'
    +   '<a class="dg dg-mini" data-drive target="_blank" rel="noopener">Drive’da aç</a>'
    +   '<button class="dg dg-mini" data-kapat>Kapat ✕</button></span></div>'
    + '<button class="gez sol" data-gez="-1">‹</button>'
    + '<img data-gorsel alt="">'
    + '<button class="gez sag" data-gez="1">›</button>';
  document.body.appendChild(kap);
  buyutecDurum = { kap: kap, dosyalar: dosyalar, i: i, baslik: baslik };

  kap.querySelector("[data-kapat]").addEventListener("click", buyutecKapat);
  kap.addEventListener("click", function(e){ if(e.target === kap) buyutecKapat(); });
  kap.querySelectorAll("[data-gez]").forEach(function(b){
    b.addEventListener("click", function(){ buyutecGez(parseInt(b.dataset.gez, 10)); });
  });
  document.addEventListener("keydown", buyutecTus);
  buyutecCiz();
}
function buyutecCiz(){
  if(!buyutecDurum) return;
  var f = buyutecDurum.dosyalar[buyutecDurum.i];
  var kap = buyutecDurum.kap;
  kap.querySelector("[data-bas]").textContent =
    buyutecDurum.baslik + "  ·  " + (buyutecDurum.i + 1) + "/" + buyutecDurum.dosyalar.length + "  ·  " + f.name;
  kap.querySelector("[data-drive]").href = f.webViewLink || ("https://drive.google.com/file/d/" + f.id + "/view");
  var img = kap.querySelector("[data-gorsel]");
  img.alt = f.name;
  img.src = f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+$/, "=s1600") : "";
  img.onerror = function(){
    /* küçük resim yoksa dosyayı doğrudan indir */
    istek(API + "/files/" + f.id + "?alt=media").then(function(y){
      if(y && y.blob) return y.blob().then(function(b){ img.onerror = null; img.src = URL.createObjectURL(b); });
    }).catch(function(){});
  };
}
function buyutecGez(y){
  if(!buyutecDurum) return;
  var n = buyutecDurum.dosyalar.length;
  buyutecDurum.i = (buyutecDurum.i + y + n) % n;
  buyutecCiz();
}
function buyutecTus(e){
  if(e.key === "Escape") buyutecKapat();
  else if(e.key === "ArrowLeft") buyutecGez(-1);
  else if(e.key === "ArrowRight") buyutecGez(1);
}
function buyutecKapat(){
  if(!buyutecDurum) return;
  document.removeEventListener("keydown", buyutecTus);
  buyutecDurum.kap.remove();
  buyutecDurum = null;
}

/* =========================================================
   6. SİLME
   ========================================================= */
function onayIste(dugme, mesaj, eylem){
  if(dugme.dataset.onay) return;
  var yer = document.createElement("span");
  yer.className = "onay";
  yer.innerHTML = esc(mesaj) + ' <button type="button" class="evet">Sil</button><button type="button" class="hayir">Vazgeç</button>';
  dugme.style.display = "none"; dugme.dataset.onay = "1";
  dugme.parentNode.insertBefore(yer, dugme.nextSibling);
  function kapat(){ if(yer.parentNode) yer.remove(); dugme.style.display = ""; delete dugme.dataset.onay; }
  yer.querySelector(".hayir").addEventListener("click", function(e){ e.stopPropagation(); kapat(); });
  yer.querySelector(".evet").addEventListener("click", function(e){
    e.stopPropagation();
    yer.textContent = "Siliniyor…";
    eylem().then(function(m){ durumYaz(m || "Drive çöp kutusuna taşındı.", "iyi"); })
           .catch(function(err){ yer.textContent = err.message; setTimeout(kapat, 5000); });
  });
}

function silHasta(p){
  return copeAt(p.g).then(function(){
    var i = VERI.indexOf(p); if(i >= 0) VERI.splice(i, 1);
    delete acik[p.d + "|" + p.h];
    hazirla(); dizinKaydet(); cipleriKur(); ciz();
    return p.h + " çöp kutusuna taşındı.";
  });
}
function silVizit(p, vt){
  var v = null;
  for(var i = 0; i < p.v.length; i++){ if(p.v[i].t === vt){ v = p.v[i]; break; } }
  if(!v) return Promise.reject(new Error("Vizit bulunamadı."));
  return copeAt(v.id).then(function(){
    p.v = p.v.filter(function(x){ return x.t !== vt; });
    if(!p.v.length){
      var i2 = VERI.indexOf(p); if(i2 >= 0) VERI.splice(i2, 1);
      return copeAt(p.g).catch(function(){}).then(function(){ return "vizit ve boş hasta klasörü silindi."; });
    }
    return gunAy(vt) + " viziti çöp kutusuna taşındı.";
  }).then(function(m){ hazirla(); dizinKaydet(); cipleriKur(); ciz(); return m; });
}
function silTeknik(p, vt, tek){
  var v = null;
  for(var i = 0; i < p.v.length; i++){ if(p.v[i].t === vt){ v = p.v[i]; break; } }
  if(!v || !v.k[tek]) return Promise.reject(new Error("Klasör bulunamadı."));
  return copeAt(v.k[tek].id).then(function(){
    delete v.k[tek];
    hazirla(); dizinKaydet(); cipleriKur(); ciz();
    return tek + " klasörü çöp kutusuna taşındı.";
  });
}

/* =========================================================
   7. DÜZENLEME — tanı ve ad
   ========================================================= */
function taniDuzenle(dugme, p){
  var kart = dugme.closest(".kart");
  if(kart.querySelector("[data-taniform]")){ kart.querySelector("[data-taniform]").remove(); return; }
  var kutu = document.createElement("div");
  kutu.setAttribute("data-taniform", "1");
  kutu.style.cssText = "margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center";
  kutu.innerHTML = '<input type="text" style="flex:1;min-width:200px" value="' + esc(p.t || "") + '" placeholder="ör. UVEA MELANOM">'
    + '<button class="dg dg-ana dg-mini" data-kaydet>Kaydet</button>';
  dugme.closest(".eylemler").after(kutu);
  var inp = kutu.querySelector("input");
  buyukHarfBagla(inp);
  inp.focus();
  kutu.querySelector("[data-kaydet]").addEventListener("click", function(){
    var metin = inp.value.trim();
    kartDurum(dugme, "Kaydediliyor…", "");
    hepsiniListele("'" + p.g + "' in parents and trashed = false", "id,name,mimeType")
      .then(function(l){
        var eskiler = l.filter(function(x){ return x.mimeType !== KLASOR && (x.name === "TANI.txt" || x.name.indexOf("TANI - ") === 0); });
        var adim = metin ? metinDosyasi("TANI - " + dosyaAdiTemiz(metin) + ".txt", "TANI: " + metin + "\n", p.g) : Promise.resolve();
        return adim.then(function(){
          return Promise.all(eskiler.map(function(x){ return copeAt(x.id).catch(function(){}); }));
        });
      })
      .then(function(){
        p.t = metin; hazirla(); dizinKaydet(); cipleriKur(); ciz();
        durumYaz(metin ? "Tanı kaydedildi." : "Tanı silindi.", "iyi");
      })
      .catch(function(err){ kartDurum(dugme, err.message, "kotu"); });
  });
}

function adDuzenle(dugme, p){
  var kart = dugme.closest(".kart");
  if(kart.querySelector("[data-adform]")){ kart.querySelector("[data-adform]").remove(); return; }
  var kutu = document.createElement("div");
  kutu.setAttribute("data-adform", "1");
  kutu.style.cssText = "margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center";
  kutu.innerHTML = '<input type="text" style="flex:1;min-width:200px" value="' + esc(p.h) + '">'
    + '<button class="dg dg-ana dg-mini" data-kaydet>Adı değiştir</button>';
  dugme.closest(".eylemler").after(kutu);
  var inp = kutu.querySelector("input");
  buyukHarfBagla(inp);
  kutu.querySelector("[data-kaydet]").addEventListener("click", function(){
    var yeni = inp.value.trim();
    if(yeni.length < 3 || yeni === p.h){ kartDurum(dugme, "Yeni bir ad yaz.", ""); return; }
    kartDurum(dugme, "Değiştiriliyor…", "");
    yenidenAdlandir(p.g, yeni).then(function(){
      p.h = yeni; hazirla(); dizinKaydet(); ciz();
      durumYaz("Klasör adı değiştirildi.", "iyi");
    }).catch(function(err){ kartDurum(dugme, err.message, "kotu"); });
  });
}

function dosyaAdiTemiz(s){ return String(s).replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100); }

function metinDosyasi(ad, icerik, ustId){
  var sinir = "----arsiv" + Date.now();
  var govde =
      "--" + sinir + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
    + JSON.stringify({ name: ad, parents: [ustId], mimeType: "text/plain" }) + "\r\n"
    + "--" + sinir + "\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"
    + icerik + "\r\n--" + sinir + "--";
  return istek(YUKLE_API + "?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { "Content-Type": 'multipart/related; boundary="' + sinir + '"' },
    body: govde
  });
}

/* =========================================================
   8. YENİ KAYIT
   ========================================================= */
var yeniDoku = null, yeniTek = {}, secilenDosyalar = [], kilitliHasta = null, durduruldu = false;

function tarihKodu(){
  var v = $("ntarih").value;
  if(!v) return "";
  return v.replace(/-/g, "");
}
function seciliTeknikler(){ return Object.keys(yeniTek).filter(function(k){ return yeniTek[k]; }); }

function formCiz(){
  var kd = $("ndoku"), kt = $("ntek");
  Array.prototype.forEach.call(kd.querySelectorAll(".cip"), function(x){ x.remove(); });
  Array.prototype.forEach.call(kt.querySelectorAll(".cip"), function(x){ x.remove(); });
  var dokular = DOKULAR.slice();
  dokular.forEach(function(d){
    var b = document.createElement("button");
    b.className = "cip"; b.type = "button"; b.textContent = d;
    b.setAttribute("aria-pressed", String(yeniDoku === d));
    b.disabled = !!kilitliHasta;
    b.addEventListener("click", function(){ yeniDoku = (yeniDoku === d ? null : d); formCiz(); yolCiz(); });
    kd.appendChild(b);
  });
  TEKNIKLER.forEach(function(t){
    var b = document.createElement("button");
    b.className = "cip"; b.type = "button"; b.textContent = t;
    b.title = TEKNIK_ACIK[t] || t;
    b.setAttribute("aria-pressed", String(!!yeniTek[t]));
    b.addEventListener("click", function(){ yeniTek[t] = !yeniTek[t]; formCiz(); dosyaSatirlariCiz(); yolCiz(); });
    kt.appendChild(b);
  });
  dosyaSatirlariCiz();
  yolCiz();
}

function dosyaSatirlariCiz(){
  var kap = $("secilenler");
  if(!secilenDosyalar.length){ kap.innerHTML = ""; return; }
  var tekler = seciliTeknikler();
  kap.innerHTML = secilenDosyalar.map(function(x, i){
    return '<div class="sdosya"><span class="ad">' + esc(x.f.name) + '</span>'
      + '<span class="bo">' + boyutYaz(x.f.size) + '</span>'
      + '<select data-tek="' + i + '" style="width:auto;padding:3px 6px;font-size:12px">'
      +   (tekler.length ? tekler.map(function(t){
            return '<option value="' + esc(t) + '"' + (x.t === t ? " selected" : "") + '>' + esc(t) + '</option>';
          }).join("") : '<option value="">önce teknik seç</option>')
      + '</select>'
      + '<button class="x" data-cikar="' + i + '" title="Listeden çıkar">✕</button></div>';
  }).join("");
  kap.querySelectorAll("[data-tek]").forEach(function(s){
    s.addEventListener("change", function(){ secilenDosyalar[parseInt(s.dataset.tek, 10)].t = s.value; });
  });
  kap.querySelectorAll("[data-cikar]").forEach(function(b){
    b.addEventListener("click", function(){
      secilenDosyalar.splice(parseInt(b.dataset.cikar, 10), 1);
      dosyaSatirlariCiz(); yolCiz();
    });
  });
  /* teknik seçimi değişmişse varsayılanı güncelle */
  secilenDosyalar.forEach(function(x){ if(tekler.indexOf(x.t) < 0) x.t = tekler[0] || ""; });
}

function dosyaEkle(dosyalar){
  var tekler = seciliTeknikler();
  Array.prototype.forEach.call(dosyalar, function(f){
    secilenDosyalar.push({ f: f, t: tekler[0] || "" });
  });
  dosyaSatirlariCiz(); yolCiz();
}

function yolCiz(){
  var ad = $("nad").value.trim(), tk = tarihKodu(), tekler = seciliTeknikler();
  var eksikler = [];
  if(!yeniDoku) eksikler.push("doku");
  if(ad.length < 3) eksikler.push("hasta adı");
  if(!tk) eksikler.push("vizit tarihi");
  if(!tekler.length) eksikler.push("en az bir teknik");
  var e = $("eksik");
  if(eksikler.length){
    e.hidden = false;
    e.textContent = "Eksik: " + eksikler.join(", ") + ".";
  } else { e.hidden = true; }
  $("olustur").disabled = eksikler.length > 0;
  $("yolonizleme").innerHTML = "Oluşacak yol: <b>" + esc(KOK_AD) + " / " + esc(yeniDoku || "DOKU")
    + " / " + esc(ad || "AD SOYAD") + " / " + esc(tk || "YYYYAAGG") + " / "
    + esc(tekler.length ? tekler.join(", ") : "TEKNİK") + "</b>";

  var ip = $("adipucu");
  if(ad.length >= 3 && yeniDoku){
    var p = hastaBul(yeniDoku, ad);
    ip.textContent = p ? ("Arşivde var — " + p.v.length + " vizit kayıtlı. Yeni vizit bu hastaya eklenecek.")
                       : "Arşivde yok — yeni hasta klasörü açılacak.";
  } else ip.textContent = "";
}

function vizitEkleBaslat(p){
  kilitliHasta = p;
  yeniDoku = p.d;
  $("nad").value = p.h; $("nad").readOnly = true;
  var kk = $("kilitkutu");
  kk.hidden = false;
  kk.innerHTML = '<div class="serit bilgi">Var olan hastaya vizit ekleniyor: <b>' + esc(p.h) + '</b> · ' + esc(p.d)
    + ' <button class="lnk" id="kilitcoz" style="margin-left:8px">vazgeç</button></div>';
  $("kilitcoz").addEventListener("click", kilidiCoz);
  sekmeSec("yeni");
  formCiz();
  $("ntarih").focus();
}
function kilidiCoz(){
  kilitliHasta = null;
  $("nad").readOnly = false; $("nad").value = "";
  $("kilitkutu").hidden = true; $("kilitkutu").innerHTML = "";
  formCiz();
}

function kayitOlustur(){
  var doku = yeniDoku, ad = $("nad").value.trim(), tk = tarihKodu();
  var tekler = seciliTeknikler(), tani = $("ntani").value.trim();
  var yuklenecek = secilenDosyalar.filter(function(x){ return x.t; });
  durduruldu = false;

  var cikti = $("cikti");
  cikti.innerHTML = "";
  $("olustur").disabled = true;
  $("iptal").hidden = false;
  $("ilerleme").hidden = yuklenecek.length === 0;
  $("pfill").style.width = "0%";

  function satir(m, sinif){
    cikti.insertAdjacentHTML("beforeend", '<div class="serit ' + (sinif || "") + '" style="margin-top:8px">' + esc(m) + "</div>");
  }

  var hastaKlasor = null, vizitKlasor = null, tekKlasor = {};
  var yuklendi = 0, atlandi = 0, basarisiz = [];

  klasorSagla(doku, kokId)
    .then(function(d){ return klasorSagla(ad, d.id); })
    .then(function(h){ hastaKlasor = h; return klasorSagla(tk, h.id); })
    .then(function(v){
      vizitKlasor = v;
      var z = Promise.resolve();
      tekler.forEach(function(t){
        z = z.then(function(){ return klasorSagla(t, v.id).then(function(f){ tekKlasor[t] = f; }); });
      });
      return z;
    })
    .then(function(){
      satir("Klasörler hazır: " + KOK_AD + " / " + doku + " / " + ad + " / " + tk, "iyi");
      if(!tani) return null;
      return hepsiniListele("'" + hastaKlasor.id + "' in parents and trashed = false", "id,name,mimeType")
        .then(function(l){
          var eskiler = l.filter(function(x){ return x.mimeType !== KLASOR && x.name.indexOf("TANI - ") === 0; });
          return metinDosyasi("TANI - " + dosyaAdiTemiz(tani) + ".txt", "TANI: " + tani + "\n", hastaKlasor.id)
            .then(function(){ return Promise.all(eskiler.map(function(x){ return copeAt(x.id).catch(function(){}); })); })
            .then(function(){ satir("Tanı kaydedildi: " + tani, "iyi"); });
        });
    })
    .then(function(){
      if(!yuklenecek.length) return null;
      var toplamBayt = yuklenecek.reduce(function(a, x){ return a + x.f.size; }, 0);
      var gidenBayt = 0;
      var mevcut = {};
      var z = Promise.resolve();
      tekler.forEach(function(t){
        z = z.then(function(){
          return hepsiniListele("'" + tekKlasor[t].id + "' in parents and trashed = false", "id,name")
            .then(function(l){ mevcut[t] = {}; l.forEach(function(f){ mevcut[t][f.name] = 1; }); });
        });
      });
      yuklenecek.forEach(function(x, i){
        z = z.then(function(){
          if(durduruldu) return null;
          $("ptext").textContent = x.t + " — " + x.f.name;
          $("pnum").textContent = (i + 1) + " / " + yuklenecek.length;
          if(mevcut[x.t] && mevcut[x.t][x.f.name]){
            atlandi++; gidenBayt += x.f.size;
            $("pfill").style.width = Math.round(100 * gidenBayt / toplamBayt) + "%";
            return null;
          }
          var oncekiBayt = gidenBayt;
          return dosyaYukle(x.f, tekKlasor[x.t].id, x.f.name, function(giden){
            var t = oncekiBayt + giden;
            $("pfill").style.width = Math.round(100 * t / toplamBayt) + "%";
          }).then(function(){
            yuklendi++;
          }).catch(function(err){
            basarisiz.push({ ad: x.f.name, mesaj: err.message });
          }).then(function(){
            gidenBayt = oncekiBayt + x.f.size;
            $("pfill").style.width = Math.round(100 * gidenBayt / toplamBayt) + "%";
          });
        });
      });
      return z.then(function(){
        var parca = [];
        if(yuklendi) parca.push(yuklendi + " yüklendi");
        if(atlandi) parca.push(atlandi + " zaten vardı");
        if(basarisiz.length) parca.push(basarisiz.length + " yüklenemedi");
        if(durduruldu) parca.push("durduruldu");
        satir("Görüntüler · " + parca.join(", "), basarisiz.length ? "kotu" : "iyi");
        basarisiz.slice(0, 10).forEach(function(b){ satir(b.ad + " — " + b.mesaj, "kotu"); });
      });
    })
    .then(function(){
      /* dizini güncelle */
      var p = hastaBul(doku, ad);
      if(!p){ p = { d: doku, h: ad, t: "", g: hastaKlasor.id, v: [] }; VERI.push(p); }
      p.g = hastaKlasor.id;
      if(tani) p.t = tani;
      var v = null;
      for(var i = 0; i < p.v.length; i++){ if(p.v[i].t === tk){ v = p.v[i]; break; } }
      if(!v){ v = { t: tk, id: vizitKlasor.id, k: {} }; p.v.push(v); }
      v.id = vizitKlasor.id;
      tekler.forEach(function(t){
        var n = yuklenecek.filter(function(x){ return x.t === t; }).length;
        var eski = v.k[t] ? (v.k[t].n || 0) : 0;
        v.k[t] = { id: tekKlasor[t].id, n: Math.max(eski, n) };
      });
      hazirla(); dizinKaydet(); cipleriKur(); ciz();
      cikti.insertAdjacentHTML("beforeend",
        '<div class="serit iyi" style="margin-top:10px">Kayıt hazır. '
        + '<a href="https://drive.google.com/drive/folders/' + esc(vizitKlasor.id) + '" target="_blank" rel="noopener">Vizit klasörünü Drive’da aç →</a></div>');
      secilenDosyalar = [];
      if(!kilitliHasta){ $("ntani").value = ""; }
      dosyaSatirlariCiz();
    })
    .catch(function(err){
      satir("İşlem yarıda kaldı: " + err.message, "kotu");
    })
    .then(function(){
      $("olustur").disabled = false;
      $("iptal").hidden = true;
      $("ilerleme").hidden = true;
      $("ptext").textContent = ""; $("pnum").textContent = "";
      yolCiz();
    });
}

/* =========================================================
   9. SEKMELER, OLAYLAR, AÇILIŞ
   ========================================================= */
function sekmeSec(hangi){
  var a = hangi === "ara";
  $("tab-ara").setAttribute("aria-selected", String(a));
  $("tab-yeni").setAttribute("aria-selected", String(!a));
  $("panel-ara").hidden = !a;
  $("panel-yeni").hidden = a;
}

function olaylariBagla(){
  qEl = $("q"); sonucEl = $("sonuclar"); sayimEl = $("sayim");
  qEl.addEventListener("input", ciz);

  $("tab-ara").addEventListener("click", function(){ sekmeSec("ara"); });
  $("tab-yeni").addEventListener("click", function(){ sekmeSec("yeni"); });

  sonucEl.addEventListener("click", function(e){
    var sx = e.target.closest("[data-silvizit],[data-silteknik],[data-silhasta]");
    if(sx){
      e.stopPropagation(); e.preventDefault();
      var p = kartHastasi(sx); if(!p) return;
      if(sx.hasAttribute("data-silhasta"))
        onayIste(sx, p.h + " — " + p.v.length + " vizitin tamamı silinsin mi?", function(){ return silHasta(p); });
      else if(sx.hasAttribute("data-silvizit"))
        onayIste(sx, gunAy(sx.dataset.silvizit) + " viziti silinsin mi?", function(){ return silVizit(p, sx.dataset.silvizit); });
      else
        onayIste(sx, sx.dataset.silteknik + " klasörü silinsin mi?", function(){ return silTeknik(p, sx.dataset.vt, sx.dataset.silteknik); });
      return;
    }
    if(e.target.closest(".onay")){ e.stopPropagation(); return; }

    var g = e.target.closest("[data-galeri]");
    if(g){ var pg = kartHastasi(g); if(pg) galeriAc(g, pg, g.dataset.vt, g.dataset.galeri); return; }

    var bas = e.target.closest(".kbas");
    if(bas){
      var id = bas.closest(".kart").dataset.id;
      acik[id] = !acik[id]; ciz();
      return;
    }
    var ve = e.target.closest("[data-vizitekle]");
    if(ve){ var pv = kartHastasi(ve); if(pv) vizitEkleBaslat(pv); return; }
    var td = e.target.closest("[data-taniduzenle]");
    if(td){ var pt = kartHastasi(td); if(pt) taniDuzenle(td, pt); return; }
    var ad = e.target.closest("[data-adduzenle]");
    if(ad){ var pa = kartHastasi(ad); if(pa) adDuzenle(ad, pa); return; }
  });

  /* yeni kayıt formu */
  ["nad", "ntarih", "ntani"].forEach(function(k){
    $(k).addEventListener("input", yolCiz);
  });
  buyukHarfBagla($("nad"), function(){ return !kilitliHasta; });
  buyukHarfBagla($("ntani"));

  var alan = $("dosyaalani"), girdi = $("ndosya");
  alan.addEventListener("click", function(){ girdi.click(); });
  girdi.addEventListener("change", function(){ dosyaEkle(girdi.files); girdi.value = ""; });
  ["dragenter", "dragover"].forEach(function(o){
    alan.addEventListener(o, function(e){ e.preventDefault(); alan.classList.add("uzerinde"); });
  });
  ["dragleave", "drop"].forEach(function(o){
    alan.addEventListener(o, function(e){ e.preventDefault(); alan.classList.remove("uzerinde"); });
  });
  alan.addEventListener("drop", function(e){ if(e.dataTransfer && e.dataTransfer.files) dosyaEkle(e.dataTransfer.files); });

  $("olustur").addEventListener("click", kayitOlustur);
  $("iptal").addEventListener("click", function(){ durduruldu = true; $("iptal").disabled = true; });

  $("yenile").addEventListener("click", function(e){
    var b = $("yenile"); b.disabled = true;
    galeriOnbellek = {};
    /* Normal tıklama: hızlı eşitleme. Shift ile tıklama: arşivi baştan oku. */
    var tam = e.shiftKey;
    var is = tam
      ? (durumYaz("Arşivin tamamı okunuyor…", ""),
         dizinKur(function(m){ durumYaz(m, ""); })
           .then(function(n){ cipleriKur(); ciz(); formCiz(); durumYaz(n + " hasta güncel.", "iyi"); }))
      : otoSenk(false);
    is.catch(function(err){ durumYaz(err.message, "kotu"); })
      .then(function(){ b.disabled = false; });
  });

  $("cikis").addEventListener("click", function(){
    try{ sessionStorage.removeItem("arsiv-jeton"); }catch(e){}
    if(jeton && window.google && google.accounts && google.accounts.oauth2)
      try{ google.accounts.oauth2.revoke(jeton); }catch(e){}
    jeton = null; jetonBitis = 0;
    location.reload();
  });
}

/* ---------------- açılış ---------------- */
function kapakDurum(metin, sinif){
  var d = $("kapakdurum");
  d.className = "serit " + (sinif || "bilgi");
  d.textContent = metin;
}

function uygulamayiAc(){
  $("kapak").hidden = true;
  $("uygulama").hidden = false;
  var z = dizinYukle();
  cipleriKur(); ciz(); formCiz();
  if(z){
    durumYaz("Drive kontrol ediliyor…", "");
    setTimeout(function(){ otoSenk(true); }, 400);
    return;
  }
  durumYaz("Arşiv ilk kez okunuyor…", "");
  sonucEl.innerHTML = '<div class="iskelet">'
    + new Array(7).join("x").split("x").map(function(){ return '<div class="isk-satir"></div>'; }).join("")
    + '</div>';
  sayimEl.innerHTML = 'Drive okunuyor…';
  dizinKur(function(m){ durumYaz(m, ""); })
    .then(function(n){ cipleriKur(); ciz(); formCiz(); durumYaz(n + " hasta yüklendi.", "iyi"); })
    .catch(function(err){ durumYaz(err.message, "kotu"); });
}

function baslat(){
  clientId = depoOku(AY_CID, null) || (window.ARSIV_CLIENT_ID || null);
  var kayitliJeton = null;
  try{ kayitliJeton = JSON.parse(sessionStorage.getItem("arsiv-jeton") || "null"); }catch(e){}
  if(kayitliJeton && kayitliJeton.b > Date.now() + 60000){ jeton = kayitliJeton.j; jetonBitis = kayitliJeton.b; }

  olaylariBagla();

  if(!clientId){
    $("kimlikalani").hidden = false;
    kapakDurum("Başlamak için Google OAuth Client ID'ni gir.", "bilgi");
  } else {
    $("kimlikdegis").hidden = false;
    kapakDurum("Google hesabınla bağlanman gerekiyor.", "bilgi");
  }

  $("kimlikdegis").addEventListener("click", function(){
    $("kimlikalani").hidden = false;
    $("cid").value = clientId || "";
    $("kimlikdegis").hidden = true;
  });

  $("baglan").addEventListener("click", function(){
    var girilen = $("cid").value.trim();
    if(!$("kimlikalani").hidden){
      if(!/apps\.googleusercontent\.com$/.test(girilen)){
        kapakDurum("Client ID '…apps.googleusercontent.com' ile bitmeli.", "kotu"); return;
      }
      clientId = girilen; depoYaz(AY_CID, clientId);
    }
    if(!clientId){ kapakDurum("Önce Client ID gerekiyor.", "kotu"); return; }
    if(!jetonKur()){ kapakDurum("Google kitaplığı yüklenemedi — sayfayı yenile.", "kotu"); return; }
    kapakDurum("Google penceresi açılıyor…", "bilgi");
    jetonIste(false).then(function(){ uygulamayiAc(); })
      .catch(function(err){ kapakDurum(err.message, "kotu"); });
  });

  /* Client ID varsa sessizce girmeyi dene — daha önce izin verilmişse
     kullanıcıya hiç düğme göstermeden açılır. */
  if(clientId){
    var sayac = 0;
    (function deneKur(){
      if(jetonKur()){
        if(jetonGecerli()){ uygulamayiAc(); return; }
        kapakDurum("Google hesabına bağlanılıyor…", "bilgi");
        jetonIste(true)
          .then(function(){ uygulamayiAc(); })
          .catch(function(){ kapakDurum("Devam etmek için Google hesabınla bağlan.", "bilgi"); });
        return;
      }
      if(sayac++ < 60) setTimeout(deneKur, 150);
      else kapakDurum("Google kitaplığı yüklenemedi — sayfayı yenile.", "kotu");
    })();
  }

  if("serviceWorker" in navigator){
    window.addEventListener("load", function(){ navigator.serviceWorker.register("sw.js").catch(function(){}); });
  }
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", baslat);
else baslat();

})();
