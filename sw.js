/* Workday offline cache. Bump VERSION when the app changes. */
var VERSION='workday-v13';
var SHELL=['./','index.html','manifest.webmanifest','icons/apple-touch-icon.png','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(VERSION).then(function(c){return c.addAll(SHELL)}).then(function(){return self.skipWaiting()}))});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==VERSION}).map(function(k){return caches.delete(k)}))}).then(function(){return self.clients.claim()}))});
self.addEventListener('fetch',function(e){
  var req=e.request;if(req.method!=='GET')return;
  var url=new URL(req.url);
  var fonts=url.hostname==='fonts.googleapis.com'||url.hostname==='fonts.gstatic.com'||url.hostname==='unpkg.com'||url.hostname==='cdn.jsdelivr.net';
  if(url.origin!==location.origin&&!fonts)return;
  if(req.mode==='navigate'){
    /* app page: try network first so updates arrive, fall back to the saved copy offline */
    e.respondWith(fetch(req.url,{cache:'no-store'}).then(function(r){var cp=r.clone();caches.open(VERSION).then(function(c){c.put('index.html',cp)});return r}).catch(function(){return caches.match('index.html')}));
    return;
  }
  e.respondWith(caches.match(req).then(function(hit){
    var net=fetch(req).then(function(r){if(r&&(r.ok||r.type==='opaque')){var cp=r.clone();caches.open(VERSION).then(function(c){c.put(req,cp)})}return r}).catch(function(){return hit});
    return hit||net;
  }));
});
