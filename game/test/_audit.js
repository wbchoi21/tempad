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

/* ★ 방해검사가 건드리는 파일을 **그 목록에서 뽑아** 읽습니다.
     예전에는 여기에 파일 이름을 손으로 적어놨는데, 방해검사에 새 파일이
     추가되면 감사가 그냥 터졌습니다 (test/page.js 를 추가했을 때 그랬습니다). */
const files = {};
const wanted = new Set(["ui.js", "game.js", "pad.js", "index.html", "unzip.js"]);
for (const c of CASES) wanted.add(c[1]);
for (const f of wanted) {
  try { files[f] = fs.readFileSync(path.join(D, f), "utf8"); }
  catch (e) { console.error("★ 못 읽음: " + f); process.exit(2); }
}

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
  /* ── zip 넣기 ─────────────────────────────────────────────────────── */
  ["unzip.js", /n = n\.replace\(/, 1, "zip 이름의 경로 벗기기 (../ 막기)"],
  ["unzip.js", /skipped\.encrypted\+\+/, 1, "암호 걸린 항목 건너뛰기"],
  ["unzip.js", /crc32\(out\) !== crc/, 1, "CRC 로 깨진 롬 잡기"],
  ["unzip.js", /if \(n !== size\) throw/, 1, "푼 양이 적힌 것과 같은가"],
  ["unzip.js", /usize \/ csize > MAX_RATIO/, 1, "압축폭탄 비율 검사"],
  ["unzip.js", /hv\.getUint16\(26, true\) \+ hv\.getUint16\(28, true\)/, 1, "자료 위치는 로컬 헤더로"],
  ["unzip.js", /const d2 = abs - \(of \+ sz\)/, 1, "앞에 붙은 쓰레기 보정"],
  ["unzip.js", /i \+ 22 \+ tdv\.getUint16\(i \+ 20, true\) === tail\.length/, 1, "EOCD 주석 길이 맞추기 (가짜 표식 방지)"],
  ["unzip.js", /await cenAt\(blob, of \+ d\)/, 1, "보정값을 CEN 표식으로 확인"],
  ["unzip.js", /const tries = \[0\];/, 1, "보정값 0 을 먼저 시도"],
  ["unzip.js", /    if \(c === 0 && sz === 0\) continue;/, 1, "빈 zip 후보는 1차에서 안 받음"],
  ["unzip.js", /rawCount === 0xFFFF \|\| cdSize === 0xFFFFFFFF \|\| rawOff === 0xFFFFFFFF/, 1, "ZIP64 감시값 (고른 뒤에 검사)"],
  ["unzip.js", /skipped\.nested\+\+/, 1, "zip 안의 zip 은 따로 세어 알려줌"],
  ["ui.js", /this\.warn\("FINISH THE QUESTION FIRST"\)/, 1, "확인창 중 넣기는 말하고 거절"],
  ["ui.js", /else if \(failSave\) parts\.push\("STORAGE FULL\?"\);/, 1, "저장 실패 이유 밝히기"],
  ["index.html", /MORE NOT ADDED — TRY AGAIN/, 1, "버려진 묶음을 반드시 말함"],
  ["index.html", /BROKEN ZIP FILE — GET IT AGAIN/, 1, "덜 받은 zip 은 다시 받으라고 함"],
  ["unzip.js", /if \(end - start > maxBytes\) throw/, 1, "무압축 항목도 크기 상한"],
  ["unzip.js", /if \(out\.length !== size\) throw/, 1, "무압축 항목도 길이 확인"],
  ["unzip.js", /const MAX_RATIO = 1100;/, 1, "압축비 상한은 deflate 최대(1032)보다 위"],
  ["index.html", /const SHARE_KEY = location\.origin \+ "\/__tempad-shared";/, 1, "공유 열쇠는 절대주소 (sw.js 와 같아야)"],
  ["unzip.js", /isJunk\(full, base\)/, 1, "맥 껍데기(__MACOSX) 거르기"],
  ["unzip.js", /new DecompressionStream\("deflate-raw"\); _rawOk = true/, 1, "deflate-raw 실제로 재보기"],
  ["index.html", /if \(importing\)/, 1, "넣는 중 겹쳐 돌기 막기"],
  ["index.html", /function openZip\(\)\{ \$\("zip"\)\.click\(\); \}/, 1, "zip 은 파일 고르기(폴더 아님)"],
  ["index.html", /takeShared\(\);/, 1, "공유로 받은 것 가져오기"],
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
