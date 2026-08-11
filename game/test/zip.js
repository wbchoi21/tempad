/* ============================================================================
   zip 읽기 검사

   ★ 이 검사가 지켜야 하는 것 —
     "안 터졌다" 로 끝내지 않습니다. **무엇이 실제로 나왔는가** 를 봅니다.
     zip 은 이 앱에서 **바깥사람이 이름을 정하는 첫 입구**라 특히 조심합니다.
   ========================================================================== */
"use strict";
const path = require("path"), fs = require("fs"), os = require("os"), cp = require("child_process");
const Z  = require(path.join(__dirname, "..", "unzip.js"));
const GM = require(path.join(__dirname, "..", "game.js"));
const { makeZip, crc32, gbRom, gbaRom } = require(path.join(__dirname, "_zipmake.js"));

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  OK   " + n); }
  else { fail++; console.log("  ★실패 " + n + (x !== undefined ? "  → " + x : "")); } };
const BS = String.fromCharCode(92);                 /* 역슬래시 (셸에 안 먹히게) */
const blobOf = buf => new Blob([buf]);
const list = (buf, opt) => Z.listEntries(blobOf(buf), opt || { maxBytes: 32*1024*1024 });

(async () => {

console.log("\n[1] 평범한 zip");
{ const buf = makeZip([
    { name:"TETRIS.gb",       data: gbRom("TETRIS", {tag:1}) },
    { name:"games/ZELDA.gbc", data: gbRom("ZELDA", {cgb:0xC0, tag:2}), method:0 },  /* 무압축 */
    { name:"ADV.gba",         data: gbaRom("ADVANCE", {tag:3}) },
  ]);
  ok("zip 으로 알아봄", await Z.looksLikeZip(blobOf(buf)));
  const { entries, skipped } = await list(buf);
  ok("★ 항목 셋이 나옴", entries.length === 3, entries.length);
  ok("★ 폴더 경로가 벗겨짐", entries[1].name === "ZELDA.gbc", entries[1].name);
  ok("크기가 적혀 있음 (풀기 전에 앎)", entries[0].size === 0x8000, entries[0].size);
  ok("버린 것 없음", Object.values(skipped).every(v => v === 0), JSON.stringify(skipped));

  /* ★ 실제로 풀어서 진짜 판별기에 넣어봅니다 */
  const got = [];
  for (const e of entries) {
    const bytes = await e.read();
    got.push(GM.detectSystem(bytes) + ":" + GM.romTitle(bytes, e.name));
  }
  ok("★★ 압축한 것이 제대로 풀림", got[0] === "gb:TETRIS", got[0]);
  ok("★★ 무압축도 제대로 나옴", got[1] === "gbc:ZELDA", got[1]);
  ok("★★ GBA 도 알아봄", got[2] === "gba:ADVANCE", got[2]);
}

console.log("\n[2] ★★ 경로 탈출 — 이름은 바깥사람이 정합니다");
{ const buf = makeZip([
    { name:".."+BS+".."+BS+"etc"+BS+"passwd.gb", data: gbRom("EVIL", {tag:9}) },
    { name:"../../evil2.gb",                     data: gbRom("EVIL2", {tag:10}) },
  ]);
  const { entries } = await list(buf);
  ok("★★★ 둘 다 파일 이름만 남음", entries.length === 2
     && entries[0].name === "passwd.gb" && entries[1].name === "evil2.gb",
     entries.map(e => e.name).join("|"));
  ok("★★★ 어떤 이름에도 경로 구분자가 없음",
     entries.every(e => !/[\\\/]/.test(e.name)), entries.map(e => e.name).join("|"));
  ok("★ 그래도 내용은 멀쩡히 읽힘",
     GM.detectSystem(await entries[0].read()) === "gb");
}

console.log("\n[3] ★ 맥에서 압축하면 딸려오는 껍데기");
{ /* __MACOSX/._Pokemon.gbc 는 이름이 .gbc 로 끝나서 롬인 척합니다.
     안 거르면 "20 NOT A GAME" 같은 헛소리 안내가 뜹니다. */
  const buf = makeZip([
    { name:"POKEMON.gbc",            data: gbRom("POKEMON", {cgb:0xC0, tag:4}) },
    { name:"__MACOSX/._POKEMON.gbc", data: Buffer.alloc(200) },
    { name:"._POKEMON.gbc",          data: Buffer.alloc(200) },
    { name:".DS_Store",              data: Buffer.alloc(60) },
  ]);
  const { entries, skipped } = await list(buf);
  ok("★★ 진짜 롬 하나만 남음", entries.length === 1 && entries[0].name === "POKEMON.gbc",
     entries.map(e => e.name).join("|"));
  ok("★ 껍데기 셋을 쓰레기로 셈", skipped.junk === 3, skipped.junk);
}

console.log("\n[4] ★★ 암호 걸린 zip");
{ const buf = makeZip([{ name:"LOCKED.gb", data: gbRom("LOCKED", {tag:5}), flags:0x0001 }]);
  const { entries, skipped } = await list(buf);
  ok("★★★ 하나도 안 꺼냄", entries.length === 0, entries.length);
  ok("★★ 암호로 셈 (그래야 아드님에게 이유를 말해줄 수 있음)",
     skipped.encrypted === 1, JSON.stringify(skipped));
}

console.log("\n[5] ★ 모르는 압축 방식");
{ const buf = makeZip([
    { name:"OK.gb",   data: gbRom("OK", {tag:6}) },
    { name:"WEIRD.gb", data: gbRom("WEIRD", {tag:7}), method:99 },
  ]);
  const { entries, skipped } = await list(buf);
  ok("아는 것만 꺼냄", entries.length === 1 && entries[0].name === "OK.gb");
  ok("모르는 것은 세어둠", skipped.method === 1, skipped.method);
}

console.log("\n[6] ★★★ 압축폭탄 — 적힌 크기를 믿으면 안 됩니다");
{ /* (가) 말도 안 되는 압축률 — **풀기도 전에** 걸러야 합니다.
         롬은 0 이 많아 잘 압축되므로, 크게 부풀렸다고 적으면 비율로 걸립니다. */
  const buf = makeZip([{ name:"BOMB.gb", data: gbRom("BOMB", {tag:8}), lieSize: 5*1024*1024 }]);
  const r1 = await list(buf);
  ok("★★★ 터무니없는 압축률은 풀기 전에 걸러짐",
     r1.entries.length === 0 && r1.skipped.big === 1, JSON.stringify(r1.skipped));

  /* (나) 비율로는 안 걸리는 **조용한 거짓말** — 풀 때 실제 나온 양으로 잡아야 합니다.
         잘 안 눌리는 내용(무작위)이라 압축률이 정상 범위입니다. */
  const noisy = Buffer.alloc(0x8000);
  for (let i = 0; i < noisy.length; i++) noisy[i] = (i * 2654435761) & 0xFF;
  const sneaky = makeZip([{ name:"SNEAK.gb", data: noisy, lieSize: 0x8000 * 2 }]);
  const r2 = await list(sneaky);
  ok("(준비) 비율이 정상이라 목록에는 들어옴", r2.entries.length === 1,
     JSON.stringify(r2.skipped));
  let msg = null;
  try { await r2.entries[0].read(); } catch (e) { msg = e.message; }
  ok("★★★ 풀어보니 적힌 것과 달라서 거절됨", msg === "BROKEN ENTRY",
     String(msg) + " — 통과하면 적힌 크기를 그대로 믿은 것");

  /* (다) 상한보다 크다고 적힌 것도 풀기 전에 */
  const big = makeZip([{ name:"HUGE.gb", data: gbRom("HUGE", {tag:11}), lieSize: 99*1024*1024 }]);
  const r3 = await list(big);
  ok("★★ 상한 넘는다고 적힌 것도 풀기 전에 걸러짐",
     r3.entries.length === 0 && r3.skipped.big === 1, JSON.stringify(r3.skipped));
}

console.log("\n[7] ★★ 깨진 내용 — CRC 로 잡아야 합니다");
{ /* CRC 를 틀리게 적으면 = 전송 중 깨진 롬. 그냥 넣으면 게임이 켜지자마자 죽고
     원인을 못 찾습니다. */
  const buf = makeZip([{ name:"BROKEN.gb", data: gbRom("BROKEN", {tag:12}), badCrc: 0x12345678 }]);
  const { entries } = await list(buf);
  let msg = null;
  try { await entries[0].read(); } catch (e) { msg = e.message; }
  ok("★★★ 깨진 롬을 거절함", msg === "BROKEN ENTRY", String(msg));
}

console.log("\n[8] ★★ 로컬 헤더의 크기를 믿으면 안 됩니다 (data descriptor)");
{ /* 스트리밍으로 만든 zip 은 로컬 헤더의 크기가 0 이고 중앙 디렉터리에만 있습니다.
     로컬 것을 읽으면 파일이 통째로 빈 것으로 보입니다. */
  const buf = makeZip([{ name:"STREAM.gb", data: gbRom("STREAM", {tag:13}),
                         flags:0x0008, localZero:true }]);
  const { entries } = await list(buf);
  ok("(준비) 목록에 들어옴", entries.length === 1 && entries[0].size === 0x8000, entries[0] && entries[0].size);
  const bytes = await entries[0].read();
  ok("★★★ 내용이 온전히 나옴", bytes.length === 0x8000 && GM.detectSystem(bytes) === "gb",
     bytes.length);
}

console.log("\n[9] ★★ 로컬과 중앙의 extra 길이가 다를 때");
{ /* 자료 시작 위치는 **로컬 헤더의 길이**로 계산해야 합니다.
     중앙 것을 쓰면 엉뚱한 자리를 읽습니다 — zip 을 잘못 읽는 가장 흔한 원인. */
  const buf = makeZip([{ name:"EXTRA.gb", data: gbRom("EXTRA", {tag:14}), extraLocal: 24 }]);
  const { entries } = await list(buf);
  const bytes = await entries[0].read();
  ok("★★★ 그래도 제대로 읽힘", GM.detectSystem(bytes) === "gb" && GM.romTitle(bytes) === "EXTRA",
     GM.romTitle(bytes));
}

console.log("\n[10] ★★ 앞에 쓰레기가 붙은 zip");
{ /* 자기압축해제 파일 등. 안에 적힌 위치가 어긋나므로 보정해야 합니다.
     보정 안 하면 멀쩡한 zip 이 통째로 깨진 것으로 보입니다. */
  const buf = makeZip([{ name:"PRE.gb", data: gbRom("PRE", {tag:15}) }],
                      { prepend: Buffer.alloc(1234, 0x41) });
  const { entries } = await list(buf);
  ok("★★★ 앞에 붙은 것을 보정해서 읽음", entries.length === 1
     && GM.romTitle(await entries[0].read()) === "PRE", entries.length);
}

console.log("\n[11] ★ zip 주석 안에 가짜 표식이 있을 때");
{ /* 주석에 우연히 EOCD 표식이 들어갈 수 있습니다. 앞에서부터 찾으면 속습니다. */
  /* ★★ 채움을 **0 으로** 합니다. 전에는 0x42 였는데, 그건 c/sz/of 가 22억이
       되어 `d < 0` 에 우연히 걸린 것뿐이었습니다. 0 으로 채우면
       c=0·sz=0·of=0 이 되어 **"항목 0개인 정상 zip"** 으로 통과합니다.
       즉 이 검사는 통과하고 있었지만 아무것도 안 보고 있었습니다.
       (실제로 그 구멍이 있었고, 멀쩡한 zip 이 "게임 없음" 이 됐습니다.) */
  const fake = Buffer.concat([Buffer.from([0x50,0x4B,0x05,0x06]), Buffer.alloc(30, 0x00)]);
  const buf = makeZip([{ name:"CMT.gb", data: gbRom("CMT", {tag:16}) }], { comment: fake });
  const { entries } = await list(buf);
  ok("★★ 진짜 표식을 찾아냄", entries.length === 1
     && GM.romTitle(await entries[0].read()) === "CMT", entries.length);
}

console.log("\n[12] ★ ZIP64 는 크게 실패해야 합니다");
{ /* 조용히 넘기면 4294967295 같은 자리를 파게 되어 엉뚱한 결과가 납니다. */
  for (const [name, opt] of [["크기 감시값", {zip64Cd:true}], ["위치 감시값", {zip64Off:true}]]){
    const buf = makeZip([{ name:"Z.gb", data: gbRom("Z", {tag:17}) }], opt);
    let msg = null;
    try { await list(buf); } catch (e) { msg = e.message; }
    ok("★★ " + name + " → 크게 실패함", msg === "UNSUPPORTED ZIP" || msg === "BROKEN ZIP",
       String(msg));
  }
  /* ★★ 항목 수가 감시값(0xFFFF)인 경우 —
       앞뒤가 다 맞아떨어져서 **다른 방어선에 안 걸립니다.**
       ZIP64 검사 자체가 잡아야 하는 유일한 경우입니다. */
  const many = makeZip([{ name:"M.gb", data: gbRom("M", {tag:25}) }], { lieCount: 0xFFFF });
  let m2 = null;
  try { await list(many); } catch (e) { m2 = e.message; }
  ok("★★★ 항목수 감시값 → UNSUPPORTED ZIP", m2 === "UNSUPPORTED ZIP", String(m2));
}

console.log("\n[12-2] ★★ CRC 가 없는 zip 에서도 크기 거짓말을 잡아야 합니다");
{ /* crc 를 0 으로 적는 도구가 있습니다. 그때는 **푼 양이 적힌 것과 같은가**
     만이 유일한 방어선입니다. (CRC 가 대신 잡아주지 않습니다.) */
  const noisy = Buffer.alloc(0x4000);
  for (let i = 0; i < noisy.length; i++) noisy[i] = (i * 2654435761) & 0xFF;
  const buf = makeZip([{ name:"NOCRC.gb", data: noisy, badCrc: 0, lieSize: 0x4000 * 2 }]);
  const { entries } = await list(buf);
  ok("(준비) 목록에는 들어옴", entries.length === 1, entries.length);
  let msg = null;
  try { await entries[0].read(); } catch (e) { msg = e.message; }
  ok("★★★ 푼 양이 달라서 거절됨 (CRC 도움 없이)", msg === "BROKEN ENTRY", String(msg));
}

console.log("\n[13] ★ 깨진 zip · zip 아닌 것");
{ let msg = null;
  try { await list(Buffer.from("이건 zip 이 아닙니다 한참 길게 써봅니다 1234567890")); }
  catch (e) { msg = e.message; }
  ok("★★ zip 이 아니면 BROKEN ZIP", msg === "BROKEN ZIP", String(msg));
  ok("looksLikeZip 도 아니라고 함",
     !(await Z.looksLikeZip(blobOf(Buffer.from("PNG\x89 어쩌구 저쩌구 한참 길게")))));

  /* 꼬리가 잘린 zip */
  const good = makeZip([{ name:"A.gb", data: gbRom("A", {tag:18}) }]);
  msg = null;
  try { await list(good.subarray(0, good.length - 10)); } catch (e) { msg = e.message; }
  ok("★★ 꼬리가 잘리면 BROKEN ZIP", msg === "BROKEN ZIP", String(msg));

  /* 빈 zip */
  const empty = makeZip([]);
  const r = await list(empty);
  ok("★ 빈 zip 은 조용히 0개", r.entries.length === 0);
}

console.log("\n[14] ★ 폴더 항목과 이상한 이름");
{ const buf = makeZip([
    { name:"games/",  data: Buffer.alloc(0) },
    { name:"OK.gb",   data: gbRom("OK2", {tag:19}) },
    { name:"",        data: Buffer.alloc(10) },
  ]);
  const { entries, skipped } = await list(buf);
  ok("★ 진짜 파일만 남음", entries.length === 1 && entries[0].name === "OK.gb",
     entries.map(e => e.name).join("|"));
  ok("폴더·빈이름은 세어둠", skipped.folder === 2, skipped.folder);
}

console.log("\n[15] ★ 한글 이름 (한국 윈도는 CP949)");
{ /* 이름을 못 읽어도 **항목을 버리면 안 됩니다** — 확장자만 알아보면 되고
     진짜 판별은 롬 속 바이트로 합니다. */
  const cp949 = Buffer.from([0xC5, 0xD7, 0xBD, 0xBA, 0xC6, 0xAE, 0x2E, 0x67, 0x62]); /* 테스트.gb */
  const buf = makeZip([{ name:"x", rawName: cp949, data: gbRom("KOR", {tag:20}) }]);
  const { entries } = await list(buf);
  ok("★★ 한글 이름이어도 항목이 살아있음", entries.length === 1, entries.length);
  ok("★★ 내용도 제대로 읽힘", entries.length === 1
     && GM.romTitle(await entries[0].read()) === "KOR");
  ok("이름 끝이 .gb 로 읽힘 (거르기가 통하게)",
     entries.length === 1 && /\.gb$/i.test(entries[0].name), entries[0] && entries[0].name);
}

console.log("\n[16] ★★★ 독립 구현과 대조 — 우리끼리 같은 착각을 하고 있지 않은가");
{ /* 이 공장과 unzip.js 가 같은 오해를 공유하면 위 검사가 전부 가짜입니다.
     그래서 **윈도 내장 압축**(System.IO.Compression, 남의 라이브러리 아님)과
     양방향으로 대조합니다. */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zipx-"));
  /* ★★★ 예외를 통째로 "건너뜀 = 통과" 로 처리하면 안 됩니다. ★★★
       powershell 이 **우리 zip 이 잘못돼서** OpenRead 에서 던져도 통과가 됩니다.
       "우리 공장과 우리 리더가 같은 착각을 하고 있지 않은가" 를 보는
       유일한 검사가, 실패할 때마다 스스로 통과해버리는 구조였습니다.
       powershell 이 되는지만 먼저 따로 확인하고, 그 뒤의 실패는 진짜 실패입니다. */
  let hasPs = false;
  try {
    cp.execSync('powershell -NoProfile -Command "exit 0"', { timeout:60000, stdio:"ignore" });
    hasPs = true;
  } catch (e) { hasPs = false; }
  let ran = false, madeOk = false, readOk = false;
  if (!hasPs) ok("윈도 압축과 대조 (건너뜀 — powershell 자체가 없음)", true, "");
  else
  try {
    /* (가) 우리가 만든 zip 을 윈도가 읽는가 */
    const ours = makeZip([
      { name:"WIN1.gb", data: gbRom("WIN1", {tag:21}) },
      { name:"sub/WIN2.gb", data: gbRom("WIN2", {tag:22}), method:0 },
    ]);
    fs.writeFileSync(path.join(tmp, "ours.zip"), ours);
    const ps = `$ErrorActionPreference='Stop';Add-Type -A System.IO.Compression.FileSystem;` +
      `$z=[IO.Compression.ZipFile]::OpenRead('${tmp.replace(/\\/g,"\\\\")}\\\\ours.zip');` +
      `$($z.Entries | % { "$($_.FullName):$($_.Length)" }) -join ',';$z.Dispose()`;
    const out = cp.execSync(`powershell -NoProfile -Command "${ps.replace(/"/g,'\\"')}"`,
                            { encoding:"utf8", timeout:60000 }).trim();
    ran = true;
    madeOk = /WIN1\.gb:32768/.test(out) && /WIN2\.gb:32768/.test(out);
    ok("★★★ 우리가 만든 zip 을 윈도가 제대로 읽음", madeOk, out.slice(0,120));

    /* (나) 윈도가 만든 zip 을 우리가 읽는가 */
    const src = path.join(tmp, "src");
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, "FROMWIN.gb"), gbRom("FROMWIN", {tag:23}));
    fs.writeFileSync(path.join(src, "note.txt"), "hello");
    const ps2 = `$ErrorActionPreference='Stop';Add-Type -A System.IO.Compression.FileSystem;` +
      `[IO.Compression.ZipFile]::CreateFromDirectory('${src.replace(/\\/g,"\\\\")}','${tmp.replace(/\\/g,"\\\\")}\\\\win.zip')`;
    cp.execSync(`powershell -NoProfile -Command "${ps2.replace(/"/g,'\\"')}"`, { timeout:60000 });
    const winZip = fs.readFileSync(path.join(tmp, "win.zip"));
    const { entries } = await list(winZip);
    const rom = entries.find(e => e.name === "FROMWIN.gb");
    readOk = !!rom && GM.romTitle(await rom.read()) === "FROMWIN";
    ok("★★★ 윈도가 만든 zip 을 우리가 제대로 읽음", readOk,
       entries.map(e => e.name).join("|"));
  } catch (e) {
    ok("★★★ 윈도 압축과 대조", false,
       "powershell 은 되는데 실패했습니다 — 우리 zip 이 잘못됐을 수 있습니다: "
       + String(e.message).slice(0,200));
  } finally { try { fs.rmSync(tmp, {recursive:true, force:true}); } catch (e) {} }
}

console.log("\n[17] ★ 항목을 두 번 읽어도 되는가");
{ const buf = makeZip([{ name:"TWICE.gb", data: gbRom("TWICE", {tag:24}) }]);
  const { entries } = await list(buf);
  const a = await entries[0].read();
  const b = await entries[0].read();
  ok("★ 두 번 읽어도 같은 내용", a.length === b.length && a[0x134] === b[0x134]
     && GM.romTitle(b) === "TWICE");
}

console.log("\n[18] ★ 항목이 너무 많은 zip");
{ const many = [];
  for (let i = 0; i < 40; i++) many.push({ name:`g${i}.gb`, data: gbRom("G"+i, {tag: i+30}) });
  const buf = makeZip(many);
  const { entries } = await list(buf);
  ok("★ 40개 다 나옴", entries.length === 40, entries.length);
  const first = await entries[0].read(), last = await entries[39].read();
  ok("★ 첫 것과 끝 것 모두 제대로", GM.romTitle(first) === "G0" && GM.romTitle(last) === "G39",
     GM.romTitle(first) + "/" + GM.romTitle(last));
}

/* ══════════════════════════════════════════════════════════════════════════
   [19]~[26] — 2026-08-11 교차검사가 잡아낸 것들.
   전부 **검사가 통과하고 있는데 코드는 틀린** 종류였습니다.
   ══════════════════════════════════════════════════════════════════════ */

/* looksLikeZip 은 이름을 봅니다 (앞이 PK 가 아닌 zip 을 살릴 때만) */
const named = (buf, name) => { const b = new Blob([buf]); b.name = name; return b; };

console.log("\n[19] ★★ 중앙 디렉터리와 EOCD 사이에 다른 기록이 끼어 있을 때");
{ /* zip64 EOCD 기록 + locator, archive digital signature 같은 것이 실제로 들어갑니다.
     32비트 값은 전부 정상이라 제대로 된 리더는 그냥 읽습니다.
     전에는 보정값을 abs-(of+sz) 하나로만 계산해서, 그 길이만큼 전부 밀려
     **멀쩡한 zip 이 통째로 깨진 것**이 됐습니다. */
  for (const [why, gap] of [
    ["archive signature 기록", Buffer.concat([Buffer.from([0x50,0x4B,0x05,0x05]),
                                              Buffer.from([10,0]), Buffer.alloc(10, 0x7A)])],
    ["zip64 기록 + locator 흉내", Buffer.alloc(76, 0x11)],
  ]){
    const buf = makeZip([{ name:"GAP.gb", data: gbRom("GAP", {tag:41}) }], { gap });
    const { entries, skipped } = await list(buf);
    ok("★★★ " + why + " 가 있어도 읽힘", entries.length === 1
       && GM.romTitle(await entries[0].read()) === "GAP",
       entries.length + " " + JSON.stringify(skipped));
  }
}

console.log("\n[20] ★★ 주석 속 가짜 EOCD 를 0 으로 채워도 안 속는가");
{ /* 채움이 0 이면 c=0·sz=0·of=0 이 되어 **"항목 0개인 정상 zip"** 으로
     통과해버립니다. 그러면 멀쩡한 zip 이 "게임이 없다" 가 되고,
     버린 개수도 0 이라 이유조차 안 뜹니다. 주석 길이를 봐야 잡힙니다. */
  const fake = Buffer.concat([Buffer.from([0x50,0x4B,0x05,0x06]), Buffer.alloc(18, 0x00)]);
  const buf = makeZip([{ name:"ZERO.gb", data: gbRom("ZERO", {tag:42}) }], { comment: fake });
  const { entries } = await list(buf);
  ok("★★★ 진짜 EOCD 를 찾아 항목이 나옴", entries.length === 1
     && GM.romTitle(await entries[0].read()) === "ZERO", entries.length);

  /* ★★ 가짜가 **진짜 중앙 디렉터리를 가리키면서 개수만 부풀린** 경우.
       "빈 zip 은 2차에서만" 순서로는 못 막습니다 — c 가 0 이 아니고
       그 자리에 진짜 CEN 표식이 있어서 1차에서 그대로 뽑힙니다.
       **주석 길이 검사만이 유일한 방어선**입니다.
       ★ 가짜 뒤에 주석이 더 이어지게 둡니다. 파일 맨 끝에 붙이면
         가짜의 주석 길이(0)도 우연히 맞아떨어져 검사가 무력해집니다. */
  const items = [{ name:"CNT.gb", data: gbRom("CNT", {tag:50}) }];
  const plain = makeZip(items);
  const e0 = plain.length - 22;                  /* 주석이 없으니 끝에서 22 */
  const fake2 = Buffer.alloc(22);
  fake2.writeUInt32LE(0x06054b50, 0);
  fake2.writeUInt16LE(2, 8); fake2.writeUInt16LE(2, 10);        /* 개수만 거짓말 */
  plain.copy(fake2, 12, e0 + 12, e0 + 20);                      /* 크기·위치는 진짜 것 */
  const buf2 = makeZip(items, { comment: Buffer.concat([fake2, Buffer.alloc(10, 0x21)]) });
  const r2 = await list(buf2);
  ok("★★★ 개수를 부풀린 가짜에도 안 속음",
     r2.entries.length === 1 && r2.skipped.broken === 0,
     r2.entries.length + " " + JSON.stringify(r2.skipped));
}

console.log("\n[21] ★★ 무압축 항목이 크기를 거짓말할 때");
{ /* 중앙 디렉터리가 "푼 크기 1KB, 압축 크기 4MB" 라고 적으면
     usize>maxBytes 도 비율 검사도 **하나도 안 걸립니다**(둘 다 usize 만 봅니다).
     전에는 그대로 4MB 를 통째로 메모리에 올렸습니다. */
  const big = Buffer.alloc(4 * 1024 * 1024, 0x5A);
  const buf = makeZip([{ name:"LIE.gb", data: big, method:0, lieSize: 1024 }]);
  const { entries } = await list(buf, { maxBytes: 64 * 1024 });
  ok("(준비) 적힌 크기가 작아서 목록에는 들어옴", entries.length === 1 && entries[0].size === 1024,
     entries.length + "/" + (entries[0] && entries[0].size));
  let msg = null, got = null;
  try { got = await entries[0].read(); } catch (e) { msg = e.message; }
  ok("★★★ 읽을 때 상한에 걸려 거절함 (4MB 를 안 올림)",
     msg === "ZIP BOMB", msg === null ? ("통과해버림 " + (got && got.length) + "바이트") : msg);

  /* 약한 형태 — 상한 안이지만 적힌 것과 실제가 다름 */
  const buf2 = makeZip([{ name:"LIE2.gb", data: gbRom("LIE2", {tag:43}), method:0,
                          lieSize: 0x8000 + 5, badCrc: 0 }]);
  const { entries: e2 } = await list(buf2);
  let m2 = null;
  try { await e2[0].read(); } catch (e) { m2 = e.message; }
  ok("★★★ 길이가 안 맞으면 거절 (CRC 가 없어도)", m2 === "BROKEN ENTRY", String(m2));
}

console.log("\n[22] ★★ 잘 눌린 진짜 롬이 압축폭탄으로 오해받지 않는가");
{ /* 카트리지 크기에 맞춰 0xFF 로 패딩된 덤프는 압축률이 1030 근처까지 갑니다.
     상한이 1000 이었을 때는 **그런 진짜 롬이 이유도 없이 사라졌습니다.** */
  const rom = gbRom("PADDED", { size: 4 * 1024 * 1024 });
  rom.fill(0xFF, 0x400);                       /* 헤더만 남기고 전부 패딩 */
  const buf = makeZip([{ name:"PADDED.gb", data: rom }]);
  const { entries, skipped } = await list(buf);
  ok("★★★ 패딩 큰 롬이 목록에 들어옴", entries.length === 1, JSON.stringify(skipped));
  ok("★★★ 실제로 풀려서 제목까지 나옴", entries.length === 1
     && GM.romTitle(await entries[0].read()) === "PADDED");
}

console.log("\n[23] ★★ 앞에 쓰레기가 붙은 zip 을 zip 으로 알아보는가");
{ /* looksLikeZip 이 0번 바이트만 보면, 안쪽의 보정 코드에 **영영 도달 못 합니다** —
     단위검사에서만 통과하는 죽은 방어가 됩니다. 실제로 그 상태였습니다. */
  const buf = makeZip([{ name:"SFX.gb", data: gbRom("SFX", {tag:44}) }],
                      { prepend: Buffer.alloc(999, 0x4D) });
  ok("★★★ 이름이 .zip 이면 꼬리를 보고 알아봄", await Z.looksLikeZip(named(buf, "roms.zip")));
  ok("★ 앞이 PK 인 평범한 zip 도 그대로 통과",
     await Z.looksLikeZip(named(makeZip([{ name:"A.gb", data: gbRom("A") }]), "a.zip")));
  ok("★ 롬 파일은 zip 이 아님", !(await Z.looksLikeZip(named(gbRom("NOTZIP"), "NOTZIP.gb"))));
}

console.log("\n[24] ★★ 진짜 data descriptor 가 붙은 zip");
{ /* 흘려보내며 압축한 zip 은 자료 뒤에 16바이트가 더 붙고 로컬 헤더 크기는 0 입니다.
     그 꼬리를 자료로 착각하면 CRC 가 틀립니다. */
  const buf = makeZip([{ name:"STREAM.gb", data: gbRom("STREAM", {tag:45}),
                         flags: 0x8, localZero: true, dataDesc: true }]);
  const { entries } = await list(buf);
  ok("★★★ 꼬리를 자료로 안 세고 제대로 읽음", entries.length === 1
     && GM.romTitle(await entries[0].read()) === "STREAM", entries.length);
}

console.log("\n[25] ★ 중앙 디렉터리에 extra 가 붙어 있을 때");
{ /* 진짜 압축 도구는 거의 항상 시각(UT/UX) 확장을 넣습니다.
     중앙 extra 길이를 안 건너뛰면 **두 번째 항목부터 통째로 어긋납니다.** */
  const buf = makeZip([
    { name:"EX1.gb", data: gbRom("EX1", {tag:46}), extraCentral: 21 },
    { name:"EX2.gb", data: gbRom("EX2", {tag:47}), extraCentral: 9, extraLocal: 13 },
  ]);
  const { entries } = await list(buf);
  ok("★★ 둘 다 나옴", entries.length === 2, entries.length);
  ok("★★ 둘 다 제대로 읽힘", entries.length === 2
     && GM.romTitle(await entries[0].read()) === "EX1"
     && GM.romTitle(await entries[1].read()) === "EX2");
}

console.log("\n[26] ★ zip 안에 zip 이 있을 때는 따로 세어 알려준다");
{ const inner = makeZip([{ name:"IN.gb", data: gbRom("IN", {tag:48}) }]);
  const buf = makeZip([
    { name:"more.zip", data: inner, method:0 },
    { name:"OK.gb",    data: gbRom("OK", {tag:49}) },
  ]);
  const { entries, skipped } = await list(buf);
  ok("★★ 안쪽 zip 은 안 풀고 따로 셈", skipped.nested === 1, JSON.stringify(skipped));
  ok("★★ 나머지 게임은 그대로 들어옴", entries.length === 1 && entries[0].name === "OK.gb",
     entries.map(e => e.name).join("|"));
}

console.log(`\n${"=".repeat(46)}\n통과 ${pass}  실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
})();
