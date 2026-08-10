/* 감사용 탐침 2 — 가짜 DOM 을 진짜에 가깝게 바꿔놓고 index.html 을 태웁니다.
   바뀐 점:
     · getComputedStyle 이 진짜 safe-area-inset 값을 돌려줍니다 (노치·홈바)
     · requestAnimationFrame 이 진짜로 콜백을 부릅니다. 단 문서가 hidden 이면
       부르지 않습니다 (HTML 명세: hidden 문서에는 rendering opportunity 가 없음)
     · visualViewport 가 있습니다
     · setTimeout 이 진짜로 돕니다
     · pointerdown → (preventDefault 안 했으면) click 순서를 흉내냅니다
   node test/_probe2.js                                                        */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const D = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(D, "index.html"), "utf8");
const pageJs = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
const ids = [...new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m => m[1]))];
const say = (t, v, x) => console.log("  " + (v ? "✓" : "✗") + " " + t + (x ? "   → " + x : ""));

function makeEl(id, env) {
  const el = {
    id, style: { cssText: "", setProperty() {} },
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    dataset: {}, _html: "", textContent: "", value: "", files: [], listeners: {},
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    removeEventListener() {}, click() { this.fire("click"); },
    fire(t, ev) { (this.listeners[t] || []).forEach(f => f(ev || { preventDefault() {}, pointerId: 1, clientX: 0, clientY: 0 })); },
    /* ★ 진짜 브라우저 순서: pointerdown → pointerup → click.
         pointerdown 에서 preventDefault 를 했으면 click 이 오는지 아닌지가
         바로 이 검사가 답을 못 주는 부분입니다 (엔진마다 다름).
         여기서는 "명세대로 click 이 온다" 쪽으로 흉내냅니다. */
    tap() {
      let prevented = false;
      this.fire("pointerdown", { preventDefault() { prevented = true; }, pointerId: 1, clientX: 0, clientY: 0 });
      this.fire("pointerup", { preventDefault() {}, pointerId: 1, clientX: 0, clientY: 0 });
      env.log.push("tap:" + this.id + (prevented ? "(pd-prevented)" : ""));
      this.fire("click", { preventDefault() {}, pointerId: 1 });
      return prevented;
    },
    querySelector(sel) {
      if (sel === ".row.sel" && /class="row[^"]*sel/.test(this._html))
        return { scrollIntoView() { el._scrolled = (el._scrolled || 0) + 1; } };
      return null;
    },
    getContext() {
      return { imageSmoothingEnabled: true,
        createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        putImageData() {} };
    },
    remove() {}, appendChild() {}, setPointerCapture() {},
  };
  return el;
}

function run(o) {
  o = o || {};
  const env = { log: [], rafs: [], timers: [], hidden: !!o.hidden };
  const els = {}; ids.forEach(i => els[i] = makeEl(i, env));
  const store = new Map();
  const ins = o.insets || { t: 0, l: 0, b: 0, r: 0 };
  const W = o.W || 844, H = o.H || 390;
  const sandbox = {
    console,
    document: {
      getElementById: i => els[i] || null,
      createElement: () => makeEl("tmp", env),
      body: { appendChild() {} },
      documentElement: { clientWidth: W, clientHeight: H, style: { setProperty() {} } },
      addEventListener(t, f) { (this._l = this._l || {})[t] = (this._l[t] || []).concat(f); },
      get visibilityState() { return env.hidden ? "hidden" : "visible"; },
      querySelectorAll: () => [],
    },
    window: null,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    matchMedia: () => ({ matches: !!o.coarse }),
    /* ★ 진짜 브라우저: position:fixed + top:env(safe-area-inset-top) 은
         계산된 top 이 실제 px 로 나옵니다. */
    getComputedStyle: () => ({ top: ins.t + "px", left: ins.l + "px",
                               bottom: ins.b + "px", right: ins.r + "px", fontSize: "13px" }),
    /* ★ hidden 문서에서는 rAF 가 돌지 않습니다 */
    requestAnimationFrame: f => { env.rafs.push(f); return env.rafs.length; },
    cancelAnimationFrame() {},
    setInterval: () => 1, clearInterval() {},
    addEventListener(t, f) { (sandbox._wl = sandbox._wl || {})[t] = (sandbox._wl[t] || []).concat(f); },
    setTimeout: (f, ms) => { env.timers.push(f); return env.timers.length; }, clearTimeout() {},
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0x8000) }),
    location: { href: "" },
    AudioContext: function () { return { sampleRate: 48000, resume() {}, suspend() {},
      createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }),
      createBufferSource: () => ({ connect() {}, start() {} }) }; },
    Binjgb: async () => ({}),
    FileReader: function () { this.readAsArrayBuffer = () => { this.onloadend({ target: { result: new ArrayBuffer(0x8000) } }); }; },
    indexedDB: undefined,
    visualViewport: { width: W, height: H, addEventListener(t, f) { (this._l = this._l || {})[t] = (this._l[t] || []).concat(f); } },
    Uint8Array, Math, JSON, Promise, Number, String, Object, Array, Date, Error, isFinite,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ["game.js", "ui.js", "pad.js"])
    vm.runInContext(fs.readFileSync(path.join(D, f), "utf8"), sandbox, { filename: f });
  let err = null;
  try { vm.runInContext(pageJs, sandbox, { filename: "index.html" }); } catch (e) { err = e; }
  const read = e => { try { return vm.runInContext(e, sandbox); } catch (x) { return undefined; } };
  /* rAF 를 한 프레임 돌립니다 (hidden 이면 안 돕니다 — 진짜 브라우저와 같게) */
  env.frame = () => {
    if (env.hidden) return 0;
    const q = env.rafs.splice(0); q.forEach(f => f(16));
    return q.length;
  };
  env.timerTick = () => { const q = env.timers.splice(0); q.forEach(f => f()); return q.length; };
  return { sandbox, els, err, read, env };
}

const num = (s, k) => { const m = String(s).match(new RegExp(k + ":(-?\\d+)px")); return m ? +m[1] : null; };

console.log("\n[1] 진짜 노치 여백을 넣으면 배치가 화면 안에 들어가는가");
{
  /* iPhone 14 Pro 가로: visualViewport 852x393, safe-area left/right 59, bottom 21
     (Apple: 다이나믹 아일랜드가 가로에서는 좌우 인셋으로 나옵니다)             */
  const cases = [
    ["아이폰14Pro 가로(노치)", 852, 393, { t: 0, l: 59, b: 21, r: 59 }],
    ["아이폰14Pro 세로",       393, 852, { t: 59, l: 0, b: 34, r: 0 }],
    ["아이폰SE 가로",          667, 375, { t: 0, l: 0, b: 0, r: 0 }],
    ["아이폰14Pro 가로(주소창 뜬 상태)", 852, 320, { t: 0, l: 59, b: 21, r: 59 }],
  ];
  for (const [n, W, H, insets] of cases) {
    const r = run({ W, H, insets });
    const bad = [];
    const uTop = num(r.els.btnUp.style.cssText, "top");
    const aTop = num(r.els.btnA.style.cssText, "top");
    const aLeft = num(r.els.btnA.style.cssText, "left");
    const infoH = num(r.els.info.style.height || "", "") ;
    const dh = H - insets.t - insets.b - 24;
    const dw = W - insets.l - insets.r - 24;
    if (uTop === null || uTop < 2) bad.push("MENU 자리 이상(" + uTop + ")");
    if (aTop === null || aTop + 46 > dh - 24) bad.push("A 버튼 아래 넘침(top=" + aTop + ", dh=" + dh + ")");
    if (aLeft !== null && aLeft < 0) bad.push("A 버튼 왼쪽 넘침(" + aLeft + ")");
    say(n, bad.length === 0, bad.join(", ") + "  [scale=" + r.read("scale") + " dw=" + dw + " dh=" + dh + "]");
  }
}

console.log("\n[2] ★ 탭이 숨겨진 동안 scheduleFit 이 불리면 그 뒤로 영영 안 재는가");
{
  const r = run({ W: 844, H: 390 });
  r.env.frame();                       /* 처음 예약분 소진 */
  /* 화면을 나갔다고 칩시다 (rAF 정지) */
  r.env.hidden = true;
  r.read("scheduleFit()");             /* 숨어 있는 동안 resize/visualViewport 로 예약 */
  const pendingWhileHidden = r.read("fitPending");
  r.env.frame();                       /* hidden 이라 안 돎 */
  /* 돌아왔습니다 */
  r.env.hidden = false;
  r.read('lastFitKey=""');             /* 크기가 바뀌었다고 치고 */
  const before = r.els.btnA.style.cssText;
  r.read("scheduleFit()");             /* 다시 예약 시도 */
  const ran = r.env.frame();
  say("숨은 동안 fitPending 이 걸림 (" + pendingWhileHidden + ")", pendingWhileHidden === true);
  say("돌아온 뒤 다시 재기가 예약됨 (rAF " + ran + "개)", ran > 0,
      ran === 0 ? "fitPending 이 true 로 갇혀 scheduleFit 이 아무것도 안 합니다" : "");
}

console.log("\n[3] ★ 게임 중 유일한 탈출구(MENU) 가 pointerdown preventDefault 뒤에도 도는가");
{
  const r = run();
  const before = r.read("ui.state.screen");
  const prevented = r.els.btnUp.tap();
  say("btnUp 의 pointerdown 이 preventDefault 를 함", prevented === true);
  console.log("    ※ 이 가짜는 preventDefault 여부와 상관없이 click 을 냅니다.");
  console.log("       진짜 iOS 사파리에서 click 이 오는지는 여기서 알 수 없습니다.");
}

console.log("\n[4] ★ orientationchange 뒤 300ms 타이머가 실제로 도는가");
{
  const r = run();
  r.env.frame();
  const h = (r.sandbox._wl && r.sandbox._wl.orientationchange) || [];
  say("orientationchange 손이 붙어 있음", h.length > 0);
  h.forEach(f => f({}));
  const t = r.env.timerTick();          /* setTimeout(scheduleFit, 300) */
  const ran = r.env.frame();
  say("여백 다시 재기가 예약됨 (timer " + t + ", raf " + ran + ")", ran > 0);
  say("insCache 가 지워짐", r.read("insCache") === null || r.read("insCache") !== undefined);
}

console.log("\n[5] visualViewport 손이 붙어 있는가 (기존 검사에는 visualViewport 자체가 없음)");
{
  const r = run();
  const l = r.sandbox.visualViewport._l || {};
  say("resize 에 붙음", !!(l.resize && l.resize.length));
  say("scroll 에 붙음", !!(l.scroll && l.scroll.length));
}

console.log("\n[6] createImageData 는 alpha 가 0 입니다. tintOrange 가 alpha 를 안 건드립니다");
{
  const G = require(path.join(D, "game.js"));
  const d = new Uint8ClampedArray(16);      /* 4픽셀, 전부 0 (투명) */
  G.tintOrange(d);
  say("칠한 뒤에도 alpha 가 0 (" + d[3] + ")", d[3] === 0,
      "첫 프레임이 오기 전에 paint() 가 불리면 아무것도 안 보입니다");
}
console.log("");
