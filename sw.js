/* Basit kabuk önbelleği — uygulama çevrimdışı açılır, veriler Drive'dan gelir. */
var SURUM = "arsiv-202609142115";
var KABUK = ["./", "./index.html", "./app.js?v=202609142115", "./config.js?v=202609142115"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SURUM).then(function (c) { return c.addAll(KABUK); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (a) {
    return Promise.all(a.map(function (k) { return k === SURUM ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var u = new URL(e.request.url);
  /* Google API ve kimlik istekleri asla önbelleğe alınmaz */
  if (u.origin !== self.location.origin) return;
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(function (y) {
      var kopya = y.clone();
      caches.open(SURUM).then(function (c) { c.put(e.request, kopya); }).catch(function () {});
      return y;
    }).catch(function () { return caches.match(e.request).then(function (r) { return r || caches.match("./index.html"); }); })
  );
});
