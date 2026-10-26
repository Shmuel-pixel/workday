/* Workday offline cache. Bump VERSION when the app changes. */
var VERSION='workday-v28';
var SHELL=['./','index.html','manifest.webmanifest','icons/apple-touch-icon.png','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(VERSION).then(function(c){return c.addAll(SHELL)}).then(function(){return self.skipWaiting()}))});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==VERSION&&k!=='wd-cfg'}).map(function(k){return caches.delete(k)}))}).then(function(){return self.clients.claim()}))});
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

/* Messages: a push comes in with no text; ask the Workday Messages service what it is, then show it. */
self.addEventListener('push',function(e){
  e.waitUntil(caches.open('wd-cfg').then(function(c){return c.match('cfg')}).then(function(r){return r?r.json():null}).then(function(cfg){
    if(!cfg||!cfg.url||!cfg.key)return {title:'Workday',body:'New message'};
    return fetch(cfg.url+'/notify',{headers:{'X-Key':cfg.key},cache:'no-store'}).then(function(r){return r.json()});
  }).catch(function(){return {title:'Workday',body:'New message'}}).then(function(n){
    try{if(self.navigator.setAppBadge&&n.count)self.navigator.setAppBadge(n.count)}catch(x){}
    return self.registration.showNotification(n.title||'Workday',{body:n.body||'New message',tag:'wd-msg',renotify:true,icon:'icons/icon-192.png',data:{chat:n.chat||'',kind:n.kind||''}});
  }));
});
self.addEventListener('notificationclick',function(e){
  e.notification.close();
  var chat=(e.notification.data&&e.notification.data.chat)||'',kind=(e.notification.data&&e.notification.data.kind)||'';
  var url=self.registration.scope+(kind==='rem'?'':(chat?'?chat='+encodeURIComponent(chat):'?chat=list'));
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(cs){
    for(var i=0;i<cs.length;i++){if(cs[i].url.indexOf(self.registration.scope)===0){
      /* app already open: tell it which chat to show, then bring it forward */
      cs[i].postMessage(kind==='rem'?{type:'openDay'}:{type:'openChat',chat:chat});
      try{return cs[i].focus().catch(function(){})}catch(x){return}
    }}
    return self.clients.openWindow(url);
  }));
});
