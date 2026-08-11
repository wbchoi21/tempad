/* ============================================================================
   TVA FIELD UNIT — 화면 흐름  (v2)

   SELECT SYSTEM → 게임 목록 → 플레이 → MENU(저장/불러오기/종료)

   game.js 가 에뮬레이터와 보관을 맡고, 이 파일은 화면만 맡습니다.
   그래서 화면 없이도 흐름을 검사할 수 있습니다. (test/ui.js)

   ★★ v1 과 가장 크게 달라진 것 — 게임 버튼과 메뉴 조작을 갈라놨습니다. ★★

   v1 은 버튼이 A·B·SELECT·START 넷뿐이라 메뉴까지 거기에 겹쳐 걸었습니다.
     · SELECT 를 누르면 LIBRARY
     · START 를 누르면 파일 넣기
     · 지우기 확인창에서 START 가 "지운다"
   사용자 판정: **"지저분하고, SELECT/START 를 메뉴에 쓰는 게 이해가 안 감."**

   v2 는 이렇습니다.
     · 십자키·A·B·L·R·SELECT·START → **게임에만** 들어갑니다.
     · 메뉴·목록·확인창·토글 → **전부 손가락으로 직접 누릅니다.**
   그래서 이 파일의 함수들은 "무슨 버튼을 눌렀나" 가 아니라
   "무엇을 눌렀나"(탭한 줄 번호, 누른 버튼 이름)를 받습니다.
   ========================================================================== */

"use strict";

/* ── 새 상태값은 맨 위에 ─────────────────────────────────────────────── */
let screen   = "system";   /* system | list | play | menu */
let systemId = "gb";       /* gb | gbc | gba */
let romList  = [];         /* 목록에 보이는 것 (지금 시스템 것만) */
let cursor   = 0;          /* 목록에서 고른 자리 */
let playing  = null;       /* 지금 하는 게임의 기록 */
let notice   = "";         /* 화면 아래 한 줄 안내 */
let listCursor = 0;        /* 메뉴에 들어가기 전 목록에서 있던 자리 */
let pending  = null;       /* 지우기 확인 중인 게임 {id,title} — 없으면 null */

/* ★★ 화면을 옮길 때마다 하나씩 올라가는 번호. ★★

   게임을 켜는 데는 구형 폰에서 1~3초가 걸립니다 (롬 읽기 + wasm 준비).
   그 사이에 아드님이 BACK 을 누르고 다른 기기를 골라버릴 수 있습니다.
   그때 늦게 끝난 play() 가 그대로 화면을 낚아채면,
   **"게임이 하나도 없네" 하고 보고 있는데 갑자기 딴 게임이 켜집니다.**

   에뮬레이터 쪽에도 비슷한 방어(epoch)가 있지만 그건 engine.stop() 이
   불렸을 때만 올라갑니다. 목록을 옮겨 다니는 것만으로는 안 올라갑니다.
   그래서 화면 쪽 번호를 따로 둡니다.
   (2026-08-11 교차검사에서 재현해서 잡았습니다.)                        */
let navGen = 0;

/* ── 보기 설정 (토글 두 개) ───────────────────────────────────────────
   화면에 그리는 쪽(index.html)이 이걸 보고 칠하고 배치합니다.
   저장은 deps.prefs 를 통해 합니다 — 검사에서 가짜를 끼울 수 있게. */
let colorReal  = false;    /* false = 템패드 주황 (기본) | true = 실제 컬러 */
let padVisible = true;     /* 터치 조작판을 보이는가 */

/* ── 한계값 ────────────────────────────────────────────────────────────
   폴더를 고르면 그 안에 있는 걸 **전부** 받습니다. 롬 묶음 폴더에는
   수백 개가 들어 있기도 하고, 엉뚱한 큰 파일이 섞여 있기도 합니다.
   막지 않으면 폰 저장공간이 꽉 차거나 화면이 몇 분씩 얼어붙습니다. */
const MAX_IMPORT    = 300;              /* 한 번에 넣을 수 있는 개수 */
const GIVE_UP_AFTER = 3;                /* 연달아 이만큼 실패하면 그만둡니다 */

/* ★ 시스템별 롬 크기 상한.
     게임보이는 아무리 커도 8MB, GBA 는 32MB 가 물리적 최대입니다
     (마더3·포켓몬 에메랄드가 32MB). 이보다 큰 파일은 롬이 아닙니다. */
const SYSTEMS = [
  { id:"gb",  name:"GAME BOY",         desc:"8-BIT CARTRIDGE",  max:  8*1024*1024, ext:/\.gbc?$/i },
  { id:"gbc", name:"GAME BOY COLOR",   desc:"COLOR CARTRIDGE",  max:  8*1024*1024, ext:/\.gbc?$/i },
  { id:"gba", name:"GAME BOY ADVANCE", desc:"32-BIT CARTRIDGE", max: 32*1024*1024, ext:/\.gba$/i  },
];
/* 어느 시스템이든 일단 이보다 크면 읽지도 않습니다 */
const MAX_ANY_BYTES = 32 * 1024 * 1024;
/* 파일 이름 1차 거르개 — 폴더째 넣을 때 사진·동영상을 미리 걷어냅니다 */
const ROM_EXT = /\.(gb|gbc|gba)$/i;

function sysDef(id) { return SYSTEMS.find(s => s.id === id) || SYSTEMS[0]; }

/* 게임 안 저장(배터리 세이브)이 실패했을 때의 안내문.
   ★ 상수로 둡니다 — 나중에 이 안내만 골라서 걷어내야 하기 때문입니다. */
const SRAM_FAIL = "COULD NOT SAVE — STORAGE FULL?";

/* ★ 지금 하는 게임의 기록에서 **목록에 쓸 것만** 남깁니다.
     보관 기록에는 롬 바이트(최대 32MB)와 슬롯 세이브가 통째로 들어 있습니다.
     그걸 그대로 붙들고 있으면 게임 하는 내내 그만큼이 놀고 있습니다.
     에뮬레이터는 이미 제 메모리로 복사해 갔으니 여기서는 필요 없습니다. */
function slimRec(rec, sys) {
  if (!rec) return null;
  return { id: rec.id, title: rec.title, file: rec.file, note: rec.note,
           system: rec.system || sys, bundled: !!rec.bundled,
           fromBundled: rec.fromBundled || null,
           played: rec.played || 0,
           states: (rec.states || [null, null, null]).map(x => !!x) };
}

/* 저장소에 기본으로 넣어둔 롬. roms/ROMS.md 참고.

   ★★ system 은 **실제 롬 헤더를 읽어서** 적은 것입니다. 추측이 아닙니다.
       (0x143 이 0x80 이면 컬러 겸용 → GAME BOY COLOR 목록)
         tobu.gb    0x00 → gb
         tobudx.gb  0x80 → gbc   ("DX" 가 곧 컬러판입니다)
         2048.gb    0x00 → gb
         libbet.gb  0x80 → gbc
         WORDLE.gb  0x00 → gb

   ★ 이걸 안 맞춰두면 무슨 일이 벌어지는가 (실제로 그랬습니다) —
     기본 게임을 한 번 저장하면 보관 기록이 생기는데, 그 기록의 system 은
     롬을 보고 정해지므로 gbc 가 됩니다. 그런데 화면은 기본 게임을
     "전부 gb" 라고 믿고 있어서, **LIBBET 과 TOBU DX 가 게임보이 목록에서
     사라지고** 세이브도 "다른 기기의 것" 이라며 못 읽게 됐습니다.
     이제 처음부터 제자리에 둡니다. 덤으로 컬러 목록이 비어 있지 않습니다. */
const BUNDLED = [
  { file:"tobu.gb",    system:"gb",  title:"TOBU TOBU GIRL",    note:"MIT / CC BY 4.0  TANGRAM GAMES" },
  { file:"tobudx.gb",  system:"gbc", title:"TOBU TOBU GIRL DX", note:"MIT / CC BY 4.0  TANGRAM GAMES" },
  { file:"2048.gb",    system:"gb",  title:"2048",              note:"ZLIB  SANQUI" },
  { file:"libbet.gb",  system:"gbc", title:"LIBBET",            note:"ZLIB  DAMIAN YERRICK" },
  { file:"WORDLE.gb",  system:"gb",  title:"WORDLE",            note:"GPL-3.0  STACKSMASHING" },
];


/* ==========================================================================
   화면 흐름
   ========================================================================== */

function Ui(deps) {
  /* deps 로 바깥것을 받습니다. 그래야 검사할 때 가짜를 끼울 수 있습니다.
       store        : 롬 보관소 (game.js 의 RomStore)
       engine       : 에뮬레이터 (game.js 의 GameMode)
       fetchRom     : 저장소에 넣어둔 롬 파일 읽기
       readFile     : 고른 파일 읽기
       detectSystem : 롬 바이트를 보고 gb/gbc/gba 를 가려냄
       loadCore     : 시스템에 맞는 에뮬레이터 준비 (gb·gbc=binjgb, gba=mGBA)
       canvas       : 그릴 곳
       prefs        : { get(k), set(k,v) } 보기 설정 저장 (없어도 됨)
       onExit       : 템패드로 나갈 때                                    */
  this.d = deps;
  /* 저장해둔 보기 설정을 되살립니다 */
  const p = deps && deps.prefs;
  if (p && typeof p.get === "function") {
    try {
      colorReal  = p.get("color") === "real";
      padVisible = p.get("pad") !== "off";
    } catch (e) { /* 저장소가 막혀 있어도 기본값으로 굴러갑니다 */ }
  }
}

Ui.prototype = {

  get state() {
    return { screen, systemId, cursor, notice,
             count: romList.length,
             title: playing ? playing.title : "",
             /* 지우기를 물어보는 중이면 그 게임 이름. 아니면 null.
                화면 쪽은 이것만 보고 확인창을 띄웁니다.
                ★ 목록 화면일 때만 내보냅니다. 다른 화면에 물음표가 뜨면
                  화면과 버튼 뜻이 어긋나 갇힙니다. */
             confirm: (pending && screen === "list") ? { title: pending.title } : null,
             colorReal, padVisible,
             running: this.d.engine.isRunning() };
  },

  /* ── 목록 만들기 ──────────────────────────────────────────────────────
     저장소에 넣어둔 것 + 아드님이 폰에 넣은 것을 합칩니다.
     ★ v2 — **지금 고른 시스템 것만** 보여줍니다. */
  async refresh() {
    let saved = [];
    try { saved = await this.d.store.list(); }
    catch (e) { notice = "STORAGE UNAVAILABLE — OPEN VIA WEB ADDRESS"; }

    /* ★ 저장된 기록이 기본 게임과 같은 파일이면, **이름과 라이선스 표기는
         기본 것을 씁니다.** 롬 헤더에서 읽은 이름은 짧고 투박합니다
         ("TOBU TOBU GIRL" → "TOBU"). 저장을 한 번 했다고 목록의 이름이
         바뀌면 아드님이 다른 게임인 줄 압니다.

       ★★ 예전에는 **파일 이름**으로 짝을 맞췄습니다. 위험했습니다. ★★
         롬 묶음 폴더에는 `2048.gb` `tobu.gb` 같은 흔한 이름이 거의 반드시
         들어 있습니다. 그게 들어오면 **기본 게임이 목록에서 사라지고**
         남의 롬이 기본 게임의 이름과 라이선스 표기를 뒤집어썼습니다.
         이제는 "기본 게임에서 만들어진 기록" 에만 표시(fromBundled)를
         붙여두고 그것만 짝을 맞춥니다. 이름은 보지 않습니다.            */
    const byFile = new Map(BUNDLED.map(b => [b.file, b]));
    const shown = saved
      /* ★ 옛 기록에는 system 이 없습니다. 그때는 게임보이만 있었으니 gb 로 봅니다. */
      .filter(r => (r.system || "gb") === systemId)
      .map(r => {
        const b = r.fromBundled ? byFile.get(r.fromBundled) : null;
        return b ? { ...r, title:b.title, note:b.note } : r;
      });
    /* ★ 짝맞춤은 **시스템을 가리지 않고** 전체에서 봅니다.
         기본 게임 기록이 어쩌다 다른 시스템으로 분류되어 있어도
         목록에 두 번 뜨는 일이 없게 합니다. */
    const taken = new Set(saved.map(r => r.fromBundled).filter(Boolean));
    const bundled = BUNDLED
      .filter(b => b.system === systemId && !taken.has(b.file))
      .map(b => ({ id:"bundled:" + b.file, title:b.title, file:b.file,
                   note:b.note, bundled:true, system:b.system,
                   hasSram:false, states:[false,false,false] }));
    romList = bundled.concat(shown);
    /* ★ 커서를 자르는 건 **목록 화면일 때만** 입니다.
         메뉴 화면의 커서는 메뉴 줄 번호라 목록 길이와 아무 상관이 없습니다.
         300개 넣기가 도는 중에 게임을 켜고 MENU 를 열면, 마지막 refresh 가
         **메뉴 커서를 말없이 옮겨서** 아드님이 안 고른 항목이 실행됐습니다.
         (2026-08-11 교차검사에서 재현해서 잡았습니다.)                  */
    if (screen === "list" && cursor >= romList.length)
      cursor = Math.max(0, romList.length - 1);
    return romList;
  },

  /* ── 시스템 고르기 ────────────────────────────────────────────────── */
  pickSystem(id) {
    if (!SYSTEMS.some(s => s.id === id)) return Promise.resolve(romList);
    navGen++;                       /* 켜는 중이던 게임이 있으면 버립니다 */
    systemId = id;
    screen = "list";
    cursor = 0;
    notice = "";
    pending = null;
    return this.refresh();
  },

  /* ── 지금 화면에 몇 줄이 있는가 ──────────────────────────────────────
     화면마다 고를 것이 다릅니다. 이걸 안 나누면 커서가 엉뚱한 데까지 갑니다. */
  rows() {
    if (screen === "system") return SYSTEMS.length;
    if (screen === "menu")   return this.menuItems().length;
    return romList.length;
  },

  move(delta) {
    /* ★ 지울까 물어보는 중에는 커서가 움직이면 안 됩니다.
         움직이면 "무엇을 지우는지" 와 화면이 어긋납니다. */
    if (pending) return;
    const n = this.rows();
    if (!n) return;
    cursor = (cursor + delta + n) % n;
  },

  /* 손가락으로 줄을 직접 눌렀을 때 (커서만 옮김) */
  setCursor(i) {
    if (pending) return false;
    if (!(i >= 0) || i >= this.rows()) return false;
    cursor = i;
    return true;
  },

  /* ★★ v2 의 핵심 — 목록에서 손가락으로 줄을 눌렀을 때 ★★

     첫 탭 = 고르기. 이미 고른 줄을 다시 탭 = 시작.
     한 번에 시작하지 않는 이유는 **오발사**입니다. 목록을 훑어 내리다
     손가락이 멈추면서 줄에 닿는 일이 잦은데, 그때마다 게임이 켜지면
     아드님은 매번 되돌아 나와야 합니다. 두 번 두드리는 건 금방 익힙니다.

     돌려주는 값 — 화면 쪽이 무엇을 해야 하는지 압니다.
       "select" 고르기만 함 / "play" 시작됨 / "fail" 시작 실패
       "busy"   지우기 확인 중이라 안 받음 / "none" 그런 줄 없음        */
  async tapRow(i) {
    if (pending) return "busy";
    if (screen !== "list") return "none";
    if (!(i >= 0) || i >= romList.length) return "none";
    if (i === cursor) {
      const ok = await this.play();
      return ok ? "play" : "fail";
    }
    cursor = i;
    return "select";
  },

  list() { return romList; },
  selected() { return romList[cursor] || null; },
  systems() { return SYSTEMS; },
  systemName() { return sysDef(systemId).name; },
  backToSystem() { navGen++; screen = "system"; cursor = 0; notice = ""; pending = null; },
  warn(msg) { notice = msg; },

  /* ── 보기 토글 두 개 ──────────────────────────────────────────────────
     ★ 이 둘은 게임 입력과 아무 상관이 없습니다. 화면 구석의 독립 버튼입니다. */
  toggleColor() {
    colorReal = !colorReal;
    this._save("color", colorReal ? "real" : "tempad");
    /* 지금 게임 중이면 즉시 반영합니다 */
    if (this.d.engine.setColorMode) this.d.engine.setColorMode(colorReal);
    notice = colorReal ? "REAL COLOR" : "TEMPAD COLOR";
    return colorReal;
  },
  togglePad() {
    padVisible = !padVisible;
    this._save("pad", padVisible ? "on" : "off");
    notice = padVisible ? "TOUCH PAD ON" : "TOUCH PAD OFF";
    return padVisible;
  },
  /* ★ 게임을 켤 때의 설정은 play() 가 start(opts.colorReal) 로 넘깁니다.
       따로 부르는 함수는 두지 않습니다 — 아무도 안 부르는 함수가 있으면
       "부르고 있겠거니" 하고 착각하게 됩니다. (교차검사에서 죽은 코드로 지적됨) */
  _save(k, v) {
    const p = this.d.prefs;
    if (p && typeof p.set === "function") { try { p.set(k, v); } catch (e) {} }
  },

  /* ── 메뉴에 뭐가 들어가는가 ────────────────────────────────────────
     게임 중에는 게임 버튼이 전부 게임 차지라, 나가는 길이 여기에 다
     있어야 합니다. 하나라도 빠지면 아드님이 갇힙니다.

     ★ v2 — 저장 칸은 줄마다 **[LOAD] [SAVE] 두 개의 터치 버튼**을 답니다.
       v1 은 "A 로 불러오고 START 로 저장" 이었는데, 그게 바로 사용자가
       지적한 "게임 버튼을 메뉴에 쓰는" 방식입니다. 눈에 보이는 버튼을
       누르는 편이 배울 것이 없습니다.                                  */
  menuItems() {
    const st = playing && playing.states ? playing.states : [null, null, null];
    const mark = i => (st[i] ? "SAVED" : "EMPTY");
    return [
      { key:"resume", label:"RESUME",        sub:"BACK TO GAME" },
      { key:"slot0",  label:"SLOT 1",        sub:mark(0), slot:0 },
      { key:"slot1",  label:"SLOT 2",        sub:mark(1), slot:1 },
      { key:"slot2",  label:"SLOT 3",        sub:mark(2), slot:2 },
      { key:"game",   label:"CHANGE GAME",   sub:"GAME LIST" },
      { key:"system", label:"CHANGE SYSTEM", sub:"GB / GBC / GBA" },
      { key:"tempad", label:"EXIT",          sub:"BACK TO TEMPAD" },
    ];
  },

  /* 메뉴 줄을 눌렀을 때.
     action 은 저장 칸에서만 뜻이 있습니다 — "load"(기본) 또는 "save".   */
  async chooseMenu(action) {
    /* ★ 메뉴 화면일 때만. 목록에서 잘못 불리면 EXIT 가 실행되어 나가버립니다. */
    if (screen !== "menu") return false;
    const item = this.menuItems()[cursor];
    if (!item) return false;
    if (item.key === "resume") return this.closeMenu();
    /* 아래 셋은 전부 게임을 먼저 정리하고 나갑니다 */
    if (item.key === "game")   { await this.quit(); return true; }
    if (item.key === "system") { await this.quit(); this.backToSystem(); return true; }
    if (item.key === "tempad") { this.exitToTempad(); return true; }
    if (item.slot !== undefined) {
      return action === "save" ? this.saveSlotAndRefresh(item.slot)
                               : this.loadSlot(item.slot);
    }
    return false;
  },

  /* 저장 칸을 손가락으로 눌렀을 때 (줄 번호와 무엇을 할지 함께 받습니다) */
  async tapMenu(i, action) {
    if (screen !== "menu") return false;
    if (!(i >= 0) || i >= this.menuItems().length) return false;
    cursor = i;
    return this.chooseMenu(action);
  },

  async saveSlotAndRefresh(n) {
    const ok = await this.saveSlot(n);
    /* 저장한 뒤 EMPTY → SAVED 로 바뀌게 다시 읽어옵니다 */
    if (ok && playing && playing.id) {
      try {
        const full = await this.d.store.get(playing.id);
        if (full) playing = slimRec(full, playing.system);
      } catch (e) {}
    }
    return ok;
  },

  /* ── ★ 구석의 첫 번째 버튼이 무엇인가 ────────────────────────────────
     화면마다 다릅니다. 글자로 보여줘야 안 헤맵니다.
     게임 중에는 게임 버튼이 전부 게임 차지라, 이 버튼이 유일한 탈출구입니다. */
  cornerLabel() {
    if (pending && screen === "list") return "KEEP";
    if (screen === "play")   return "MENU";
    if (screen === "menu")   return "RESUME";
    if (screen === "list")   return "BACK";
    return "EXIT";                     /* 시스템 고르는 화면 */
  },

  /* 구석 버튼을 눌렀을 때. 돌려주는 값은 옮겨간 화면 이름입니다. */
  async corner() {
    /* ★ 지울까 물어보는 중이면 이 버튼은 "안 지움" 입니다.
         여기서 화면을 옮겨버리면 물음표만 남고 답을 못 합니다. */
    if (pending) {
      pending = null;
      if (screen === "list") { notice = "KEPT"; return "list"; }
    }
    if (screen === "play") { this.openMenu(); return "menu"; }
    if (screen === "menu") { this.closeMenu(); return "play"; }
    if (screen === "list") { this.backToSystem(); return "system"; }
    this.exitToTempad();
    return "tempad";
  },

  /* ── 롬 넣기 ────────────────────────────────────────────────────────
     ★ v2 — 어느 목록에서 넣든 **롬을 보고 제 시스템으로 보냅니다.**
       v1 은 "게임보이 목록에서만 받음" 이었는데, 이제 시스템이 셋이라
       그 방식이면 아드님이 목록을 옮겨 다니며 넣어야 합니다.
       .gba 를 게임보이 목록에서 넣어도 GBA 목록에 들어가고, 그렇게
       말해줍니다.                                                       */
  async addRom(file) {
    if (pending) return null;      /* 지울까 물어보는 중에는 안 받습니다 */
    if (!file) return null;
    /* ★ 크기를 읽기 전에 봅니다.
         폴더를 잘못 골라 4GB 짜리 동영상이 걸리면 앱이 그냥 죽습니다. */
    if (file.size > MAX_ANY_BYTES) { notice = "FILE TOO BIG"; return null; }
    try {
      const bytes = await this.d.readFile(file);
      /* ★ 크기와 이름만 보면 아무 파일이나 들어옵니다 (.txt 도 들어갔습니다).
           롬 안의 고정 바이트를 보고 진짜인지, 어느 기기 것인지 가려냅니다. */
      const sys = this.d.detectSystem(bytes, file.name);
      if (!sys) { notice = "NOT A GAME FILE"; return null; }
      if (bytes.length > sysDef(sys).max) { notice = "FILE TOO BIG"; return null; }
      const rec = await this.d.store.add(bytes, file.name, { system: sys });
      if (sys === systemId) {
        notice = "ADDED — " + rec.title;
        await this.refresh();
        cursor = Math.max(0, romList.findIndex(r => r.id === rec.id));
      } else {
        /* 다른 시스템 것이었습니다. 어디로 갔는지 알려줘야 찾습니다. */
        notice = "ADDED TO " + sysDef(sys).name;
        await this.refresh();
      }
      return rec;
    } catch (e) {
      notice = "COULD NOT ADD FILE";
      return null;
    }
  },

  /* ── 여러 개 한꺼번에 넣기 (파일 여러 개 / 폴더째) ────────────────────
     폴더를 고르면 **그 안에 있는 것이 전부** 들어옵니다.
     사진, 설명서, 하위 폴더까지 섞여 있습니다. 그래서 두 번 거릅니다.
       1차 — 이름이 .gb / .gbc / .gba 인 것만
       2차 — 파일 속 고정 바이트를 보고 진짜 롬인 것만
     (이름만 보면 안 됩니다. 확장자만 바꿔놓은 파일이 흔합니다.)

     onProgress(지금, 전체) 로 진행 상황을 알려줍니다.
     ★ 이걸 안 보여주면 200개 넣는 동안 아드님은 고장난 줄 압니다.       */
  async addRoms(files, onProgress) {
    const empty = { added:0, dup:0, bad:0, big:0, failed:0, over:0,
                    stopped:false, total:0, elsewhere:0 };
    /* ★ 확인창이 떠 있는 동안은 넣지 않습니다. 그런데 전에는 **말없이**
         돌아섰습니다. 12개짜리 zip 을 넣는 중에 아드님이 게임 하나를 길게
         눌러 삭제창을 띄웠다 KEEP 을 누르면, 12개가 통째로 사라진 채
         목록도 안내칸도 그대로였습니다. 어디로 갔는지 알 방법이 없습니다. */
    if (pending) { this.warn("FINISH THE QUESTION FIRST"); return empty; }
    const all = Array.from(files || []);
    const cand = all.filter(f => f && ROM_EXT.test(f.name || ""));
    const over = Math.max(0, cand.length - MAX_IMPORT);
    const use  = cand.slice(0, MAX_IMPORT);

    let added = 0, dup = 0, bad = 0, big = 0, failed = 0, streak = 0,
        stopped = false, elsewhere = 0;
    /* ★ 실패를 **읽기 실패와 저장 실패로 나눠서** 셉니다.
         전에는 3연속으로 실패해야만 "STORAGE FULL?" 이 떴습니다.
         그래서 게임 하나짜리 zip 을 용량이 꽉 찬 폰에 넣으면
         "ADDED 0 / 1 FAILED" 만 뜨고 **용량 이야기가 안 나왔습니다.**
         아드님은 zip 이 잘못된 줄 알고 다시 받으러 갑니다. */
    let failSave = 0, failRead = 0;
    /* ★ 넣는 도중에 아드님이 시스템을 바꿀 수 있습니다. 그때 "다른 데로 간
         개수" 가 도중에 뜻이 바뀌면 숫자가 거짓말이 됩니다. 시작할 때의
         목록을 기준으로 셉니다. */
    const startedIn = systemId;
    /* 이미 가지고 있는 것 — 다시 넣어도 "새로 넣었다"고 세지 않게.
       ★ 지금 목록(한 시스템)만 보면 안 됩니다. 다른 시스템에 이미 있는
         것을 "새로 넣었다"고 세면 숫자가 거짓말이 됩니다. */
    let known = new Set();
    try { known = new Set((await this.d.store.list()).map(r => r.id)); }
    catch (e) { known = new Set(romList.map(r => r.id)); }

    let done = 0;                 /* 실제로 손대본 개수 (중간에 그만둘 때 씁니다) */
    for (let i = 0; i < use.length; i++) {
      done = i + 1;
      const f = use[i];
      if (onProgress) { try { onProgress(i + 1, use.length); } catch (e) {} }
      /* ★ 몇 개마다 한 번씩 화면에 그릴 틈을 줍니다.
           안 그러면 끝날 때까지 화면이 통째로 얼어붙습니다. */
      if (i % 4 === 0) await new Promise(r => setTimeout(r, 0));

      /* ★ 걸러낸 것도 streak 을 되돌립니다.
           안 그러면 "롬 아닌 파일 150개 사이에 실패 3개가 흩어져 있는"
           멀쩡한 폴더에서 저장공간이 찼다며 중간에 그만둡니다. */
      if (f.size > MAX_ANY_BYTES) { big++; streak = 0; continue; }
      let bytes = null;
      try { bytes = await this.d.readFile(f); }
      catch (e) { failed++; failRead++; streak++; if (streak >= GIVE_UP_AFTER) { stopped = "READ"; break; } continue; }

      const sys = this.d.detectSystem(bytes, f.name);
      if (!sys) { bad++; streak = 0; continue; }
      if (bytes.length > sysDef(sys).max) { big++; streak = 0; continue; }
      try {
        const rec = await this.d.store.add(bytes, f.name, { system: sys });
        streak = 0;
        if (known.has(rec.id)) dup++;
        else {
          known.add(rec.id);
          added++;
          if (sys !== startedIn) elsewhere++;
        }
      } catch (e) {
        /* 저장 공간이 찼을 때가 대부분입니다. 계속 해봐야 다 실패합니다. */
        failed++; failSave++; streak++;
        if (streak >= GIVE_UP_AFTER) { stopped = "SAVE"; break; }
      }
    }

    await this.refresh();
    const parts = [];
    /* ★ 왜 그만뒀는지를 나눠서 씁니다.
         전에는 못 읽은 것도 "저장공간이 찼다" 고 나왔습니다. 정반대 진단입니다. */
    if (stopped === "SAVE") parts.push("STOPPED — STORAGE FULL?");
    else if (stopped === "READ") parts.push("STOPPED — CANNOT READ FILES");
    /* ★ 3연속까지 못 갔어도 **이유는 말해줘야** 합니다. 게임이 한두 개뿐인
         zip 은 아무리 실패해도 연속 3회가 안 나옵니다. */
    else if (failSave) parts.push("STORAGE FULL?");
    else if (failRead) parts.push("CANNOT READ FILES");
    parts.push("ADDED " + added);
    /* ★ 중간에 그만뒀으면 **몇 개를 아예 시도조차 안 했는지** 말해줘야 합니다.
         300개를 골랐는데 52번째에서 멈추고 "ADDED 49" 만 뜨면,
         나머지 248개가 어떻게 됐는지 알 길이 없습니다.
         (2026-08-11 교차검사에서 지적) */
    if (stopped && done < use.length) parts.push((use.length - done) + " NOT TRIED");
    if (elsewhere) parts.push(elsewhere + " IN OTHER SYSTEMS");
    if (dup)    parts.push(dup + " ALREADY IN");
    if (bad)    parts.push(bad + " NOT A GAME");
    if (big)    parts.push(big + " TOO BIG");
    if (failed) parts.push(failed + " FAILED");
    if (over)   parts.push(over + " OVER LIMIT " + MAX_IMPORT);
    if (!cand.length) { parts.length = 0; parts.push("NO GAME FILES IN THERE"); }
    notice = parts.join(" / ");
    return { added, dup, bad, big, failed, over, stopped, elsewhere,
             total: use.length, tried: done, notTried: use.length - done };
  },

  /* ── 지우기 — 반드시 한 번 물어봅니다 ────────────────────────────────
     ★ 게임을 지우면 그 게임의 세이브도 같이 사라집니다.
       되돌릴 수 없습니다. 그래서 손가락이 스쳐서 지워지면 안 됩니다.
       길게 눌러서(0.9초) → 화면의 DELETE 버튼. 두 단계입니다.

       ★ v2 — 확인은 **화면에 보이는 [DELETE] [KEEP] 버튼**으로 합니다.
         v1 은 "START 를 눌러 지움" 이었습니다. 목록에서 A 가 늘 "시작"
         이라 A 를 못 쓰는 건 맞았지만, 그렇다고 START 에 파괴적인 일을
         거는 건 배워야 할 규칙이 하나 더 느는 것입니다.
         눈에 보이는 버튼은 배울 것이 없습니다.                          */
  askRemove(i) {
    if (screen !== "list") return false;
    const r = (i === undefined || i === null) ? this.selected() : romList[i];
    if (!r) return false;
    if (r.bundled) { notice = "BUILT-IN — CANNOT DELETE"; return false; }
    if (i !== undefined && i !== null) cursor = i;
    pending = { id: r.id, title: r.title };
    notice = "";
    return true;
  },

  cancelRemove() {
    if (!pending) return false;
    pending = null;
    notice = "KEPT";
    return true;
  },

  async confirmRemove() {
    if (!pending) return false;
    /* ★ 지우기 전에 미리 비웁니다.
         지우는 동안 또 눌러서 두 번 들어오는 걸 막습니다. */
    const { id, title } = pending;
    pending = null;
    try { await this.d.store.remove(id); }
    catch (e) { notice = "COULD NOT DELETE"; return false; }
    notice = "DELETED — " + title;
    await this.refresh();
    return true;
  },

  /* ── 시작 ─────────────────────────────────────────────────────────── */
  async play() {
    /* ★ 지울까 물어보는 중에는 시작하지 않습니다. */
    if (pending) return false;
    /* ★ 목록 화면에서만 시작합니다. 게임 중에 또 부르면 지금 하던 게임을
         소리 없이 다시 켜게 됩니다. */
    if (screen !== "list") return false;
    const r = this.selected();
    if (!r) { notice = "NO GAME"; return false; }
    const sys = r.system || systemId;
    /* ★ 롬을 읽는 동안 사용자가 나갈 수 있습니다.
         지금 세대를 잡아뒀다가 시작할 때 대조합니다.
         · born  — 에뮬레이터 쪽 (engine.stop 이 불렸는가)
         · gen   — 화면 쪽 (목록을 옮겨 다녔는가). 이게 없으면 BACK 을
                   누르고 다른 기기를 골라도 늦게 끝난 play 가 화면을 낚아챕니다. */
    const born = this.d.engine.epoch ? this.d.engine.epoch() : undefined;
    const gen = navGen;
    const abandoned = () => gen !== navGen;

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
    /* ★ 읽는 사이에 목록을 옮겨 다녔으면 조용히 버립니다 (안내도 안 냅니다 —
         아드님은 이미 다른 걸 보고 있고, 자기가 취소한 것이니까요). */
    if (abandoned()) return false;

    /* ★ 시스템마다 에뮬레이터가 다릅니다. 없으면 여기서 멈춥니다.
         (GBA 코어 파일을 안 올렸을 때 검은 화면 대신 이유가 뜹니다.) */
    let core;
    try { core = await this.d.loadCore(sys); }
    catch (e) {
      if (abandoned()) return false;
      notice = sys === "gba" ? "GBA EMULATOR NOT AVAILABLE"
                             : "EMULATOR NOT AVAILABLE";
      return false;
    }
    if (abandoned()) return false;

    /* ★★ 아래 onSram 은 게임이 끝날 때까지 살아 있습니다.
           그래서 **이 클로저가 붙들고 있는 것이 곧 게임 내내 놀고 있는
           메모리**입니다. 예전에는 롬 바이트(GBA 는 최대 32MB)와 보관 기록
           전체를 통째로 붙들고 있었습니다.
           기본 게임일 때만 롬이 필요하므로(기록을 새로 만들어야 하니까),
           그때만 들고 있고 나머지는 id 하나만 남깁니다.                  */
    const isBundled = !!(r.bundled || !rec.id || String(rec.id).startsWith("bundled:"));
    const seedBytes = isBundled ? bytes : null;
    const seedFile  = isBundled ? rec.file : null;
    let sramTarget  = isBundled ? null : rec.id;
    let sramWarned  = false;      /* 저장 실패를 한 번만 알리려고 */

    let started;
    try {
      started = this.d.engine.start(core, bytes, {
        system: sys,
        canvas: this.d.canvas,
        colorReal,
        sram: sram || undefined,
        /* 게임이 스스로 저장하면 여기로 옵니다. 저장소에 넣어둔 롬은
           아직 보관 기록이 없으니 이때 하나 만들어 둡니다. */
        /* ★ 실패하면 **거절된 약속을 그대로 돌려줍니다.**
             game.js 가 그걸 보고 표시를 되살려 3초 뒤에 다시 시도합니다.
             예전에는 여기서 통째로 삼켜서, 저장공간이 차면 게임 안의
             저장이 아무 말 없이 영영 사라졌습니다. */
        onSram: async b => {
          try {
            if (!sramTarget) {
              /* ★ 어느 기본 게임에서 나온 기록인지 표시해 둡니다 —
                   파일 이름으로 짝을 맞추면 남의 롬이 기본 게임을 밀어냅니다. */
              const made = await this.d.store.add(seedBytes, seedFile,
                             { fromBundled: seedFile, system: sys });
              if (!made || !made.id) throw new Error("no-record");
              sramTarget = made.id;
            }
            await this.d.store.patch(sramTarget, { sram:b });
            /* 성공했으면 아까 띄운 경고만 걷어냅니다.
               ★ 다른 안내(예: "SAVED TO SLOT 1")까지 지우면 안 됩니다. */
            if (sramWarned) {
              sramWarned = false;
              if (notice === SRAM_FAIL) { notice = ""; if (this.d.redraw) this.d.redraw(); }
            }
          } catch (e) {
            /* ★★ 화면에 **실제로 띄워야** 합니다 — 조용히 잃는 것이 제일 나쁩니다.
                 이 콜백은 3초짜리 타이머에서 불립니다. notice 만 바꿔놓으면
                 아무도 다시 그리지 않아서 **화면에는 영영 안 나옵니다.**
                 게다가 MENU 를 열면 openMenu 가 notice 를 지웁니다.
                 그래서 (1) 직접 다시 그리고 (2) 실패할 때마다 다시 세웁니다.
                 (한 번만 띄우고 잠가뒀더니 놓치면 끝이었습니다 —
                  2026-08-11 최종 점검에서 잡았습니다.) */
            sramWarned = true;
            notice = SRAM_FAIL;
            if (this.d.redraw) this.d.redraw();
            throw e;
          }
        },
      }, born);
    } catch (e) {
      notice = (e && e.message === "BAD ROM") ? "BAD ROM FILE" : "COULD NOT START";
      return false;
    }

    /* 읽는 사이에 나갔으면 start 가 null 을 줍니다. 화면을 넘기지 않습니다. */
    if (started === null) return false;

    /* ★ 롬을 읽고 에뮬레이터를 준비하는 동안 (구형 폰에서 1~3초)
         다른 손가락이 줄을 길게 눌러 "지울까요?" 를 띄울 수 있습니다.
         v1 에서는 그게 게임 화면까지 따라와 **구석 버튼이 KEEP 이 되고
         눌러도 아무 데도 안 갔습니다.** 게임 중 유일한 탈출구가 막혔습니다.

       ★ v2 에서는 이 한 줄이 없어도 그 사고가 안 납니다 — 구조가 바뀌었습니다.
           · state.confirm 은 **목록 화면일 때만** 내보냅니다
           · cornerLabel() 의 KEEP 도 목록 화면일 때만
           · corner() · openMenu() · quit() 이 각자 pending 을 풉니다
         2026-08-11 방해검사에서 이 줄을 빼고 검사 665개를 전부 돌려봤는데
         **관측되는 차이가 하나도 없었습니다.** 즉 지금은 중복 방어입니다.

         그래도 남겨둡니다. 위 세 곳 중 하나라도 나중에 손대면 다시
         살아나는 사고이고, 비용은 한 줄이기 때문입니다.
         (지우기 쪽을 포기합니다 — 되돌릴 수 없는 쪽을 버리는 게 맞습니다.) */
    pending = null;
    playing = slimRec(rec, sys);        /* ★ 롬 바이트는 안 들고 있습니다 */
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
    pending = null;                 /* 게임 화면까지 따라온 물음표는 여기서도 풉니다 */
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
        const made = await this.d.store.add(raw, playing.file,
                       { fromBundled: playing.file, system: playing.system || systemId });
        /* ★ 저장소가 빈 값을 돌려줄 수도 있습니다. 그때 playing 을 덮어쓰면
             null 이 되어 **그 뒤로 저장·불러오기가 영영 안 됩니다.**
             (메뉴에 게임 이름도 사라지고 칸이 전부 EMPTY 로 보입니다.)
             그러니 제대로 된 것을 받았을 때만 갈아끼웁니다. */
        if (!made || !made.id) { notice = "SAVE FAILED"; return false; }
        playing = slimRec(made, playing.system) || playing;
        id = made.id;
      }
      /* ★ 어느 롬의 세이브인지 함께 적어둡니다.
           스테이트 안에는 게임 신원이 없어서, 크기만 같으면
           남의 세이브가 그대로 들어가 화면이 깨집니다.
         ★ 시스템도 같이 적습니다. 코어가 둘이라 GBA 스테이트를
           게임보이에 넣는 사고가 새로 생길 수 있습니다.
         ★★ 한 칸만 **한 트랜잭션 안에서** 바꿉니다 (store.putSlot).
            읽고-쓰기를 나누면 두 칸을 연달아 저장할 때 하나가 사라집니다. */
      const slot = { rom: id, system: playing.system || systemId, bytes };
      /* ★ putSlot 은 반드시 있어야 합니다. 예전에는 없을 때를 대비해
           "읽고 → 고치고 → 쓰기" 폴백을 뒀는데, **그 폴백이 바로 putSlot 이
           고치려던 버그(두 칸을 연달아 저장하면 하나가 사라짐)를 그대로
           갖고 있었습니다.** 안 쓰이는 버그 있는 길을 남겨두면, 언젠가
           누가 그 길로 빠졌을 때 아무도 모릅니다. 그래서 없앴습니다. */
      const done = await this.d.store.putSlot(id, n, slot);
      if (!done) { notice = "SAVE FAILED"; return false; }
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
      if (slot.system && slot.system !== (playing.system || systemId)) {
        notice = "SLOT BELONGS TO ANOTHER SYSTEM"; return false;
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
    navGen++;
    this.d.engine.stop();
    playing = null;
    pending = null;
    /* 메뉴를 거쳐 나왔을 때만 목록 자리를 되돌립니다.
       안 거쳤으면 지금 커서가 맞는 자리입니다. */
    if (screen === "menu") cursor = listCursor;
    screen = "list";
    notice = "";
    return this.refresh();
  },

  /* 템패드로 나갈 때 */
  exitToTempad() {
    navGen++;
    this.d.engine.stop();
    playing = null;
    pending = null;
    screen = "system";
    notice = "";
    if (this.d.onExit) this.d.onExit();
  },

  /* ── 버튼 ─────────────────────────────────────────────────────────────
     ★★ v2 — 게임 중에만 에뮬레이터로 넘깁니다. 그리고 **그게 전부입니다.**
       메뉴에서 누른 게 게임에 들어가면 안 되고, 게임 버튼이 메뉴를
       움직여서도 안 됩니다. 목록·메뉴를 움직이는 것은 손가락(tapRow /
       tapMenu / corner)과, 보조로 붙인 십자키 뿐입니다.               */
  press(name, down) {
    if (screen !== "play") return false;
    this.d.engine.press(name, down);
    return true;
  },

  /* 시험용 */
  _reset() {
    screen = "system"; systemId = "gb"; romList = [];
    cursor = 0; listCursor = 0; playing = null; notice = "";
    pending = null; colorReal = false; padVisible = true;
  },
};

const UiApi = { Ui, SYSTEMS, BUNDLED,
                MAX_IMPORT, MAX_ANY_BYTES, ROM_EXT, sysDef };
if (typeof window !== "undefined") window.GameUi = UiApi;
if (typeof module !== "undefined" && module.exports) module.exports = UiApi;
