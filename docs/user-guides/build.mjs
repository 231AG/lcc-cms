// Builds the three step-by-step guides (Student, Admin, Super Admin) as printable HTML
// and renders each to a PDF with Chromium.
//
//   node docs/user-guides/build.mjs
//
// Content lives in ./content/*.mjs (one file per role). Every button, field and menu
// name in the text is taken from the screens themselves, so the guide and the
// application say the same words.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Lucide from "lucide-react";
import { chromium } from "playwright";
import { existsSync } from "node:fs";

// The sandbox ships Chromium outside Playwright's default cache; use it when present.
const SANDBOX_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "source");
mkdirSync(out, { recursive: true });

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Lucide icon as inline SVG (same icon set the application uses). */
export function icon(name, size = 22, stroke = 2) {
  const C = Lucide[name];
  if (!C) throw new Error(`unknown icon ${name}`);
  return renderToStaticMarkup(createElement(C, { size, strokeWidth: stroke, "aria-hidden": true }));
}

/** Tiny inline markup: [[Button]] ((Secondary button)) {{Field or label}} **bold** `Value`. */
export function rich(text) {
  // Short chips stay on one line; a long button name (e.g. "Approve checked (or all, if none checked)") may wrap.
  const chip = (cls) => (_, t) => `<span class="${cls}${t.length > 26 ? "" : " nw"}">${t}</span>`;
  return esc(text)
    .replace(/\[!(.+?)!\]/g, chip("b-danger"))
    .replace(/\[\[(.+?)\]\]/g, chip("b-primary"))
    .replace(/\(\((.+?)\)\)/g, chip("b-second"))
    .replace(/\{\{(.+?)\}\}/g, chip("b-field"))
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

const fontCss = `
@font-face{font-family:"Plus Jakarta Sans";font-weight:200 800;src:url("../assets/jakarta-latin-ext.woff2") format("woff2");unicode-range:U+100-2BA,U+2BD-2C5,U+2C7-2CC,U+2CE-2D7,U+2DD-2FF,U+304,U+308,U+329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:"Plus Jakarta Sans";font-weight:200 800;src:url("../assets/jakarta-latin.woff2") format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
`;

const css = `
${fontCss}
:root{
  --o50:#f5f2ff;--o100:#ebe5ff;--o200:#d9cdff;--o300:#bda6fb;--o400:#8b5cf6;--o500:#7440e0;--o600:#5f2ac4;--o700:#4e2199;--o800:#3b1a7e;--o900:#2a1259;
  --gold:#f2c661;--gold-d:#7d6110;--honey:#fff7d6;--honey-line:#e9d27a;
  --ink:#1c1b22;--muted:#5b5868;--line:#e4e0ee;--ok:#1f7a45;--ok-bg:#e6f5ec;--bad:#b3261e;--bad-bg:#fdeceb;--wait:#8a5a00;--wait-bg:#fff1d6;--grey-bg:#efeef3;
}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{word-spacing:.03em;margin:0;font-family:"Plus Jakarta Sans","Liberation Sans",Arial,sans-serif;color:var(--ink);font-size:10.4pt;line-height:1.42;background:#fff}
@page{size:A4;margin:11mm 13mm 15mm 13mm}
svg{flex:none;display:block}

/* ---------- cover ---------- */
.cover{border-radius:16px;overflow:hidden;background:linear-gradient(120deg,var(--o900),var(--o700) 55%,var(--o600));color:#fff;padding:18px 22px 16px;display:grid;grid-template-columns:62px 1fr;gap:18px;align-items:center;position:relative;break-inside:avoid}
.cover::after{content:"";position:absolute;right:-40px;top:-60px;width:210px;height:210px;border-radius:50%;background:rgba(242,198,97,.16)}
.cover::before{content:"";position:absolute;right:60px;bottom:-70px;width:150px;height:150px;border-radius:50%;background:rgba(255,255,255,.07)}
.cover img{width:62px;height:auto;background:#fff;border-radius:12px;padding:5px}
.cover .kicker{font-size:8.6pt;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);font-weight:700}
.cover h1{margin:2px 0 3px;font-size:23pt;line-height:1.1;font-weight:800;letter-spacing:-.01em}
.cover p{margin:0;font-size:10.4pt;color:#e6defb;max-width:128mm}
.role-pill{display:inline-flex;align-items:center;gap:6px;margin-top:9px;background:var(--gold);color:#33280a;font-weight:800;font-size:8.8pt;border-radius:99px;padding:3px 11px 3px 8px}

.panel{margin-top:11px;border:1px solid var(--line);border-radius:14px;padding:11px 14px 12px;break-inside:avoid;background:#fff}
.panel h2{margin:0 0 8px;font-size:10.6pt;font-weight:800;color:var(--o800);display:flex;align-items:center;gap:7px}
.menu-groups{display:flex;flex-wrap:wrap;gap:8px 14px}
.menu-group{min-width:0}
.menu-group .gl{font-size:7.6pt;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:3px}
.menu-group .items{display:flex;flex-wrap:wrap;gap:4px}
.mi{display:inline-flex;align-items:center;gap:5px;background:var(--o50);border:1px solid var(--o200);color:var(--o800);border-radius:8px;padding:3px 8px 3px 6px;font-weight:600;font-size:8.8pt}
.mi svg{color:var(--o600)}
.two{display:grid;grid-template-columns:1fr;gap:0}
.facts{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:5px 18px}
.facts li{display:flex;gap:8px;align-items:flex-start;font-size:9.4pt}
.facts li svg{color:var(--o600);margin-top:2px}

/* ---------- task ---------- */
.task{margin-top:12px;border:1.5px solid var(--o200);border-radius:16px;overflow:hidden;break-inside:avoid;background:#fff}
.task-head{display:flex;align-items:center;gap:12px;padding:8px 14px;background:linear-gradient(90deg,var(--o50),#fff)}
.num{width:34px;height:34px;border-radius:50%;background:var(--gold);color:#33280a;font-weight:800;font-size:15pt;display:grid;place-items:center;flex:none;box-shadow:0 0 0 4px #fbeec6}
.task-head h3{margin:0;font-size:13.4pt;line-height:1.18;font-weight:800;color:var(--o800)}
.task-head .goal{margin:1px 0 0;color:var(--muted);font-size:9.2pt}
.where{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:5px 14px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#fcfbff;font-size:8.8pt}
.where .lbl{font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:7.4pt;margin-right:3px}
.where .crumb{display:inline-flex;align-items:center;gap:4px;font-weight:700;color:var(--o800);background:var(--o100);border-radius:6px;padding:1px 7px}
.where .sep{color:var(--o400);display:inline-flex}
.where .when{margin-left:auto;color:var(--muted)}
.steps{display:grid;gap:10px 20px;padding:11px 14px 10px}
.steps.c2{grid-template-columns:repeat(2,minmax(0,1fr))}
.steps.c3{grid-template-columns:repeat(3,minmax(0,1fr))}
.step{position:relative;border:1px solid var(--line);border-radius:12px;padding:7px 9px 8px;background:#fff;min-width:0}
.step .top{display:flex;align-items:center;gap:7px;margin-bottom:3px}
.step .n{width:22px;height:22px;border-radius:50%;background:var(--o600);color:#fff;font-weight:800;font-size:9.4pt;display:grid;place-items:center;flex:none}
.step .ic{width:30px;height:30px;border-radius:9px;background:var(--o50);color:var(--o600);display:grid;place-items:center;margin-left:auto;flex:none}
.step h4{margin:0;font-size:10pt;line-height:1.2;font-weight:800;color:var(--ink)}
.step p{margin:0;color:#34313f;font-size:8.8pt;line-height:1.32}
.step p + p{margin-top:4px}
.step:not(.row-end)::after{content:"";position:absolute;right:-17px;top:50%;width:14px;height:14px;transform:translateY(-50%);background:no-repeat center/contain url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b5cf6' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><path d='m9 18 6-6-6-6'/></svg>")}
.step.finish{border-color:#9bd3b0;background:#f6fcf8}
.step.finish .n{background:var(--ok)}
.step.finish .ic{background:var(--ok-bg);color:var(--ok)}

.b-primary,.b-second,.b-field,.b-danger{display:inline;font-weight:700;font-size:8.6pt;line-height:1.5;border-radius:6px;padding:1.5px 7px;vertical-align:baseline;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.nw{white-space:nowrap}
.b-primary{background:var(--o600);color:#fff}
.b-danger{background:var(--bad);color:#fff}
.b-second{background:#fff;color:var(--o700);border:1px solid var(--o300)}
.b-field{background:#fff;color:var(--ink);border:1px dashed #9a95ad;border-radius:5px}
code{font-family:"DejaVu Sans Mono","Liberation Mono",monospace;font-size:8.6pt;background:var(--grey-bg);border-radius:4px;padding:0 4px}
strong{font-weight:800}

/* ---------- flow ---------- */
.flow{margin:0 14px 10px;border:1px dashed var(--o300);border-radius:12px;padding:8px 10px 9px;background:#fcfbff}
.flow .ft{font-size:7.8pt;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin-bottom:6px;display:flex;align-items:center;gap:6px}
.flow-row{display:flex;align-items:stretch;gap:0;flex-wrap:nowrap}
.fn{flex:1 1 0;min-width:0;align-self:center;border-radius:10px;padding:5px 7px;text-align:center;border:1px solid transparent}
.fn b{display:block;font-size:9.4pt;line-height:1.15}
.fn span{display:block;font-size:7.8pt;line-height:1.25;margin-top:2px;opacity:.92}
.fn.grey{background:var(--grey-bg);color:#3a3846;border-color:#d9d7e2}
.fn.wait{background:var(--wait-bg);color:var(--wait);border-color:#efd08c}
.fn.ok{background:var(--ok-bg);color:var(--ok);border-color:#a9d9bd}
.fn.bad{background:var(--bad-bg);color:var(--bad);border-color:#f0b9b5}
.fn.brand{background:var(--o100);color:var(--o800);border-color:var(--o300)}
.branch .fn{align-self:stretch}
.fa{flex:none;width:18px;display:grid;place-items:center;color:var(--o400)}
.fa svg{width:14px;height:14px}
.branch{display:flex;flex-direction:column;gap:4px;flex:1 1 0;min-width:0;align-self:center}

/* ---------- callouts ---------- */
.notes{display:grid;gap:5px;padding:0 14px 10px}
.note{display:flex;gap:8px;align-items:flex-start;border-radius:10px;padding:5px 10px;font-size:8.7pt;line-height:1.34}
.note svg{margin-top:1px}
.note.tip{background:var(--o50);border:1px solid var(--o200);color:#2d2347}
.note.tip svg{color:var(--o600)}
.note.warn{background:var(--honey);border:1px solid var(--honey-line);color:#4a3f00}
.note.warn svg{color:var(--gold-d)}
.note.no{background:var(--bad-bg);border:1px solid #f0b9b5;color:#6b1a15}
.note.no svg{color:var(--bad)}

.finder{margin-top:11px;border:1px solid var(--line);border-radius:14px;padding:10px 14px 11px;break-inside:avoid}
.finder h2{margin:0 0 7px;font-size:10.6pt;font-weight:800;color:var(--o800);display:flex;align-items:center;gap:7px}
.finder ol{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:5px 18px}
.finder li{display:flex;gap:8px;align-items:flex-start;font-size:9pt;line-height:1.3}
.finder li .fnum{width:19px;height:19px;border-radius:50%;background:var(--gold);color:#33280a;font-weight:800;font-size:8.4pt;display:grid;place-items:center;flex:none;margin-top:1px}
.finder li b{display:block;font-weight:800}
.finder li span.p{color:var(--muted);font-size:8.2pt}
.footer-note{margin-top:14px;display:flex;gap:9px;align-items:center;border-radius:14px;background:var(--o800);color:#efe9ff;padding:10px 14px;font-size:9.3pt;break-inside:avoid}
.footer-note svg{color:var(--gold)}
.footer-note b{color:#fff}
`;

function stepsHtml(steps) {
  const cols = steps.length === 4 || steps.length === 2 ? 2 : 3;
  return `<div class="steps c${cols}">` + steps.map((s, i) => {
    const rowEnd = (i + 1) % cols === 0 || i === steps.length - 1;
    const cls = ["step", rowEnd ? "row-end" : "", s.finish ? "finish" : ""].filter(Boolean).join(" ");
    return `<div class="${cls}"><div class="top"><span class="n">${i + 1}</span><span class="ic">${icon(s.icon, 17)}</span></div><h4>${rich(s.title)}</h4>${[].concat(s.body).map((b) => `<p>${rich(b)}</p>`).join("")}</div>`;
  }).join("") + `</div>`;
}

function flowHtml(f) {
  if (!f) return "";
  const arrow = `<div class="fa">${icon("ChevronRight", 14, 3)}</div>`;
  const node = (n) => `<div class="fn ${n.tone ?? "grey"}"><b>${rich(n.label)}</b>${n.sub ? `<span>${rich(n.sub)}</span>` : ""}</div>`;
  const parts = f.nodes.map((n) => (Array.isArray(n) ? `<div class="branch">${n.map(node).join("")}</div>` : node(n)));
  return `<div class="flow"><div class="ft">${icon(f.icon ?? "Route", 13)} ${esc(f.title)}</div><div class="flow-row">${parts.join(arrow)}</div></div>`;
}

function notesHtml(notes) {
  if (!notes?.length) return "";
  const ic = { tip: "Lightbulb", warn: "TriangleAlert", no: "ShieldAlert" };
  return `<div class="notes">${notes.map((n) => `<div class="note ${n.kind}">${icon(ic[n.kind], 16)}<div>${rich(n.text)}</div></div>`).join("")}</div>`;
}

function taskHtml(t, i) {
  const path = t.path?.length
    ? `<div class="where"><span class="lbl">Where</span>${t.path.map((p, k) => `${k ? `<span class="sep">${icon("ChevronRight", 13, 3)}</span>` : ""}<span class="crumb">${k === t.path.length - 1 && t.pathIcon ? icon(t.pathIcon, 12) : ""}${esc(p)}</span>`).join("")}${t.when ? `<span class="when">${esc(t.when)}</span>` : ""}</div>`
    : "";
  return `<section class="task"><div class="task-head"><div class="num">${i + 1}</div><div><h3>${esc(t.title)}</h3><p class="goal">${esc(t.goal)}</p></div></div>${path}${stepsHtml(t.steps)}${flowHtml(t.flow)}${notesHtml(t.notes)}</section>`;
}

function menuHtml(groups) {
  return `<div class="menu-groups">${groups.map((g) => `<div class="menu-group">${g.label ? `<div class="gl">${esc(g.label)}</div>` : `<div class="gl">&nbsp;</div>`}<div class="items">${g.items.map(([n, ic]) => `<span class="mi">${icon(ic, 13)}${esc(n)}</span>`).join("")}</div></div>`).join("")}</div>`;
}

function finderHtml(tasks) {
  return `<section class="finder"><h2>${icon("Compass", 16)} Find your task</h2><ol>${tasks.map((t, i) => `<li><span class="fnum">${i + 1}</span><div><b>${esc(t.title)}</b><span class="p">${esc(t.path.join("  ▸  "))}</span></div></li>`).join("")}</ol></section>`;
}

function pageHtml(g) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(g.title)} — LCC E-Portal</title><style>${css}</style></head><body>
<header class="cover"><img src="../assets/lcc-logo.png" alt="Liberia Christian College seal"><div><div class="kicker">Liberia Christian College E-Portal</div><h1>${esc(g.title)}</h1><p>${esc(g.subtitle)}</p><span class="role-pill">${icon(g.roleIcon, 14)} ${esc(g.role)}</span></div></header>
<div class="two">
  <section class="panel"><h2>${icon("PanelLeft", 16)} Your menu</h2>${menuHtml(g.menu)}</section>
  <section class="panel"><h2>${icon("Info", 16)} Good to know</h2><ul class="facts">${g.facts.map((f) => `<li>${icon(f.icon, 15)}<span>${rich(f.text)}</span></li>`).join("")}</ul></section>
</div>
${g.finder ? finderHtml(g.tasks) : ""}
${g.tasks.map(taskHtml).join("\n")}
<div class="footer-note">${icon("LifeBuoy", 22)}<div>${rich(g.help)}</div></div>
</body></html>`;
}

const roles = ["student", "admin", "super-admin"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync(SANDBOX_CHROME) ? SANDBOX_CHROME : undefined) });
for (const r of roles) {
  const { default: g } = await import(`./content/${r}.mjs`);
  const html = pageHtml(g);
  const htmlPath = join(out, `${g.file}.html`);
  writeFileSync(htmlPath, html);
  const page = await browser.newPage();
  await page.goto("file://" + htmlPath, { waitUntil: "networkidle" });
  await page.pdf({
    path: join(here, `${g.file}.pdf`),
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5pt;color:#6b6879;padding:0 13mm;display:flex;justify-content:space-between"><span>Liberia Christian College E-Portal · ${g.title}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    margin: { top: "11mm", bottom: "15mm", left: "13mm", right: "13mm" },
  });
  await page.close();
  console.log("built", g.file);
}
await browser.close();
