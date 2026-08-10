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
chk("왼쪽 세로줄 게임 버튼", js.includes('location.href = "game/"'));
chk("메뉴 목록에도 있음", s.includes('data-url="game/"'));
chk("게임 버튼이 디렉토리 위에 있음",
    s.indexOf('id="btnGames"') < s.indexOf('id="btnDir"'));

/* 서비스워커 — 옛 화면에 묶이지 않게 하는 장치들 */
chk("serviceWorker 있는지 확인하고 씀", /"serviceWorker" in navigator/.test(js));
chk("★ updateViaCache 꺼둠 (안 그러면 하루까지 옛것)", /updateViaCache/.test(js));
chk("★ 다시 켜기는 한 번만 (무한 새로고침 방지)", /reloaded\s*=\s*true/.test(js));
chk("켤 때마다 새것 확인", /reg\.update\(\)/.test(js));

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
