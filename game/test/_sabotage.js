/* ============================================================================
   방해검사 — 일부러 코드를 망가뜨려 검사가 진짜 잡는지 본다.
   잡지 못하면 그 검사는 "통과하지만 아무것도 안 보는" 가짜다.

   ★★★ 이 도구는 **원본을 절대 건드리지 않습니다.** ★★★

   예전 판은 제품 파일을 제자리에서 고쳤다가 되돌리는 방식이었습니다.
   그게 **세 번 사고를 냈습니다** — 백그라운드로 돌리다 편집이 날아가고,
   타임아웃 SIGKILL 로 복구 훅이 못 돌고, 다른 사람이 돌리다 죽고.
   남은 방해는 이런 것들이었습니다:
     · 지우기 확인창의 냉각시간이 0 (스치기만 해도 게임이 지워짐)
     · 길게누르는 중 손가락이 움직여도 취소 안 됨 (스크롤하려다 지우기 창)
   둘 다 아이가 실수로 게임을 잃는 상태입니다.

   그래서 아예 구조를 바꿨습니다 —
   **game/ 폴더를 통째로 임시 폴더에 복사해서 거기서만 망가뜨립니다.**
   이 파일이 어떻게 죽든 원본은 안전합니다.
   ========================================================================== */
const fs = require("fs"), cp = require("child_process"), path = require("path"), os = require("os");
const SRC = path.join(__dirname, "..");

const CASES = [
  /* [이름, 파일, 찾을것(정규식), 바꿀것, 돌릴검사] */
  ["구석버튼을 click 으로 되돌리기 (iOS 위험)", "index.html",
   /el\.addEventListener\("pointerup", e => \{\n    e\.preventDefault\(\);\n    el\.classList\.remove\("press"\);\n    if \(!armed\) return;\n    armed = false;\n    fn\(e\);\n  \}, \{ passive:false \}\);/,
   'el.addEventListener("click", e => { fn(e); });', "page"],

  ["L 혼자로 메뉴 열리게 (v1 방식으로 되돌리기)", "pad.js",
   /\[4, "L"\], \[5, "R"\],/, '[4, "menu"], [5, "menu"],', "pad"],

  ["MENU 조합을 SELECT 하나로 줄이기", "pad.js",
   /const MENU_COMBO = \["select", "L", "R"\];/, 'const MENU_COMBO = ["select"];', "pad"],

  ["조합에 쓰인 버튼을 게임에 그대로 흘리기", "pad.js",
   /  return \{ held: list\.filter\(n => MENU_COMBO\.indexOf\(n\) < 0\), menu: true \};/,
   '  return { held: list.slice(), menu: true };', "pad"],

  ["첫 탭에 바로 게임이 켜지게 (오발사)", "ui.js",
   /if \(i === cursor\) \{\n      const ok = await this\.play\(\);\n      return ok \? "play" : "fail";\n    \}\n    cursor = i;\n    return "select";/,
   'const ok = await this.play();\n    return ok ? "play" : "fail";', "ui"],

  ["시스템별 목록 나누기를 없애기 (전부 섞이게)", "ui.js",
   /\.filter\(r => \(r\.system \|\| "gb"\) === systemId\)/, '.filter(r => true)', "ui"],

  ["켜는 중에 나가도 늦게 켜지게 (화면 낚아채기)", "ui.js",
   /const abandoned = \(\) => gen !== navGen;/, 'const abandoned = () => false;', "ui"],

  ["기본 게임 시스템을 전부 gb 로 (LIBBET·TOBU DX 소실)", "ui.js",
   /\{ file:"libbet\.gb",  system:"gbc", title:"LIBBET"/,
   '{ file:"libbet.gb",  system:"gb", title:"LIBBET"', "ui"],

  ["다시 넣을 때 시스템 보존을 없애기 (기록이 딴 목록으로 이사)", "game.js",
   /          rec\.system = cur\.system \|\| "gb";/, '', "store"],

  ["add 가 기존 세이브를 안 지키게 (다시 넣으면 세이브 소실)", "game.js",
   /          rec\.sram   = cur\.sram;/, '', "store"],

  ["옛 기록 이행을 롬 재판별로 (v1 게임이 딴 목록으로)", "game.js",
   /      if \(!r\.system\) r\.system = "gb";/,
   '      if (!r.system) r.system = detectSystem(r.rom) || "gb";', "store"],

  ["슬롯 저장을 옛 두 트랜잭션 방식으로 되돌리기", "game.js",
   /  putSlot\(id, n, value\) \{/,
   '  async putSlot(id, n, value) {\n    const c = await this.get(id); if(!c) return false;\n'
   + '    const st=(c.states||[null,null,null]).slice(); st[n]=value;\n'
   + '    await this.patch(id,{states:st}); return true;\n  },\n  _old(id, n, value) {', "store"],

  ["배터리 세이브 실패를 다시 삼키기", "game.js",
   /p\.catch\(\(\) => \{ if \(!this\.dead\) this\.sramDirty = true; \}\);/, 'void 0;', "run"],

  ["저장 실패 때 playing 을 null 로 덮어쓰기", "ui.js",
   /        if \(!made \|\| !made\.id\) \{ notice = "SAVE FAILED"; return false; \}\n        playing = slimRec\(made, playing\.system\) \|\| playing;/,
   '        playing = slimRec(made, playing.system);', "ui"],

  ["저장 실패 안내를 화면에 안 그리기 (notice 만 세우고 끝)", "ui.js",
   /if \(this\.d\.redraw\) this\.d\.redraw\(\);\n            throw e;/,
   'throw e;', "page"],

  ["저장 실패 안내를 한 번만 띄우고 잠그기 (놓치면 끝)", "ui.js",
   /            sramWarned = true;\n            notice = SRAM_FAIL;/,
   '            if (sramWarned) throw e;\n            sramWarned = true;\n            notice = SRAM_FAIL;', "page"],

  ["GBA 판별을 0x96 한 바이트로 되돌리기", "game.js",
   /  return gbaLogoOk\(bytes\) \|\| gbaChecksumOk\(bytes\);/, '  return true;', "run"],

  ["GBA 제목을 게임보이 자리에서 읽기", "game.js",
   /  if \(!looksLikeGb\(bytes\) && looksLikeGba\(bytes\)\) return gbaTitle\(bytes, fileName\);/,
   '', "run"],

  ["일부러 끈 것도 사고로 알리기 (가짜 GAME STOPPED)", "game.js",
   /  stop: stopQuiet,/, '  stop: hardStop,', "run"],

  ["메뉴로 멈춘 것도 돌아오면 다시 돌리기", "game.js",
   /  if \(session && !session\.dead && !session\.running && !session\.userPaused\)\n    session\.resume\(\);/,
   '  if (session && !session.dead && !session.running) session.resume();', "run"],

  ["메뉴 화면에서도 커서를 목록 길이로 자르기", "ui.js",
   /    if \(screen === "list" && cursor >= romList\.length\)\n      cursor = Math\.max\(0, romList\.length - 1\);/,
   '    if (cursor >= romList.length) cursor = Math.max(0, romList.length - 1);', "ui"],

  ["메뉴 열 때 게임패드를 안 놓기", "index.html",
   /  for \(const n of gpPrev\) \{ try \{ GameMode\.press\(n, false\); \} catch \(e\) \{\} \}/,
   '', "page"],

  ["조작판을 꺼도 L·R 은 남기기", "index.html",
   /    \$\(id\)\.style\.display = \(showPad && isGba\) \? "flex" : "none";/,
   '    $(id).style.display = isGba ? "flex" : "none";', "page"],

  ["버튼을 끌고 나가도 실행되게", "index.html",
   /    if \(Math\.abs\(\(e\.clientX\|\|0\) - sx\) > 16 \|\| Math\.abs\(\(e\.clientY\|\|0\) - sy\) > 16\) off\(\);/,
   '', "page"],

  ["지우기 확인창의 대기시간(ARM_MS) 없애기", "index.html",
   /const ARM_MS = 400;/, 'const ARM_MS = 0;', "page"],

  ["기본 게임도 지울 수 있게", "ui.js",
   /if \(r\.bundled\) \{ notice = "BUILT-IN — CANNOT DELETE"; return false; \}/, '', "ui"],

  ["컬러 토글이 에뮬에 전달 안 되게", "ui.js",
   /if \(this\.d\.engine\.setColorMode\) this\.d\.engine\.setColorMode\(colorReal\);\n    notice = colorReal/,
   'notice = colorReal', "ui"],

  ["조작판을 숨겨도 화면이 안 커지게", "index.html",
   /const minSide = showPad \? MIN_SIDE_PAD : MIN_SIDE_BARE;/,
   'const minSide = MIN_SIDE_PAD;', "page"],

  ["화면을 늘려서 채우기 (비율 깨뜨리기)", "index.html",
   /  if \(gw > maxW\) \{ gw = Math\.max\(80, maxW\); gh = Math\.round\(gw \/ aspect\); \}/,
   '  if (gw > maxW) { gw = Math.max(80, maxW); }', "page"],

  ["글자 감싸기(esc) 없애기", "index.html",
   /<div class="t">\$\{esc\(r\.title\)\}<\/div>/, '<div class="t">${r.title}</div>', "page"],

  ["GBC 를 게임보이로 잘못 분류", "game.js",
   /return \(flag === 0x80 \|\| flag === 0xC0\) \? "gbc" : "gb";/, 'return "gb";', "ui"],

  ["두 번째 손가락이 첫 번째를 덮어쓰게", "index.html",
   /    if \(holdId !== null\) return;/, '', "page"],

  ["길게 누르는 중 움직여도 안 취소되게", "index.html",
   /Math\.abs\(e\.clientX - holdX\) > 10 \|\| Math\.abs\(e\.clientY - holdY\) > 10/, 'false', "page"],

  ["세이브의 시스템 대조를 없애기", "ui.js",
   /if \(slot\.system && slot\.system !== \(playing\.system \|\| systemId\)\) \{\n        notice = "SLOT BELONGS TO ANOTHER SYSTEM"; return false;\n      \}/,
   '', "ui"],

  ["메뉴에서 누른 게 게임으로 새게", "ui.js",
   /  press\(name, down\) \{\n    if \(screen !== "play"\) return false;/,
   '  press(name, down) {\n    if (false) return false;', "ui"],

  ["_free 를 빼기 (메모리 새기 — 71번째 저장에서 죽던 버그)", "game.js",
   /    m\._file_data_delete\(ptr\);\n    m\._free\(ptr\);            \/\* ★ 껍데기까지 반납 \*\/\n    return out;/,
   '    m._file_data_delete(ptr);\n    return out;', "run"],
];

/* ── 사본 만들기 ────────────────────────────────────────────────────────
   game/ 폴더를 통째로 임시 폴더에 복사합니다. 롬과 wasm 까지 다 필요합니다
   (진짜 binjgb 를 돌리는 검사가 있습니다).                              */
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "tempad-sabotage-"));
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) { if (e.name === "_scratch") continue; copyDir(a, b); }
    else fs.copyFileSync(a, b);
  }
}
copyDir(SRC, WORK);
process.on("exit", () => { try { fs.rmSync(WORK, { recursive: true, force: true }); } catch (e) {} });
console.log("사본에서만 망가뜨립니다 (원본은 안 건드립니다):\n  " + WORK + "\n");

const FROM = Number(process.argv[2] || 0);
const COUNT = Number(process.argv[3] || CASES.length);

let caught = 0, missed = 0;
const results = [];

for (const [name, file, find, repl, test] of CASES.slice(FROM, FROM + COUNT)) {
  const p = path.join(WORK, file);
  const orig = fs.readFileSync(p, "utf8");
  if (!find.test(orig)) {
    results.push(["?? 못찾음", name, "(정규식이 안 맞음 — 방해를 못 걸었음. 소스가 바뀌었나?)"]);
    missed++;
    continue;
  }
  fs.writeFileSync(p, orig.replace(find, repl));
  let out = "", code = 0;
  try {
    out = cp.execSync(`node test/${test}.js`, { cwd: WORK, encoding: "utf8", stdio: "pipe", timeout: 300000 });
  } catch (e) { code = 1; out = (e.stdout || "") + (e.stderr || ""); }
  fs.writeFileSync(p, orig);                       /* 사본을 되돌립니다 */
  const failed = code !== 0 || /★실패|★터짐/.test(out);
  const n = (out.match(/★실패|★터짐/g) || []).length;
  if (failed) { caught++; results.push(["잡음", name, `${test}.js 에서 ${n}건`]); }
  else { missed++; results.push(["★놓침", name, `${test}.js 가 전부 통과해버림`]); }
}

console.log("================ 방해검사 결과 ================");
for (const [tag, name, note] of results)
  console.log(`  ${tag.padEnd(8)} ${name}\n           ${note}`);
console.log(`\n잡음 ${caught} / 놓침 ${missed} / 돌린 것 ${results.length} (전체 ${CASES.length})`);
console.log("\n원본은 건드리지 않았습니다. 확인하려면: node test/_audit.js");
process.exit(missed ? 1 : 0);
