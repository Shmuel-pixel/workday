/**
 * Workday Connect
 * The bridge between Shmuel's Workday app and his Google account.
 * Runs as Shmuel. The app sends requests with the connection code.
 *
 * What it can do:
 *  - read and write the Workday, Equipment Manager and Dumpster Log sheets
 *  - search Google Contacts (for foremen)
 *  - look up full addresses (Google Maps geocoder, free)
 *  - save job photos to a Drive folder called "Workday Photos"
 *  - free translation (Google Translate) as a backup
 *  - put reminders and jobs on Google Calendar (calendars "Workday Reminders" and "Workday Jobs")
 */

var TOKEN = 'PUT-YOUR-OWN-TOKEN-HERE'; /* the real one is only in the Google Doc and your Apps Script */

var BOOKS = {
  workday:  '1-6dJlD1UaD16rgJfdY1cVjH_hgaYjNdQkrrJeA30WHo',
  equipment:'1fV83ak0tgWdPJy-iTrHzxkg6_fzpcF8k6ThH62aiXJ4',
  dumpsters:'15YCb4w9HbNq1Mw9E2ZmX9FP8pTVsHVqkh3yMUNUJ1v4',
  supply:   '1X-1lPEIHSr5uEjTAq7UA4MfzE1LwC_Z4erVa3dELcuo'
};

var CARD_COLS = ['ID','Date','Time','Status','Work Type','Address','Contractor','Foreman','Phone','Crew','Vehicle','Materials','Tools','Notes','Source','Order','Created','Updated','Deleted'];

/* ---------- web entry points ---------- */

function doGet(e) {
  var url = ScriptApp.getService().getUrl();
  var code = url + '#' + TOKEN;
  var html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#F3F2F1;margin:0;padding:24px}' +
    '.c{background:#fff;border-radius:12px;padding:20px;max-width:520px;margin:auto}' +
    'h1{font-size:22px;margin:0 0 8px}p{color:#444}textarea{width:100%;height:120px;font:13px monospace;border:1px solid #ccc;border-radius:8px;padding:8px;box-sizing:border-box}' +
    'button{background:#0078D4;color:#fff;border:0;border-radius:8px;padding:12px 18px;font-size:16px;font-weight:600;margin-top:10px}</style></head><body><div class="c">' +
    '<h1>Workday Connect is running</h1><p>Copy this connection code, then paste it into Workday: gear, Google connection, Paste code.</p>' +
    '<textarea id="t" readonly>' + code + '</textarea><button onclick="var t=document.getElementById(\'t\');t.select();try{navigator.clipboard.writeText(t.value)}catch(e){document.execCommand(\'copy\')}this.textContent=\'Copied\'">Copy code</button>' +
    '<p style="font-size:13px">Keep this code private. Anyone with it can read your Workday sheets.</p></div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Workday Connect').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents || '{}');
    if (req.token !== TOKEN) throw new Error('bad_token');
    out = { ok: true, data: route_(req.action, req.args || {}) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function route_(action, a) {
  switch (action) {
    case 'ping':        return { user: Session.getEffectiveUser().getEmail(), time: new Date().toISOString() };
    case 'getAll':      return getAll_();
    case 'saveCards':   return saveCards_(a.cards || []);
    case 'addNote':     return addNote_(a);
    case 'addRow':      return addRow_(a.tab, a.row);
    case 'updateRow':   return updateRow_(a.tab, a.key, a.value, a.row);
    case 'contacts':    return searchContacts_(a.q || '');
    case 'geocode':     return geocode_(a.q || '');
    case 'translate':   return { text: LanguageApp.translate(a.text || '', a.from || '', a.to || 'es') };
    case 'getValues':   return getValues_(a.book, a.range);
    case 'updateValues':return updateValues_(a.book, a.range, a.values);
    case 'appendValues':return appendValues_(a.book, a.range, a.values);
    case 'syncCalendar':return syncCalendar_(a);
    default: throw new Error('unknown_action ' + action);
  }
}

/* ---------- helpers ---------- */

function book_(key) {
  var id = BOOKS[key];
  if (!id) throw new Error('unknown_book ' + key);
  return SpreadsheetApp.openById(id);
}
function tab_(name) {
  var sh = book_('workday').getSheetByName(name);
  if (!sh) throw new Error('missing_tab ' + name);
  return sh;
}
function rows_(sh) {
  var v = sh.getDataRange().getValues();
  if (!v.length) return [];
  var head = v[0].map(String), out = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i], o = {}, empty = true;
    for (var j = 0; j < head.length; j++) {
      if (!head[j]) continue;
      var x = cell_(head[j], r[j]);
      o[head[j]] = x === null || x === undefined ? '' : String(x);
      if (o[head[j]] !== '') empty = false;
    }
    if (!empty) out.push(o);
  }
  return out;
}
function cell_(h, x) {
  if (x instanceof Date && x.getFullYear() < 1901) return Utilities.formatDate(x, 'America/New_York', 'HH:mm');
  if (x instanceof Date) return Utilities.formatDate(x, 'America/New_York', h === 'Time' ? 'HH:mm' : (h === 'Date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss'));
  return x;
}
function headers_(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String); }
function now_() { return Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd HH:mm:ss'); }

/* ---------- Workday data ---------- */

function getAll_() {
  var b = book_('workday'), names = ['Cards','Notes','Suggestions','Contractors','Foremen','Job Sites','Crew','Lists','Settings'], out = {};
  names.forEach(function (n) { var sh = b.getSheetByName(n); out[n] = sh ? rows_(sh) : []; });
  return out;
}

function saveCards_(cards) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = tab_('Cards'), head = headers_(sh);
    var last = sh.getLastRow(), ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
    var saved = 0;
    cards.forEach(function (c) {
      var row = head.map(function (h) { var v = c[h]; return v === undefined || v === null ? '' : v; });
      var i = ids.indexOf(String(c.ID));
      if (i >= 0) {
        var cur = sh.getRange(i + 2, 1, 1, head.length).getValues()[0];
        var curUpd = String(cell_('Updated', cur[head.indexOf('Updated')]) || '');
        if (curUpd && c.Updated && curUpd > c.Updated) return; /* sheet has a newer edit, keep it */
        sh.getRange(i + 2, 1, 1, head.length).setValues([row]);
      } else {
        sh.appendRow(row); ids.push(String(c.ID));
      }
      saved++;
    });
    return { saved: saved };
  } finally { lock.releaseLock(); }
}

function addNote_(a) {
  var url = '';
  if (a.photo) {
    var folder = photoFolder_();
    var m = String(a.photo).match(/^data:(image\/[a-z]+);base64,(.*)$/);
    if (m) {
      var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], (a.cardId || 'job') + '-' + Date.now() + '.jpg');
      var f = folder.createFile(blob);
      url = f.getUrl();
    }
  }
  tab_('Notes').appendRow([a.cardId || '', a.time || now_(), a.text || '', url, a.by || 'Shmuel', a.noteId || '']);
  return { photoUrl: url };
}

function photoFolder_() {
  var it = DriveApp.getFoldersByName('Workday Photos');
  return it.hasNext() ? it.next() : DriveApp.createFolder('Workday Photos');
}

var ALLOWED_TABS = ['Contractors','Foremen','Job Sites','Crew','Suggestions','Lists','Settings'];

function addRow_(tab, row) {
  if (ALLOWED_TABS.indexOf(tab) < 0) throw new Error('tab_not_allowed');
  var sh = tab_(tab), head = headers_(sh);
  sh.appendRow(head.map(function (h) { return row[h] === undefined ? '' : row[h]; }));
  return { added: true };
}

function updateRow_(tab, key, value, row) {
  if (ALLOWED_TABS.indexOf(tab) < 0) throw new Error('tab_not_allowed');
  var sh = tab_(tab), head = headers_(sh), k = head.indexOf(key);
  if (k < 0) throw new Error('missing_column ' + key);
  var last = sh.getLastRow();
  if (last > 1) {
    var col = sh.getRange(2, k + 1, last - 1, 1).getValues();
    for (var i = 0; i < col.length; i++) {
      if (String(col[i][0]).toLowerCase() === String(value).toLowerCase()) {
        var cur = sh.getRange(i + 2, 1, 1, head.length).getValues()[0];
        var next = head.map(function (h, j) { return row[h] === undefined ? cur[j] : row[h]; });
        sh.getRange(i + 2, 1, 1, head.length).setValues([next]);
        return { updated: true };
      }
    }
  }
  return addRow_(tab, row);
}

/* ---------- Google Contacts ---------- */

function searchContacts_(q) {
  q = String(q).trim();
  if (!q) return { people: [] };
  if (typeof People === 'undefined') return { people: [], needsSetup: true }; /* turn on: Services + People API */
  try { People.People.searchContacts({ query: '', readMask: 'names' }); } catch (e) {} /* warm-up call Google asks for */
  Utilities.sleep(300);
  var res = People.People.searchContacts({ query: q, readMask: 'names,phoneNumbers,emailAddresses,organizations', pageSize: 10 });
  var people = (res.results || []).map(function (r) {
    var p = r.person || {};
    return {
      name: p.names && p.names[0] ? p.names[0].displayName : '',
      phones: (p.phoneNumbers || []).map(function (x) { return x.value; }),
      emails: (p.emailAddresses || []).map(function (x) { return x.value; }),
      company: p.organizations && p.organizations[0] ? (p.organizations[0].name || '') : ''
    };
  }).filter(function (p) { return p.name || p.phones.length; });
  return { people: people };
}

/* ---------- Addresses ---------- */

function geocode_(q) {
  q = String(q).trim();
  if (!q) return { places: [] };
  var g = Maps.newGeocoder().setRegion('us').setBounds(39.6, -75.6, 41.4, -73.8); /* prefer New Jersey */
  var res = g.geocode(/\b(nj|new jersey)\b/i.test(q) ? q : q + ', NJ');
  var places = (res.results || []).slice(0, 5).map(function (r) {
    return {
      address: r.formatted_address.replace(/, USA$/, ''),
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      partial: !!r.partial_match
    };
  });
  return { places: places };
}

/* ---------- Other sheets (equipment, dumpsters, supply) ---------- */

function sheetRange_(key, range) {
  var b = book_(key), m = String(range).match(/^'?([^'!]+)'?!(.+)$/);
  if (!m) throw new Error('bad_range');
  var sh = b.getSheetByName(m[1]);
  if (!sh) throw new Error('missing_tab ' + m[1]);
  return { sh: sh, a1: m[2] };
}
function getValues_(key, range) {
  var r = sheetRange_(key, range);
  var v = r.sh.getRange(r.a1).getDisplayValues();
  while (v.length && v[v.length - 1].join('') === '') v.pop();
  v = v.map(function (row) { while (row.length && row[row.length - 1] === '') row.pop(); return row; });
  return { range: range, values: v };
}
function updateValues_(key, range, values) {
  var r = sheetRange_(key, range);
  r.sh.getRange(r.a1).setValues(values);
  return { updated: true };
}
function appendValues_(key, range, values) {
  var r = sheetRange_(key, range);
  values.forEach(function (row) { r.sh.appendRow(row); });
  return { appended: values.length };
}

/* ---------- Google Calendar ---------- */

function getCal_(name) {
  var c = CalendarApp.getCalendarsByName(name)[0];
  if (!c) { c = CalendarApp.createCalendar(name); try { c.setTimeZone('America/New_York'); } catch (e) {} }
  return c;
}

/* The app sends the full list it wants for a window of days. Only changes are written. */
function syncCalendar_(a) {
  var from = new Date(a.from), to = new Date(a.to), out = {};
  [['reminders', 'Workday Reminders'], ['jobs', 'Workday Jobs']].forEach(function (k) {
    var items = a[k[0]];
    if (!items) return;
    var cal = getCal_(k[1]), have = {}, want = {}, made = 0, gone = 0;
    cal.getEvents(from, to).forEach(function (ev) {
      var key = ev.getTag('wk');
      if (!key) return;
      if (have[key]) { ev.deleteEvent(); gone++; } else have[key] = ev;
    });
    items.forEach(function (it) { want[it.key] = it; });
    Object.keys(have).forEach(function (key) {
      var it = want[key];
      if (!it || have[key].getTag('sig') !== it.sig) { have[key].deleteEvent(); delete have[key]; gone++; }
    });
    items.forEach(function (it) {
      if (have[it.key]) return;
      var st = new Date(it.start), ev;
      if (it.allDay) ev = cal.createAllDayEvent(it.title, st, { description: it.desc || '', location: it.loc || '' });
      else ev = cal.createEvent(it.title, st, new Date(it.end || (it.start + 15 * 60000)), { description: it.desc || '', location: it.loc || '' });
      ev.setTag('wk', it.key); ev.setTag('sig', it.sig);
      ev.removeAllReminders();
      if (it.alert !== null && it.alert !== undefined) ev.addPopupReminder(it.alert);
      made++;
      if (made % 20 === 0) Utilities.sleep(500);
    });
    out[k[0]] = { added: made, removed: gone };
  });
  return out;
}

/* Run this once from the editor to approve access. */
function setup() {
  getAll_();
  photoFolder_();
  try { if (typeof People !== 'undefined') searchContacts_('a'); } catch (e) {}
  geocode_('Lakewood');
  getCal_('Workday Reminders');
  getCal_('Workday Jobs');
  Logger.log('Workday Connect is ready. Now deploy it as a web app.');
}
