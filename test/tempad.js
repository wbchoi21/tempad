/* 본체 index.html 정적 점검 — 브라우저 없이 볼 수 있는 것들
   (게임 쪽 검사는 game/test/all.js) */
const fs=require("fs"), path=require("path");
const D=path.join(__dirname,"..");
const s=fs.readFileSync(path.join(D,"index.html"),"utf8");
const js=[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join("\n");
let bad=0;
const chk=(n,c,x)=>{ console.log((c?"  OK   ":"  ★실패 ")+n+(x&&!c?"  → "+x:"")); if(!c)bad++; };

console.log("\n[본체 index.html]\n");

const dollarAt=js.search(/(const|let|var)\s+\$\s*=/);
const gamesAt =js.indexOf('$("btnGames")');
chk("$ 가 쓰이기 전에 정의됨", dollarAt>=0 && dollarAt<gamesAt);

for(const id of ["btnGames","btnDir","btnExit","bld"])
  chk(id+" 요소가 있음", s.includes(`id="${id}"`));

/* ★ 코드가 부르는 요소가 전부 HTML 에 있는가.
     오타 하나로 화면이 통째로 안 뜨는 걸 막습니다. */
const used=[...new Set([...js.matchAll(/\$\("([\w-]+)"\)/g)].map(m=>m[1]))];
const have=new Set([...s.matchAll(/id="([\w-]+)"/g)].map(m=>m[1]));
const miss=used.filter(u=>!have.has(u));
chk(`코드가 부르는 요소 ${used.length}개가 전부 존재`, miss.length===0, miss.join(", "));

/* 홈 화면 아이콘 격자는 2x2 — 다섯 개를 넣으면 넘칩니다 */
const cells=(s.match(/<div class="icon-cell"/g)||[]).length;
chk("홈 아이콘 4개 (2x2)", cells===4, cells+"개");

/* 게임으로 가는 길 */
chk("왼쪽 세로줄 게임 버튼", js.includes('goPage("game/")'));
chk("메뉴 목록에도 있음", s.includes('data-url="game/"'));
chk("게임 버튼이 디렉토리 위에 있음",
    s.indexOf('id="btnGames"') < s.indexOf('id="btnDir"'));

/* 서비스워커 — 옛 화면에 묶이지 않게 하는 장치들 */
chk("serviceWorker 있는지 확인하고 씀", /"serviceWorker" in navigator/.test(js));
chk("★ updateViaCache 꺼둠 (안 그러면 하루까지 옛것)", /updateViaCache/.test(js));
chk("★ 다시 켜기는 한 번만 (무한 새로고침 방지)", /reloaded\s*=\s*true/.test(js));
chk("켤 때마다 새것 확인", /reg\.update\(\)/.test(js));

/* ★★ 정의되지 않은 함수를 부르는 곳이 있는가 ★★
     실제로 `exitFull()` 이 정의도 없이 불리고 있었고, try 가 오류를 삼켜서
     **전체화면이 한 번도 안 풀렸습니다.** 아무 증상 없이 조용히 실패합니다.
     점 없이 부르는 이름만 봅니다 (메서드는 제외).                        */
{
  const stripped = js
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");

  const defined = new Set();
  for (const m of stripped.matchAll(/(?:^|[^.\w])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  for (const m of stripped.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
  for (const m of stripped.matchAll(/(?:function|catch)\s*\(([^)]*)\)/g))
    m[1].split(",").forEach(a => { const n=a.trim().split(/[=\s]/)[0]; if(n) defined.add(n); });
  for (const m of stripped.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) defined.add(m[1]);

  const GLOBALS = new Set(["setTimeout","clearTimeout","setInterval","clearInterval","parseFloat","parseInt",
    "requestAnimationFrame","cancelAnimationFrame","addEventListener","removeEventListener","fetch",
    "encodeURIComponent","decodeURIComponent","getComputedStyle","matchMedia","isFinite","isNaN",
    "alert","confirm","prompt","structuredClone","queueMicrotask","btoa","atob","Number","String",
    "Boolean","Array","Object","Date","Math","JSON","Promise","Error","Map","Set","RegExp","Symbol",
    "Image","Audio","Blob","URL","FileReader","AudioContext","webkitAudioContext","Uint8Array",
    "Int8Array","Uint8ClampedArray","Float32Array","DOMParser","AbortController","Intl","if","for",
    "while","switch","catch","return","typeof","new","function","await","super","import","do",
    /* 글자열 안에 섞여 들어오는 CSS 함수들 */
    "calc","rgba","rgb","url","translate","scale","rotate","var","env","min","max","clamp"]);

  const bad = new Set();
  for (const m of stripped.matchAll(/(^|[^.\w$])([a-z_$][\w$]*)\s*\(/g)) {
    const n = m[2];
    if (!defined.has(n) && !GLOBALS.has(n)) bad.add(n);
  }
  chk("★ 정의 없는 함수를 부르는 곳이 없음", bad.size === 0, [...bad].join(", "));
}

/* ★ 종료 — 누르면 무조건 나가야 합니다 */
chk("전체화면 풀기 함수가 실제로 있음", /function exitFull\(/.test(js));
chk("★ 종료할 때 전체화면을 품", /isFull\(\)\s*\)\s*await exitFull/.test(js) || /isFull\(\) *\) *exitFull/.test(js));
chk("전체화면 풀기에 시간 제한이 있음", /setTimeout\(finish/.test(js));
chk("종료에 RESTART 버튼이 없음", !/sdRestart/.test(s),
    "끄기인데 '다시 시작' 버튼이 있으면 뜻이 어긋납니다");
chk("창 닫기를 시도함", /window\.close\(\)/.test(js));
chk("★ 안 닫히면 아예 떠남", /about:blank/.test(js));
chk("★ 뒤로가기로 못 돌아오게 replace 사용", /location\.replace\("about:blank"\)/.test(js));
chk("나가기 전 화면을 검게", /shutdown\(\)/.test(js));
/* ★ 화면을 옮길 때 기록을 남기지 않아야 종료가 계속 됩니다.
     기록이 쌓이면 브라우저가 창 닫기를 거부합니다. */
chk("★ 게임으로 갈 때 replace 사용", /location\.replace\(url\)/.test(js));
chk("★ href 로 옮기는 곳이 없음",
    !/location\.href\s*=\s*["'][^"']*game/.test(js), "기록이 쌓입니다");

/* 판 번호 */
const b=(js.match(/const BUILD = "([^"]+)"/)||[])[1];
const v=(fs.readFileSync(path.join(D,"version.txt"),"utf8").match(/BUILD (\S+)/)||[])[1];
chk("BUILD 를 화면에 찍음", /getElementById\("bld"\)/.test(js));
chk("version.txt 와 판이 같음", b===v, b+" vs "+v);

/* 서비스워커가 미리 저장할 파일이 실제로 있는가 */
const sw=fs.readFileSync(path.join(D,"sw.js"),"utf8");
/* ★ 주석을 걷어내고 봅니다.
     안 그러면 "addAll 을 쓰지 마세요" 라는 주석을 실제 코드로 오인합니다.
     실제로 이 검사가 그렇게 틀렸습니다. */
const swCode = sw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const keep=[...sw.matchAll(/"\.\/([^"]+)"/g)].map(m=>m[1]);
const gone=keep.filter(f=>!fs.existsSync(path.join(D,f)));
chk(`sw.js 가 저장할 파일 ${keep.length}개가 전부 존재`, gone.length===0, gone.join(", "));
chk("★ addAll 이 아니라 하나씩 저장 (하나 없다고 다 무너지지 않게)",
    !/addAll/.test(swCode) && /\.add\(u\)\.catch/.test(swCode));
chk("★ 성공한 응답만 저장 (404 를 저장하지 않게)", /res\.ok/.test(swCode));

console.log("\n" + (bad ? "★ 문제 "+bad+"개" : "전부 통과") + "\n");
process.exit(bad?1:0);
