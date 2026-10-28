/*
  Workday Messages: the small online service behind the Messages tab.
  - Receives WhatsApp Business messages (Meta webhook) and keeps them.
  - Lets the Workday app list chats, read messages, send text and photos.
  - Sends a phone notification when a message comes in.
  - Works in test mode before WhatsApp is connected.
  Nothing secret is in this file. Keys are made on first use and kept in storage.
*/
import { DurableObject } from 'cloudflare:workers';

var GRAPH_DEFAULT = 'v23.0';
var PUSH_SUB = 'https://workday.shmuel-4f0.workers.dev/';
/* Public keys allowed to drop items into the Workday inbox (Claude, from the build chat). Public, not secret. */
var AUTHOR_KEYS = ['MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE9ttkUVPeky+c+4pb5BCCsvRNrpMW13mVBfVXSXzIS5R/srHUEuyDXojNT6veALdfAWoyDL+JpwpGwrJWKlKkLw=='];

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    var stub = env.BOX.get(env.BOX.idFromName('main'));
    return stub.fetch(req);
  }
};

function cors(h) {
  h = h || {};
  h['Access-Control-Allow-Origin'] = '*';
  h['Access-Control-Allow-Headers'] = 'Content-Type, X-Key';
  h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  return h;
}
function json(o, status) {
  return new Response(JSON.stringify(o), { status: status || 200, headers: cors({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }) });
}
function err(msg, status) { return json({ error: msg }, status || 400); }
function rand(n) {
  var a = new Uint8Array(n), c = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
  crypto.getRandomValues(a);
  for (var i = 0; i < n; i++) s += c[a[i] % c.length];
  return s;
}
function b64u(buf) {
  var b = new Uint8Array(buf), s = '';
  for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  var bin = atob(s), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function hex(buf) {
  return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
}
function digits(p) { return String(p || '').replace(/\D/g, ''); }
function phone(p) { var d = digits(p); return d.length === 10 ? '1' + d : d; }

/* What a WhatsApp message says, in one line of text. */
function msgText(m) {
  var t = m.type;
  if (t === 'text') return (m.text && m.text.body) || '';
  if (t === 'image' || t === 'video' || t === 'document') {
    var o = m[t] || {};
    return o.caption || (t === 'document' ? (o.filename || 'Document') : '');
  }
  if (t === 'audio') return (m.audio && m.audio.voice) ? 'Voice message' : 'Audio';
  if (t === 'sticker') return 'Sticker';
  if (t === 'location') {
    var l = m.location || {};
    return 'Location: ' + [l.name, l.address].filter(Boolean).join(', ') + ' https://maps.google.com/?q=' + l.latitude + ',' + l.longitude;
  }
  if (t === 'contacts') {
    return 'Contact: ' + (m.contacts || []).map(function (c) {
      return ((c.name && c.name.formatted_name) || '') + ' ' + ((c.phones || []).map(function (p) { return p.phone; }).join(', '));
    }).join('; ');
  }
  if (t === 'reaction') return 'Reacted ' + ((m.reaction && m.reaction.emoji) || '');
  if (t === 'button') return (m.button && m.button.text) || '';
  if (t === 'interactive') {
    var i = m.interactive || {};
    return (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || '';
  }
  return 'Message (' + t + ')';
}
function msgMedia(m) {
  var o = m[m.type];
  if (o && o.id && ['image', 'video', 'audio', 'document', 'sticker'].indexOf(m.type) >= 0) return { id: o.id, mime: o.mime_type || '' };
  return null;
}

export class Box extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS chats (chat TEXT PRIMARY KEY, name TEXT, last_ts INTEGER, last_text TEXT, last_dir TEXT, unread INTEGER DEFAULT 0, last_in INTEGER DEFAULT 0)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS msgs (id TEXT PRIMARY KEY, chat TEXT, dir TEXT, type TEXT, text TEXT, media TEXT, mime TEXT, ts INTEGER, status TEXT, err TEXT, via TEXT, upd INTEGER)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS msgs_chat ON msgs (chat, ts)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, mime TEXT, data BLOB, ts INTEGER)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, sub TEXT, ts INTEGER)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS rems (key TEXT PRIMARY KEY, t INTEGER, title TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, item TEXT, ts INTEGER, done INTEGER DEFAULT 0)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS drops (id TEXT PRIMARY KEY, ts INTEGER)');
  }

  get(k) { var r = this.sql.exec('SELECT v FROM kv WHERE k=?', k).toArray(); return r.length ? r[0].v : null; }
  put(k, v) {
    if (v === null || v === undefined || v === '') this.sql.exec('DELETE FROM kv WHERE k=?', k);
    else this.sql.exec('INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, String(v));
  }
  waReady() { return !!(this.get('wa_token') && this.get('phone_id')); }
  graph() { return 'https://graph.facebook.com/' + (this.get('graph') || GRAPH_DEFAULT) + '/'; }

  async fetch(req) {
    var url = new URL(req.url), p = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (p === '/') return json({ ok: true, app: 'Workday Messages', paired: !!this.get('app_key'), whatsapp: this.waReady() });
      if (p === '/webhook' && req.method === 'GET') return this.verify(url);
      if (p === '/webhook' && req.method === 'POST') return await this.webhook(req);
      if (p === '/pair' && req.method === 'POST') return this.pair();
      if (p === '/inbox-key') return json({ key: await this.inboxPublic() });
      if (p === '/handoff' && req.method === 'GET') return json(this.handoffTake(url.searchParams.get('c')));
      if (p === '/widget' && req.method === 'GET') { var wk = this.get('widget_key'); if (!wk || url.searchParams.get('w') !== wk) return err('Wrong widget key', 401); return json(JSON.parse(this.get('widget') || '{"items":[]}')); }
      if (p === '/drop' && req.method === 'POST') return json(await this.drop(await req.json()));

      var key = req.headers.get('X-Key') || (p.indexOf('/media/') === 0 ? url.searchParams.get('k') : '');
      if (!this.get('app_key') || key !== this.get('app_key')) return err('Wrong or missing app key', 401);

      if (p === '/status') return json(this.status(url));
      if (p === '/config' && req.method === 'POST') return json(await this.config(await req.json(), url));
      if (p === '/chats') return json({ chats: this.chats(), now: Date.now(), whatsapp: this.waReady() });
      if (p === '/messages') return json(this.messages(url.searchParams.get('chat'), +(url.searchParams.get('after') || 0)));
      if (p === '/send' && req.method === 'POST') return await this.send(await req.json());
      if (p === '/read' && req.method === 'POST') return json(await this.read((await req.json()).chat));
      if (p === '/name' && req.method === 'POST') { var b = await req.json(); this.sql.exec('UPDATE chats SET name=? WHERE chat=?', b.name || '', phone(b.chat)); return json({ ok: true }); }
      if (p === '/notify') return json(this.notify());
      if (p === '/vapid') return json({ key: await this.vapidPublic() });
      if (p === '/subscribe' && req.method === 'POST') return json(this.subscribe(await req.json()));
      if (p === '/push-test' && req.method === 'POST') return json(await this.pushAll());
      if (p === '/inbox') return json({ items: this.sql.exec('SELECT id,item,ts FROM inbox WHERE done=0 ORDER BY ts').toArray().map(function (r) { var o = JSON.parse(r.item); o._inbox = r.id; return o; }) });
      if (p === '/inbox/ack' && req.method === 'POST') { var ab = await req.json(), self2 = this; (ab.ids || []).forEach(function (i) { self2.sql.exec('UPDATE inbox SET done=1 WHERE id=?', String(i)); }); return json({ ok: true }); }
      if (p === '/handoff' && req.method === 'POST') return json(this.handoffMake(await req.json()));
      if (p === '/widget' && req.method === 'POST') { this.put('widget', JSON.stringify(await req.json())); return json({ ok: true }); }
      if (p === '/widget-key') { if (!this.get('widget_key')) this.put('widget_key', rand(24)); return json({ key: this.get('widget_key') }); }
      if (p === '/transcribe' && req.method === 'POST') return json(await this.transcribe(await req.json()));
      if (p === '/reminders' && req.method === 'POST') return json(await this.setReminders(await req.json()));
      if (p === '/test/incoming' && req.method === 'POST') return json(await this.testIncoming(await req.json()));
      if (p.indexOf('/media/') === 0) return await this.media(decodeURIComponent(p.slice(7)));
      return err('Not found', 404);
    } catch (e) {
      return err('Server problem: ' + (e && e.message ? e.message : e), 500);
    }
  }

  /* ---------- pairing and setup ---------- */
  pair() {
    if (this.get('app_key')) return err('This service is already connected to a phone. Use the app key from that phone.', 403);
    var k = rand(32);
    this.put('app_key', k);
    if (!this.get('verify_token')) this.put('verify_token', rand(24));
    return json({ key: k });
  }
  status(url) {
    return {
      paired: true,
      whatsapp: this.waReady(),
      phoneId: this.get('phone_id') || '',
      hasToken: !!this.get('wa_token'),
      hasSecret: !!this.get('app_secret'),
      graph: this.get('graph') || GRAPH_DEFAULT,
      webhookUrl: url.origin + '/webhook',
      verifyToken: this.get('verify_token') || '',
      lastWebhook: +(this.get('last_webhook') || 0),
      subs: this.sql.exec('SELECT COUNT(*) AS n FROM subs').toArray()[0].n,
      rems: this.sql.exec('SELECT COUNT(*) AS n FROM rems').toArray()[0].n,
      nextRem: this.sql.exec('SELECT t,title FROM rems ORDER BY t LIMIT 1').toArray()[0] || null,
      lastPush: this.get('last_push') ? JSON.parse(this.get('last_push')) : null
    };
  }
  async config(b, url) {
    if ('waToken' in b) this.put('wa_token', String(b.waToken || '').trim());
    if ('phoneId' in b) this.put('phone_id', digits(b.phoneId));
    if ('appSecret' in b) this.put('app_secret', String(b.appSecret || '').trim());
    if ('graph' in b) this.put('graph', String(b.graph || '').trim());
    var out = this.status(url);
    if (b.check && this.waReady()) {
      var r = await fetch(this.graph() + this.get('phone_id') + '?fields=display_phone_number,verified_name', { headers: { Authorization: 'Bearer ' + this.get('wa_token') } });
      var j = await r.json().catch(function () { return {}; });
      out.check = r.ok ? { ok: true, number: j.display_phone_number, name: j.verified_name } : { ok: false, error: (j.error && j.error.message) || ('HTTP ' + r.status) };
    }
    return out;
  }

  /* ---------- Meta webhook ---------- */
  verify(url) {
    var q = url.searchParams;
    if (q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') && q.get('hub.verify_token') === this.get('verify_token')) {
      return new Response(q.get('hub.challenge') || '', { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }
  async webhook(req) {
    var raw = await req.arrayBuffer();
    var secret = this.get('app_secret');
    if (secret) {
      var sig = (req.headers.get('X-Hub-Signature-256') || '').replace(/^sha256=/, '');
      var k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      var mine = hex(await crypto.subtle.sign('HMAC', k, raw));
      if (!sig || sig !== mine) return new Response('Bad signature', { status: 401 });
    }
    var body = {};
    try { body = JSON.parse(new TextDecoder().decode(raw)); } catch (e) { return new Response('ok'); }
    this.put('last_webhook', Date.now());
    var self = this, got = 0;
    (body.entry || []).forEach(function (en) {
      (en.changes || []).forEach(function (ch) {
        var v = ch.value || {};
        var names = {};
        (v.contacts || []).forEach(function (c) { if (c.wa_id) names[c.wa_id] = c.profile && c.profile.name; });
        (v.messages || []).forEach(function (m) {
          self.store({ id: m.id, chat: digits(m.from), dir: 'in', type: m.type, text: msgText(m), media: msgMedia(m), ts: (+m.timestamp || Date.now() / 1000) * 1000, status: 'received', via: 'whatsapp', name: names[m.from] });
          got++;
        });
        /* Messages you sent from the WhatsApp Business app on your phone (coexistence) */
        (v.message_echoes || []).forEach(function (m) {
          self.store({ id: m.id, chat: digits(m.to), dir: 'out', type: m.type, text: msgText(m), media: msgMedia(m), ts: (+m.timestamp || Date.now() / 1000) * 1000, status: 'sent', via: 'phone' });
        });
        (v.statuses || []).forEach(function (s) {
          var e = (s.errors && s.errors[0]) ? (s.errors[0].title || s.errors[0].message || '') : null;
          self.sql.exec('UPDATE msgs SET status=?, err=COALESCE(?,err), upd=? WHERE id=?', s.status, e, Date.now(), s.id);
        });
      });
    });
    if (got) await this.pushAll();
    return new Response('ok');
  }
  store(m) {
    var now = Date.now();
    var dup = this.sql.exec('SELECT id FROM msgs WHERE id=?', m.id).toArray().length;
    if (dup) return false;
    this.sql.exec('INSERT INTO msgs (id,chat,dir,type,text,media,mime,ts,status,err,via,upd) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      m.id, m.chat, m.dir, m.type || 'text', m.text || '', m.media ? m.media.id : null, m.media ? m.media.mime : null, Math.round(m.ts), m.status || '', m.err || null, m.via || '', now);
    var preview = m.text || (m.type === 'image' ? 'Photo' : m.type === 'video' ? 'Video' : m.type || '');
    this.sql.exec('INSERT INTO chats (chat,name,last_ts,last_text,last_dir,unread,last_in) VALUES (?,?,?,?,?,?,?) ON CONFLICT(chat) DO UPDATE SET ' +
      'name=COALESCE(NULLIF(excluded.name,\'\'),chats.name), last_ts=MAX(chats.last_ts,excluded.last_ts), ' +
      'last_text=CASE WHEN excluded.last_ts>=chats.last_ts THEN excluded.last_text ELSE chats.last_text END, ' +
      'last_dir=CASE WHEN excluded.last_ts>=chats.last_ts THEN excluded.last_dir ELSE chats.last_dir END, ' +
      'unread=chats.unread+excluded.unread, last_in=MAX(chats.last_in,excluded.last_in)',
      m.chat, m.name || '', Math.round(m.ts), preview, m.dir, m.dir === 'in' ? 1 : 0, m.dir === 'in' ? Math.round(m.ts) : 0);
    return true;
  }

  /* ---------- app reads ---------- */
  chats() {
    return this.sql.exec('SELECT chat,name,last_ts,last_text,last_dir,unread,last_in FROM chats ORDER BY last_ts DESC LIMIT 300').toArray();
  }
  messages(chat, after) {
    chat = phone(chat);
    var rows = after
      ? this.sql.exec('SELECT * FROM msgs WHERE chat=? AND upd>? ORDER BY ts', chat, after).toArray()
      : this.sql.exec('SELECT * FROM (SELECT * FROM msgs WHERE chat=? ORDER BY ts DESC LIMIT 300) ORDER BY ts', chat).toArray();
    var c = this.sql.exec('SELECT * FROM chats WHERE chat=?', chat).toArray()[0] || null;
    return { chat: c, msgs: rows, now: Date.now() };
  }
  async read(chat) {
    chat = phone(chat);
    this.sql.exec('UPDATE chats SET unread=0 WHERE chat=?', chat);
    if (this.waReady()) {
      var last = this.sql.exec('SELECT id FROM msgs WHERE chat=? AND dir=\'in\' AND via=\'whatsapp\' ORDER BY ts DESC LIMIT 1', chat).toArray()[0];
      if (last) {
        await fetch(this.graph() + this.get('phone_id') + '/messages', {
          method: 'POST', headers: { Authorization: 'Bearer ' + this.get('wa_token'), 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: last.id })
        }).catch(function () {});
      }
    }
    return { ok: true };
  }
  notify() {
    var nt = this.get('notice'), n = nt ? JSON.parse(nt) : null;
    var lastIn = this.sql.exec('SELECT MAX(ts) AS t FROM msgs WHERE dir=\'in\'').toArray()[0].t || 0;
    if (n && n.ts > Date.now() - 15 * 60000 && n.ts >= lastIn) return { kind: 'rem', title: 'Workday', body: n.title, count: 0 };
    var u = this.sql.exec('SELECT COALESCE(SUM(unread),0) AS n FROM chats').toArray()[0].n;
    var last = this.sql.exec('SELECT m.chat, m.text, m.type, c.name FROM msgs m LEFT JOIN chats c ON c.chat=m.chat WHERE m.dir=\'in\' ORDER BY m.ts DESC LIMIT 1').toArray()[0];
    if (!last) return { count: u, title: 'Workday', body: 'New message' };
    return { count: u, chat: last.chat, title: last.name || ('+' + last.chat), body: last.text || (last.type === 'image' ? 'Photo' : 'New message') };
  }

  /* ---------- sending ---------- */
  async send(b) {
    var to = phone(b.to);
    if (to.length < 8) return err('That phone number does not look right.');
    var text = String(b.text || '').trim(), img = b.image || null;
    if (!text && !img) return err('Nothing to send.');
    var now = Date.now(), localMedia = null, mime = null, bytes = null;
    if (img) {
      var mm = /^data:([^;]+);base64,(.*)$/.exec(img);
      if (!mm) return err('The photo did not come through.');
      mime = mm[1]; bytes = fromB64(mm[2]);
      if (bytes.length > 4.5 * 1024 * 1024) return err('That photo is too big.');
      localMedia = 'local-' + rand(16);
      this.saveMedia(localMedia, mime, bytes);
    }
    if (b.name) this.sql.exec('INSERT INTO chats (chat,name,last_ts,last_text,last_dir,unread,last_in) VALUES (?,?,?,?,?,0,0) ON CONFLICT(chat) DO NOTHING', to, b.name, now, '', 'out');

    if (!this.waReady()) {
      var id = 'test-' + rand(12);
      this.store({ id: id, chat: to, dir: 'out', type: img ? 'image' : 'text', text: text, media: localMedia ? { id: localMedia, mime: mime } : null, ts: now, status: 'test', via: 'app', name: b.name });
      return json({ ok: true, id: id, test: true });
    }

    var H = { Authorization: 'Bearer ' + this.get('wa_token') };
    var payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to: to };
    if (img) {
      var fd = new FormData();
      fd.append('messaging_product', 'whatsapp');
      fd.append('type', mime);
      fd.append('file', new Blob([bytes], { type: mime }), 'photo.' + (mime.split('/')[1] || 'jpg'));
      var ur = await fetch(this.graph() + this.get('phone_id') + '/media', { method: 'POST', headers: H, body: fd });
      var uj = await ur.json().catch(function () { return {}; });
      if (!ur.ok || !uj.id) return err('WhatsApp would not take the photo: ' + ((uj.error && uj.error.message) || ur.status), 502);
      payload.type = 'image'; payload.image = { id: uj.id };
      if (text) payload.image.caption = text;
    } else {
      payload.type = 'text'; payload.text = { body: text, preview_url: true };
    }
    var r = await fetch(this.graph() + this.get('phone_id') + '/messages', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify(payload) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok || !j.messages || !j.messages[0]) {
      var e = j.error || {}, code = e.code, msg = e.message || ('HTTP ' + r.status);
      if (code === 131047 || /24 hours|re-engagement/i.test(msg)) msg = 'It has been more than 24 hours since this person last wrote to you, so WhatsApp only allows an approved template message.';
      return err(msg, 502);
    }
    var wid = j.messages[0].id;
    this.store({ id: wid, chat: to, dir: 'out', type: img ? 'image' : 'text', text: text, media: localMedia ? { id: localMedia, mime: mime } : null, ts: now, status: 'sent', via: 'app', name: b.name });
    return json({ ok: true, id: wid });
  }

  /* ---------- photos and files ---------- */
  saveMedia(id, mime, bytes) {
    if (bytes.length > 1900000) return;
    this.sql.exec('INSERT INTO media (id,mime,data,ts) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING', id, mime, bytes, Date.now());
  }
  async media(id) {
    var row = this.sql.exec('SELECT mime,data FROM media WHERE id=?', id).toArray()[0];
    if (row) return new Response(row.data, { headers: cors({ 'Content-Type': row.mime || 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000' }) });
    if (!this.waReady() || id.indexOf('local-') === 0) return err('Photo not found', 404);
    var H = { Authorization: 'Bearer ' + this.get('wa_token') };
    var r = await fetch(this.graph() + encodeURIComponent(id), { headers: H });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok || !j.url) return err('WhatsApp no longer has this file', 404);
    var f = await fetch(j.url, { headers: H });
    if (!f.ok) return err('Could not download the file', 502);
    var buf = new Uint8Array(await f.arrayBuffer()), mime = j.mime_type || f.headers.get('Content-Type') || 'application/octet-stream';
    this.saveMedia(id, mime, buf);
    return new Response(buf, { headers: cors({ 'Content-Type': mime, 'Cache-Control': 'private, max-age=31536000' }) });
  }

  /* ---------- notifications (Web Push, no message text sent through Apple) ---------- */
  async vapidKeys() {
    var pub = this.get('vapid_pub'), priv = this.get('vapid_priv');
    if (!pub || !priv) {
      var kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
      priv = JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey));
      this.put('vapid_pub', pub); this.put('vapid_priv', priv);
    }
    return { pub: pub, priv: JSON.parse(priv) };
  }
  async vapidPublic() { return (await this.vapidKeys()).pub; }
  subscribe(b) {
    var s = b && b.subscription;
    if (!s || !s.endpoint) return { ok: false };
    this.sql.exec('INSERT INTO subs (endpoint,sub,ts) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET sub=excluded.sub, ts=excluded.ts', s.endpoint, JSON.stringify(s), Date.now());
    return { ok: true };
  }
  async pushAll() {
    var subs = this.sql.exec('SELECT endpoint FROM subs').toArray();
    if (!subs.length) { this.put('last_push', JSON.stringify({ ts: Date.now(), sent: 0, subs: 0, errors: ['no phone signed up for notifications'] })); return { sent: 0, subs: 0 }; }
    var keys = await this.vapidKeys();
    var signKey = await crypto.subtle.importKey('jwk', keys.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    var sent = 0, self = this, errors = [];
    await Promise.all(subs.map(async function (s) {
      var aud = new URL(s.endpoint).origin;
      var head = b64u(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
      var claims = b64u(new TextEncoder().encode(JSON.stringify({ aud: aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: PUSH_SUB })));
      var sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signKey, new TextEncoder().encode(head + '.' + claims));
      var jwt = head + '.' + claims + '.' + b64u(sig);
      try {
        var r = await fetch(s.endpoint, { method: 'POST', headers: { Authorization: 'vapid t=' + jwt + ', k=' + keys.pub, TTL: '86400', Urgency: 'high', 'Content-Length': '0' } });
        if (r.status === 404 || r.status === 410) self.sql.exec('DELETE FROM subs WHERE endpoint=?', s.endpoint);
        else if (r.ok) sent++;
        else errors.push(r.status + ' ' + (await r.text()).slice(0, 120));
      } catch (e) { errors.push(String(e)); }
    }));
    this.put('last_push', JSON.stringify({ ts: Date.now(), sent: sent, subs: subs.length, errors: errors.slice(0, 3) }));
    return { sent: sent, subs: subs.length, errors: errors };
  }

  /* ---------- voice: speech to text (Cloudflare Workers AI, Whisper) ---------- */
  async transcribe(b) {
    if (!this.env.AI) return { error: 'Voice is not turned on in the service yet.' };
    var audio = String((b && b.audio) || '');
    if (!audio) return { error: 'No audio came through.' };
    var r = await this.env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: audio, language: 'en', vad_filter: true });
    return { text: ((r && r.text) || '').trim() };
  }

  /* ---------- set up another device with a 6-digit code (single use, 15 minutes) ---------- */
  handoffMake(b) {
    var a = new Uint32Array(1); crypto.getRandomValues(a);
    var code = String(100000 + (a[0] % 900000));
    this.put('handoff', JSON.stringify({ code: code, blob: b && b.blob, exp: Date.now() + 15 * 60000, tries: 0 }));
    return { code: code, minutes: 15 };
  }
  handoffTake(c) {
    var h = this.get('handoff') ? JSON.parse(this.get('handoff')) : null;
    if (!h || Date.now() > h.exp) { this.put('handoff', ''); return { error: 'That code has expired. Make a new one on your other device.' }; }
    if (String(c || '').trim() !== h.code) {
      h.tries++; if (h.tries >= 10) { this.put('handoff', ''); return { error: 'Too many wrong tries. Make a new code on your other device.' }; }
      this.put('handoff', JSON.stringify(h)); return { error: 'That code is not right. Check the number on your other device.' };
    }
    this.put('handoff', '');
    return { blob: h.blob };
  }

  /* ---------- reminders (mincha, summaries, Trello...) ---------- */
  async setReminders(b) {
    var items = (b && b.items) || [], now = Date.now();
    this.sql.exec('DELETE FROM rems WHERE key NOT LIKE \'x-%\'');
    var self = this;
    items.forEach(function (it) { if (it && it.key && +it.t > now) self.sql.exec('INSERT OR REPLACE INTO rems (key,t,title) VALUES (?,?,?)', String(it.key), Math.round(+it.t), String(it.title || 'Reminder')); });
    await this.nextAlarm();
    var next = this.sql.exec('SELECT t,title FROM rems ORDER BY t LIMIT 1').toArray()[0] || null;
    return { ok: true, count: this.sql.exec('SELECT COUNT(*) AS n FROM rems').toArray()[0].n, next: next };
  }
  async nextAlarm() {
    var n = this.sql.exec('SELECT MIN(t) AS t FROM rems').toArray()[0].t;
    if (n) await this.ctx.storage.setAlarm(n); else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    var now = Date.now();
    var due = this.sql.exec('SELECT key,t,title FROM rems WHERE t<=? ORDER BY t', now + 30000).toArray();
    for (var i = 0; i < due.length; i++) {
      this.sql.exec('DELETE FROM rems WHERE key=?', due[i].key);
      if (due[i].t < now - 30 * 60000) continue; /* too late, skip */
      this.put('notice', JSON.stringify({ title: due[i].title, ts: now }));
      await this.pushAll();
    }
    await this.nextAlarm();
  }

  /* ---------- inbox: sealed, signed items from Claude ---------- */
  async inboxKeys() {
    var pub = this.get('inbox_pub'), priv = this.get('inbox_priv');
    if (!pub || !priv) {
      var kp = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
      pub = b64u(await crypto.subtle.exportKey('spki', kp.publicKey));
      priv = JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey));
      this.put('inbox_pub', pub); this.put('inbox_priv', priv);
    }
    return { pub: pub, priv: JSON.parse(priv) };
  }
  async inboxPublic() { return (await this.inboxKeys()).pub; }
  async drop(b) {
    /* b = {k: RSA-sealed AES key, iv, ct, sig}; sig = ECDSA over k.iv.ct by an author key */
    if (!b || !b.k || !b.iv || !b.ct || !b.sig) return { ok: false, error: 'bad drop' };
    var data = new TextEncoder().encode(b.k + '.' + b.iv + '.' + b.ct), good = false;
    for (var i = 0; i < AUTHOR_KEYS.length && !good; i++) {
      var ak = await crypto.subtle.importKey('spki', fromB64(AUTHOR_KEYS[i]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, ak, fromB64(b.sig), data);
    }
    if (!good) return { ok: false, error: 'not signed' };
    var keys = await this.inboxKeys();
    var rk = await crypto.subtle.importKey('jwk', keys.priv, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    var raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, rk, fromB64(b.k));
    var aes = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
    var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(b.iv) }, aes, fromB64(b.ct));
    var msg = JSON.parse(new TextDecoder().decode(plain));
    var now = Date.now();
    if (!msg.id || Math.abs(now - (+msg.ts || 0)) > 2 * 86400000) return { ok: false, error: 'old drop' };
    if (this.sql.exec('SELECT id FROM drops WHERE id=?', msg.id).toArray().length) return { ok: true, dup: true };
    this.sql.exec('INSERT INTO drops (id,ts) VALUES (?,?)', msg.id, now);
    var self = this, titles = [];
    (msg.items || []).forEach(function (it, n) {
      var iid = msg.id + '-' + n;
      self.sql.exec('INSERT OR REPLACE INTO inbox (id,item,ts,done) VALUES (?,?,?,0)', iid, JSON.stringify(it), now);
      if (it.remindAt && +it.remindAt > now) self.sql.exec('INSERT OR REPLACE INTO rems (key,t,title) VALUES (?,?,?)', 'x-' + iid, Math.round(+it.remindAt), String(it.remindText || it.title || 'Reminder'));
      titles.push(it.title || 'item');
    });
    await this.nextAlarm();
    if (titles.length) { this.put('notice', JSON.stringify({ title: 'Added to Workday: ' + titles.join(', '), ts: now })); await this.pushAll(); }
    return { ok: true, added: titles.length };
  }

  /* ---------- test mode ---------- */
  async testIncoming(b) {
    var from = phone(b.from || '17325550100');
    this.store({ id: 'test-in-' + rand(12), chat: from, dir: 'in', type: 'text', text: String(b.text || 'Test message from Workday'), ts: Date.now(), status: 'received', via: 'test', name: b.name || 'Test' });
    var p = await this.pushAll();
    return { ok: true, push: p };
  }
}
