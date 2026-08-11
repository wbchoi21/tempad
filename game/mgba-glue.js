/* ============================================================================
   GBA 알맹이(mGBA) 를 우리 규약에 맞추는 얇은 껍데기

   [ 이 파일이 하는 일 ]
   mgba.js 는 남이 만든 것이고 우리와 말이 안 통합니다.
   game.js 의 Session 과 **같은 모양**으로 감싸서, ui.js 가 게임보이와
   GBA 를 구별하지 않고 똑같이 부릴 수 있게 합니다.

   [ 반드시 알아야 할 것 세 가지 ]

   ★★ 1. mgba.js 는 **ES 모듈**입니다.
      <script src="mgba.js"> 로는 안 뜹니다. import() 로 불러야 합니다.
      (그래서 index.html 의 loadMgba 는 이 파일을 부르고, 이 파일이
       import() 를 합니다. 이 파일 자체는 평범한 스크립트입니다.)

   ★★ 2. mGBA 의 IndexedDB 저장(FSInit/FSSync)을 **쓰지 않습니다.**
      우리는 이미 롬과 세이브를 우리 저장소에 넣고 있습니다.
      mGBA 에게도 저장을 시키면 —
        · 32MB 롬이 두 벌씩 쌓이고
        · 세이브 주인이 둘이 되어 어느 쪽이 최신인지 알 수 없게 됩니다.
      그래서 메모리 파일시스템만 쓰고, 폴더는 손으로 만듭니다.

   ★★ 3. mGBA 는 **픽셀 배열을 안 내줍니다.** 제 캔버스에 직접 그립니다.
      그래서 게임보이처럼 tintOrange 로 칠할 수 없습니다.
      주황은 CSS 필터로 만듭니다 (GPU 가 하므로 매 프레임 비용이 0).
      ★ GBA 를 게임보이처럼 4단계로 뭉개면 안 됩니다 — 글자가 안 보입니다.
        색이 수천 가지라 앰버 모니터처럼 **연속된 주황**이 맞습니다.
   ========================================================================== */

(function () {
"use strict";

/* 우리 버튼 이름 → mGBA 버튼 이름.
   ★ mGBA 는 대문자 A/B, 방향은 Up/Down/Left/Right, 어깨는 L/R 입니다. */
const KEYMAP = {
  up:"Up", down:"Down", left:"Left", right:"Right",
  A:"A", B:"B", L:"L", R:"R", select:"Select", start:"Start",
};

let modPromise = null;

/* mGBA 세션 하나. game.js 의 Session 과 같은 모양이어야 합니다. */
class MgbaSession {
  constructor(module, romBytes, opts) {
    this.module = module;
    this.opts   = opts || {};
    this.dead   = false;
    this.userPaused = false;
    this.sramTimer = 0;
    this.sramDirty = false;
    this.started = false;
    this.colorReal = !!this.opts.colorReal;

    const P = module.filePaths();
    this.paths = P;
    /* 폴더는 손으로 만듭니다 (FSInit 을 안 쓰므로) */
    for (const d of ["/data", P.gamePath, P.savePath, P.saveStatePath]) {
      try { module.FS.mkdir(d); } catch (e) {}
    }

    /* ★ 이름은 **매번 같아야** 합니다. 세이브 파일 이름이 여기서 나오기
         때문입니다. 롬 내용이 같으면 이름도 같아야 세이브가 이어집니다.
         우리 기록 id(내용 지문)를 쓰면 정확히 그렇게 됩니다. */
    const tag = String(this.opts.romId || "rom").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)
                || "rom";
    this.romName  = tag + ".gba";
    this.romPath  = P.gamePath + "/" + this.romName;
    this.savePath = P.savePath + "/" + tag + ".sav";

    /* 이전 판이 남긴 찌꺼기를 지웁니다 */
    this._rm(this.romPath);

    module.FS.writeFile(this.romPath, romBytes instanceof Uint8Array
                                        ? romBytes : new Uint8Array(romBytes));

    /* ★ 배터리 세이브는 **롬을 켜기 전에** 넣어야 합니다.
         켠 뒤에 넣으면 게임이 이미 빈 세이브를 읽은 뒤라 무시됩니다. */
    if (this.opts.sram) { try { this.loadSram(this.opts.sram); } catch (e) {} }

    /* 캔버스는 GBA 전용을 씁니다 (한 캔버스에 2D 와 WebGL 을 같이 못 붙입니다) */
    this.canvas = this.opts.canvasGba || this.opts.canvas || null;
    this.setColorMode(this.colorReal);

    if (!module.loadGame(this.romPath)) throw new Error("BAD ROM");

    /* 게임이 스스로 저장하면 알려줍니다 — 게임보이 쪽의 sramDirty 와 같은 뜻 */
    try {
      module.addCoreCallbacks({ saveDataUpdatedCallback: () => { this.sramDirty = true; } });
    } catch (e) {}

    /* ★ 소리 크기는 **건드리지 않습니다.** mGBA 의 setVolume 이 0~1 인지
         0~100 인지 확인할 방법이 없었습니다(게임을 안 켠 상태에서는
         getVolume 이 엉뚱한 값을 냅니다). 잘못 넣으면 **소리가 아예 안
         납니다.** 기본값을 그대로 씁니다 — 필요하면 그때 맞춥니다. */

    /* ★★ 여기서 resumeGame 을 부르면 안 됩니다.
         loadGame 이 이미 주 반복문을 돌려놨습니다. 또 부르면 반복문이
         두 겹으로 돌 수 있습니다(게임이 두 배 속도로 가거나 소리가 겹칩니다).
         start() 도 마찬가지 이유로 "멈춰 있을 때만" 재개합니다. */
    this.paused = false;
  }

  _rm(p) { try { this.module.FS.unlink(p); } catch (e) {} }

  /* ── 버튼 ─────────────────────────────────────────────────────────── */
  press(name, down) {
    if (this.dead) return;
    const k = KEYMAP[name];
    if (!k) return;
    try { down ? this.module.buttonPress(k) : this.module.buttonUnpress(k); }
    catch (e) {}
  }

  /* ── 화면 색 ──────────────────────────────────────────────────────────
     mGBA 가 제 캔버스에 직접 그리므로 CSS 필터로 칠합니다. */
  setColorMode(real) {
    this.colorReal = !!real;
    const cv = this.canvas;
    if (!cv || !cv.classList) return true;
    /* real = 게임 본래 색, 아니면 템패드 주황 */
    if (this.colorReal) cv.classList.remove("amber");
    else                cv.classList.add("amber");
    return true;
  }

  get running() { return this.started && !this.dead && !this.paused; }

  start() {
    if (this.dead || this.started) return;
    this.started = true;
    /* ★ 이미 돌고 있으면(생성자에서 loadGame 이 돌려놨습니다) 건드리지
         않습니다. 멈춰 있을 때만 재개합니다 — 이중 재개 방지. */
    if (this.paused) { this.paused = false; try { this.module.resumeGame(); } catch (e) {} }
    if (this.sramTimer) clearInterval(this.sramTimer);
    /* 게임보이 쪽과 같은 3초. 이유도 같습니다 — 한 번 저장할 때
       기록 전체를 다시 쓰기 때문에 자주 하면 폰이 뜨거워집니다. */
    this.sramTimer = setInterval(() => this.flushSram(), 3000);
  }

  pause(byUser) {
    if (byUser) this.userPaused = true;
    if (this.dead || this.paused) return;
    this.paused = true;
    try { this.module.pauseGame(); } catch (e) {}
    if (this.sramTimer) { clearInterval(this.sramTimer); this.sramTimer = 0; }
    this.flushSram();
  }

  resume() {
    this.userPaused = false;
    if (this.dead || !this.paused) return;
    this.paused = false;
    try { this.module.resumeGame(); } catch (e) {}
    if (!this.sramTimer) this.sramTimer = setInterval(() => this.flushSram(), 3000);
  }

  /* ── 배터리 세이브 (게임 안의 "리포트") ───────────────────────────── */
  loadSram(bytes) {
    if (!bytes || !bytes.length) return;
    try {
      this.module.FS.writeFile(this.savePath,
        bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    } catch (e) {}
  }

  flushSram() {
    if (this.dead || !this.sramDirty) return false;
    this.sramDirty = false;
    try {
      let bytes = null;
      try { bytes = this.module.getSave(); } catch (e) {}
      /* getSave 가 비면 파일에서 직접 읽어봅니다 */
      if (!bytes || !bytes.length) {
        try { bytes = this.module.FS.readFile(this.savePath); } catch (e) {}
      }
      if (!bytes || !bytes.length) return false;
      /* ★ 사본을 넘깁니다. 원본은 wasm 메모리 위라 다음 프레임에 바뀝니다. */
      const copy = new Uint8Array(bytes);
      /* ★★ 실패하면 **다시 시도해야 합니다.** 위에서 표시를 미리 껐기 때문에,
           그냥 흘리면 그 저장은 영영 사라집니다. 게임보이 쪽과 같은 사고입니다. */
      if (this.opts.onSram) {
        const p = this.opts.onSram(copy);
        if (p && typeof p.catch === "function")
          p.catch(() => { if (!this.dead) this.sramDirty = true; });
      }
      return true;
    } catch (err) { this.sramDirty = true; return false; }
  }

  /* ── 세이브 스테이트 (아무 때나 순간을 통째로) ─────────────────────
     ★ mGBA 는 바이트를 안 돌려줍니다. 슬롯 번호로 **파일**에 씁니다.
       그래서 쓰고 나서 그 파일을 읽어 바이트로 꺼냅니다.
       (우리 슬롯은 저장소에 바이트로 들어갑니다 — 게임보이와 같은 규약) */
  _statePath(slot) {
    const n = slot === undefined ? 1 : slot;
    /* mGBA 가 실제로 쓴 파일을 찾습니다 — 이름 규칙이 판마다 달라서
       폴더를 훑는 편이 안전합니다. */
    try {
      const dir = this.module.FS.readdir(this.paths.saveStatePath)
                    .filter(x => x !== "." && x !== "..");
      const hit = dir.find(f => f.indexOf(String(n)) >= 0) || dir[0];
      if (hit) return this.paths.saveStatePath + "/" + hit;
    } catch (e) {}
    return null;
  }

  getState() {
    if (this.dead) return null;
    try {
      if (!this.module.saveState(1)) return null;
      const p = this._statePath(1);
      if (!p) return null;
      const b = this.module.FS.readFile(p);
      const copy = new Uint8Array(b);
      this._rm(p);                     /* 우리가 들고 갈 것이니 흔적은 지웁니다 */
      return copy;
    } catch (e) { return null; }
  }

  loadState(bytes) {
    if (this.dead || !bytes || !bytes.length) return false;
    try {
      /* 우리 바이트를 mGBA 가 읽을 자리에 놓고 시킵니다.
         ★ 이름 규칙을 모르므로, 먼저 한 번 저장해서 **그 이름을 알아낸 뒤**
           그 자리에 우리 것을 덮어씁니다. 규칙이 판마다 달라도 안전합니다. */
      this.module.saveState(1);
      const p = this._statePath(1);
      if (!p) return false;
      this.module.FS.writeFile(p, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      const ok = this.module.loadState(1);
      this._rm(p);
      return !!ok;
    } catch (e) { return false; }
  }

  /* ── 정리 ─────────────────────────────────────────────────────────────
     ★ 한 단계가 실패해도 나머지는 반드시 돌아야 합니다. 순서도 중요합니다.
     ★★ 여기가 제일 위험한 곳입니다. binjgb 에서 **같은 사고가 두 번** 났습니다
        (저장할 때마다 195KB 가 새서 71번째에 죽음, 메모리 두 번 반납으로
         세 번째 시작에서 터짐). GBA 도 껐다 켜기를 반복해도 안 늘어나는지
        반드시 검사로 확인하세요.                                          */
  destroy() {
    if (this.dead) return;
    this.dead = true;
    const safe = f => { try { f(); } catch (e) {} };

    safe(() => clearInterval(this.sramTimer));
    this.sramTimer = 0;
    safe(() => { this.dead = false; this.flushSram(); this.dead = true; });  /* 마지막 저장 */
    safe(() => this.module.pauseGame());
    safe(() => this.module.quitGame());
    /* 파일시스템에 남긴 것을 전부 치웁니다 — 안 치우면 롬을 켤 때마다
       32MB 씩 메모리 파일시스템에 쌓입니다. */
    safe(() => this._rm(this.romPath));
    safe(() => this._rm(this.savePath));
    safe(() => {
      const dir = this.module.FS.readdir(this.paths.saveStatePath)
                    .filter(x => x !== "." && x !== "..");
      for (const f of dir) this._rm(this.paths.saveStatePath + "/" + f);
    });
    this.started = false;
  }
}

/* ── 바깥에서 부르는 입구 ──────────────────────────────────────────────
   index.html 의 loadMgba() 가 이 파일을 부르고, loadCore("gba") 가
   여기 load() 를 부릅니다.                                              */
window.MgbaCore = {
  async load() {
    if (modPromise) return modPromise;
    modPromise = (async () => {
      /* ★ ES 모듈이라 import() 로 불러야 합니다 */
      const ns = await import("./mgba.js");
      const factory = ns && (ns.default || ns);
      if (typeof factory !== "function") throw new Error("no-mgba");

      const cv = document.getElementById("screenGba");
      if (!cv) throw new Error("no-canvas");
      cv.width = 240; cv.height = 160;

      const mod = await factory({ canvas: cv });

      /* 우리 규약에 맞는 Session 을 등록합니다 */
      if (window.GameMode && window.GameMode.registerCore)
        window.GameMode.registerCore("gba", MgbaSession);
      return mod;
    })();
    /* 실패했으면 다음에 다시 해볼 수 있게 풀어둡니다 */
    modPromise.catch(() => { modPromise = null; });
    return modPromise;
  },
  Session: MgbaSession,      /* 검사에서 직접 씁니다 */

  /* ── 새는지 눈으로 확인하는 창구 ──────────────────────────────────────
     ★ 메모리 누수는 **느낌으로는 절대 안 보입니다.** 게임보이 때도
       71번째 저장에서야 죽었습니다 — 반나절 놀아야 닿는 횟수입니다.
       그래서 숫자를 볼 수 있게 열어둡니다.

     쓰는 법 (브라우저 개발자도구 콘솔):
       MgbaCore.stats()        ← 게임 켜기 전에 한 번
       ... 껐다 켜기 열 번 ...
       MgbaCore.stats()        ← 숫자가 그대로여야 정상

     heapMB 가 계속 커지거나 files 가 늘어나면 새는 것입니다.          */
  async stats() {
    try {
      const mod = await (modPromise || Promise.resolve(null));
      if (!mod) return { loaded:false };
      const P = mod.filePaths();
      const count = d => { try {
        return mod.FS.readdir(d).filter(x => x !== "." && x !== "..").length;
      } catch (e) { return -1; } };
      return {
        loaded: true,
        heapMB: +(mod.HEAPU8.length / 1048576).toFixed(1),
        files: { 롬:count(P.gamePath), 세이브:count(P.savePath), 저장칸:count(P.saveStatePath) },
      };
    } catch (e) { return { error: String(e && e.message || e) }; }
  },
};

/* Node 검사에서도 쓸 수 있게 */
if (typeof module !== "undefined" && module.exports) module.exports = { MgbaSession, KEYMAP };

})();
