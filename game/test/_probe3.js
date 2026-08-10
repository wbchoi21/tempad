/* 감사용 탐침 3 — "다른 앱으로 갈 때 마지막 저장이 실제로 끝나는가"
   pause()/destroy() 안의 flushSram → onSram → RomStore.patch 는 전부 비동기입니다.
   폰이 페이지를 멈추기 전에 몇 번의 이벤트루프 회전이 필요한지 셉니다.        */
"use strict";
const path = require("path");
const { makeIDB, STAT } = require("./idb_strict.js");
const { makeDom, makeModule } = require("./fake.js");
const P = path.join(__dirname, "..", "game.js");

let turns = 0;
const realST = setTimeout;
global.setTimeout = (f, ms) => realST(() => { turns++; f(); }, ms);

makeDom();
global.indexedDB = makeIDB({});
delete require.cache[require.resolve(P)];
const G = require(P);

const LOGO = [0xCE,0xED,0x66,0x66,0xCC,0x0D,0x00,0x0B,0x03,0x73,0x00,0x83,0x00,0x0C,0x00,0x0D];
function gbRom(fill, size) {
  const b = new Uint8Array(size || 0x8000); b.fill(fill);
  LOGO.forEach((v, i) => b[0x104 + i] = v);
  for (let i = 0x134; i <= 0x142; i++) b[i] = 0;
  "GAME".split("").forEach((c, i) => b[0x134 + i] = c.charCodeAt(0));
  b[0x143] = 0; return b;
}

(async () => {
const rom = gbRom(7, 0x8000);                      /* 32KB 롬 (가짜 wasm 힙이 1MB 라서) */
const rec = await G.RomStore.add(rom, "g.gb");
await G.RomStore.patch(rec.id, { states: [
  { rom: rec.id, bytes: new Uint8Array(199616) },
  { rom: rec.id, bytes: new Uint8Array(199616) },
  { rom: rec.id, bytes: new Uint8Array(199616) } ] });

/* 게임을 켭니다 */
const mod = makeModule();
mod._setSramDirty(true);
let sramCalls = 0, sramDone = 0;
const s = G.start(mod, rom, {
  canvas: null,
  onSram: async b => { sramCalls++; await G.RomStore.patch(rec.id, { sram: b }); sramDone++; },
});

console.log("\n[1] 다른 앱으로 갈 때(visibilitychange:hidden) 마지막 저장");
turns = 0; STAT.cloneBytes = 0; s.sramDirty = true;
global.document.visibilityState = "hidden";
G._guards.onVisibility();                 /* = pauseForBackground() → pause() → flushSram() */
console.log("    pause() 가 돌아온 직후: onSram 부름 " + sramCalls + "번, 저장 끝남 " + sramDone + "번");
console.log("    ✗ 저장이 아직 끝나지 않았습니다 — 여기서 폰이 자바스크립트를 멈추면 날아갑니다");

/* 이벤트루프를 계속 돌려서 몇 번 만에 끝나는지 셉니다 */
let spins = 0;
while (sramDone === 0 && spins < 200) { await new Promise(r => realST(r, 0)); spins++; }
console.log("    저장이 끝나기까지 필요한 매크로태스크 회전: 약 " + turns + "번 (setTimeout " + turns + "회)");
console.log("    그동안 오간 바이트: " + (STAT.cloneBytes / 1048576).toFixed(2) + " MB "
          + "(32B 세이브 하나 때문에 롬 + 슬롯 3칸을 통째로 다시 씁니다)");

console.log("\n[2] 페이지를 떠날 때(pagehide → hardStop → destroy → 마지막 저장)");
s.sramDirty = true;
sramCalls = 0; sramDone = 0; turns = 0;
G.stop();
console.log("    stop() 이 돌아온 직후: onSram 부름 " + sramCalls + "번, 저장 끝남 " + sramDone + "번");
console.log("    ✗ pagehide 핸들러가 끝나는 순간 브라우저는 페이지를 버릴 수 있습니다.");
console.log("      IndexedDB 쓰기는 그 뒤 " + "여러 번의 태스크" + "가 더 필요합니다 → 커밋 보장 없음");

console.log("\n[3] 롬 20개면 저장 용량이 얼마나 되는가");
const perRom = (n, mb) => {
  const state = 199616 * 3, sram = 32768;
  return (mb * 1048576 + state + sram) * n;
};
for (const [label, mb] of [["32KB 짜리만", 0.03125], ["1MB 평균", 1], ["4MB 평균", 4], ["8MB(최대)", 8]])
  console.log("    롬 20개 " + label + " → " + (perRom(20, mb) / 1048576).toFixed(0) + " MB");
console.log("    ※ IndexedDB 는 값을 통째로 다시 쓰므로, 저장 한 번마다 위 크기만큼 I/O 가 납니다.");
process.exit(0);
})();
