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
const ON   = 0.38;   /* ★ 예전엔 0.55. 너무 멀리 밀어야 해서 조작이 무거웠습니다 */
const KEEP = 1.4;    /* 축을 바꾸려면 다른 축이 1.4배 커야 함 (= 45도에 ±10도 여유) */
const RADIUS = 48;   /* ★ 예전엔 56. 엄지가 짧게 움직여도 되게 줄였습니다 */

/* ★★ 대각선 판정 ★★
   진짜 게임보이 십자키는 **위와 오른쪽을 동시에** 누를 수 있습니다.
   전에는 4방향 중 하나만 골라서, 대각선으로 못 가는 게임이
   (젤다·마리오·커비 전부) 조작이 극악이 됐습니다.

   0.414 는 22.5도의 탄젠트입니다. 두 축의 비가 이보다 크면 그 축도
   눌린 것으로 봅니다. 그러면 8방향이 각각 45도씩 고르게 나뉩니다.
     0~22.5도   → 오른쪽만
     22.5~67.5  → 오른쪽+위 (대각선)
     67.5~90    → 위만                                                  */
const DIAG      = 0.414;
/* 이미 대각선이면 조금 더 쉽게 유지합니다. 경계에서 덜덜 떠는 걸 막습니다. */
const DIAG_KEEP = 0.30;

const DIRS = ["up", "down", "left", "right"];

/* 밀어낸 거리를 **방향 여러 개**로 바꿉니다. 대각선이면 두 개가 나옵니다.
   prev 에 지금 눌린 방향 배열을 주면 경계에서 덜 흔들립니다. */
function toDirs(dx, dy, radius, prev) {
  const r = radius || RADIUS;
  const nx = dx / r, ny = dy / r;
  const len = Math.sqrt(nx * nx + ny * ny);
  /* ★ 숫자가 아니면 방향 없음. 이걸 안 보면 NaN 이 "down" 으로 떨어집니다. */
  if (!Number.isFinite(len)) return [];
  if (len < DEAD) return [];
  if (len < ON)   return prev ? prev.slice() : [];   /* 살짝 민 것으로는 안 바꿈 */

  const ax = Math.abs(nx), ay = Math.abs(ny);
  const had = d => !!(prev && prev.indexOf(d) >= 0);
  const h = nx < 0 ? "left" : "right";
  const v = ny < 0 ? "up"   : "down";
  const out = [];
  if (ax > ay * (had(h) ? DIAG_KEEP : DIAG)) out.push(h);
  if (ay > ax * (had(v) ? DIAG_KEEP : DIAG)) out.push(v);
  /* 정확히 45도면 위 두 검사가 다 빗나갑니다. 그때는 대각선입니다. */
  if (!out.length) { out.push(h); out.push(v); }
  return out;
}

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
  this.dirs    = [];       /* 지금 눌린 방향들 (대각선이면 두 개) */
  this.btnIds  = new Map();/* 손가락 번호 → 버튼 이름 */
  this.bound   = [];
}

Pad.prototype = {

  /* 예전 이름. 방향 하나만 물어보는 곳을 위해 남겨둡니다. */
  get dir() { return this.dirs.length ? this.dirs[0] : null; },

  /* ── 방향 바꾸기 ──────────────────────────────────────────────────────
     ★ 없어진 것은 반드시 떼고, 새로 생긴 것만 누릅니다.
       그대로 있는 방향을 한 번 뗐다 다시 누르면 게임이 "키를 놨다"고
       읽어서, 대각선으로 꺾는 순간 캐릭터가 한 박자 멈춥니다.        */
  setDirs(next) {
    const now = next || [];
    for (const d of this.dirs) if (now.indexOf(d) < 0) this.onPress(d, false);
    for (const d of now) if (this.dirs.indexOf(d) < 0) this.onPress(d, true);
    this.dirs = now.slice();
  },

  /* 예전 이름 (방향 하나) */
  setDir(d) { this.setDirs(d ? [d] : []); },

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
    this.setDirs(toDirs(x - this.origin.x, y - this.origin.y, this.radius, this.dirs));
    return true;
  },

  /* 뗐을 때 / ★ 전화·알림으로 취소됐을 때 — 둘 다 여기로 옵니다 */
  up(id) {
    if (id !== this.stickId) return false;
    this.stickId = null;
    this.origin = null;
    this.setDirs([]);
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
    this.setDirs([]);
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
    const out = this.dirs.slice();
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

/* ==========================================================================
   진짜 게임패드 (블루투스 컨트롤러)

   유리판 십자키는 손끝에 걸리는 턱이 없어서, 아무리 다듬어도 진짜
   십자키를 못 이깁니다. 브라우저에 표준 규격이 있으니 그걸 씁니다.

   [ 버튼 번호는 표준으로 정해져 있습니다 ]
     0 아래(A위치)  1 오른쪽  2 왼쪽  3 위
     4 L  5 R  6 L2  7 R2   8 SELECT  9 START
     12 위  13 아래  14 왼쪽  15 오른쪽 (십자키)
     축 0 = 좌우, 축 1 = 위아래 (아날로그 스틱)

   ★ 게임보이는 A 가 **오른쪽**, B 가 왼쪽입니다.
     엑스박스 패드의 아래 버튼(0번)은 위치상 왼쪽 아래라 B 로 놓습니다.
     헷갈리지 않게 위·아래 두 개를 B, 좌·우 두 개를 A 로 겹쳐 둡니다.
     어느 걸 눌러도 되게 하는 편이 아이한테 낫습니다.
   ========================================================================== */
const GP_DEAD = 0.5;          /* 아날로그 스틱을 이만큼 밀어야 방향으로 침 */
const GP_MAP = [
  [0, "B"], [2, "B"], [3, "B"],
  [1, "A"],
  [8, "select"], [9, "start"],
  [12, "up"], [13, "down"], [14, "left"], [15, "right"],
  /* L·R 은 MENU — 게임 중에 패드만으로 저장·나가기까지 되게 */
  [4, "menu"], [5, "menu"],
];

/* 지금 눌려 있는 것들을 이름으로 돌려줍니다 (정렬된 배열).
   pads 는 navigator.getGamepads() 가 준 것 그대로 넣으면 됩니다. */
function gamepadHeld(pads) {
  const now = new Set();
  for (const p of (pads || [])) {
    if (!p) continue;
    const bs = p.buttons || [];
    for (const [i, name] of GP_MAP) {
      const b = bs[i];
      /* 아날로그 트리거는 pressed 대신 value 로 오는 패드가 있습니다 */
      if (b && (b.pressed || (typeof b === "number" ? b > 0.5 : b.value > 0.5)))
        now.add(name);
    }
    const ax = p.axes || [];
    const x = Number(ax[0]) || 0, y = Number(ax[1]) || 0;
    if (x < -GP_DEAD) now.add("left"); else if (x > GP_DEAD) now.add("right");
    if (y < -GP_DEAD) now.add("up");   else if (y > GP_DEAD) now.add("down");
  }
  return [...now].sort();
}

/* 지난번과 견줘서 **바뀐 것만** 알려줍니다.
   ★ 이게 없으면 1초에 60번씩 "눌렸다"고 보내게 됩니다. */
function gamepadEdges(prev, now) {
  const out = [];
  for (const n of now)  if (prev.indexOf(n) < 0) out.push([n, true]);
  for (const n of prev) if (now.indexOf(n)  < 0) out.push([n, false]);
  return out;
}

const PadApi = { Pad, toDir, toDirs, gamepadHeld, gamepadEdges,
                 DEAD, ON, KEEP, DIAG, RADIUS, DIRS, GP_DEAD, GP_MAP };
if (typeof window !== "undefined") window.GamePad4 = PadApi;
if (typeof module !== "undefined" && module.exports) module.exports = PadApi;
