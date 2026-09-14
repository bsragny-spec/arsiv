# Oküler Onkoloji Arşivi — web uygulaması

Google Drive'daki `HASTA KAYIT STANDART` arşivine **doğrudan** bağlanan tek sayfalık uygulama.
Aradaki köprü kalktığı için **yükleme boyut sınırı yoktur** — dosyalar Google'ın parçalı
yükleme protokolüyle, tam kalitede, kaldığı yerden devam ederek gider.

Hasta verisi bu depoda **yoktur** ve buraya hiç gelmez. Depoda yalnızca arayüz kodu bulunur;
tüm görüntüler ve tanılar kullanıcının kendi Google Drive'ında kalır.

## Dosyalar

| Dosya | Ne işe yarar |
|---|---|
| `index.html` | Sayfa iskeleti ve tüm stiller |
| `app.js` | Uygulamanın tamamı — Drive bağlantısı, arama, yükleme, düzenleme |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | Telefon/masaüstü simgesi ve çevrimdışı açılış |
| `test.js` | Sahte bir Drive üzerinde uçtan uca sınama (`node test.js`, jsdom gerektirir) |

## Kurulum

### 1. Google tarafı (bir kerelik, ~10 dk)

1. [console.cloud.google.com](https://console.cloud.google.com) → **New Project** → ad: `okuler-arsiv`
2. **APIs & Services → Library** → `Google Drive API` → **Enable**
3. **OAuth consent screen** (yeni konsolda **Google Auth Platform → Branding**)
   - User type: **External**
   - App name, destek e-postası, geliştirici e-postası: kendi hesabın
   - **Audience → Test users** → kendi Gmail adresini ekle
4. **Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - **Authorized JavaScript origins**: `https://bsragny-spec.github.io`
     (yalnızca kök adres; sonunda eğik çizgi ve alt yol yok)
   - Oluşan **Client ID** `config.js` içine yazılmıştır — değiştirmen gerekmez

> Uygulama "Testing" modunda kaldığı için Google ilk girişte "doğrulanmamış uygulama"
> uyarısı gösterir — **Advanced → Go to …** ile devam edilir. Yetki zaman zaman
> yenilenmek ister; bu da tek tıktır.

### 2. GitHub tarafı

1. Yeni bir depo aç (ör. `arsiv`)
2. Bu klasördeki dosyaları deponun köküne yükle
3. **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main` / `(root)` → Save
4. Bir iki dakika sonra adres hazır: `https://bsragny-spec.github.io/arsiv/`

### 3. İlk açılış

1. Adresi aç → **Google ile bağlan** (Client ID gömülü geldi)
2. Uygulama arşivin tamamını Drive'dan okur (birkaç saniye) ve tarayıcıya kaydeder
3. Telefonda: tarayıcı menüsünden **Ana ekrana ekle** → simge olarak açılır

## Nasıl çalışır

- **Dizin**: Drive'daki tüm klasörler tek sorguda çekilir, ağaç tarayıcıda kurulur.
  20 000 dosyalık arşiv için toplam birkaç istek yeter. Sonuç tarayıcıda saklanır;
  **Yenile** düğmesi her şeyi Drive'dan yeniden okur.
- **Yükleme**: `uploadType=resumable` ile 8 MB'lık dilimler hâlinde. Ağ koparsa
  kaldığı bayttan devam eder. Boyut sınırı yoktur, dosya hiç dönüştürülmez.
- **Önizleme**: Drive'ın kendi küçük resimleri kullanılır — HEIC gibi tarayıcının
  açamadığı biçimler de görünür.
- **Silme**: her şey **çöp kutusuna** taşınır (`trashed: true`), kalıcı silme yapılmaz.
- **Tanı**: hasta klasöründe `TANI - <metin>.txt` dosyası olarak tutulur; yeni tanı
  yazılınca eskisi çöp kutusuna gider.

## Klasör düzeni

```
HASTA KAYIT STANDART/
  <DOKU>/                 KAPAK, KONJONKTIVA, KOROID, IRIS, ORBIT, RETINA, OKULER MELANOSIS
    <AD SOYAD>/
      TANI - <tanı>.txt
      <YYYYAAGG>/
        <TEKNİK>/         UWFP, FAF, FA, OCT, ASOCT, ASP, USG, UBM, RETCAM, ICG, GONIO,
          görüntüler      EKSTERNAL, ANAMNEZ, RADYOLOJI
```

Adı `_` ile başlayan klasörler (ör. `_ARAC`) doku sayılmaz, listede görünmez.
