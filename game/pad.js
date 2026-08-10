/* ============================================================================
   터치 조작 — 4방향 십자키 + 버튼

   왼쪽 판에 십자키 "그림"은 그리지만 그건 안내일 뿐입니다.
   ★ 왼쪽 판 아무 데나 누르면 그 자리가 중심이 됩니다.
     그래서 엄지가 판을 벗어나 입력이 끊기는 일이 없습니다.

   [ 반드시 막아야 하는 여섯 가지 — LittleJS 소스에서 확인한 것 ]
   1. 손가락이 영역 밖으로 나가 끊김      → setPointerCapture
   2. 브라우저가 스크롤·확대로 가로챔      → touch-action:none (CSS)
   3. CSS 로 안 막히는 경우 (특히 iOS)    → {passive:false} + preventDefault
   4. 길게 눌러 선택·복사 메뉴            → contextmenu 막기 (CSS 는 index.html)
   5. 두 손 동시 조작이 꼬임              → 손가락마다 pointerId 로 따로
   6. ★ 전화 오면 키가 눌린 채 고착        → pointercancel 도 뗀 것으로

   6번을 빼먹으면 알림이 뜬 순간부터 캐릭터가 한 방향으로 계속 걸어갑니다.
   ========================================================================== */

"use strict";

/* ── 판정값 ────────────────────────────────────────────────────────────
   전부 근거가 있는 숫자입니다. 자세한 것은 GAME_ENGINE.md 9장.        */
const DEAD = 0.12;   /* 중심에서 12% 이내는 무시 — 엄지가 얹혀만 있어도 안 움직이게 */
const ON   = 0.55;   /* 55% 이상 밀어야 방향으로 침 */
const KEEP = 1.4;    /* 축을 바꾸려면 다른 축이 1.4배 커야 함 (= 45도에 ±10도 여유) */
const RADIUS = 56;   /* 이만큼 밀면 최대. 엄지가 편하게 닿는 거리 */

const DIRS = ["up", "down", "left", "right"];

/* 밀어낸 거리(dx,dy)를 4방향 하나로 바꿉니다.
   삼각함수 안 씁니다. 나눗셈 하나로 끝납니다.

   prev 를 넣으면 그 방향을 유지하려는 관성이 생깁니다.
   이게 대각선 근처에서 위↔오른쪽으로 덜덜 떨리는 걸 없앱니다. */
function toDir(dx, dy, radius, prev) {
  const r = radius || RADIUS;
  const nx = dx / r, ny = dy / r;
  const len = Math.sqrt(nx * nx + ny * ny);
  /* ★ 숫자가 아니면 방향 없음. 이걸 안 보면 NaN 이 "down" 으로 떨어집니다. */
  if (!Number.isFinite(len)) return null;
  if (len < DEAD) return null;
  if (len < ON) return prev || null;      /* 살짝 민 것으로는 방향을 안 바꿈 */

  const ax = Math.abs(nx), ay = Math.abs(ny);
  let horiz;
  if (prev === "left" || prev === "right")      horiz = !(ay > ax * KEEP);
  else if (prev === "up" || prev === "down")    horiz =  (ax > ay * KEEP);
  else                                          horiz =  (ax >= ay);
  return horiz ? (nx < 0 ? "left" : "right") : (ny < 0 ? "up" : "down");
}


/* ==========================================================================
   십자키
   ========================================================================== */

function Pad(opts) {
  this.o = opts || {};
  this.onPress = this.o.onPress || function () {};
  this.radius  = this.o.radius || RADIUS;

  this.stickId = null;     /* 이동을 맡은 손가락 번호 */
  this.origin  = null;     /* 그 손가락이 처음 닿은 자리 */
  this.dir     = null;     /* 지금 눌린 방향 */
  this.btnIds  = new Map();/* 손가락 번호 → 버튼 이름 */
  this.bound   = [];
}

Pad.prototype = {

  /* ── 방향 바꾸기. 옛 방향은 반드시 떼줍니다 ────────────────────────── */
  setDir(d) {
    if (d === this.dir) return;
    if (this.dir) this.onPress(this.dir, false);
    this.dir = d;
    if (d) this.onPress(d, true);
  },

  /* ── 손가락이 닿았을 때 ───────────────────────────────────────────── */
  down(id, x, y, el) {
    if (this.stickId !== null) return false;    /* 이미 이동 중인 손가락이 있음 */
    this.stickId = id;
    this.origin = { x, y };
    /* ★ 이걸 해야 손가락이 판 밖으로 나가도 계속 따라옵니다 */
    if (el && el.setPointerCapture) { try { el.setPointerCapture(id); } catch (e) {} }
    return true;
  },

  move(id, x, y) {
    if (id !== this.stickId || !this.origin) return false;
    this.setDir(toDir(x - this.origin.x, y - this.origin.y, this.radius, this.dir));
    return true;
  },

  /* 뗐을 때 / ★ 전화·알림으로 취소됐을 때 — 둘 다 여기로 옵니다 */
  up(id) {
    if (id !== this.stickId) return false;
    this.stickId = null;
    this.origin = null;
    this.setDir(null);
    return true;
  },

  /* ── 버튼 (A / B / START / SELECT) ────────────────────────────────── */
  btnDown(id, name, el) {
    if (this.btnIds.has(id)) return false;
    this.btnIds.set(id, name);
    if (el && el.setPointerCapture) { try { el.setPointerCapture(id); } catch (e) {} }
    this.onPress(name, true);
    return true;
  },

  /* ★ 같은 버튼을 두 손가락으로 누를 수 있습니다.
       하나만 떼었다고 버튼을 놓아버리면, 아직 누르고 있는데 놓인 게 됩니다.
       그 이름을 쥔 손가락이 하나도 안 남았을 때만 놓습니다. */
  btnUp(id) {
    const name = this.btnIds.get(id);
    if (name === undefined) return false;
    this.btnIds.delete(id);
    let stillHeld = false;
    for (const n of this.btnIds.values()) if (n === name) { stillHeld = true; break; }
    if (!stillHeld) this.onPress(name, false);
    return true;
  },

  /* ── 전부 떼기 ────────────────────────────────────────────────────────
     화면을 나가거나, 다른 앱으로 가거나, 게임을 끝낼 때.
     이걸 안 하면 눌린 채로 남습니다.                                    */
  releaseAll() {
    this.stickId = null;
    this.origin = null;
    this.setDir(null);
    /* ★ 같은 버튼을 두 손가락으로 잡고 있었으면 뗌 신호가 두 번 나갑니다.
         이름별로 한 번씩만 보냅니다 (btnUp 과 같은 규약). */
    const seen = new Set();
    for (const name of this.btnIds.values()) {
      if (seen.has(name)) continue;
      seen.add(name);
      this.onPress(name, false);
    }
    this.btnIds.clear();
  },

  /* 지금 눌려 있는 것들 (검사용) */
  get held() {
    const out = [];
    if (this.dir) out.push(this.dir);
    for (const n of this.btnIds.values()) out.push(n);
    return out.sort();
  },

  /* ── 화면에 붙이기 ────────────────────────────────────────────────── */
  attach(padEl, buttons) {
    const add = (el, type, fn) => {
      /* ★ {passive:false} 를 안 주면 preventDefault 가 무시됩니다 */
      el.addEventListener(type, fn, { passive: false });
      this.bound.push([el, type, fn]);
    };

    if (padEl) {
      add(padEl, "pointerdown", e => {
        e.preventDefault();
        this.down(e.pointerId, e.clientX, e.clientY, padEl);
      });
      add(padEl, "pointermove", e => {
        if (e.pointerId !== this.stickId) return;
        e.preventDefault();
        this.move(e.pointerId, e.clientX, e.clientY);
      });
      /* ★ pointercancel 을 pointerup 과 똑같이 처리 — 전화·알림 대비 */
      for (const t of ["pointerup", "pointercancel", "lostpointercapture"])
        add(padEl, t, e => { e.preventDefault(); this.up(e.pointerId); });
    }

    for (const [el, name] of (buttons || [])) {
      if (!el) continue;
      add(el, "pointerdown", e => {
        e.preventDefault();
        el.classList && el.classList.add("on");
        this.btnDown(e.pointerId, name, el);
      });
      for (const t of ["pointerup", "pointercancel", "lostpointercapture"])
        add(el, t, e => {
          e.preventDefault();
          el.classList && el.classList.remove("on");
          this.btnUp(e.pointerId);
        });
    }
    return this;
  },

  detach() {
    this.releaseAll();
    for (const [el, type, fn] of this.bound) el.removeEventListener(type, fn);
    this.bound.length = 0;
  },
};

const PadApi = { Pad, toDir, DEAD, ON, KEEP, RADIUS, DIRS };
if (typeof window !== "undefined") window.GamePad4 = PadApi;
if (typeof module !== "undefined" && module.exports) module.exports = PadApi;
