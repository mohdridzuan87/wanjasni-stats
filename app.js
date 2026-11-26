// This site is public: no Analytics data, keys or private addresses belong in these files.
// Until a device is connected it shows made-up SAMPLE numbers. The connection (your Google script's
// address and key) is typed in on each device and saved only in that browser.
const SAMPLE = { // the 7-day example; other periods are scaled from it
  activeNow: 3, visitorsToday: 48, whatsappToday: 5, tiktokToday: 7,
  topPages: [["Home", 162], ["Vios price", 57], ["Yaris price", 41], ["Hilux price", 28]],
  sources: [["TikTok", 146], ["Google", 63], ["Direct", 55], ["Other", 17]],
  waButtons: [["Floating", 14], ["Calculator", 9], ["Model card", 6], ["Other", 4]],
  // State names must match the ones in map.js.
  states: [["Selangor", 104], ["Kuala Lumpur", 71], ["Johor", 28], ["Penang", 17], ["Perak", 11], ["Sabah", 9],
    ["Sarawak", 8], ["Negeri Sembilan", 7], ["Kedah", 5], ["Melaka", 4], ["Pahang", 3], ["Kelantan", 2], ["Terengganu", 1]],
  stateUnknown: 0,
  countries: [["Singapore", 7], ["Brunei", 2], ["Other", 2]],
};
// 31 made-up days, oldest first; the last one is today.
const SAMPLE_DAYS = [22, 25, 31, 40, 38, 27, 24, 26, 29, 35, 43, 47, 30, 28, 33, 39, 45, 27, 31, 34, 37, 42, 46, 29,
  31, 44, 52, 29, 36, 41, 48];
const SAMPLE_HOURS = [1, 1, 0, 0, 0, 1, 1, 2, 3, 4, 4, 5, 6, 5, 4, 4, 3, 3, 4, 5, 6, 5, 3, 2];

/* ---------- Periods ---------- */
const PERIODS = {
  today: { short: "today", hero: "visitors today", points: [1, 24] },
  "7d": { short: "7 days", hero: "visitors, last 7 days", points: [7, 7] },
  "14d": { short: "14 days", hero: "visitors, last 14 days", points: [14, 14] },
  month: { short: "this month", hero: "visitors this month", points: [1, 31] },
};

// Each chart point is [label under the chart, visitors, longer label for the tooltip].
function dayPoint(date, value, period, isToday) {
  const format = options => date.toLocaleDateString("en-MY", { ...options, timeZone: "UTC" });
  const short = isToday ? "Today" : period === "7d" ? format({ weekday: "short" }) : String(date.getUTCDate());
  return [short, value, format({ weekday: "short", day: "numeric", month: "short" })];
}
function hourPoint(hour, value) {
  const h = hour % 12 || 12, half = hour < 12 ? "am" : "pm";
  return [h + half, value, `${h} ${half}`];
}

function sample(period) {
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let series, visitors;
  if (period === "today") {
    series = SAMPLE_HOURS.slice(0, now.getHours() + 1).map((v, h) => hourPoint(h, v));
    visitors = SAMPLE.visitorsToday;
  } else {
    const count = period === "month" ? now.getDate() : PERIODS[period].points[0];
    series = SAMPLE_DAYS.slice(-count).map((v, i) =>
      dayPoint(new Date(todayUtc - (count - 1 - i) * 86400000), v, period, i === count - 1));
    visitors = series.reduce((a, p) => a + p[1], 0);
  }
  const scale = rows => rows.map(([n, v]) => [n, Math.round((v * visitors) / 281)]).filter(r => r[1] > 0);
  const out = { ...SAMPLE, series, visitors };
  for (const k of ["topPages", "sources", "states", "countries", "waButtons"]) out[k] = scale(SAMPLE[k]);
  return out;
}

// Connected, but nothing received yet for this period: show dashes rather than numbers that look real.
function blank() {
  return {
    blank: true, activeNow: null, visitorsToday: null, whatsappToday: null, tiktokToday: null,
    series: ["", "", "", "", "", "", ""].map(d => [d, 0, ""]), visitors: null,
    topPages: [], sources: [], waButtons: [], states: [], stateUnknown: 0, countries: [],
  };
}

const $ = id => document.getElementById(id);
const num = n => (n === null ? "–" : n.toLocaleString("en-MY"));
const visitorText = n => `${num(n)} ${n === 1 ? "visitor" : "visitors"}`;
const el = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

/* ---------- Saved on this device ---------- */
const CONFIG_KEY = "wjStats.config", DATA_KEY = "wjStats.lastData", PERIOD_KEY = "wjStats.period";
const load = name => { try { return JSON.parse(localStorage.getItem(name)); } catch { return null; } };
const save = (name, value) => {
  try { value === null ? localStorage.removeItem(name) : localStorage.setItem(name, JSON.stringify(value)); return true; }
  catch { return false; }
};

let config = load(CONFIG_KEY);
let saved = (config && load(DATA_KEY)) || {}; // last reply for each period
let period = Object.hasOwn(PERIODS, load(PERIOD_KEY)) ? load(PERIOD_KEY) : "7d";
let data, fetchedAt;
let problem = null;
let inFlight = null, requestNumber = 0;
let picked = null; // index of the chart point being inspected
let pickedState = null;

function showPeriod() {
  if (!config) { data = sample(period); fetchedAt = null; return; }
  data = saved[period]?.data ?? blank();
  fetchedAt = saved[period]?.fetchedAt ?? null;
}
showPeriod();

/* ---------- Live data ---------- */
// Only Google Apps Script web app addresses are accepted, so the key goes nowhere else.
const FEED_URL = /^https:\/\/script\.google\.com\/(?:a\/macros\/[\w.-]+|a\/[\w.-]+\/macros|macros)\/s\/[\w-]+\/exec$/;

class FeedError extends Error {}

async function callFeed({ url, key }, wanted) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST", body: JSON.stringify({ key, period: wanted }), headers: { "Content-Type": "text/plain;charset=utf-8" },
      cache: "no-store", credentials: "omit", redirect: "follow", signal: AbortSignal.timeout(45000),
    });
  } catch (e) {
    throw new FeedError(e.name === "TimeoutError" ? "Google took too long. Try again."
      : "Couldn't reach your script. Check your internet, the address, and that access is set to Anyone.");
  }
  let body;
  try { body = await response.json(); }
  catch { throw new FeedError("That address didn't return data. Check it ends in /exec and access is set to Anyone."); }
  if (body?.ok) return clean(body.data, wanted);
  if (body?.error === "wrong-key") throw new FeedError("The secret key doesn't match.");
  throw new FeedError(body?.message ? "Google Analytics: " + body.message : "Your script reported an error.");
}

/** Checks the reply has the expected shape before anything is shown or saved. */
function clean(raw, wanted) {
  const bad = () => { throw new FeedError("The data came back in an unexpected format. Is the script up to date?"); };
  const int = v => (Number.isFinite(v) && v >= 0 ? Math.round(v) : bad());
  const list = rows => (Array.isArray(rows) ? rows.map(r => [String(r?.[0]).slice(0, 60), int(r?.[1])]) : bad());
  const [fewest, most] = PERIODS[wanted].points;
  if (raw?.period !== wanted || !Array.isArray(raw.series) || raw.series.length < fewest || raw.series.length > most) bad();
  const series = raw.series.map((row, i) => {
    if (wanted === "today") {
      const hour = /^([01]?\d|2[0-3])$/.test(row?.[0]) ? Number(row[0]) : bad();
      return hourPoint(hour, int(row[1]));
    }
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(row?.[0]) || bad();
    return dayPoint(new Date(Date.UTC(m[1], m[2] - 1, m[3])), int(row[1]), wanted, i === raw.series.length - 1);
  });
  const out = { series, timeZone: String(raw.timeZone || "").slice(0, 60) };
  for (const k of ["activeNow", "visitorsToday", "whatsappToday", "tiktokToday", "visitors", "stateUnknown"]) out[k] = int(raw[k]);
  for (const k of ["topPages", "sources", "states", "countries"]) out[k] = list(raw[k]);
  out.waButtons = raw.waButtons === null ? null : list(raw.waButtons);
  return out;
}

function stopWaiting() { // any reply still on its way is now out of date
  requestNumber++;
  inFlight = null;
  $("refresh").classList.remove("busy");
}

async function refresh() {
  if (!config) { showPeriod(); render(); return; }
  if (inFlight === period) return;
  const using = config, wanted = period, ticket = ++requestNumber;
  const outdated = () => ticket !== requestNumber || config !== using;
  inFlight = wanted;
  $("refresh").classList.add("busy");
  try {
    const fresh = await callFeed(using, wanted);
    if (outdated()) return;
    saved[wanted] = { data: fresh, fetchedAt: Date.now() };
    save(DATA_KEY, saved);
    if (period === wanted) { problem = null; showPeriod(); }
  } catch (e) {
    if (outdated() || period !== wanted) return;
    problem = e instanceof FeedError ? e.message : "Something went wrong while updating.";
  } finally {
    if (ticket === requestNumber) {
      inFlight = null;
      $("refresh").classList.remove("busy");
    }
  }
  render();
}

function selectPeriod(wanted) {
  if (wanted === period) return;
  period = wanted;
  save(PERIOD_KEY, period);
  picked = pickedState = problem = null;
  showPeriod(); // show what is already saved straight away, then update it
  render();
  if (config && (!fetchedAt || Date.now() - fetchedAt > 60000)) refresh();
}

/* ---------- Drawing ---------- */
function barList(list, rows, emptyText = "No visits yet") {
  if (!rows.length) { list.replaceChildren(el("p", emptyText, "empty")); return; }
  const max = Math.max(1, ...rows.map(r => r[1]));
  list.replaceChildren(...rows.map(([name, value]) => {
    const li = el("li"), track = el("span", undefined, "track"), fill = el("i");
    fill.style.width = (value / max) * 100 + "%";
    track.append(fill);
    li.append(el("span", name, "name"), track, el("b", num(value)));
    return li;
  }));
}

function drawChart() {
  const box = $("chart");
  const w = box.clientWidth, h = box.clientHeight;
  if (!w || !h) return;
  const pad = 18, top = 30, bottom = h - 22;
  const count = data.series.length;
  const max = Math.max(1, ...data.series.map(d => d[1])) * 1.1;
  const pts = data.series.map(([, v], i) => [
    count === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (count - 1),
    bottom - (v / max) * (bottom - top),
  ]);
  // Flat tangents at each point, so the smooth line never overshoots the real values.
  let line = `M${pts[0]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], mid = (x0 + x1) / 2;
    line += `C${mid},${y0} ${mid},${y1} ${x1},${y1}`;
  }
  const last = pts.length - 1;
  const shown = picked ?? last;
  const grid = [0, 0.5, 1].map(f => {
    const y = top + f * (bottom - top);
    return `<line x1="0" x2="${w}" y1="${y}" y2="${y}" style="stroke:var(--grid)"/>`;
  }).join("");
  // Day labels are made by this app (never copied from the reply), so they are safe to place in the markup.
  // With many points, only every few get a label, counted back from the latest so they never collide.
  const every = Math.max(1, Math.ceil((count - 1) / Math.max(1, Math.floor((w - pad * 2) / 46))));
  const labels = data.series.map(([d], i) => ((last - i) % every ? "" :
    `<text x="${pts[i][0]}" y="${h - 4}" text-anchor="middle"${i === shown ? ' class="on"' : ""}>${d}</text>`)).join("");
  box.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:var(--blue);stop-opacity:.32"/><stop offset="1" style="stop-color:var(--blue);stop-opacity:0"/>
    </linearGradient></defs>
    ${grid}
    <path d="${line}L${pts[last][0]},${bottom}L${pts[0][0]},${bottom}Z" fill="url(#fade)"/>
    <path d="${line}" fill="none" stroke-width="2.5" stroke-linecap="round" style="stroke:var(--blue)"/>
    ${picked === null ? "" : `<line x1="${pts[shown][0]}" x2="${pts[shown][0]}" y1="${top - 4}" y2="${bottom}" style="stroke:var(--muted)"/>`}
    <circle cx="${pts[shown][0]}" cy="${pts[shown][1]}" r="5.5" stroke-width="2" style="fill:var(--blue);stroke:var(--card)"/>
    ${labels}</svg>`;
  if (picked !== null) {
    const tip = el("div", `${data.series[shown][2]} · ${visitorText(data.series[shown][1])}`, "tip");
    box.append(tip);
    const half = tip.offsetWidth / 2;
    tip.style.left = Math.min(w - half, Math.max(half, pts[shown][0])) + "px";
  }
}

function pickAt(clientX) {
  const r = $("chart").getBoundingClientRect();
  const last = data.series.length - 1;
  const step = last ? (r.width - 36) / last : 1;
  picked = Math.min(last, Math.max(0, Math.round((clientX - r.left - 18) / step)));
  drawChart();
}
const clearPick = () => { picked = null; drawChart(); };

// Visitor map: one hue, stronger colour = more visitors. Grey = none.
const SMALL = ["Kuala Lumpur", "Putrajaya", "Labuan"]; // too small to see or tap without a marker

function drawMap() {
  const counts = new Map(data.states);
  const max = Math.max(1, ...counts.values());
  const paint = name => {
    const v = counts.get(name) || 0;
    // square root, so states with only a few visitors still show up
    return v ? `style="fill:var(--blue);fill-opacity:${(0.2 + 0.8 * Math.sqrt(v / max)).toFixed(2)}"` : 'style="fill:var(--grid)"';
  };
  for (const [id, group] of [["mapPeninsula", MAP.peninsula], ["mapEast", MAP.east]]) {
    const shapes = group.states.map(s => `<path d="${s.d}" data-state="${s.name}" ${paint(s.name)}/>`).join("");
    const chosen = group.states.find(s => s.name === pickedState);
    // A solid backing under each marker keeps its see-through shade from mixing with the state behind it.
    const markers = group.states.filter(s => SMALL.includes(s.name)).map(s => {
      const [cx, cy] = s.at, on = s.name === pickedState;
      return `<circle cx="${cx}" cy="${cy}" r="24" style="fill:var(--card)"/>
        <circle cx="${cx}" cy="${cy}" r="21" data-state="${s.name}" class="marker${on ? " on" : ""}" ${paint(s.name)}/>`;
    }).join("");
    $(id).innerHTML = `<svg viewBox="-30 -30 ${group.w + 60} ${group.h + 60}" role="img" aria-label="Visitors by state">
      ${shapes}${chosen ? `<path d="${chosen.d}" class="outline"/>` : ""}${markers}</svg>`;
  }
  const top = [...data.states].sort((a, b) => b[1] - a[1])[0];
  const name = pickedState ?? top?.[0];
  if (name === undefined) {
    $("mapPick").textContent = data.blank ? "Waiting for data" : "No visits located yet";
    return;
  }
  const value = pickedState ? counts.get(pickedState) || 0 : top[1];
  $("mapPick").replaceChildren(el("b", name), ` · ${visitorText(value)}${pickedState ? "" : " (most)"}`);
}

function selectState(name) {
  pickedState = name === pickedState ? null : name;
  drawMap();
}

function renderGeo() {
  const sorted = [...data.states].sort((a, b) => b[1] - a[1]);
  barList($("states"), sorted.slice(0, 5), data.blank ? "" : "No Malaysian states yet");
  [...$("states").querySelectorAll("li")].forEach((li, i) => {
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.addEventListener("click", () => selectState(sorted[i][0]));
    li.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectState(sorted[i][0]); }
    });
  });
  const outside = data.countries.map(([c, v]) => `${c} ${num(v)}`).join(" · ") || (data.blank ? "–" : "none");
  $("countries").textContent = "Outside Malaysia: " + outside +
    (data.stateUnknown ? ` · Malaysia, state unknown: ${num(data.stateUnknown)}` : "");
  $("geoTable").replaceChildren(...[...sorted, ...data.countries].map(([n, v]) => {
    const tr = el("tr");
    tr.append(el("th", n), el("td", num(v)));
    return tr;
  }));
  drawMap();
}

function clock(time) {
  const when = new Date(time);
  const options = { hour: "numeric", minute: "2-digit" };
  if (when.toDateString() !== new Date().toDateString()) Object.assign(options, { day: "numeric", month: "short" });
  return when.toLocaleString("en-MY", options);
}

function renderStatus() {
  const status = $("updated");
  status.classList.toggle("problem", Boolean(config && problem));
  if (!config) status.textContent = "Sample data";
  else if (problem) status.textContent = fetchedAt ? `Not updated · data from ${clock(fetchedAt)}` : "Not updated";
  else status.textContent = fetchedAt ? "Updated " + clock(fetchedAt) : "Connecting…";

  let note = "Sample data, not your real numbers";
  if (config) {
    note = problem ?? "Live from Google Analytics";
    // "Today" follows the time zone set in the Analytics property.
    if (!problem && data.timeZone && !/^Asia\/(Kuala_Lumpur|Kuching|Singapore)$/.test(data.timeZone)) {
      note += ` · Analytics time zone is ${data.timeZone}, not Malaysia`;
    }
  }
  $("mode").textContent = note;
  $("connectCta").hidden = Boolean(config);
}

function render() {
  const { short, hero } = PERIODS[period];
  for (const button of $("periods").children) button.setAttribute("aria-pressed", String(button.dataset.period === period));
  $("visitorsLabel").textContent = hero;
  $("chart").setAttribute("aria-label", "Chart of " + hero);
  $("topTitle").textContent = `Top pages, ${short}`;
  $("sourcesTitle").textContent = `Sources, ${short}`;
  $("mapTitle").textContent = `Visitor map, ${short} · stronger blue means more`;
  $("waTitle").textContent = `WhatsApp clicks by button, ${short}`;
  renderGeo();
  for (const k of ["activeNow", "visitorsToday", "whatsappToday", "tiktokToday", "visitors"]) $(k).textContent = num(data[k]);
  const quiet = data.blank ? "" : "No visits yet";
  barList($("topPages"), data.topPages, quiet);
  barList($("sources"), data.sources, quiet);
  $("waButtons").replaceChildren(...(data.waButtons ?? []).map(([name, v]) => {
    const li = el("li", name);
    li.append(el("b", num(v)));
    return li;
  }));
  const waNote = data.waButtons === null ? "To see this, add button_area as a custom dimension in Google Analytics."
    : data.waButtons.length || data.blank ? "" : "No WhatsApp clicks yet";
  $("waNote").textContent = waNote;
  $("waNote").hidden = !waNote;
  $("chartTable").replaceChildren(...data.series.map(([d, v, long]) => {
    const tr = el("tr");
    tr.append(el("th", long || d), el("td", num(v)));
    return tr;
  }));
  renderStatus();
  drawChart();
}

/* ---------- Connection sheet ---------- */
const sheet = $("sheet");
const formStatus = (text, isProblem = false) => {
  $("formStatus").textContent = text;
  $("formStatus").classList.toggle("problem", isProblem);
};

function openSheet() {
  $("feedUrl").value = config?.url ?? "";
  $("feedKey").value = "";
  $("feedKey").placeholder = config ? "Saved. Leave empty to keep it" : "";
  $("disconnect").hidden = !config;
  formStatus("");
  sheet.showModal();
}

$("connectForm").addEventListener("submit", async e => {
  e.preventDefault();
  const url = $("feedUrl").value.trim();
  const key = $("feedKey").value.trim() || config?.key || "";
  if (!FEED_URL.test(url)) return formStatus("Paste the web app address. It starts with https://script.google.com/ and ends in /exec.", true);
  if (!key) return formStatus("Paste the secret key.", true);
  $("connect").disabled = true;
  formStatus("Connecting… this can take a few seconds.");
  const wanted = period;
  try {
    const fresh = await callFeed({ url, key }, wanted);
    if (!sheet.open) return; // cancelled while waiting
    stopWaiting();
    config = { url, key };
    saved = { [wanted]: { data: fresh, fetchedAt: Date.now() } };
    picked = pickedState = problem = null;
    if (!save(CONFIG_KEY, config)) problem = "Connected, but this browser won't remember it after you close the app.";
    save(DATA_KEY, saved);
    showPeriod();
    sheet.close();
    render();
  } catch (err) {
    formStatus(err instanceof FeedError ? err.message : "Something went wrong while connecting.", true);
  } finally {
    $("connect").disabled = false;
  }
});

$("disconnect").addEventListener("click", () => {
  stopWaiting();
  config = null;
  saved = {};
  save(CONFIG_KEY, null);
  save(DATA_KEY, null);
  picked = pickedState = problem = null;
  showPeriod();
  sheet.close();
  render();
});
$("closeSheet").addEventListener("click", () => sheet.close());
sheet.addEventListener("close", () => { $("feedKey").value = ""; });
$("settings").addEventListener("click", openSheet);
$("connectCta").addEventListener("click", openSheet);

/* ---------- Events ---------- */
for (const id of ["mapPeninsula", "mapEast"]) {
  $(id).addEventListener("click", e => {
    const hit = e.target.closest("[data-state]");
    if (hit) selectState(hit.dataset.state);
  });
}

$("periods").addEventListener("click", e => {
  const button = e.target.closest("[data-period]");
  if (button) selectPeriod(button.dataset.period);
});

const chart = $("chart");
chart.addEventListener("pointermove", e => pickAt(e.clientX));
chart.addEventListener("pointerdown", e => pickAt(e.clientX));
chart.addEventListener("pointerleave", clearPick);
chart.addEventListener("blur", clearPick);
chart.addEventListener("keydown", e => {
  const move = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
  if (!move) return;
  e.preventDefault();
  picked = Math.min(data.series.length - 1, Math.max(0, (picked ?? data.series.length - 1) + move));
  drawChart();
});
new ResizeObserver(drawChart).observe(chart);

// Update on opening or returning to the app, and every 5 minutes while it is on screen.
$("refresh").addEventListener("click", refresh);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && (!fetchedAt || Date.now() - fetchedAt > 60000)) refresh();
});
setInterval(() => { if (config && !document.hidden) refresh(); }, 5 * 60000);

// Screen size readout: tells us what the unfolded and folded screens really give the app.
const showSize = () => { $("screenSize").textContent = `Screen ${innerWidth} × ${innerHeight}`; };
addEventListener("resize", showSize);
showSize();

// Install help. Android Chrome offers a button; iPhone has to use the Share menu.
const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent);
let installPrompt = null;
if (!installed && isApple) {
  $("installHint").textContent = "To install: Safari → Share → Add to Home Screen";
  $("installHint").hidden = false;
}
addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  installPrompt = e;
  $("install").hidden = false;
});
$("install").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("install").hidden = true;
});
addEventListener("appinstalled", () => { $("install").hidden = true; });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
render();
refresh();
