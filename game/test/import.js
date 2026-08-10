/* ============================================================================
   폴더째 넣기 + 길게 눌러 지우기 검사

   두 기능 다 **되돌릴 수 없는 일**을 합니다.
     · 넣기 — 폰 저장공간을 먹습니다. 잘못 들어온 게 200개면 골치입니다.
     · 지우기 — 세이브까지 같이 사라집니다.
   그래서 "잘 되는 경우" 보다 **"안 되어야 하는 경우"** 를 더 많이 봅니다.
   ========================================================================== */
"use strict";
const path = require("path");
const UI = path.join(__dirname, "..", "ui.js");

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log("  OK   " + n); }
  else   { fail++; console.log("  ★실패 " + n + (x !== undefined ? "  → " + x : "")); }
};

const LOGO = [0xCE,0xED,0x66,0x66,0xCC,0x0D,0x00,0x0B,0x03,0x73,0x00,0x83,
              0x00,0x0C,0x00,0x0D];

/* 가짜 롬 파일. seed 가 같으면 내용이 같습니다(= 같은 게임). */
function romFile(name, seed, opt = {}) {
  const size = opt.size || 0x8000;
  const b = new Uint8Array(size);
  if (opt.valid !== false && size >= 0x150) LOGO.forEach((v, i) => b[0x104 + i] = v);
  /* 내용으로 신원을 만들 수 있게 seed 를 심습니다 */
  b[0x200] = (seed || 0) & 0xFF;
  return { name, size: opt.reportedSize !== undefined ? opt.reportedSize : size, bytes: b };
}

function fresh(opt = {}) {
  delete require.cache[require.resolve(UI)];
  const { Ui } = require(UI);
  const db = new Map();
  let addCalls = 0;

  const store = {
    async list() {
      return [...db.values()].map(r => ({
        id:r.id, title:r.title, file:r.file, fromBundled:r.fromBundled||null, size:r.size,
        hasSram:!!r.sram, states:(r.states||[null,null,null]).map(x => !!x),
        played:r.played||0, added:r.added||0 }));
    },
    /* ★ 진짜 저장소와 같게 **내용으로 신원을 만듭니다.**
         이름이 달라도 같은 게임이면 같은 칸에 들어갑니다.
         이게 "중복은 안 센다" 를 검사할 수 있게 해줍니다. */
    async add(bytes, name, extra) {
      addCalls++;
      if (opt.addFails) throw new Error("QuotaExceededError");
      if (opt.addFailsFrom !== undefined && addCalls > opt.addFailsFrom)
        throw new Error("QuotaExceededError");
      const id = "rom" + bytes[0x200] + ":" + bytes.length;
      const old = db.get(id);
      const rec = { id, title:(name||"").replace(/\.[^.]*$/, "").toUpperCase(),
                    file:name, size:bytes.length, rom:bytes,
                    fromBundled:(extra && extra.fromBundled) || null,
                    sram: old ? old.sram : null,
                    states: old ? old.states : [null,null,null],
                    played: old ? old.played : 0, added: old ? old.added : Date.now() };
      /* ★ 진짜(game.js:206-217)와 같게, 이미 있으면 **처음 것을 지킵니다.**
           가짜가 덮어쓰게 두면 "다시 넣어도 이름이 안 바뀐다" 는 규약이
           검사에서 통째로 빠집니다. */
      if (old) {
        rec.file        = old.file || rec.file;
        rec.title       = old.title || rec.title;
        rec.fromBundled = old.fromBundled || rec.fromBundled;
      }
      db.set(id, rec);
      return rec;
    },
    async get(id) { return db.get(id) || null; },
    async patch(id, ch) { const r = db.get(id); if (r) Object.assign(r, ch); return r || null; },
    async remove(id) { if (opt.removeFails) throw new Error("nope"); db.delete(id); },
  };

  const engine = {
    start(){ return {}; }, stop(){}, pause(){}, resume(){},
    isRunning:() => false, press(){}, saveState:() => null, loadState:() => false,
  };

  const ui = new Ui({
    store, engine,
    readFile: async f => { if (opt.readFails) throw new Error("io"); return f.bytes; },
    looksLikeGb: b => {
      if (!b || b.length < 0x150) return false;
      for (let i = 0; i < LOGO.length; i++) if (b[0x104 + i] !== LOGO[i]) return false;
      return true;
    },
    fetchRom: async () => new Uint8Array(0x8000),
    loadWasm: async () => ({}),
    canvas: null,
  });
  ui._reset();
  return { ui, db, get addCalls(){ return addCalls; } };
}

/* 목록 화면까지 가 있는 상태로 시작 (기본 게임 5개가 들어 있습니다) */
async function atList(opt) {
  const t = fresh(opt);
  await t.ui.pickSystem("gb");
  return t;
}

async function main() {

  /* ═══ 1. 여러 개 넣기 ═══════════════════════════════════════════════ */
  console.log("\n[1] 파일 여러 개 / 폴더째 넣기");
  {
    const t = await atList();
    const r = await t.ui.addRoms([
      romFile("a.gb", 1), romFile("b.gb", 2), romFile("c.gbc", 3),
    ]);
    ok("셋 다 들어감", r.added === 3, JSON.stringify(r));
    ok("저장소에 셋", t.db.size === 3, t.db.size);
    ok("목록에 기본5 + 새로3", t.ui.state.count === 8, t.ui.state.count);
  }

  /* ★ 폴더를 고르면 롬이 아닌 것이 잔뜩 딸려옵니다. 이게 핵심입니다. */
  {
    const t = await atList();
    const r = await t.ui.addRoms([
      romFile("game.gb", 1),
      { name:"cover.png",  size:2000, bytes:new Uint8Array(2000) },
      { name:"readme.txt", size:100,  bytes:new Uint8Array(100) },
      { name:"list.csv",   size:10,   bytes:new Uint8Array(10) },
    ]);
    ok("롬 아닌 이름은 아예 안 셈", r.added === 1 && r.bad === 0, JSON.stringify(r));
    ok("저장소엔 하나만", t.db.size === 1, t.db.size);
  }

  /* ★ 이름만 .gb 로 바꿔놓은 파일 — 이름으로는 못 거릅니다 */
  {
    const t = await atList();
    const r = await t.ui.addRoms([
      romFile("real.gb", 1),
      romFile("fake.gb", 2, { valid:false }),          /* 로고 없음 */
      romFile("tiny.gb", 3, { size:100 }),             /* 너무 작음 */
    ]);
    ok("속을 보고 가짜를 거름", r.added === 1 && r.bad === 2, JSON.stringify(r));
  }

  /* ★ 같은 게임이 이름만 다르게 두 번 — 두 번 세면 안 됩니다 */
  {
    const t = await atList();
    const r = await t.ui.addRoms([
      romFile("Tetris.gb", 7),
      romFile("Tetris (USA).gb", 7),                   /* 내용 같음 */
      romFile("other.gb", 8),
    ]);
    ok("같은 게임은 중복으로 셈", r.added === 2 && r.dup === 1, JSON.stringify(r));
    ok("저장소에도 둘만", t.db.size === 2, t.db.size);
  }

  /* ★ 이미 가지고 있는 것을 또 넣으면 */
  {
    const t = await atList();
    await t.ui.addRoms([romFile("a.gb", 1)]);
    const r = await t.ui.addRoms([romFile("a.gb", 1), romFile("b.gb", 2)]);
    ok("이미 있던 건 새로 넣은 걸로 안 셈", r.added === 1 && r.dup === 1, JSON.stringify(r));
  }

  /* ★ 이미 있던 게임의 세이브가 살아남아야 합니다 */
  {
    const t = await atList();
    await t.ui.addRoms([romFile("a.gb", 1)]);
    const id = [...t.db.keys()][0];
    await t.db.get(id).states[0] === undefined;
    t.db.get(id).states = [{ rom:id, bytes:new Uint8Array([9]) }, null, null];
    await t.ui.addRoms([romFile("a.gb", 1)]);
    ok("다시 넣어도 세이브 안 날아감", !!t.db.get(id).states[0]);
  }

  /* ★ 너무 큰 파일 (게임보이 롬은 8MB 를 넘지 않습니다) */
  {
    const t = await atList();
    const r = await t.ui.addRoms([
      romFile("ok.gb", 1),
      { name:"huge.gb", size:50 * 1024 * 1024, bytes:new Uint8Array(0x8000) },
    ]);
    ok("8MB 넘는 건 안 읽음", r.added === 1 && r.big === 1, JSON.stringify(r));
    ok("너무 크다고 따로 알려줌", /TOO BIG/.test(t.ui.state.notice), t.ui.state.notice);
  }

  /* ★★ 파일 하나만 골랐을 때도 크기 검사를 해야 합니다.
         전에는 개수가 1이면 addRom 으로 새서 검사를 통째로 건너뛰었습니다.
         폴더를 잘못 골라 4GB 동영상 하나가 걸리면 앱이 죽습니다. */
  {
    const t = await atList();
    const huge = { name:"movie.gb", size:4 * 1024 * 1024 * 1024, bytes:new Uint8Array(0x8000) };
    ok("★ 하나만 골라도 큰 파일은 거부", (await t.ui.addRom(huge)) === null);
    ok("왜 안 되는지 알려줌", /TOO BIG/.test(t.ui.state.notice), t.ui.state.notice);
    ok("아무것도 안 들어감", t.db.size === 0, t.db.size);
  }

  /* ★ 개수 제한 */
  {
    const { MAX_IMPORT } = require(UI);
    const t = await atList();
    const many = [];
    for (let i = 0; i < MAX_IMPORT + 5; i++) many.push(romFile("g" + i + ".gb", i % 200));
    const r = await t.ui.addRoms(many);
    ok("제한을 넘긴 만큼 남겨둠", r.over === 5, r.over);
    ok("읽은 건 제한까지만", r.total === MAX_IMPORT, r.total);
  }

  /* ★ 저장공간이 차면 — 끝까지 헛수고하지 않고 그만둡니다 */
  {
    const t = await atList();
    const many = [];
    for (let i = 0; i < 50; i++) many.push(romFile("g" + i + ".gb", i));
    const r = await t.ui.addRoms(many);
    ok("(대조) 꽉 안 찼을 때는 전부 들어감", r.added === 50, r.added);

    const t2 = await atList({ addFails:true });
    const r2 = await t2.ui.addRoms(many);
    ok("꽉 차면 도중에 그만둠", r2.stopped === "SAVE" && r2.failed <= 3, JSON.stringify(r2));
    ok("그만둔 걸 글로 알려줌", /STORAGE FULL/.test(t2.ui.state.notice), t2.ui.state.notice);
  }

  /* ★ 파일을 못 읽을 때 — 저장공간 문제와 **다르게** 알려줘야 합니다.
       전에는 둘 다 "STORAGE FULL" 이라고 나왔습니다. 정반대 진단입니다. */
  {
    const t = await atList({ readFails:true });
    const r = await t.ui.addRoms([romFile("a.gb",1), romFile("b.gb",2),
                                 romFile("c.gb",3), romFile("d.gb",4)]);
    ok("못 읽으면 그만둠", r.stopped === "READ", JSON.stringify(r));
    ok("★ 저장공간 탓으로 오진하지 않음",
       /CANNOT READ/.test(t.ui.state.notice) && !/STORAGE/.test(t.ui.state.notice),
       t.ui.state.notice);
  }

  /* ★★ 롬 아닌 파일이 많이 섞여 있어도 도중에 그만두면 안 됩니다.
         전에는 걸러낸 것이 실패 횟수를 안 되돌려서, 멀쩡한 폴더에서
         "저장공간이 찼다"며 중간에 멈췄습니다. */
  {
    const t = await atList();
    const mix = [];
    for (let i = 0; i < 60; i++) mix.push(romFile("junk" + i + ".gb", i, { valid:false }));
    mix.splice(10, 0, romFile("real1.gb", 201));
    mix.splice(40, 0, romFile("real2.gb", 202));
    mix.push(romFile("real3.gb", 203));
    const r = await t.ui.addRoms(mix);
    ok("★ 잡파일이 많아도 끝까지 감", r.stopped === false && r.added === 3, JSON.stringify(r));
  }

  /* ★ 빈 것 / 이상한 것을 줘도 안 터집니다 */
  {
    const t = await atList();
    for (const bad of [null, undefined, [], [null], [{}]]) {
      let threw = false;
      try { await t.ui.addRoms(bad); } catch (e) { threw = true; }
      ok("이상한 입력에 안 터짐: " + JSON.stringify(bad), !threw);
    }
    ok("롬이 하나도 없으면 그렇게 알려줌",
       /NO \.GB FILES/.test(t.ui.state.notice), t.ui.state.notice);
  }

  /* ★ 진행 상황을 알려줘야 합니다 (200개 넣는 동안 멈춘 줄 알면 안 됩니다) */
  {
    const t = await atList();
    const seen = [];
    await t.ui.addRoms([romFile("a.gb",1), romFile("b.gb",2), romFile("c.gb",3)],
                       (n, tot) => seen.push(n + "/" + tot));
    ok("한 개마다 알려줌", seen.join(",") === "1/3,2/3,3/3", seen.join(","));
  }
  {
    /* 알려주는 쪽이 터져도 넣기는 계속돼야 합니다 */
    const t = await atList();
    const r = await t.ui.addRoms([romFile("a.gb",1), romFile("b.gb",2)],
                                 () => { throw new Error("boom"); });
    ok("알림이 터져도 넣기는 계속됨", r.added === 2, JSON.stringify(r));
  }


  /* ═══ 1-2. ★★ 이름이 겹쳐도 기본 게임이 사라지면 안 됩니다 ★★ ════════
     롬 묶음 폴더에는 `2048.gb` `tobu.gb` 같은 흔한 이름이 거의 반드시
     들어 있습니다. 전에는 그게 들어오는 순간
       · 기본 2048 이 목록에서 통째로 사라지고
       · 남의 롬이 "2048 / ZLIB SANQUI" 라는 이름표를 뒤집어쓰고
       · 그걸 지우면 기본 2048 이 영영 없어졌습니다.
     ================================================================== */
  console.log("\n[1-2] ★★ 이름 겹침 — 기본 게임 지키기");
  {
    const { BUNDLED } = require(UI);
    const t = await atList();
    const before = t.ui.list().length;
    const names = BUNDLED.map(b => b.file);

    /* 기본 게임과 **똑같은 이름**인데 내용은 전혀 다른 롬을 넣습니다 */
    const r = await t.ui.addRoms(names.map((n, i) => romFile(n, 150 + i)));
    ok("남의 롬이 들어감", r.added === names.length, JSON.stringify(r));

    const list = t.ui.list();
    ok("★ 기본 게임이 그대로 다 남아있음",
       BUNDLED.every(b => list.some(x => x.bundled && x.file === b.file)),
       list.filter(x => x.bundled).map(x => x.file).join(","));
    ok("★ 목록이 기본 + 새것 만큼 늘어남", list.length === before + names.length, list.length);

    /* 이름표를 훔치지 않았는지 */
    const fake = list.find(x => !x.bundled && x.file === "2048.gb");
    const real = list.find(x =>  x.bundled && x.file === "2048.gb");
    ok("★ 진짜 2048 이 살아있고 라이선스 표기도 그대로",
       !!real && /SANQUI/.test(real.note || ""), real && real.note);
    ok("★ 남의 롬은 제 이름을 씀", !!fake && !/SANQUI/.test(fake.note || ""),
       fake && (fake.title + " / " + fake.note));
  }

  /* 반대로, 기본 게임에서 만들어진 기록은 계속 기본 게임으로 보여야 합니다 */
  {
    const t = await atList();
    const b = t.ui.list().find(x => x.bundled);
    /* 게임이 저장을 하면 이런 기록이 생깁니다 */
    await t.ui.d.store.add(romFile(b.file, 250).bytes, b.file, { fromBundled: b.file });
    await t.ui.refresh();
    const list = t.ui.list();
    ok("★ 기본 게임이 두 번 뜨지 않음",
       list.filter(x => x.file === b.file).length === 1,
       list.filter(x => x.file === b.file).length);
    const now = list.find(x => x.file === b.file);
    ok("★ 이름과 라이선스 표기를 지킴", now.title === b.title && now.note === b.note,
       now.title + " / " + now.note);
  }

  /* ═══ 1-3. ★ 게임&워치 목록에서는 받지 않습니다 ══════════════════════
     그쪽 목록은 저장소를 아예 안 봅니다. 거기서 받으면
     "300개 넣었다"고 말해놓고 빈 화면을 보여줍니다.
     ================================================================== */
  console.log("\n[1-3] ★ 게임&워치 목록에서는 안 받음");
  {
    const t = await atList();
    await t.ui.pickSystem("gw");
    const r = await t.ui.addRoms([romFile("a.gb",1), romFile("b.gb",2)]);
    ok("★ 하나도 안 들어감", r.added === 0 && t.db.size === 0, JSON.stringify(r));
    ok("왜 안 되는지 알려줌", /GAME BOY LIST ONLY/.test(t.ui.state.notice), t.ui.state.notice);
    ok("★ 파일 하나도 마찬가지", (await t.ui.addRom(romFile("c.gb",3))) === null);
    ok("저장소는 여전히 비어있음", t.db.size === 0, t.db.size);
  }


  /* ═══ 2. 길게 눌러 지우기 ═══════════════════════════════════════════ */
  console.log("\n[2] 길게 눌러 지우기");

  {
    const t = await atList();
    await t.ui.addRoms([romFile("a.gb",1), romFile("b.gb",2)]);
    /* 기본 게임 5개 뒤에 새로 넣은 것이 옵니다 */
    const list = t.ui.list();
    const mine = list.findIndex(r => !r.bundled);
    ok("(준비) 넣은 게임을 찾음", mine >= 0, mine);

    ok("길게 누르면 물어봄", t.ui.askRemove(mine));
    ok("무엇을 지우는지 이름이 나옴",
       t.ui.state.confirm && t.ui.state.confirm.title === list[mine].title,
       JSON.stringify(t.ui.state.confirm));
    ok("커서가 그 줄로 옮겨감", t.ui.state.cursor === mine, t.ui.state.cursor);

    /* ★ 물어보는 중에는 아무것도 움직이면 안 됩니다 */
    t.ui.move(1);
    ok("물어보는 중엔 커서가 안 움직임", t.ui.state.cursor === mine, t.ui.state.cursor);
    ok("물어보는 중엔 손가락으로도 못 옮김", t.ui.setCursor(0) === false);
    ok("물어보는 중엔 시작 안 됨", (await t.ui.play()) === false);
    ok("물어보는 중엔 파일도 안 받음", (await t.ui.addRom(romFile("z.gb",9))) === null);
    ok("버튼 글자가 KEEP 으로 바뀜", t.ui.upLabel() === "KEEP", t.ui.upLabel());

    /* 취소 */
    ok("취소됨", t.ui.cancelRemove());
    ok("취소하면 물음표가 사라짐", t.ui.state.confirm === null);
    ok("취소하면 아무것도 안 지워짐", t.db.size === 2, t.db.size);
    ok("취소를 두 번 하면 아무 일 없음", t.ui.cancelRemove() === false);
  }

  /* ★ 확인해야만 지워집니다 */
  {
    const t = await atList();
    await t.ui.addRoms([romFile("a.gb",1), romFile("b.gb",2)]);
    const before = t.ui.state.count;
    const mine = t.ui.list().findIndex(r => !r.bundled);
    const title = t.ui.list()[mine].title;
    t.ui.askRemove(mine);
    ok("확인하면 지워짐", await t.ui.confirmRemove());
    ok("저장소에서 사라짐", t.db.size === 1, t.db.size);
    ok("목록에서도 사라짐", t.ui.state.count === before - 1, t.ui.state.count);
    ok("무엇을 지웠는지 알려줌", t.ui.state.notice === "DELETED — " + title, t.ui.state.notice);
    ok("물음표는 닫힘", t.ui.state.confirm === null);
    ok("두 번 확인해도 또 안 지움", (await t.ui.confirmRemove()) === false);
  }

  /* ★★ 기본으로 들어 있는 게임은 못 지웁니다 ★★ */
  {
    const t = await atList();
    const b = t.ui.list().findIndex(r => r.bundled);
    ok("(준비) 기본 게임이 있음", b >= 0);
    ok("기본 게임은 물어보지도 않음", t.ui.askRemove(b) === false);
    ok("물음표가 안 뜸", t.ui.state.confirm === null);
    ok("왜 안 되는지 알려줌", /CANNOT DELETE/.test(t.ui.state.notice), t.ui.state.notice);
  }

  /* ★ 없는 줄을 길게 눌러도 안 터집니다 */
  {
    const t = await atList();
    ok("범위 밖은 무시", t.ui.askRemove(999) === false);
    ok("음수도 무시", t.ui.askRemove(-1) === false);
    ok("물음표 안 뜸", t.ui.state.confirm === null);
  }

  /* ★ MENU 버튼(위로)은 "안 지움" 이어야 합니다 */
  {
    const t = await atList();
    await t.ui.addRoms([romFile("a.gb",1)]);
    const mine = t.ui.list().findIndex(r => !r.bundled);
    t.ui.askRemove(mine);
    const to = await t.ui.up();
    ok("위로 누르면 취소만 됨", to === "list" && t.ui.state.confirm === null, to);
    ok("화면을 안 떠남", t.ui.state.screen === "list", t.ui.state.screen);
    ok("아무것도 안 지워짐", t.db.size === 1, t.db.size);
  }

  /* ★ 지우다 실패해도 갇히면 안 됩니다 */
  {
    const t = await atList({ removeFails:true });
    await t.ui.addRoms([romFile("a.gb",1)]);
    const mine = t.ui.list().findIndex(r => !r.bundled);
    t.ui.askRemove(mine);
    ok("실패를 알려줌", (await t.ui.confirmRemove()) === false);
    ok("실패해도 물음표는 닫힘", t.ui.state.confirm === null);
    ok("실패라고 씀", /COULD NOT DELETE/.test(t.ui.state.notice), t.ui.state.notice);
    ok("게임은 그대로 있음", t.db.size === 1, t.db.size);
  }

  /* ★ 화면을 옮기면 물음표는 반드시 사라집니다.
       남아 있으면 나중에 엉뚱한 순간에 A 한 번으로 지워집니다. */
  {
    for (const [name, act] of [
      ["시스템 화면으로",   t => t.ui.backToSystem()],
      ["시스템 다시 고르면", t => t.ui.pickSystem("gb")],
      ["템패드로 나가면",   t => t.ui.exitToTempad()],
      ["게임을 끝내면",     t => t.ui.quit()],
    ]) {
      const t = await atList();
      await t.ui.addRoms([romFile("a.gb",1)]);
      t.ui.askRemove(t.ui.list().findIndex(r => !r.bundled));
      await act(t);
      ok(name + " 물음표가 사라짐", t.ui.state.confirm === null);
    }
  }

  /* ★ 목록 화면이 아니면 물어보지 않습니다 */
  {
    const t = await atList();
    await t.ui.addRoms([romFile("a.gb",1)]);
    t.ui.backToSystem();
    ok("시스템 화면에서는 물어보지 않음", t.ui.askRemove(0) === false);
  }

  /* ★★ 게임을 켜는 동안 물음표가 뜨면 — 게임 중에 갇히면 안 됩니다 ★★
         롬을 읽고 에뮬레이터를 준비하는 데 구형 폰은 1~3초 걸립니다.
         그 사이에 다른 손가락이 줄을 길게 누를 수 있습니다.
         물음표가 게임 화면까지 따라오면 MENU 버튼이 "KEEP" 이 되고
         눌러도 아무 데도 안 갑니다 — 유일한 탈출구가 막힙니다. */
  {
    const t = await atList();
    await t.ui.addRoms([romFile("a.gb",1)]);
    const mine = t.ui.list().findIndex(r => !r.bundled);
    t.ui.setCursor(mine);
    /* 게임 켜는 도중에 물음표가 뜬 상황을 만듭니다 */
    const p = t.ui.play();
    t.ui.askRemove(mine);
    ok("(준비) 물음표가 떴음", t.ui.state.confirm !== null);
    await p;
    ok("★ 게임이 켜짐", t.ui.state.screen === "play", t.ui.state.screen);
    ok("★★ 물음표가 남아있지 않음", t.ui.state.confirm === null);
    ok("★★ MENU 버튼이 제 글자로 돌아옴", t.ui.upLabel() === "MENU", t.ui.upLabel());
    const to = await t.ui.up();
    ok("★★ MENU 버튼이 실제로 먹힘", to === "menu" && t.ui.state.screen === "menu",
       to + "/" + t.ui.state.screen);
    ok("아무것도 안 지워짐", t.db.size === 1, t.db.size);
  }

  /* ★ 목록 화면이 아니면 물음표를 화면에 내보내지 않습니다 */
  {
    const t = await atList();
    await t.ui.addRoms([romFile("a.gb",1)]);
    t.ui.setCursor(t.ui.list().findIndex(r => !r.bundled));
    await t.ui.play();
    ok("(준비) 게임 중", t.ui.state.screen === "play");
    ok("★ 게임 중에는 길게 눌러도 안 물어봄", t.ui.askRemove(0) === false);
    ok("물음표 없음", t.ui.state.confirm === null);
    ok("MENU 글자 그대로", t.ui.upLabel() === "MENU", t.ui.upLabel());
  }

  /* ★ 손가락으로 줄 고르기 */
  {
    const t = await atList();
    ok("줄을 누르면 커서가 감", t.ui.setCursor(2) && t.ui.state.cursor === 2, t.ui.state.cursor);
    ok("범위 밖은 무시", t.ui.setCursor(999) === false);
    ok("음수도 무시", t.ui.setCursor(-1) === false);
    ok("커서는 그대로", t.ui.state.cursor === 2, t.ui.state.cursor);
  }

  console.log(`\n  통과 ${pass} / 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.log("  ★터짐 " + (e && e.stack || e)); process.exit(1); });
