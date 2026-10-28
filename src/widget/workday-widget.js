// Workday widget for Scriptable. Shows today's jobs and the next reminder.
// Made by the Workday app. Add a Scriptable widget (medium or large) and pick this script.
const APP = "https://workday.shmuel-4f0.workers.dev/";
const isDark = Device.isUsingDarkAppearance();
const C = {
  bg: Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E")),
  fg: Color.dynamic(new Color("#1C1C1E"), new Color("#F2F2F7")),
  muted: Color.dynamic(new Color("#6E6E73"), new Color("#98989F")),
  blue: Color.dynamic(new Color("#007AFF"), new Color("#0A84FF")),
  green: Color.dynamic(new Color("#34C759"), new Color("#30D158")),
  red: Color.dynamic(new Color("#FF3B30"), new Color("#FF453A"))
};
async function getData() {
  const fm = FileManager.local(), path = fm.joinPath(fm.cacheDirectory(), "workday-widget.json");
  try {
    const r = new Request(WD_URL + "/widget?w=" + encodeURIComponent(WD_KEY));
    r.timeoutInterval = 10;
    const d = await r.loadJSON();
    if (d && d.items) { fm.writeString(path, JSON.stringify(d)); return d; }
  } catch (e) {}
  if (fm.fileExists(path)) { const d = JSON.parse(fm.readString(path)); d.stale = true; return d; }
  return null;
}
function clock(ms) { const df = new DateFormatter(); df.dateFormat = "h:mm a"; return df.string(new Date(ms)); }
const size = config.widgetFamily || "large";
const max = size === "small" ? 3 : size === "medium" ? 4 : 10;
const d = await getData();
const w = new ListWidget();
w.backgroundColor = C.bg; w.url = APP; w.setPadding(12, 14, 12, 14);
const top = w.addStack(); top.centerAlignContent();
const t1 = top.addText("Workday"); t1.font = Font.boldSystemFont(15); t1.textColor = C.blue;
top.addSpacer();
const t2 = top.addText(d ? d.dateLabel : ""); t2.font = Font.mediumSystemFont(12); t2.textColor = C.muted;
if (d && d.heb && size !== "small") { const hb = w.addText(d.heb); hb.font = Font.systemFont(11); hb.textColor = C.muted; }
w.addSpacer(6);
if (!d) {
  const m = w.addText("Open Workday once to load your day."); m.font = Font.systemFont(13); m.textColor = C.muted;
} else {
  if (d.noWork) { const n = w.addText(d.noWork); n.font = Font.semiboldSystemFont(13); n.textColor = C.red; w.addSpacer(4); }
  const items = d.items.slice(0, max);
  if (!items.length) { const m = w.addText("No jobs today"); m.font = Font.systemFont(13); m.textColor = C.muted; }
  for (const it of items) {
    const row = w.addStack(); row.centerAlignContent(); row.spacing = 6;
    const dot = row.addText(it.done ? "\u2713" : "\u25CF"); dot.font = Font.boldSystemFont(11); dot.textColor = it.done ? C.green : (it.missed ? C.red : C.blue);
    if (it.time) { const tm = row.addText(it.time); tm.font = Font.semiboldMonospacedSystemFont(12); tm.textColor = C.muted; }
    const tt = row.addText(it.title + (it.crew && size !== "small" ? " \u00B7 " + it.crew : "")); tt.font = Font.mediumSystemFont(13);
    tt.textColor = it.done ? C.muted : C.fg; tt.lineLimit = 1;
    w.addSpacer(3);
  }
  if (d.items.length > max) { const more = w.addText("+" + (d.items.length - max) + " more"); more.font = Font.systemFont(11); more.textColor = C.muted; }
  w.addSpacer();
  const bot = w.addStack(); bot.centerAlignContent();
  if (d.next) { const nx = bot.addText("\u23F0 " + d.next.title + " " + clock(d.next.t)); nx.font = Font.systemFont(11); nx.textColor = C.muted; nx.lineLimit = 1; }
  bot.addSpacer();
  if (d.mincha && size !== "small") { const mi = bot.addText("Mincha " + d.mincha); mi.font = Font.semiboldSystemFont(11); mi.textColor = C.blue; }
  if (d.stale) { const st = w.addText("Offline, showing last saved"); st.font = Font.italicSystemFont(9); st.textColor = C.muted; }
}
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
if (config.runsInWidget) Script.setWidget(w); else await w.presentLarge();
Script.complete();
