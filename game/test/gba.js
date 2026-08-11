/* ============================================================================
   GBA 껍데기(mgba-glue.js) 검사 — ★ 특히 **껐다 켜기를 반복해도 안 새는가**

   왜 이 검사가 있나 —
   binjgb 에서 **똑같은 사고가 두 번** 났습니다.
     · 저장할 때마다 195KB 가 새서 **71번째 저장에서 죽음**
     · 메모리를 두 번 반납해서 **세 번째 게임 시작에서 터짐**
   둘 다 "느낌" 으로는 절대 안 보입니다. 아이가 반나절 놀다 갑자기 죽습니다.
   GBA 는 롬이 훨씬 커서(최대 32MB) 더 빨리 옵니다.

   ★ 진짜 mgba.js 는 브라우저 밖에서 게임을 못 돌립니다(주 반복문이 안 섭니다).
     그래서 **mGBA 와 같은 모양의 가짜**를 물려서 껍데기 쪽을 봅니다.
     여기서 보는 것은 "우리가 뒷정리를 하는가" 입니다 — 그건 우리 몫입니다.
   ========================================================================== */
"use strict";
const path = require("path"), fs = require("fs");

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  OK   " + n); }
  else { fail++; console.log("  ★실패 " + n + (x !== undefined ? "  → " + x : "")); } };

/* ── 가짜 mGBA — 진짜와 같은 모양 ────────────────────────────────────────
   ★ 진짜보다 너그러우면 안 됩니다. 파일시스템은 진짜처럼 **쌓입니다** —
     우리가 안 지우면 안 지워진 채로 남아야 검사가 뜻이 있습니다.       */
function makeFakeMgba() {
  const files = new Map();
  let loaded = null, running = false, cbCount = 0, cb = null;
  const P = { root:"/data", gamePath:"/data/games", savePath:"/data/saves",
              saveStatePath:"/data/states", cheatsPath:"/data/cheats",
              screenshotsPath:"/data/shots", patchPath:"/data/patches" };
  const dirs = new Set();
  return {
    _files: files, _dirs: dirs,
    get _cbCount(){ return cbCount; },
    get _running(){ return running; },
    get _loaded(){ return loaded; },
    filePaths: () => P,
    FS: {
      mkdir(d){ if (dirs.has(d)) throw new Error("exists"); dirs.add(d); },
      writeFile(p, b){ files.set(p, b); },
      readFile(p){ if (!files.has(p)) throw new Error("ENOENT"); return files.get(p); },
      unlink(p){ if (!files.has(p)) throw new Error("ENOENT"); files.delete(p); },
      readdir(d){ const out = [".",".."];
        for (const k of files.keys()) if (k.lastIndexOf("/") === d.length && k.startsWith(d + "/"))
          out.push(k.slice(d.length + 1));
        return out; },
      stat(p){ return { size: (files.get(p) || []).length }; },
    },
    loadGame(p){ if (!files.has(p)) return false; loaded = p; running = true; return true; },
    quitGame(){ loaded = null; running = false; },
    pauseGame(){ running = false; },
    resumeGame(){ running = true; },
    buttonPress(){}, buttonUnpress(){},
    getSave(){ return new Uint8Array([1,2,3]); },
    saveState(n){ files.set(P.saveStatePath + "/g.ss" + n, new Uint8Array([5,5,5,5])); return true; },
    loadState(){ return true; },
    addCoreCallbacks(o){ cbCount++; cb = o && o.saveDataUpdatedCallback || null; },
    _fireSave(){ if (cb) cb(); },
    setVolume(){}, getVolume(){ return 1; },
  };
}

/* 껍데기를 불러옵니다 — window 흉내가 필요합니다 */
function loadGlue() {
  global.window = global.window || {};
  global.document = global.document || { getElementById: () => null };
  const p = path.join(__dirname, "..", "mgba-glue.js");
  delete require.cache[require.resolve(p)];
  return require(p);
}

const timers = new Set();
global.setInterval = (f, ms) => { const id = { f, ms }; timers.add(id); return id; };
global.clearInterval = id => { timers.delete(id); };

const { MgbaSession } = loadGlue();
const rom = new Uint8Array(1024);

(async () => {

console.log("\n[1] 기본 — 켜고 끄기");
{ const m = makeFakeMgba();
  const s = new MgbaSession(m, rom, { romId:"abc123", canvasGba:null });
  ok("롬이 파일시스템에 들어감", m._files.size === 1, m._files.size);
  ok("게임이 켜짐", m._running === true);
  s.start();
  ok("★ 자동저장 타이머가 하나", timers.size === 1, timers.size);
  s.destroy();
  ok("★★★ 파일이 전부 치워짐", m._files.size === 0,
     [...m._files.keys()].join(", "));
  ok("★★★ 타이머가 치워짐", timers.size === 0, timers.size);
  ok("게임이 꺼짐", m._running === false);
}

console.log("\n[2] ★★★ 껐다 켜기 30번 — 아무것도 쌓이면 안 됩니다");
{ /* binjgb 는 여기서 두 번 죽었습니다. GBA 는 롬이 커서 더 빨리 옵니다. */
  const m = makeFakeMgba();
  /* ★★ mGBA 는 **제가 알아서 파일을 남기기도 합니다** (자동 저장칸 등).
       우리가 안 치우면 켤 때마다 쌓입니다. 그걸 흉내내야 "뒷정리를
       하는가" 가 진짜로 시험됩니다 — 우리가 만든 것만 지우는 검사는
       우리가 지운 것만 확인할 뿐입니다. */
  const realLoad = m.loadGame.bind(m);
  m.loadGame = p => { const r = realLoad(p);
    if (r) m.FS.writeFile("/data/states/auto.ss0", new Uint8Array([1]));
    return r; };
  let maxFiles = 0, maxTimers = 0;
  for (let i = 0; i < 30; i++) {
    const s = new MgbaSession(m, rom, { romId:"g" + (i % 3), canvasGba:null });
    s.start();
    /* 게임이 저장도 하고 슬롯도 씁니다 */
    m._fireSave();
    s.getState();
    s.flushSram();
    maxFiles = Math.max(maxFiles, m._files.size);
    maxTimers = Math.max(maxTimers, timers.size);
    s.destroy();
    /* 한 판이 끝나면 **깨끗해야** 합니다 */
    if (m._files.size !== 0) { ok("★★★ " + (i+1) + "번째에서 파일이 남음", false,
      [...m._files.keys()].join(", ")); break; }
    if (timers.size !== 0) { ok("★★★ " + (i+1) + "번째에서 타이머가 남음", false, timers.size); break; }
  }
  ok("★★★ 30번을 돌려도 파일이 안 쌓임", m._files.size === 0,
     [...m._files.keys()].join(", "));
  ok("★★★ 30번을 돌려도 타이머가 안 쌓임", timers.size === 0, timers.size);
  ok("(참고) 한 판 도중 최대 파일 수", maxFiles <= 3, maxFiles);
  ok("★ 도는 중에도 타이머는 하나뿐", maxTimers <= 1, maxTimers);
}

console.log("\n[3] ★★ 게임을 바꿔도 앞 게임이 안 남아야 합니다");
{ const m = makeFakeMgba();
  const a = new MgbaSession(m, rom, { romId:"AAA", canvasGba:null });
  a.start(); a.destroy();
  const b = new MgbaSession(m, rom, { romId:"BBB", canvasGba:null });
  b.start();
  const names = [...m._files.keys()].join(", ");
  ok("★★ 앞 게임 파일이 없음", names.indexOf("AAA") < 0, names);
  ok("★ 새 게임이 켜져 있음", m._loaded && m._loaded.indexOf("BBB") >= 0, m._loaded);
  b.destroy();
}

console.log("\n[4] ★★ 세이브가 이어지는가 (같은 롬 = 같은 이름)");
{ const m = makeFakeMgba();
  const a = new MgbaSession(m, rom, { romId:"SAME", canvasGba:null,
                                      sram:new Uint8Array([9,9]) });
  const savePath = a.savePath;
  ok("★ 배터리 세이브를 켜기 전에 넣음", m._files.has(savePath), savePath);
  a.destroy();
  const b = new MgbaSession(m, rom, { romId:"SAME", canvasGba:null });
  ok("★★ 같은 롬이면 세이브 파일 이름이 같음", b.savePath === savePath,
     b.savePath + " vs " + savePath);
  b.destroy();
  const c = new MgbaSession(m, rom, { romId:"OTHER", canvasGba:null });
  ok("★★ 다른 롬이면 이름이 다름", c.savePath !== savePath, c.savePath);
  c.destroy();
}

console.log("\n[5] ★★ 저장이 실패하면 다시 시도해야 합니다");
{ /* 위에서 표시를 미리 껐기 때문에, 실패를 그냥 흘리면 그 저장은 영영
     사라집니다. 게임보이 쪽과 똑같은 사고입니다. */
  const m = makeFakeMgba();
  let tries = 0;
  const s = new MgbaSession(m, rom, { romId:"F", canvasGba:null,
    onSram: () => { tries++; return Promise.reject(new Error("full")); } });
  s.start();
  m._fireSave();
  s.flushSram();
  await new Promise(r => setImmediate(r));
  ok("★ 한 번 시도함", tries === 1, tries);
  ok("★★★ 실패했으니 표시가 되살아남 (다음에 다시 시도)", s.sramDirty === true,
     String(s.sramDirty));
  s.destroy();
}

console.log("\n[6] ★ 버튼 이름이 mGBA 것으로 옮겨지는가");
{ const m = makeFakeMgba();
  const seen = [];
  m.buttonPress = n => seen.push("+" + n);
  m.buttonUnpress = n => seen.push("-" + n);
  const s = new MgbaSession(m, rom, { romId:"K", canvasGba:null });
  for (const n of ["up","down","left","right","A","B","L","R","select","start"])
    { s.press(n, true); s.press(n, false); }
  ok("★ 열 개가 전부 전달됨", seen.length === 20, seen.length + " / " + seen.join(","));
  ok("★ 방향은 대문자로 시작", seen.indexOf("+Up") >= 0 && seen.indexOf("+Left") >= 0);
  ok("★ select/start 도 옮겨짐", seen.indexOf("+Select") >= 0 && seen.indexOf("+Start") >= 0);
  seen.length = 0;
  s.press("없는버튼", true);
  ok("★ 모르는 이름은 조용히 무시", seen.length === 0, seen.join(","));
  s.destroy();
  seen.length = 0;
  s.press("A", true);
  ok("★★ 끝난 세션은 버튼을 안 받음", seen.length === 0, seen.join(","));
}

console.log("\n[7] ★ 죽은 세션은 아무것도 안 해야 합니다");
{ const m = makeFakeMgba();
  const s = new MgbaSession(m, rom, { romId:"D", canvasGba:null });
  s.start(); s.destroy();
  ok("두 번 정리해도 안 터짐", (() => { try { s.destroy(); return true; } catch(e){ return false; } })());
  ok("★ 슬롯 저장이 null", s.getState() === null);
  ok("★ 슬롯 불러오기가 false", s.loadState(new Uint8Array([1])) === false);
  ok("★ running 이 거짓", s.running === false);
}

console.log(`\n${"=".repeat(46)}\n통과 ${pass}  실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
})();
