/* 방해검사 잔재 전수 감사 —
   sabotage.js 가 넣는 **모든 대체 문자열**이 제품 파일에 남아 있지 않은지 보고,
   반대로 **모든 찾을 패턴**이 제자리에 있는지도 확인한다.
   (두 번이나 방해가 남은 채로 진행할 뻔했다. 이제 기계로 확인한다.) */
const fs = require("fs"), path = require("path");
const D = require("path").join(__dirname, "..");

/* sabotage.js 의 CASES 를 그대로 읽어온다 */
const src = fs.readFileSync(
  require("path").join(__dirname, "_sabotage.js"),
  "utf8");
const body = src.slice(src.indexOf("const CASES = ["), src.indexOf("\n];", src.indexOf("const CASES = [")) + 3);
let CASES;
try { CASES = eval(body + "\nCASES"); }
catch (e) { console.error("CASES 를 못 읽었습니다: " + e.message); process.exit(2); }

const files = {};
for (const f of ["ui.js", "game.js", "pad.js", "index.html"])
  files[f] = fs.readFileSync(path.join(D, f), "utf8");

let bad = 0;
console.log("=== 1. 방해가 남아 있는가 (대체 문자열이 파일에 있으면 사고) ===");
for (const [name, file, find, repl] of CASES) {
  const s = files[file];
  /* 빈 문자열로 바꾸는 방해는 "찾을 패턴이 사라졌는가" 로 판정합니다 */
  const trimmed = String(repl).trim();
  if (trimmed && s.includes(trimmed)) {
    /* 원래부터 있던 흔한 조각은 걸러냅니다 (예: 'return true;') */
    if (trimmed.length >= 25) { console.log("  ★ 남아있음: " + name); bad++; }
    else console.log("  (참고) 짧은 조각이라 판정 보류: " + name + " → \"" + trimmed + "\"");
  }
}
if (!bad) console.log("  남은 방해 없음");

console.log("\n=== 2. 원래 코드가 제자리에 있는가 (패턴이 없으면 지워졌을 수 있음) ===");
let missing = 0;
for (const [name, file, find] of CASES) {
  if (!find.test(files[file])) { console.log("  ★ 원본 패턴 없음: " + name + "  (" + file + ")"); missing++; }
}
if (!missing) console.log("  전부 제자리");

console.log("\n=== 3. 반드시 살아 있어야 하는 불변식 ===");
const MUST = [
  ["game.js", /m\._free\(ptr\);/g, 4, "_file_data_delete 뒤 _free (메모리 누수 방지)"],
  ["game.js", /rec\.system = cur\.system \|\| "gb";/, 1, "기록의 시스템 보존"],
  ["game.js", /if \(!r\.system\) r\.system = "gb";/, 1, "옛 기록 이행 (list 와 같은 규칙)"],
  ["game.js", /putSlot\(id, n, value\) \{/, 1, "슬롯 한 칸 원자적 저장"],
  ["game.js", /p\.catch\(\(\) => \{ if \(!this\.dead\) this\.sramDirty = true; \}\);/, 1, "배터리 세이브 재시도"],
  ["game.js", /stop: stopQuiet,/, 1, "일부러 끈 것은 조용히"],
  ["game.js", /!session\.userPaused/, 1, "메뉴로 멈춘 건 안 되살림"],
  ["game.js", /gbaLogoOk\(bytes\) \|\| gbaChecksumOk\(bytes\)/, 1, "GBA 판별 강화"],
  ["ui.js", /const abandoned = \(\) => gen !== navGen;/, 1, "켜는 중 나가면 버림"],
  ["ui.js", /BUILT-IN — CANNOT DELETE/, 1, "기본 게임 삭제 금지"],
  ["ui.js", /SLOT BELONGS TO ANOTHER SYSTEM/, 1, "남의 기기 세이브 거부"],
  ["ui.js", /if \(screen !== "play"\) return false;/, 1, "메뉴 입력이 게임으로 안 샘"],
  ["ui.js", /system:"gbc", title:"LIBBET"/, 1, "LIBBET 은 GBC 목록"],
  ["pad.js", /\[4, "L"\], \[5, "R"\],/, 1, "어깨 버튼은 게임 입력"],
  ["pad.js", /const MENU_COMBO = \["select", "L", "R"\];/, 1, "MENU 는 세 버튼 조합"],
  ["index.html", /const ARM_MS = 400;/, 1, "지우기 확인창 0.4초 냉각"],
  ["index.html", /const HOLD_MS = 900;/, 1, "길게누르기 0.9초"],
  ["index.html", /Math\.abs\(e\.clientX - holdX\) > 10/, 1, "길게누르는 중 움직이면 취소"],
  ["index.html", /Math\.abs\(\(e\.clientX\|\|0\) - sx\) > 16/, 1, "버튼을 끌고 나가면 취소"],
  ["index.html", /if \(holdId !== null\) return;/, 1, "두 번째 손가락 무시"],
  ["index.html", /for \(const n of gpPrev\) \{ try \{ GameMode\.press\(n, false\); \} catch \(e\) \{\} \}/, 1, "패드 키 놓기"],
  ["index.html", /\$\(id\)\.style\.display = \(showPad && isGba\) \? "flex" : "none";/, 1, "조작판 끄면 L·R 도 숨김"],
  ["index.html", /esc\(r\.title\)/, 1, "게임 이름 감싸기"],
  ["index.html", /addEventListener\("pointerup"/, 2, "click 대신 pointerup"],
];
let broke = 0;
for (const [file, re, min, why] of MUST) {
  const m = files[file].match(re.global ? re : new RegExp(re.source, "g"));
  const n = m ? m.length : 0;
  if (n < min) { console.log(`  ★★ 깨짐: ${why}  (${file} 에서 ${n}건, ${min}건 이상이어야 함)`); broke++; }
}
if (!broke) console.log("  불변식 " + MUST.length + "개 전부 살아있음");

console.log("\n=== 4. click 리스너가 없는가 (아이폰 위험) ===");
let clicks = 0;
for (const f of Object.keys(files)) {
  const m = files[f].match(/addEventListener\(\s*["']click["']/g);
  if (m) { console.log("  ★ " + f + " 에 click 리스너 " + m.length + "개"); clicks += m.length; }
}
if (!clicks) console.log("  없음 (정상)");

const total = bad + missing + broke + clicks;
console.log("\n" + (total ? "★ 문제 " + total + "건" : "전부 정상"));
process.exit(total ? 1 : 0);
