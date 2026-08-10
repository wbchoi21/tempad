/* 감사용 탐침 — 기존 검사가 한 번도 건드리지 않는 곳만 골라 찌릅니다.
   node test/_probe.js  [strict|loose]                                        */
"use strict";
const path = require("path");
const which = process.argv[2] === "loose" ? "./idb.js" : "./idb_strict.js";
const { makeIDB, STAT } = require(which);
const P = path.join(__dirname, "..", "game.js");

const LOGO = [0xCE,0xED,0x66,0x66,0xCC,0x0D,0x00,0x0B,0x03,0x73,0x00,0x83,0x00,0x0C,0x00,0x0D];
function gbRom(fill, title, size) {
  const b = new Uint8Array(size || 0x8000); b.fill(fill);
  LOGO.forEach((v, i) => b[0x104 + i] = v);
  for (let i = 0x134; i <= 0x142; i++) b[i] = 0;
  (title || "").split("").forEach((c, i) => b[0x134 + i] = c.charCodeAt(0));
  b[0x143] = 0; return b;
}
function fresh(opts) {
  global.indexedDB = makeIDB(opts || {});
  delete require.cache[require.resolve(P)];
  return require(P);
}
let n = 0;
const say = (t, v) => console.log("  " + (v ? "✓" : "✗") + " " + t + (v ? "" : "   <== 문제"));

(async () => {
console.log("\n### 사용 중인 가짜: " + which + "\n");

/* ─────────────────────────────────────────────────────────────────────
   A. 동시에 두 곳에서 고치면? (읽고-고치고-쓰기가 두 트랜잭션에 걸쳐 있음)
   실제 앱에서 일어납니다:
     · ui.play() 의 patch({played}) 는 await 를 안 합니다
     · 1초마다 도는 flushSram → onSram → patch({sram})
     · 메뉴에서 saveSlot → get + patch({states})
   ───────────────────────────────────────────────────────────────────── */
console.log("[A] 동시에 두 번 고치기 (lost update)");
{ const G = fresh();
  const a = await G.RomStore.add(gbRom(7, "RACE"), "race.gb");
  await Promise.all([
    G.RomStore.patch(a.id, { sram: new Uint8Array([1,2,3]) }),   // 배터리 세이브
    G.RomStore.patch(a.id, { played: 99 }),                      // 플레이 횟수
  ]);
  const after = await G.RomStore.get(a.id);
  say("배터리 세이브가 남아 있음  (sram=" + (after.sram ? after.sram.length + "B" : "null") + ")", !!after.sram);
  say("플레이 횟수도 남아 있음    (played=" + after.played + ")", after.played === 99);
}

/* ─────────────────────────────────────────────────────────────────────
   B. add() 도 읽고-고치고-쓰기입니다. 저장 중에 add 가 끼면?
   ───────────────────────────────────────────────────────────────────── */
console.log("\n[B] 저장 중에 같은 롬을 다시 add");
{ const G = fresh();
  const rom = gbRom(7, "RACE2");
  const a = await G.RomStore.add(rom, "r.gb");
  await Promise.all([
    G.RomStore.patch(a.id, { sram: new Uint8Array([9,9,9,9]) }),
    G.RomStore.add(rom, "r.gb"),
  ]);
  const after = await G.RomStore.get(a.id);
  say("배터리 세이브가 살아남음  (sram=" + (after.sram ? after.sram.length + "B" : "null") + ")", !!after.sram);
}

/* ─────────────────────────────────────────────────────────────────────
   C. patch 한 번에 실제로 몇 바이트를 읽고 쓰는가
      (폰에서 1초마다 이만큼 디스크에 씁니다)
   ───────────────────────────────────────────────────────────────────── */
console.log("\n[C] 한 번 저장할 때 오가는 바이트 (1MB 롬 + 슬롯 3칸 195KB)");
{ const G = fresh();
  const rom = gbRom(7, "BIG", 1024 * 1024);
  const rec = await G.RomStore.add(rom, "big.gb");
  await G.RomStore.patch(rec.id, { states: [
    { rom: rec.id, bytes: new Uint8Array(199616) },
    { rom: rec.id, bytes: new Uint8Array(199616) },
    { rom: rec.id, bytes: new Uint8Array(199616) } ] });
  if (STAT) { STAT.cloneBytes = 0; STAT.clones = 0; }
  await G.RomStore.patch(rec.id, { sram: new Uint8Array(8192) });   /* 8KB 세이브 하나 */
  if (STAT) console.log("    8KB 짜리 배터리 세이브 하나를 넣는데 오간 바이트: "
    + (STAT.cloneBytes / 1048576).toFixed(2) + " MB  (복사 " + STAT.clones + "번)");
  else console.log("    (loose 가짜는 재지 않습니다)");
}

/* ─────────────────────────────────────────────────────────────────────
   D. wasm 힙 위의 뷰를 그대로 넣으면? (structured clone = 버퍼 전체)
   ───────────────────────────────────────────────────────────────────── */
console.log("\n[D] wasm 힙 위의 32KB 뷰를 그대로 저장하면");
{ const G = fresh();
  const heap = new ArrayBuffer(16 * 1024 * 1024);        /* binjgb 은 16MB 고정 */
  const view = new Uint8Array(heap, 1024, 32768);        /* 32KB 짜리 뷰 */
  const rec = await G.RomStore.add(gbRom(1, "VIEW"), "v.gb");
  if (STAT) { STAT.cloneBytes = 0; }
  await G.RomStore.patch(rec.id, { sram: view });
  const back = await G.RomStore.get(rec.id);
  if (STAT) console.log("    32KB 를 넣었는데 실제로 오간 바이트: "
    + (STAT.cloneBytes / 1048576).toFixed(1) + " MB");
  say("돌려받은 것도 32KB (byteLength=" + back.sram.byteLength + ")", back.sram.byteLength === 32768);
}

/* ─────────────────────────────────────────────────────────────────────
   E. 다른 탭이 버전을 올리면 (blocked). openDB 에 onblocked 가 없음
   ───────────────────────────────────────────────────────────────────── */
console.log("\n[E] 다른 연결이 열려 있는 채로 버전이 올라가면 (blocked)");
{ global.indexedDB = makeIDB({});
  /* 연결 하나를 열어두고 닫지 않습니다 (다른 탭 흉내) */
  const held = await new Promise(r => { const q = indexedDB.open("tempad.games", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("roms", { keyPath: "id" });
    q.onsuccess = () => r(q.result); });
  let settled = "안 끝남";
  const p = new Promise(r => {
    const q = indexedDB.open("tempad.games", 2);       /* 다음 판올림 흉내 */
    q.onsuccess = () => r("성공"); q.onerror = () => r("에러");
    /* onblocked 를 안 답니다 — game.js 의 openDB() 와 똑같이 */
  });
  const res = await Promise.race([p, new Promise(r => setTimeout(() => r("안 끝남"), 300))]);
  settled = res;
  say("판올림 요청이 끝남 (" + settled + ")", settled !== "안 끝남");
  console.log("    ※ game.js 의 openDB() 에는 onblocked 도 db.onversionchange 도 없습니다.");
  held.close();
}

/* ─────────────────────────────────────────────────────────────────────
   F. 저장이 실패했을 때 앞의 쓰기가 롤백되는가 / oncomplete 가 안 오는가
   ───────────────────────────────────────────────────────────────────── */
console.log("\n[F] 용량 초과로 put 이 실패했을 때");
{ const G = fresh({ putFails: true });
  let msg = null;
  try { await G.RomStore.add(gbRom(1, "Q"), "q.gb"); } catch (e) { msg = (e && e.name) + "/" + (e && e.message); }
  console.log("    add 가 던진 것: " + msg);
  say("QuotaExceededError 라고 알아볼 수 있음", /Quota/i.test(String(msg)));
}

/* ─────────────────────────────────────────────────────────────────────
   G. 연결을 닫은 뒤 트랜잭션을 만들면
   ───────────────────────────────────────────────────────────────────── */
console.log("\n[G] db.close() 뒤 transaction()");
{ global.indexedDB = makeIDB({});
  const db = await new Promise(r => { const q = indexedDB.open("t", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("s", { keyPath: "id" });
    q.onsuccess = () => r(q.result); });
  db.close();
  let threw = null;
  try { db.transaction("s", "readonly"); } catch (e) { threw = e.name; }
  say("InvalidStateError 를 던짐 (" + threw + ")", threw === "InvalidStateError");
}

/* ─────────────────────────────────────────────────────────────────────
   H. readonly 트랜잭션에 put
   ───────────────────────────────────────────────────────────────────── */
console.log("\n[H] readonly 에 put");
{ global.indexedDB = makeIDB({});
  const db = await new Promise(r => { const q = indexedDB.open("t2", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("s", { keyPath: "id" });
    q.onsuccess = () => r(q.result); });
  let threw = null;
  try { db.transaction("s", "readonly").objectStore("s").put({ id: 1 }); } catch (e) { threw = e.name; }
  say("ReadOnlyError 를 던짐 (" + threw + ")", threw === "ReadOnlyError");
  db.close();
}

/* ─────────────────────────────────────────────────────────────────────
   I. await 뒤에 같은 트랜잭션을 다시 쓰면
   ───────────────────────────────────────────────────────────────────── */
console.log("\n[I] await 한 번 하고 같은 트랜잭션에 요청을 더 걸면");
{ global.indexedDB = makeIDB({});
  const db = await new Promise(r => { const q = indexedDB.open("t3", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("s", { keyPath: "id" });
    q.onsuccess = () => r(q.result); });
  const t = db.transaction("s", "readwrite");
  const s = t.objectStore("s");
  s.put({ id: 1 });
  await new Promise(r => setTimeout(r, 0));
  let threw = null;
  try { s.put({ id: 2 }); } catch (e) { threw = e.name; }
  say("TransactionInactiveError 를 던짐 (" + threw + ")", threw === "TransactionInactiveError");
  db.close();
}

/* ─────────────────────────────────────────────────────────────────────
   J. Date 가 살아 돌아오는가 (structured clone)
   ───────────────────────────────────────────────────────────────────── */
console.log("\n[J] Date 를 넣었다 빼면");
{ const G = fresh();
  const rec = await G.RomStore.add(gbRom(1, "D"), "d.gb");
  await G.RomStore.patch(rec.id, { lastPlayed: new Date(1700000000000) });
  const back = await G.RomStore.get(rec.id);
  say("Date 로 돌아옴 (" + Object.prototype.toString.call(back.lastPlayed) + ")",
      back.lastPlayed instanceof Date);
}

console.log("");
})();
