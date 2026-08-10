/* ============================================================================
   TVA FIELD UNIT — 화면 흐름

   SELECT SYSTEM → 게임 목록 → 플레이 → MENU(저장/불러오기/종료)

   game.js 가 에뮬레이터와 보관을 맡고, 이 파일은 화면만 맡습니다.
   그래서 화면 없이도 흐름을 검사할 수 있습니다. (test/ui.js)
   ========================================================================== */

"use strict";

/* ── 새 상태값은 맨 위에 ─────────────────────────────────────────────── */
let screen   = "system";   /* system | list | play | menu */
let systemId = "gb";       /* gb (게임보이) | gw (게임&워치) */
let romList  = [];         /* 목록에 보이는 것 */
let cursor   = 0;          /* 목록에서 고른 자리 */
let playing  = null;       /* 지금 하는 게임의 기록 */
let slotPick = 0;          /* 저장 칸 1~3 */
let notice   = "";         /* 화면 아래 한 줄 안내 */
let listCursor = 0;        /* 메뉴에 들어가기 전 목록에서 있던 자리 */

/* 저장소에 기본으로 넣어둔 롬. roms/ROMS.md 참고 */
const BUNDLED = [
  { file:"tobu.gb",    title:"TOBU TOBU GIRL",    note:"MIT / CC BY 4.0  TANGRAM GAMES" },
  { file:"tobudx.gb",  title:"TOBU TOBU GIRL DX", note:"MIT / CC BY 4.0  TANGRAM GAMES" },
  { file:"2048.gb",    title:"2048",              note:"ZLIB  SANQUI" },
  { file:"libbet.gb",  title:"LIBBET",            note:"ZLIB  DAMIAN YERRICK" },
  { file:"WORDLE.gb",  title:"WORDLE",            note:"GPL-3.0  STACKSMASHING" },
];

/* 우리가 만드는 게임&워치 방식 게임. 아직 없습니다. */
const GW_GAMES = [];

const SYSTEMS = [
  { id:"gb", name:"GAME BOY",     desc:"CARTRIDGE EMULATION" },
  { id:"gw", name:"GAME & WATCH", desc:"LCD HANDHELD" },
];


/* ==========================================================================
   화면 흐름
   ========================================================================== */

function Ui(deps) {
  /* deps 로 바깥것을 받습니다. 그래야 검사할 때 가짜를 끼울 수 있습니다.
       store   : 롬 보관소 (game.js 의 RomStore)
       engine  : 에뮬레이터 (game.js 의 GameMode)
       fetchRom: 저장소에 넣어둔 롬 파일 읽기
       render  : 화면 다시 그리기
       loadWasm: binjgb 준비                                              */
  this.d = deps;
}

Ui.prototype = {

  get state() {
    return { screen, systemId, cursor, slotPick, notice,
             count: romList.length,
             title: playing ? playing.title : "",
             running: this.d.engine.isRunning() };
  },

  /* ── 목록 만들기 ──────────────────────────────────────────────────────
     저장소에 넣어둔 것 + 아드님이 폰에 넣은 것을 합칩니다.
     같은 게임이 겹치면 폰에 넣은 쪽을 씁니다(저장 기록이 붙어 있으니까). */
  async refresh() {
    if (systemId === "gw") { romList = GW_GAMES.slice(); cursor = 0; return romList; }
    let saved = [];
    try { saved = await this.d.store.list(); }
    catch (e) { notice = "STORAGE UNAVAILABLE — OPEN VIA WEB ADDRESS"; }
    /* ★ 저장된 기록이 기본 게임과 같은 파일이면, **이름과 라이선스 표기는
         기본 것을 씁니다.** 롬 헤더에서 읽은 이름은 짧고 투박합니다
         ("TOBU TOBU GIRL" → "TOBU"). 저장을 한 번 했다고 목록의 이름이
         바뀌면 아드님이 다른 게임인 줄 압니다. */
    const byName = new Map(BUNDLED.map(b => [b.file, b]));
    const shown = saved.map(r => {
      const b = byName.get(r.file);
      return b ? { ...r, title:b.title, note:b.note } : r;
    });
    const byFile = new Set(saved.map(r => r.file));
    const bundled = BUNDLED
      .filter(b => !byFile.has(b.file))
      .map(b => ({ id:"bundled:" + b.file, title:b.title, file:b.file,
                   note:b.note, bundled:true, hasSram:false, states:[false,false,false] }));
    romList = bundled.concat(shown);
    if (cursor >= romList.length) cursor = Math.max(0, romList.length - 1);
    return romList;
  },

  /* ── 시스템 고르기 ────────────────────────────────────────────────── */
  pickSystem(id) {
    systemId = id;
    screen = "list";
    cursor = 0;
    notice = "";
    return this.refresh();
  },

  /* ── 지금 화면의 목록 길이 ──────────────────────────────────────────
     화면마다 고를 것이 다릅니다. 이걸 안 나누면 메뉴에서 커서가
     엉뚱한 데까지 갑니다.                                             */
  rows() {
    if (screen === "system") return SYSTEMS.length;
    if (screen === "menu")   return this.menuItems().length;
    return romList.length;
  },

  move(delta) {
    const n = this.rows();
    if (!n) return;
    cursor = (cursor + delta + n) % n;
  },

  list() { return romList; },
  selected() { return romList[cursor] || null; },
  systemName() {
    const s = SYSTEMS.find(x => x.id === systemId);
    return s ? s.name : "";
  },
  backToSystem() { screen = "system"; cursor = 0; notice = ""; },
  warn(msg) { notice = msg; },

  /* ── 메뉴에 뭐가 들어가는가 ────────────────────────────────────────
     게임 중에는 8개 버튼이 전부 게임 차지라, 나가는 길이 여기에 다 있어야
     합니다. 하나라도 빠지면 아드님이 갇힙니다.                          */
  /* ★ 줄 수를 7개로 맞췄습니다.
       화면이 160x144 라 한 화면에 일곱 줄이 한계입니다.
       저장 칸을 SAVE 3줄 + LOAD 3줄로 나누면 열 줄이 되어
       네 줄만 보이고 나머지는 스크롤해야 합니다.
       작은 화면에서 스크롤은 "없는 것"과 같습니다.

       그래서 칸 하나에 두 가지를 겁니다 — A 로 불러오고, START 로 저장합니다.
       오른쪽 판에 그렇게 적어둡니다.                                     */
  menuItems() {
    const st = playing && playing.states ? playing.states : [null, null, null];
    const mark = i => (st[i] ? "SAVED" : "EMPTY");
    return [
      { key:"resume", label:"RESUME",        sub:"BACK TO GAME" },
      { key:"slot0",  label:"SLOT 1",        sub:mark(0) },
      { key:"slot1",  label:"SLOT 2",        sub:mark(1) },
      { key:"slot2",  label:"SLOT 3",        sub:mark(2) },
      { key:"game",   label:"CHANGE GAME",   sub:"GAME LIST" },
      { key:"system", label:"CHANGE SYSTEM", sub:"GAME BOY / G&W" },
      { key:"tempad", label:"EXIT",          sub:"BACK TO TEMPAD" },
    ];
  },

  /* A 를 눌렀을 때 */
  async chooseMenu() {
    const item = this.menuItems()[cursor];
    if (!item) return false;
    if (item.key === "resume") return this.closeMenu();
    /* 아래 셋은 전부 게임을 먼저 정리하고 나갑니다 */
    if (item.key === "game")   { await this.quit(); return true; }
    if (item.key === "system") { await this.quit(); this.backToSystem(); return true; }
    if (item.key === "tempad") { this.exitToTempad(); return true; }
    if (item.key.startsWith("slot")) return this.loadSlot(Number(item.key.slice(-1)));
    return false;
  },

  /* START 를 눌렀을 때 — 저장 칸에서만 뜻이 있습니다 */
  async saveMenu() {
    const item = this.menuItems()[cursor];
    if (!item || !item.key.startsWith("slot")) { notice = "SELECT A SLOT FIRST"; return false; }
    const n = Number(item.key.slice(-1));
    const ok = await this.saveSlot(n);
    /* 저장한 뒤 EMPTY → SAVED 로 바뀌게 다시 읽어옵니다 */
    if (ok && playing && playing.id) {
      try { playing = await this.d.store.get(playing.id) || playing; } catch (e) {}
    }
    return ok;
  },

  /* ── ★ "한 단계 위로" 버튼 ──────────────────────────────────────────
     화면마다 어디로 가는지가 다릅니다. 글자로 보여줘야 안 헤맵니다.
     게임 중에는 게임보이 버튼 8개가 전부 게임 차지라,
     이 버튼만이 유일한 탈출구입니다.                                    */
  upLabel() {
    if (screen === "play")   return "MENU";
    if (screen === "menu")   return "RESUME";
    if (screen === "list")   return "SYSTEM";
    return "—";            /* 기기 고르는 화면 — 더 위가 없습니다 */
  },

  /* ★★ 이 버튼은 절대로 페이지를 떠나지 않습니다. ★★

     전에는 기기 고르는 화면에서 누르면 템패드로 나가버렸습니다.
     한 번 잘못 누르면 게임 밖으로 튕겨나가는 구조였습니다.
     특히 화면이 바뀐 직후에는 버튼 글자가 아직 안 바뀌어 있을 수 있어서,
     "MENU 인 줄 알고 눌렀는데 밖으로 나감" 이 됩니다.

     그래서 나가는 길은 두 군데로만 두었습니다.
       · 화면 왼쪽 아래 "< TVA // FIELD UNIT"
       · 일시정지 메뉴의 EXIT
     둘 다 "나간다"고 글자로 적혀 있습니다.                              */
  async up() {
    if (screen === "play") { this.openMenu(); return "menu"; }
    if (screen === "menu") { this.closeMenu(); return "play"; }
    if (screen === "list") { this.backToSystem(); return "system"; }
    return "stay";              /* 기기 고르는 화면에서는 아무 일도 안 함 */
  },

  /* ── 롬 넣기 ──────────────────────────────────────────────────────── */
  async addRom(file) {
    try {
      const bytes = await this.d.readFile(file);
      /* ★ 크기만 보면 아무 파일이나 들어옵니다 (.txt 도 들어갔습니다).
           닌텐도 로고 바이트로 진짜 게임보이 롬인지 확인합니다. */
      if (!this.d.looksLikeGb(bytes)) { notice = "NOT A GAME BOY FILE"; return null; }
      const rec = await this.d.store.add(bytes, file.name);
      notice = "ADDED — " + rec.title;
      await this.refresh();
      cursor = Math.max(0, romList.findIndex(r => r.id === rec.id));
      return rec;
    } catch (e) {
      notice = "COULD NOT ADD FILE";
      return null;
    }
  },

  async removeRom() {
    const r = this.selected();
    if (!r || r.bundled) { notice = "BUILT-IN — CANNOT REMOVE"; return false; }
    await this.d.store.remove(r.id);
    notice = "REMOVED";
    await this.refresh();
    return true;
  },

  /* ── 시작 ─────────────────────────────────────────────────────────── */
  async play() {
    const r = this.selected();
    if (!r) { notice = "NO GAME"; return false; }
    /* ★ 롬을 읽는 동안 사용자가 나갈 수 있습니다.
         지금 세대를 잡아뒀다가 시작할 때 대조합니다. */
    const born = this.d.engine.epoch ? this.d.engine.epoch() : undefined;

    let bytes = null, sram = null, rec = r;
    try {
      if (r.bundled) {
        bytes = await this.d.fetchRom("roms/" + r.file);
      } else {
        const full = await this.d.store.get(r.id);
        if (!full) { notice = "GAME MISSING"; await this.refresh(); return false; }
        bytes = full.rom; sram = full.sram; rec = full;
      }
    } catch (e) { notice = "COULD NOT LOAD GAME"; return false; }

    let mod;
    try { mod = await this.d.loadWasm(); }
    catch (e) { notice = "EMULATOR NOT AVAILABLE"; return false; }

    let started;
    try {
      started = this.d.engine.start(mod, bytes, {
        canvas: this.d.canvas,
        sram: sram || undefined,
        /* 게임이 스스로 저장하면 여기로 옵니다. 저장소에 넣어둔 롬은
           아직 보관 기록이 없으니 이때 하나 만들어 둡니다. */
        onSram: async b => {
          try {
            if (rec.bundled || !rec.id || String(rec.id).startsWith("bundled:")) {
              const made = await this.d.store.add(bytes, rec.file);
              rec = made;
              await this.d.store.patch(made.id, { sram:b });
            } else {
              await this.d.store.patch(rec.id, { sram:b });
            }
          } catch (e) {}
        },
      }, born);
    } catch (e) {
      notice = (e && e.message === "BAD ROM") ? "BAD ROM FILE" : "COULD NOT START";
      return false;
    }

    /* 읽는 사이에 나갔으면 start 가 null 을 줍니다. 화면을 넘기지 않습니다. */
    if (started === null) return false;
    playing = rec;
    screen = "play";
    notice = "";
    if (!rec.bundled && rec.id) {
      this.d.store.patch(rec.id, { played: (rec.played || 0) + 1 }).catch(() => {});
    }
    return true;
  },

  /* ── 메뉴 ─────────────────────────────────────────────────────────── */
  openMenu() {
    if (screen !== "play") return false;
    this.d.engine.pause();          /* pause 안에서 저장까지 합니다 */
    listCursor = cursor;            /* 목록에서 어디 있었는지 기억 */
    screen = "menu";
    cursor = 0;                     /* 메뉴는 항상 맨 위(RESUME)부터 */
    notice = "";
    return true;
  },

  closeMenu() {
    if (screen !== "menu") return false;
    screen = "play";
    cursor = listCursor;
    this.d.engine.resume();
    return true;
  },

  async saveSlot(n) {
    if (!playing) return false;
    try {
      /* ★ 이 줄이 try 밖에 있었습니다.
           여기서 터지면 처리 안 된 오류가 되고, 그러면 game.js 의
           안전장치가 그걸 잡아서 **게임까지 멈춰버립니다.** */
      const bytes = this.d.engine.saveState();
      if (!bytes) { notice = "NOTHING TO SAVE"; return false; }
      /* 저장소에 넣어둔 롬은 아직 보관 기록이 없으니 만들어 둡니다 */
      let id = playing.id;
      if (playing.bundled || String(id).startsWith("bundled:")) {
        const raw = await this.d.fetchRom("roms/" + playing.file);
        const made = await this.d.store.add(raw, playing.file);
        playing = made; id = made.id;
      }
      const full = await this.d.store.get(id);
      const states = (full && full.states) ? full.states.slice() : [null,null,null];
      /* ★ 어느 롬의 세이브인지 함께 적어둡니다.
           스테이트 안에는 게임 신원이 없어서, 크기만 같으면
           남의 세이브가 그대로 들어가 화면이 깨집니다. */
      states[n] = { rom: id, bytes };
      await this.d.store.patch(id, { states });
      notice = "SAVED TO SLOT " + (n + 1);
      return true;
    } catch (e) { notice = "SAVE FAILED"; return false; }
  },

  async loadSlot(n) {
    if (!playing) return false;
    try {
      const full = await this.d.store.get(playing.id);
      const slot = full && full.states && full.states[n];
      if (!slot) { notice = "SLOT " + (n + 1) + " EMPTY"; return false; }
      /* 옛 방식(바이트만 있던 것)도 읽어줍니다 */
      const bytes = slot.bytes || slot;
      if (slot.rom && slot.rom !== playing.id) {
        notice = "SLOT BELONGS TO ANOTHER GAME"; return false;
      }
      const ok = this.d.engine.loadState(bytes);
      notice = ok ? "LOADED SLOT " + (n + 1) : "SLOT DOES NOT MATCH THIS GAME";
      if (ok) this.closeMenu();
      return ok;
    } catch (e) { notice = "LOAD FAILED"; return false; }
  },

  /* ── 끝내기 ───────────────────────────────────────────────────────────
     ★ 화면을 바꾸기 전에 반드시 에뮬레이터를 먼저 정리합니다.
       순서를 바꾸면 화면만 넘어가고 게임이 뒤에서 계속 돕니다.        */
  quit() {
    this.d.engine.stop();
    playing = null;
    /* 메뉴를 거쳐 나왔을 때만 목록 자리를 되돌립니다.
       안 거쳤으면 지금 커서가 맞는 자리입니다. */
    if (screen === "menu") cursor = listCursor;
    screen = "list";
    notice = "";
    return this.refresh();
  },

  /* 좌측 메뉴에서 게임 아이콘을 다시 누르거나 TemPad 로 나갈 때 */
  exitToTempad() {
    this.d.engine.stop();
    playing = null;
    screen = "system";
    notice = "";
    if (this.d.onExit) this.d.onExit();
  },

  /* ── 버튼 ─────────────────────────────────────────────────────────────
     게임 중에만 에뮬레이터로 넘깁니다. 메뉴에서 누른 게 게임에
     들어가면 안 됩니다.                                                */
  press(name, down) {
    if (screen !== "play") return false;
    this.d.engine.press(name, down);
    return true;
  },

  /* 시험용 */
  _reset() {
    screen = "system"; systemId = "gb"; romList = [];
    cursor = 0; listCursor = 0; playing = null; slotPick = 0; notice = "";
  },
};

const UiApi = { Ui, SYSTEMS, BUNDLED, GW_GAMES };
if (typeof window !== "undefined") window.GameUi = UiApi;
if (typeof module !== "undefined" && module.exports) module.exports = UiApi;
