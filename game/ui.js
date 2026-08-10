/* ============================================================================
   TVA FIELD UNIT — 화면 흐름

   SELECT SYSTEM → 게임 목록 → 플레이 → MENU(저장/불러오기/종료)

   game.js 가 에뮬레이터와 보관을 맡고, 이 파일은 화면만 맡습니다.
   그래서 화면 없이도 흐름을 검사할 수 있습니다. (test/ui.js)
   ========================================================================== */

"use strict";

/* ── 새 상태값은 맨 위에 ─────────────────────────────────────────────── */
let screen   = "system";   /* system | list | library | play | menu */
let systemId = "gb";       /* gb (게임보이) | gw (게임&워치) */
let romList  = [];         /* 목록에 보이는 것 */
let cursor   = 0;          /* 목록에서 고른 자리 */
let playing  = null;       /* 지금 하는 게임의 기록 */
let slotPick = 0;          /* 저장 칸 1~3 */
let notice   = "";         /* 화면 아래 한 줄 안내 */
let listCursor = 0;        /* 메뉴에 들어가기 전 목록에서 있던 자리 */
let pending  = null;       /* 지우기 확인 중인 게임 {id,title} — 없으면 null */
let libFrom  = 0;          /* 라이브러리 메뉴에 들어오기 전 목록에서 있던 자리 */

/* ── 폴더째 넣을 때의 한계값 ───────────────────────────────────────────
   폴더를 고르면 그 안에 있는 걸 **전부** 받습니다. 롬 묶음 폴더에는
   수백 개가 들어 있기도 하고, 엉뚱한 큰 파일이 섞여 있기도 합니다.
   막지 않으면 폰 저장공간이 꽉 차거나 화면이 몇 분씩 얼어붙습니다. */
const MAX_ROM_BYTES = 8 * 1024 * 1024;  /* 게임보이 롬은 아무리 커도 8MB */
const MAX_IMPORT    = 300;              /* 한 번에 넣을 수 있는 개수 */
const GIVE_UP_AFTER = 3;                /* 연달아 이만큼 실패하면 그만둡니다 */

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
             /* 지우기를 물어보는 중이면 그 게임 이름. 아니면 null.
                화면 쪽은 이것만 보고 확인창을 띄웁니다. */
             /* ★ 목록 화면일 때만 내보냅니다. 다른 화면에 물음표가 뜨면
                  화면과 버튼 뜻이 어긋나 갇힙니다. */
             confirm: (pending && screen === "list") ? { title: pending.title } : null,
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
    /* ★★ 예전에는 **파일 이름**으로 짝을 맞췄습니다. 위험했습니다. ★★
         롬 묶음 폴더에는 `2048.gb` `tobu.gb` 같은 흔한 이름이 거의 반드시
         들어 있습니다. 그게 들어오면 **기본 게임이 목록에서 사라지고**
         남의 롬이 기본 게임의 이름과 라이선스 표기를 뒤집어썼습니다.
         (그리고 지울 수도 있게 돼서, 지우면 기본 게임이 영영 없어졌습니다.)

         이제는 "기본 게임에서 만들어진 기록" 에만 표시(fromBundled)를
         붙여두고 그것만 짝을 맞춥니다. 이름은 보지 않습니다.            */
    const byName = new Map(BUNDLED.map(b => [b.file, b]));
    const shown = saved.map(r => {
      const b = r.fromBundled ? byName.get(r.fromBundled) : null;
      return b ? { ...r, title:b.title, note:b.note } : r;
    });
    const taken = new Set(saved.map(r => r.fromBundled).filter(Boolean));
    const bundled = BUNDLED
      .filter(b => !taken.has(b.file))
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
    pending = null;
    return this.refresh();
  },

  /* ── 지금 화면의 목록 길이 ──────────────────────────────────────────
     화면마다 고를 것이 다릅니다. 이걸 안 나누면 메뉴에서 커서가
     엉뚱한 데까지 갑니다.                                             */
  rows() {
    if (screen === "system")  return SYSTEMS.length;
    if (screen === "menu")    return this.menuItems().length;
    if (screen === "library") return this.libraryItems().length;
    return romList.length;
  },

  /* ── 라이브러리 메뉴 ──────────────────────────────────────────────────
     버튼이 A·B·SELECT·START 넷뿐이라 넣기·폴더넣기·지우기를 전부
     버튼에 걸 수 없습니다. 그래서 한 자리에 모읍니다.

     ★ ADD FOLDER 는 **어느 기기에서나 있습니다.**
       아이폰 사파리는 진짜 폴더 고르기를 못 하지만, 그렇다고 항목을
       없애면 "내 폰엔 왜 없지" 가 됩니다. 대신 파일 여러 개 고르기가
       열리고, 무엇을 하면 되는지 아래 설명에 적어줍니다.           */
  libraryItems(canFolder) {
    const r = romList[libFrom] || null;
    return [
      { key:"file",   label:"ADD FILE",   sub:"ONE OR MORE" },
      { key:"folder", label:"ADD FOLDER",
        sub: canFolder === false ? "PICK ALL INSIDE" : "EVERYTHING INSIDE" },
      { key:"remove", label:"REMOVE",
        sub: !r ? "NO GAME" : (r.bundled ? "BUILT-IN" : r.title) },
      { key:"back",   label:"BACK",       sub:"GAME LIST" },
    ];
  },

  openLibrary() {
    if (screen !== "list" || pending) return false;
    /* 게임&워치 목록은 저장소를 안 봅니다 — 거기서 넣으면 사라집니다 */
    if (systemId !== "gb") { notice = "GAME BOY LIST ONLY"; return false; }
    libFrom = cursor;
    screen = "library";
    cursor = 0;
    notice = "";
    return true;
  },

  closeLibrary() {
    if (screen !== "library") return false;
    screen = "list";
    cursor = libFrom;
    return true;
  },

  /* A 를 눌렀을 때. 무엇을 해야 하는지 화면 쪽에 알려줍니다.
       "file" | "folder"  → 파일 고르는 창을 열어라
       "asked"            → 지울까 물어보는 중이다
       "refused" | "back" → 목록으로 돌아왔다                         */
  chooseLibrary() {
    const it = this.libraryItems()[cursor];
    if (!it) return null;
    if (it.key === "back") { this.closeLibrary(); return "back"; }
    if (it.key === "remove") {
      /* ★ 목록으로 먼저 돌아간 뒤에 물어봅니다.
           지우기 확인은 목록 화면에서만 뜨게 되어 있습니다
           (다른 화면에 뜨면 버튼 뜻이 어긋나 갇힙니다). */
      const at = libFrom;
      this.closeLibrary();
      return this.askRemove(at) ? "asked" : "refused";
    }
    /* 파일 창은 목록 화면 위에 열립니다. 먼저 돌아가 둡니다. */
    this.closeLibrary();
    return it.key;
  },

  move(delta) {
    /* ★ 지울까 물어보는 중에는 커서가 움직이면 안 됩니다.
         움직이면 "무엇을 지우는지" 와 화면이 어긋납니다. */
    if (pending) return;
    const n = this.rows();
    if (!n) return;
    cursor = (cursor + delta + n) % n;
  },

  /* 손가락으로 줄을 직접 눌렀을 때 (십자키 말고) */
  setCursor(i) {
    if (pending) return false;
    if (!(i >= 0) || i >= this.rows()) return false;
    cursor = i;
    return true;
  },

  list() { return romList; },
  selected() { return romList[cursor] || null; },
  systemName() {
    const s = SYSTEMS.find(x => x.id === systemId);
    return s ? s.name : "";
  },
  backToSystem() { screen = "system"; cursor = 0; notice = ""; pending = null; },
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
    /* 지울까 물어보는 중에는 이 버튼이 "안 지움" 입니다.
       ★ 반드시 목록 화면일 때만입니다. 게임 중에 이게 KEEP 이 되면
         유일한 탈출구가 막힙니다. */
    if (pending && screen === "list") return "KEEP";
    if (screen === "play")    return "MENU";
    if (screen === "menu")    return "RESUME";
    if (screen === "library") return "LIST";
    if (screen === "list")    return "SYSTEM";
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
    /* ★ 지울까 물어보는 중이면 이 버튼은 "안 지움" 입니다.
         여기서 화면을 옮겨버리면 물음표만 남고 답을 못 합니다.
         ★ 목록 화면일 때만. 다른 화면이면 물음표만 조용히 걷어내고
           원래 하던 일(메뉴 열기 등)을 그대로 합니다. */
    if (pending) {
      pending = null;
      if (screen === "list") { notice = "KEPT"; return "list"; }
    }
    if (screen === "play")    { this.openMenu(); return "menu"; }
    if (screen === "menu")    { this.closeMenu(); return "play"; }
    if (screen === "library") { this.closeLibrary(); return "list"; }
    if (screen === "list")    { this.backToSystem(); return "system"; }
    return "stay";              /* 기기 고르는 화면에서는 아무 일도 안 함 */
  },

  /* ── 롬 넣기 ──────────────────────────────────────────────────────── */
  async addRom(file) {
    if (pending) return null;      /* 지울까 물어보는 중에는 안 받습니다 */
    /* ★★ 게임&워치 목록은 저장소를 안 봅니다(refresh 맨 윗줄).
           거기서 받으면 "넣었다"고 해놓고 화면에는 아무것도 안 나옵니다. */
    if (systemId !== "gb") { notice = "GAME BOY LIST ONLY"; return null; }
    if (!file) return null;
    /* ★ 크기를 여기서도 봅니다.
         전에는 파일이 딱 하나일 때 이 검사를 통째로 건너뛰었습니다.
         폴더를 잘못 골라 4GB 짜리 동영상이 걸리면 앱이 그냥 죽습니다. */
    if (file.size > MAX_ROM_BYTES) { notice = "FILE TOO BIG"; return null; }
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

  /* ── 여러 개 한꺼번에 넣기 (파일 여러 개 / 폴더째) ────────────────────
     폴더를 고르면 **그 안에 있는 것이 전부** 들어옵니다.
     사진, 설명서, 하위 폴더까지 섞여 있습니다. 그래서 두 번 거릅니다.
       1차 — 이름이 .gb / .gbc 인 것만
       2차 — 파일 속 닌텐도 로고를 보고 진짜 게임보이 롬인 것만
     (이름만 보면 안 됩니다. 확장자만 바꿔놓은 파일이 흔합니다.)

     onProgress(지금, 전체) 로 진행 상황을 알려줍니다.
     ★ 이걸 안 보여주면 200개 넣는 동안 아드님은 고장난 줄 압니다.       */
  async addRoms(files, onProgress) {
    if (pending) return { added:0, dup:0, bad:0, failed:0, over:0, stopped:false, total:0 };
    if (systemId !== "gb") {
      notice = "GAME BOY LIST ONLY";
      return { added:0, dup:0, bad:0, failed:0, over:0, stopped:false, total:0 };
    }
    const all = Array.from(files || []);
    const cand = all.filter(f => f && /\.gbc?$/i.test(f.name || ""));
    const over = Math.max(0, cand.length - MAX_IMPORT);
    const use  = cand.slice(0, MAX_IMPORT);

    let added = 0, dup = 0, bad = 0, big = 0, failed = 0, streak = 0, stopped = false;
    /* 이미 가지고 있는 것 — 다시 넣어도 "새로 넣었다"고 세지 않게 */
    const known = new Set(romList.map(r => r.id));

    for (let i = 0; i < use.length; i++) {
      const f = use[i];
      if (onProgress) { try { onProgress(i + 1, use.length); } catch (e) {} }
      /* ★ 몇 개마다 한 번씩 화면에 그릴 틈을 줍니다.
           안 그러면 끝날 때까지 화면이 통째로 얼어붙습니다. */
      if (i % 4 === 0) await new Promise(r => setTimeout(r, 0));

      /* ★ 걸러낸 것도 streak 을 되돌립니다.
           안 그러면 "롬 아닌 파일 150개 사이에 실패 3개가 흩어져 있는"
           멀쩡한 폴더에서 저장공간이 찼다며 중간에 그만둡니다. */
      if (f.size > MAX_ROM_BYTES) { big++; streak = 0; continue; }
      let bytes = null;
      try { bytes = await this.d.readFile(f); }
      catch (e) { failed++; streak++; if (streak >= GIVE_UP_AFTER) { stopped = "READ"; break; } continue; }
      if (!this.d.looksLikeGb(bytes)) { bad++; streak = 0; continue; }
      try {
        const rec = await this.d.store.add(bytes, f.name);
        streak = 0;
        if (known.has(rec.id)) dup++; else { known.add(rec.id); added++; }
      } catch (e) {
        /* 저장 공간이 찼을 때가 대부분입니다. 계속 해봐야 다 실패합니다. */
        failed++; streak++;
        if (streak >= GIVE_UP_AFTER) { stopped = "SAVE"; break; }
      }
    }

    await this.refresh();
    const parts = [];
    /* ★ 왜 그만뒀는지를 나눠서 씁니다.
         전에는 못 읽은 것도 "저장공간이 찼다" 고 나왔습니다. 정반대 진단입니다. */
    if (stopped === "SAVE") parts.push("STOPPED — STORAGE FULL?");
    if (stopped === "READ") parts.push("STOPPED — CANNOT READ FILES");
    parts.push("ADDED " + added);
    if (dup)    parts.push(dup + " ALREADY IN");
    if (bad)    parts.push(bad + " NOT GAME BOY");
    if (big)    parts.push(big + " TOO BIG");
    if (failed) parts.push(failed + " FAILED");
    if (over)   parts.push(over + " OVER LIMIT " + MAX_IMPORT);
    if (!cand.length) parts.length = 0, parts.push("NO .GB FILES IN THERE");
    notice = parts.join(" / ");
    return { added, dup, bad, big, failed, over, stopped, total: use.length };
  },

  /* ── 지우기 — 반드시 한 번 물어봅니다 ────────────────────────────────
     ★ 게임을 지우면 그 게임의 세이브도 같이 사라집니다.
       되돌릴 수 없습니다. 그래서 손가락이 스쳐서 지워지면 안 됩니다.
       길게 눌러서(0.9초) → 다시 START 로 확인. 두 단계입니다.

       ★ 확인은 A 가 아니라 START 입니다.
         목록에서 A 는 늘 "게임 시작" 이었습니다. 그 손버릇 그대로
         A 를 누르면 게임이 사라집니다. 평소에 안 쓰던 버튼으로 옮겼습니다.
         (화면 쪽 처리는 index.html 의 onPress 에 있습니다.)             */
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

  /* 예전 방식 (SELECT 버튼으로 바로 지우기). 지금 화면에서는 안 씁니다. */
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
    /* ★ 지울까 물어보는 중에 A 는 "지운다" 는 뜻입니다.
         여기까지 오면 안 됩니다. 혹시 몰라 한 번 더 막습니다. */
    if (pending) return false;
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
              /* ★ 어느 기본 게임에서 나온 기록인지 표시해 둡니다 */
              const made = await this.d.store.add(bytes, rec.file, { fromBundled: rec.file });
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

    /* ★★ 롬을 읽고 에뮬레이터를 준비하는 동안 (구형 폰에서 1~3초)
           다른 손가락이 줄을 길게 눌러 "지울까요?" 를 띄울 수 있습니다.
           그대로 두면 게임 화면인데 pending 이 살아 있어서
           **MENU 버튼에 KEEP 이라고 찍히고 눌러도 아무 데도 안 갑니다.**
           게임 중 유일한 탈출구가 막히는 것이라 반드시 여기서 풉니다.
           (지우기 쪽을 포기합니다 — 되돌릴 수 없는 쪽을 버리는 게 맞습니다.) */
    pending = null;
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
        const made = await this.d.store.add(raw, playing.file, { fromBundled: playing.file });
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
    pending = null;
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
    pending = null;
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
    pending = null; libFrom = 0;
  },
};

const UiApi = { Ui, SYSTEMS, BUNDLED, GW_GAMES, MAX_ROM_BYTES, MAX_IMPORT };
if (typeof window !== "undefined") window.GameUi = UiApi;
if (typeof module !== "undefined" && module.exports) module.exports = UiApi;
