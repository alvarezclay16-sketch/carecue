// Contrast and size rules of the simulated Echo screen (web/styles.css).
//   node tests/contrast.ts              static: reads the colour tokens of every theme x scene from the CSS (no server, no browser)
//   node tests/contrast.ts <baseUrl>    also loads ?scene=<kind> in Playwright for every scene, theme and language and checks
//                                       the computed colours of every visible text node, and its font size
// Rules: text/background contrast >= 7:1 (AAA); >= 4.5:1 for text of 56 px or more (the STOP word and the digits);
// every font size token is at least 36 px. Playwright is the copy installed under ../video/node_modules.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../web/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const sceneSrc = readFileSync(new URL("../src/scene.ts", import.meta.url), "utf8");

// ---------- WCAG contrast ----------
const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function lum(rgb: [number, number, number]) {
  const [r, g, b] = rgb.map((c) => lin(c / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function ratio(a: [number, number, number], b: [number, number, number]) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const hex = (h: string): [number, number, number] => {
  assert.match(h, /^#[0-9a-f]{6}$/i, `colour tokens must be #rrggbb: ${h}`);
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
};

// ---------- tokens per theme x scene ----------
const scenes = [...(sceneSrc.match(/export type Scene =([\s\S]*?);\n/)?.[1] ?? "").matchAll(/kind: "(\w+)"/g)].map((m) => m[1]);
assert.ok(scenes.length >= 10, `scene kinds read from src/scene.ts: ${scenes}`);

const tokens = new Map<string, Record<string, string>>();
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const body = Object.fromEntries([...m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
  for (const sel of m[1].split(",")) {
    const k = sel.match(/\[data-theme="(\w+)"\]\[data-scene="(\w+)"\]/);
    if (k) tokens.set(`${k[1]}/${k[2]}`, { ...(tokens.get(`${k[1]}/${k[2]}`) ?? {}), ...body });
  }
}

const PAIRS: Array<{ name: string; fg: string; bg: string; large: boolean }> = [
  { name: "text", fg: "--fg", bg: "--bg", large: false },
  { name: "primary button", fg: "--btn-fg", bg: "--btn-bg", large: false },
  { name: "second button", fg: "--alt-fg", bg: "--alt-bg", large: false },
  { name: "STOP word / digit tiles (>= 56 px)", fg: "--oct-fg", bg: "--oct-bg", large: true },
];
let worst = { r: 99, what: "" };
let n = 0;
for (const theme of ["day", "night"]) {
  for (const scene of scenes) {
    const t = tokens.get(`${theme}/${scene}`);
    assert.ok(t, `no colour tokens for theme ${theme}, scene ${scene}`);
    for (const p of PAIRS) {
      const r = ratio(hex(t[p.fg]), hex(t[p.bg]));
      const need = p.large ? 4.5 : 7;
      assert.ok(r >= need, `${theme}/${scene} ${p.name}: ${t[p.fg]} on ${t[p.bg]} is ${r.toFixed(2)}:1, needs ${need}:1`);
      if (r < worst.r) worst = { r, what: `${theme}/${scene} ${p.name}` };
      n++;
    }
  }
}
console.log(`ok: ${n} colour pairs (${scenes.length} scenes x 2 themes) all pass; lowest ${worst.r.toFixed(2)}:1 (${worst.what})`);

// ---------- font size tokens ----------
const sizes = [...css.matchAll(/--fs-[\w]+\s*:\s*([^;]+);/g)].map((m) => m[1]);
assert.ok(sizes.length >= 8, "font size tokens found");
for (const v of sizes) {
  const px = [...v.matchAll(/clamp\(\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  const plain = /^calc\(var\(--z\) \* (\d+)px\)$/.exec(v.trim());
  if (plain) px.push(Number(plain[1]));
  assert.ok(px.length > 0 && px.every((p) => p >= 36), `font token below 36 px: ${v}`);
}
console.log(`ok: ${sizes.length} font size tokens, all >= 36 px at 100%`);
assert.ok(/\.echo\s*\{[^}]*font-size:\s*var\(--fs-s\)/.test(css), "the screen's base font size is the 36 px token");
assert.ok(/prefers-reduced-motion:\s*reduce/.test(css), "prefers-reduced-motion is respected");
assert.ok(/focus-visible/.test(css), "visible focus ring");
console.log("ok: base font, reduced motion and focus ring present");

// ---------- computed colours in the real page ----------
const base = process.argv[2];
if (base) {
  const { chromium } = (await import(new URL("../../video/node_modules/playwright/index.mjs", import.meta.url).href)) as any;
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  const failures: string[] = [];
  let pairs = 0;
  for (const scene of scenes) for (const theme of ["day", "night"]) for (const lang of ["en", "es"]) {
    await page.goto(`${base}/?scene=${scene}&theme=${theme}&lang=${lang}`);
    await page.waitForFunction(() => document.getElementById("scene")?.children.length);
    await page.evaluate(() => document.fonts.ready);
    const rows: Array<{ text: string; fg: string; bg: string; px: number }> = await page.evaluate(() => {
      const echo = document.getElementById("echo")!;
      const bgOf = (el: Element | null) => {
        for (let e = el; e; e = e.parentElement) {
          const c = getComputedStyle(e).backgroundColor;
          const m = c.match(/rgba?\(([^)]+)\)/);
          if (m) { const p = m[1].split(",").map(Number); if (p.length < 4 || p[3] > 0.99) return c; }
        }
        return "rgb(255, 255, 255)";
      };
      const out: Array<{ text: string; fg: string; bg: string; px: number }> = [];
      const w = document.createTreeWalker(echo, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!n.nodeValue!.trim()) continue;
        const el = n.parentElement!;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs.display === "none" || cs.visibility === "hidden" || !r.width) continue;
        out.push({ text: n.nodeValue!.trim().slice(0, 24), fg: cs.color, bg: bgOf(el), px: parseFloat(cs.fontSize) });
      }
      for (const i of echo.querySelectorAll("input")) { const cs = getComputedStyle(i); out.push({ text: "<input>", fg: cs.color, bg: bgOf(i), px: parseFloat(cs.fontSize) }); }
      return out;
    });
    const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number) as [number, number, number];
    for (const r of rows) {
      pairs++;
      const c = ratio(rgb(r.fg), rgb(r.bg));
      const need = r.px >= 56 ? 4.5 : 7;
      if (c < need) failures.push(`${scene}/${theme}/${lang} "${r.text}" ${r.fg} on ${r.bg} = ${c.toFixed(2)}:1 at ${r.px}px (needs ${need})`);
      if (r.px < 36) failures.push(`${scene}/${theme}/${lang} "${r.text}" is ${r.px}px`);
    }
  }
  await browser.close();
  assert.equal(failures.length, 0, "computed contrast / size failures:\n" + failures.slice(0, 20).join("\n"));
  console.log(`ok: ${pairs} computed text pairs in the page (${scenes.length} scenes x 2 themes x 2 languages) pass`);
}
console.log("contrast: all passed");
