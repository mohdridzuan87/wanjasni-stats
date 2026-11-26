// Phase 1: made-up numbers to test the layout. Live data replaces SAMPLE in phase 3.
// This site is public, so no Analytics data, keys or private addresses belong in these files.
const SAMPLE = {
  activeNow: 3, visitorsToday: 48, whatsappToday: 5, tiktokToday: 7,
  days: [["Fri", 31], ["Sat", 44], ["Sun", 52], ["Mon", 29], ["Tue", 36], ["Wed", 41], ["Today", 48]],
  visitors7: 281,
  topPages: [["Home", 162], ["Vios price", 57], ["Yaris price", 41], ["Hilux price", 28]],
  sources: [["TikTok", 146], ["Google", 63], ["Direct", 55], ["Other", 17]],
  waButtons: [["Floating", 14], ["Calculator", 9], ["Model card", 6], ["Other", 4]],
};

const $ = id => document.getElementById(id);
const num = n => n.toLocaleString("en-MY");
const el = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

let data = SAMPLE;
let picked = null; // index of the chart point being inspected

function barList(list, rows) {
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
  const max = Math.max(1, ...data.days.map(d => d[1])) * 1.1;
  const pts = data.days.map(([, v], i) => [
    pad + (i * (w - pad * 2)) / (data.days.length - 1),
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
  const labels = data.days.map(([d], i) =>
    `<text x="${pts[i][0]}" y="${h - 4}" text-anchor="middle"${i === shown ? ' class="on"' : ""}>${d}</text>`).join("");
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
    const tip = el("div", `${data.days[shown][0]} · ${num(data.days[shown][1])} visitors`, "tip");
    box.append(tip);
    const half = tip.offsetWidth / 2;
    tip.style.left = Math.min(w - half, Math.max(half, pts[shown][0])) + "px";
  }
}

function pickAt(clientX) {
  const r = $("chart").getBoundingClientRect();
  const step = (r.width - 36) / (data.days.length - 1);
  picked = Math.min(data.days.length - 1, Math.max(0, Math.round((clientX - r.left - 18) / step)));
  drawChart();
}
const clearPick = () => { picked = null; drawChart(); };

function render() {
  for (const k of ["activeNow", "visitorsToday", "whatsappToday", "tiktokToday", "visitors7"]) $(k).textContent = num(data[k]);
  barList($("topPages"), data.topPages);
  barList($("sources"), data.sources);
  $("waButtons").replaceChildren(...data.waButtons.map(([name, v]) => {
    const li = el("li", name);
    li.append(el("b", num(v)));
    return li;
  }));
  $("chartTable").replaceChildren(...data.days.map(([d, v]) => {
    const tr = el("tr");
    tr.append(el("th", d), el("td", num(v)));
    return tr;
  }));
  $("updated").textContent = "Updated " + new Date().toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit" });
  drawChart();
}

const chart = $("chart");
chart.addEventListener("pointermove", e => pickAt(e.clientX));
chart.addEventListener("pointerdown", e => pickAt(e.clientX));
chart.addEventListener("pointerleave", clearPick);
chart.addEventListener("blur", clearPick);
chart.addEventListener("keydown", e => {
  const move = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
  if (!move) return;
  e.preventDefault();
  picked = Math.min(data.days.length - 1, Math.max(0, (picked ?? data.days.length - 1) + move));
  drawChart();
});
new ResizeObserver(drawChart).observe(chart);

$("refresh").addEventListener("click", render);
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });

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
