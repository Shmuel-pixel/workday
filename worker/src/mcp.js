/*
  Workday connector for Claude (remote MCP server, Streamable HTTP, no sessions).
  Claude reaches it at /mcp/<secret>. The secret is made by the Workday app (gear, Claude connector)
  and kept in storage. The Google connection (Workday Connect URL + code) is sent by the app too.
  Nothing secret is in this file.
*/

var VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

var BOOKS = {
  workday: ['Cards', 'Notes', 'Contractors', 'Foremen', 'Job Sites', 'Crew', 'Keys', 'Tows', 'Contacts', 'Contact Items', 'Receipts', 'Notebook', 'Lists', 'Settings', 'Suggestions', 'Google Contacts'],
  dumpsters: ['Dumpsters', 'Job Sites', 'Companies', 'Sizes'],
  equipment: ['Equipment', 'Locations', 'Tasks', 'History'],
  supply: ['Stock', 'Log', 'Orders', 'Audits']
};

var INSTRUCTIONS = [
  'This connector runs Shmuel\'s Workday app (Five Star Services, Lakewood NJ). The app reads the same Google Sheets, so changes show up after he pulls down in the app.',
  'Rules:',
  '1. Call workday_today first in a session to get the date and time in New York, and use it for "today", "tomorrow", "Monday".',
  '2. Before adding or changing anything, read the names back (crew, contractor, foreman, address, company) and get his OK. Then write.',
  '3. Read a tab (read_tab or list_jobs) before writing to it, so you use the real column names. Only change what he asked.',
  '4. Never schedule work on Shabbos or Yom Tov. Ask for another day.',
  '5. If more than one row could match, ask which one.',
  '6. Delete = delete_row, which marks the row deleted (it can be brought back with restore_row) when the tab has a Deleted column. Keys are never deleted: set Status to Retired with the date and reason. Key serial numbers never change.',
  '7. Jobs (Cards): Date YYYY-MM-DD, Time HH:MM 24-hour, Status todo or done. Materials and Tools are separated by "; ". Use add_job / update_job for jobs; they fill ID, Created, Updated, Source and Moves.',
  '8. Dumpster status goes Ordered -> Delivered -> Pickup Requested -> Picked Up; fill that step\'s date column when it changes.',
  '9. Keep answers short, like a text message.'
].join('\n');

function nyNow() {
  var f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'long' });
  var o = {};
  f.formatToParts(new Date()).forEach(function (p) { o[p.type] = p.value; });
  var hh = o.hour === '24' ? '00' : o.hour;
  return { date: o.year + '-' + o.month + '-' + o.day, time: hh + ':' + o.minute, stamp: o.year + '-' + o.month + '-' + o.day + ' ' + hh + ':' + o.minute + ':' + o.second, weekday: o.weekday };
}
function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function q(tab) { return "'" + String(tab).replace(/'/g, "''") + "'"; }

var S = { type: 'string' };
var TOOLS = [
  { name: 'workday_today', description: 'Today\'s date, weekday and time in New York (Lakewood), plus the list of sheets and tabs this connector can use. Call this first.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'list_jobs', description: 'List job cards (Cards tab) for a day or a range of days, in time order. Skips deleted cards.', inputSchema: { type: 'object', properties: { from: { type: 'string', description: 'First day, YYYY-MM-DD' }, to: { type: 'string', description: 'Last day, YYYY-MM-DD (default: same as from)' }, include_done: { type: 'boolean', description: 'Also show done jobs (default true)' }, search: { type: 'string', description: 'Only jobs containing this text (address, contractor, crew...)' } }, required: ['from'] }, annotations: { readOnlyHint: true } },
  { name: 'add_job', description: 'Add a job card. Confirm the names with Shmuel first. Fields use the Cards column names, for example Date, Time, Title, Work Type, Address, Contractor, Foreman, Phone, Crew, Crew Size, Vehicle, Materials, Tools, Notes. ID, Status, Source, Created and Updated are filled in.', inputSchema: { type: 'object', properties: { fields: { type: 'object', description: 'Column name -> value', additionalProperties: S } }, required: ['fields'] } },
  { name: 'update_job', description: 'Change a job card by its ID. Only the given columns change. Changing Date records the move. Status "done" marks it done.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, changes: { type: 'object', description: 'Column name -> new value', additionalProperties: S } }, required: ['id', 'changes'] } },
  { name: 'read_tab', description: 'Read rows from any tab as objects (column name -> value). Each row has _row (the sheet row number). Deleted rows are skipped unless include_deleted.', inputSchema: { type: 'object', properties: { book: { type: 'string', enum: Object.keys(BOOKS), description: 'workday, dumpsters, equipment or supply' }, tab: S, search: { type: 'string', description: 'Only rows containing this text' }, limit: { type: 'number', description: 'Most rows to return (default 200, newest last)' }, include_deleted: { type: 'boolean' } }, required: ['book', 'tab'] }, annotations: { readOnlyHint: true } },
  { name: 'add_row', description: 'Add one row to a tab. Give values by column name. Empty Added, Created and Updated columns get the current time. Confirm with Shmuel first.', inputSchema: { type: 'object', properties: { book: { type: 'string', enum: Object.keys(BOOKS) }, tab: S, row: { type: 'object', additionalProperties: S } }, required: ['book', 'tab', 'row'] } },
  { name: 'update_row', description: 'Change cells in one row. Find the row by its first-column value (ID), or by match_column + match_value, or by row number. Only the given columns change; Updated is set if the tab has it. Confirm with Shmuel first.', inputSchema: { type: 'object', properties: { book: { type: 'string', enum: Object.keys(BOOKS) }, tab: S, id: { type: 'string', description: 'Value in the first column' }, match_column: S, match_value: S, row: { type: 'number', description: 'Sheet row number (from _row)' }, changes: { type: 'object', additionalProperties: S } }, required: ['book', 'tab', 'changes'] } },
  { name: 'delete_row', description: 'Delete a row. If the tab has a Deleted column the row is only marked deleted and can be brought back with restore_row. Otherwise the row is cleared and cannot be brought back, so confirm with Shmuel first. Keys cannot be deleted (retire them instead).', inputSchema: { type: 'object', properties: { book: { type: 'string', enum: Object.keys(BOOKS) }, tab: S, id: S, match_column: S, match_value: S, row: { type: 'number' } }, required: ['book', 'tab'] }, annotations: { destructiveHint: true } },
  { name: 'restore_row', description: 'Bring back a row that was marked deleted (clears its Deleted column).', inputSchema: { type: 'object', properties: { book: { type: 'string', enum: Object.keys(BOOKS) }, tab: S, id: S, row: { type: 'number' } }, required: ['book', 'tab'] } }
];

export async function mcpHandle(box, req) {
  if (req.method === 'GET') return new Response('Workday connector. Use POST.', { status: 405, headers: { Allow: 'POST' } });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  var body;
  try { body = await req.json(); } catch (e) { return rpcOut({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  var list = Array.isArray(body) ? body : [body], out = [];
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if (!m || m.id === undefined || m.id === null) continue; /* notification */
    out.push(await one(box, m));
  }
  if (!out.length) return new Response(null, { status: 202 });
  return rpcOut(Array.isArray(body) ? out : out[0]);
}
function rpcOut(o) { return new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }

async function one(box, m) {
  var r = { jsonrpc: '2.0', id: m.id };
  try {
    if (m.method === 'initialize') {
      var want = m.params && m.params.protocolVersion;
      r.result = { protocolVersion: VERSIONS.indexOf(want) >= 0 ? want : VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'workday', title: 'Workday', version: '1.0.0' }, instructions: INSTRUCTIONS };
    } else if (m.method === 'ping') r.result = {};
    else if (m.method === 'tools/list') r.result = { tools: TOOLS };
    else if (m.method === 'resources/list') r.result = { resources: [] };
    else if (m.method === 'prompts/list') r.result = { prompts: [] };
    else if (m.method === 'tools/call') {
      var name = m.params && m.params.name, args = (m.params && m.params.arguments) || {};
      try {
        var res = await callTool(box, name, args);
        r.result = { content: [{ type: 'text', text: typeof res === 'string' ? res : JSON.stringify(res, null, 1) }] };
      } catch (e) {
        r.result = { content: [{ type: 'text', text: 'Error: ' + (e && e.message ? e.message : String(e)) }], isError: true };
      }
    } else r.error = { code: -32601, message: 'Method not found: ' + m.method };
  } catch (e) {
    r.error = { code: -32603, message: String(e && e.message || e) };
  }
  return r;
}

/* ---------- sheet helpers ---------- */
function cfg(box) {
  var c = box.get('mcp_conn') || box.get('bk_cfg');
  if (!c) throw new Error('Workday is not linked to Google yet. In the Workday app: gear, Claude connector, then tap Update link.');
  return JSON.parse(c);
}
function checkBook(book, tab) {
  if (!BOOKS[book]) throw new Error('Unknown book "' + book + '". Use: ' + Object.keys(BOOKS).join(', '));
  if (!tab) throw new Error('Which tab?');
}
async function readTab(box, book, tab) {
  checkBook(book, tab);
  var d = await box.bridgeCall(cfg(box), 'getValues', { book: book, range: q(tab) + '!A1:AZ5000' });
  var v = (d && d.values) || [];
  var head = (v[0] || []).map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i] || [], o = { _row: i + 1 }, any = false;
    head.forEach(function (h, j) { if (!h) return; var x = r[j] === undefined ? '' : String(r[j]); o[h] = x; if (x !== '') any = true; });
    if (any) rows.push(o);
  }
  return { head: head, rows: rows, last: v.length };
}
function colOf(head, name) {
  var k = head.indexOf(name);
  if (k < 0) { var low = String(name).toLowerCase(); k = head.findIndex(function (h) { return h.toLowerCase() === low; }); }
  return k;
}
function findRow(t, a) {
  if (a.row) { var byNum = t.rows.filter(function (r) { return r._row === +a.row; })[0]; if (!byNum) throw new Error('Row ' + a.row + ' is empty or does not exist.'); return byNum; }
  var col = a.match_column || t.head[0], val = a.match_column ? a.match_value : a.id;
  if (val === undefined || val === null || val === '') throw new Error('Give id, match_column + match_value, or row.');
  var k = colOf(t.head, col);
  if (k < 0) throw new Error('No column "' + col + '". Columns: ' + t.head.filter(Boolean).join(', '));
  var h = t.head[k], want = String(val).trim().toLowerCase();
  var hits = t.rows.filter(function (r) { return String(r[h]).trim().toLowerCase() === want; });
  if (!hits.length) throw new Error('No row with ' + h + ' = "' + val + '".');
  if (hits.length > 1) throw new Error(hits.length + ' rows have ' + h + ' = "' + val + '" (rows ' + hits.map(function (r) { return r._row; }).join(', ') + '). Ask which one and use row.');
  return hits[0];
}
/* write only the cells that change, in runs of neighbouring columns */
async function writeCells(box, book, tab, rowNum, head, changes) {
  var idx = [], vals = {};
  Object.keys(changes).forEach(function (name) {
    var k = colOf(head, name);
    if (k < 0) throw new Error('No column "' + name + '" in ' + tab + '. Columns: ' + head.filter(Boolean).join(', '));
    idx.push(k); vals[k] = changes[name] === null || changes[name] === undefined ? '' : String(changes[name]);
  });
  idx = idx.filter(function (k, i) { return idx.indexOf(k) === i; }).sort(function (a, b) { return a - b; });
  var runs = [], cur = null;
  idx.forEach(function (k) { if (cur && k === cur.end + 1) { cur.end = k; cur.v.push(vals[k]); } else { cur = { start: k, end: k, v: [vals[k]] }; runs.push(cur); } });
  var c = cfg(box);
  for (var i = 0; i < runs.length; i++) {
    var ru = runs[i];
    await box.bridgeCall(c, 'updateValues', { book: book, range: q(tab) + '!' + colName(ru.start) + rowNum + ':' + colName(ru.end) + rowNum, values: [ru.v] });
  }
}
async function appendRow(box, book, tab, head, row) {
  var bad = Object.keys(row).filter(function (n) { return colOf(head, n) < 0; });
  if (bad.length) throw new Error('No column ' + bad.map(function (b) { return '"' + b + '"'; }).join(', ') + ' in ' + tab + '. Columns: ' + head.filter(Boolean).join(', '));
  var line = head.map(function () { return ''; });
  Object.keys(row).forEach(function (n) { line[colOf(head, n)] = row[n] === null || row[n] === undefined ? '' : String(row[n]); });
  while (line.length && line[line.length - 1] === '') line.pop();
  await box.bridgeCall(cfg(box), 'appendValues', { book: book, range: q(tab) + '!A:' + colName(Math.max(head.length - 1, 0)), values: [line] });
  return line;
}
function stampEmpty(head, row, now) {
  ['Added', 'Created', 'Updated'].forEach(function (n) { if (colOf(head, n) >= 0 && !row[n]) row[n] = now.stamp; });
}
function jobId() { return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 10); }
function tidy(r) { var o = {}; Object.keys(r).forEach(function (k) { if (r[k] !== '' || k === 'ID') o[k] = r[k]; }); return o; }

async function callTool(box, name, a) {
  var now = nyNow();
  if (name === 'workday_today') return { today: now.date, weekday: now.weekday, time: now.time, timezone: 'America/New_York', books: BOOKS };

  if (name === 'list_jobs') {
    var from = String(a.from || now.date), to = String(a.to || from), qq = String(a.search || '').toLowerCase();
    var t = await readTab(box, 'workday', 'Cards');
    var jobs = t.rows.filter(function (r) {
      if (r.Deleted) return false;
      if (!(r.Date >= from && r.Date <= to)) return false;
      if (a.include_done === false && r.Status === 'done') return false;
      if (qq && JSON.stringify(r).toLowerCase().indexOf(qq) < 0) return false;
      return true;
    }).sort(function (x, y) { return (x.Date + (x.Time || '99:99') + (x.Order || '')).localeCompare(y.Date + (y.Time || '99:99') + (y.Order || '')); });
    return { from: from, to: to, count: jobs.length, jobs: jobs.map(tidy) };
  }

  if (name === 'add_job') {
    var t2 = await readTab(box, 'workday', 'Cards'), f = Object.assign({}, a.fields || {});
    if (!f.Date) throw new Error('A job needs a Date (YYYY-MM-DD).');
    f.ID = f.ID || jobId(); f.Status = f.Status || 'todo'; f.Source = f.Source || 'claude';
    f.Created = now.stamp; f.Updated = now.stamp;
    await appendRow(box, 'workday', 'Cards', t2.head, f);
    return { added: tidy(f) };
  }

  if (name === 'update_job') {
    var t3 = await readTab(box, 'workday', 'Cards'), row = findRow(t3, { id: a.id }), ch = Object.assign({}, a.changes || {});
    if (row.Deleted && !('Deleted' in ch)) throw new Error('That job is deleted. Use restore_row first.');
    if (ch.Date && ch.Date !== row.Date && colOf(t3.head, 'Moves') >= 0) {
      ch.Moves = (row.Moves ? row.Moves + '; ' : '') + row.Date + '>' + ch.Date;
      if (colOf(t3.head, 'Order') >= 0 && !('Order' in ch)) ch.Order = '';
    }
    ch.Updated = now.stamp;
    await writeCells(box, 'workday', 'Cards', row._row, t3.head, ch);
    return { updated: a.id, changes: ch };
  }

  if (name === 'read_tab') {
    var t4 = await readTab(box, a.book, a.tab), del = colOf(t4.head, 'Deleted'), qs = String(a.search || '').toLowerCase();
    var rows = t4.rows.filter(function (r) {
      if (del >= 0 && r[t4.head[del]] && !a.include_deleted) return false;
      return !qs || JSON.stringify(r).toLowerCase().indexOf(qs) >= 0;
    });
    var lim = Math.max(1, Math.min(+a.limit || 200, 1000)), total = rows.length;
    rows = rows.slice(-lim);
    return { book: a.book, tab: a.tab, columns: t4.head.filter(Boolean), total: total, shown: rows.length, rows: rows.map(tidy) };
  }

  if (name === 'add_row') {
    if (a.book === 'workday' && a.tab === 'Cards') return callTool(box, 'add_job', { fields: a.row });
    var t5 = await readTab(box, a.book, a.tab), r5 = Object.assign({}, a.row || {});
    stampEmpty(t5.head, r5, now);
    await appendRow(box, a.book, a.tab, t5.head, r5);
    return { added: r5, tab: a.tab };
  }

  if (name === 'update_row') {
    if (a.book === 'workday' && a.tab === 'Cards' && a.id && !a.row && !a.match_column) return callTool(box, 'update_job', { id: a.id, changes: a.changes });
    var t6 = await readTab(box, a.book, a.tab), r6 = findRow(t6, a), c6 = Object.assign({}, a.changes || {});
    if (a.book === 'workday' && a.tab === 'Keys' && Object.keys(c6).some(function (k) { return k.toLowerCase() === 'serial'; })) throw new Error('Key serial numbers never change.');
    if (colOf(t6.head, 'Updated') >= 0 && !('Updated' in c6)) c6.Updated = now.stamp;
    await writeCells(box, a.book, a.tab, r6._row, t6.head, c6);
    return { updated_row: r6._row, tab: a.tab, changes: c6 };
  }

  if (name === 'delete_row') {
    if (a.book === 'workday' && a.tab === 'Keys') throw new Error('Keys are never deleted. Use update_row to set Status to Retired, with Retired on and Why retired.');
    var t7 = await readTab(box, a.book, a.tab), r7 = findRow(t7, a), dk = colOf(t7.head, 'Deleted');
    if (dk >= 0) {
      var c7 = {}; c7[t7.head[dk]] = now.stamp;
      if (colOf(t7.head, 'Updated') >= 0) c7.Updated = now.stamp;
      await writeCells(box, a.book, a.tab, r7._row, t7.head, c7);
      return { deleted: true, can_restore: true, row: r7._row, was: tidy(r7) };
    }
    var blank = {}; t7.head.forEach(function (h) { if (h) blank[h] = ''; });
    await writeCells(box, a.book, a.tab, r7._row, t7.head, blank);
    return { cleared: true, can_restore: false, row: r7._row, was: tidy(r7) };
  }

  if (name === 'restore_row') {
    var t8 = await readTab(box, a.book, a.tab), dk8 = colOf(t8.head, 'Deleted');
    if (dk8 < 0) throw new Error('This tab has no Deleted column, so nothing to restore.');
    var r8 = findRow(t8, a), c8 = {}; c8[t8.head[dk8]] = '';
    if (colOf(t8.head, 'Updated') >= 0) c8.Updated = now.stamp;
    await writeCells(box, a.book, a.tab, r8._row, t8.head, c8);
    return { restored: true, row: r8._row };
  }

  throw new Error('Unknown tool ' + name);
}
