const P = require(require("path").join(__dirname,"..","pad.js"));
const { Pad, toDir, RADIUS } = P;
let pass=0,fail=0;
const ok=(n,c,x)=>{ if(c){pass++;console.log("  OK   "+n);} else {fail++;console.log("  ★실패 "+n+(x?"  → "+x:""));} };
const mk=()=>{ const log=[]; const p=new Pad({onPress:(n,d)=>log.push(n+(d?"+":"-"))}); return {p,log}; };
const R=RADIUS;

console.log("\n[1] 방향 판정");
{ ok("가만히 두면 없음", toDir(0,0,R)===null);
  ok("살짝 얹은 정도는 무시", toDir(4,0,R)===null, toDir(4,0,R));
  ok("살짝 민 정도로는 아직 안 침", toDir(R*0.3,0,R)===null, toDir(R*0.3,0,R));
  ok("확실히 밀면 오른쪽", toDir(R,0,R)==="right");
  ok("왼쪽", toDir(-R,0,R)==="left");
  ok("위", toDir(0,-R,R)==="up");
  ok("아래", toDir(0,R,R)==="down");
  ok("예전 방식(하나만)도 그대로 됨", ["up","right"].includes(toDir(R,-R,R)), toDir(R,-R,R));
}

console.log("\n[1-2] ★★ 대각선 — 진짜 십자키처럼 두 방향이 같이 눌려야 함");
{ const { toDirs } = P;
  const j = (x,y,prev) => toDirs(R*x, R*y, R, prev).sort().join("+");
  ok("오른쪽만",        j(1,0)==="right", j(1,0));
  ok("위만",            j(0,-1)==="up", j(0,-1));
  ok("★ 오른쪽+위",     j(0.71,-0.71)==="right+up", j(0.71,-0.71));
  ok("★ 왼쪽+아래",     j(-0.71,0.71)==="down+left", j(-0.71,0.71));
  ok("★ 오른쪽+아래",   j(0.71,0.71)==="down+right", j(0.71,0.71));
  ok("★ 왼쪽+위",       j(-0.71,-0.71)==="left+up", j(-0.71,-0.71));
  ok("가만히 두면 없음", j(0,0)==="", j(0,0));

  /* 8방향이 45도씩 고르게 나뉘는가 — 한 바퀴 돌면서 셉니다 */
  const seen = {};
  for(let a=0;a<360;a++){
    const t=a*Math.PI/180;
    seen[toDirs(R*Math.cos(t), R*Math.sin(t), R).sort().join("+")] = true;
  }
  ok("★ 여덟 방향이 전부 나옴", Object.keys(seen).length===8,
     Object.keys(seen).sort().join(" / "));

  /* 실제로 45도씩인지 (한 방향이 차지하는 각도) */
  let rightOnly=0;
  for(let a=0;a<3600;a++){
    const t=a/10*Math.PI/180;
    if(toDirs(R*Math.cos(t), R*Math.sin(t), R).join("+")==="right") rightOnly++;
  }
  ok("★ 한 방향이 45도쯤 차지", Math.abs(rightOnly/10 - 45) < 2, (rightOnly/10)+"도");

  /* NaN 방어 */
  ok("숫자가 아니면 없음", toDirs(NaN,0,R).length===0);
  ok("무한대도 없음", toDirs(Infinity,0,R).length===0);
}

console.log("\n[1-3] ★ 대각선으로 꺾을 때 가던 방향이 안 끊겨야 함");
{ /* 오른쪽 → 오른쪽위 로 꺾을 때 right 를 뗐다 다시 누르면
     게임이 "키를 놨다"고 읽어서 캐릭터가 한 박자 멈춥니다. */
  const {p,log}=mk();
  p.down(1, 100, 100);
  p.move(1, 100+R, 100);              /* 오른쪽 */
  log.length=0;
  p.move(1, 100+R*0.71, 100-R*0.71);  /* 오른쪽위 */
  ok("★ right 를 놓지 않음", log.indexOf("right-")<0, log.join(","));
  ok("up 만 새로 눌림", log.join(",")==="up+", log.join(","));
  ok("둘 다 눌린 상태", p.held.join(",")==="right,up", p.held.join(","));
  log.length=0;
  p.move(1, 100+R, 100);              /* 다시 오른쪽 */
  ok("★ up 만 떼짐", log.join(",")==="up-", log.join(","));
  ok("right 는 계속 눌린 채", p.held.join(",")==="right", p.held.join(","));
}

console.log("\n[1-4] ★★ 십자키와 버튼을 동시에 (두 손가락)");
{ const {p,log}=mk();
  /* 왼손으로 오른쪽위, 오른손으로 A 와 B 를 같이 */
  p.down(1, 100, 100);
  p.move(1, 100+R*0.71, 100-R*0.71);
  p.btnDown(2, "A");
  p.btnDown(3, "B");
  ok("★★ 대각선 + A + B 가 전부 눌림",
     p.held.join(",")==="A,B,right,up", p.held.join(","));
  p.btnUp(2);
  ok("A 만 떼짐", p.held.join(",")==="B,right,up", p.held.join(","));
  ok("★ 이동은 그대로", p.held.includes("right") && p.held.includes("up"));
  p.up(1);
  ok("이동만 떼짐", p.held.join(",")==="B", p.held.join(","));
  p.btnUp(3);
  ok("전부 풀림", p.held.length===0);
}

console.log("\n[1-5] ★★ 블루투스 게임패드");
{ const { gamepadHeld, gamepadEdges } = P;
  /* 표준 규격대로 버튼 17개, 축 4개짜리 패드를 만듭니다 */
  const mkPad = (down = [], axes = [0,0,0,0]) => ({
    buttons: Array.from({length:17}, (_,i) => ({ pressed: down.indexOf(i) >= 0,
                                                 value: down.indexOf(i) >= 0 ? 1 : 0 })),
    axes,
  });
  const h = (...a) => gamepadHeld(...a).join(",");

  ok("아무것도 안 누르면 없음", h([mkPad()])==="", h([mkPad()]));
  ok("패드가 없어도 안 터짐", h([])==="" && h(null)==="" && h([null])==="");

  /* ★ 게임보이는 A 가 오른쪽입니다 */
  ok("★ 오른쪽 버튼(1) = A", h([mkPad([1])])==="A");
  ok("★ 아래 버튼(0) = B",   h([mkPad([0])])==="B");
  ok("왼쪽·위 버튼도 B (헷갈리지 말라고)", h([mkPad([2])])==="B" && h([mkPad([3])])==="B");
  ok("SELECT(8)", h([mkPad([8])])==="select");
  ok("START(9)",  h([mkPad([9])])==="start");
  /* ★★ v2 — 어깨 버튼은 이제 게임 입력입니다. ★★
       v1 은 L 이나 R 혼자 누르면 MENU 였습니다. 게임보이에는 어깨 버튼이
       없어서 그래도 됐지만, GBA 는 L·R 이 진짜 게임 버튼입니다.
       그대로 두면 드리프트하려고 R 을 누른 순간 게임이 멈춥니다. */
  ok("★ L(4) 은 게임 입력 L", h([mkPad([4])])==="L", h([mkPad([4])]));
  ok("★ R(5) 은 게임 입력 R", h([mkPad([5])])==="R", h([mkPad([5])]));
  ok("★ 어느 것도 menu 가 아님", !/menu/.test(h([mkPad([4,5])])), h([mkPad([4,5])]));

  /* 십자키 */
  ok("십자키 위(12)",   h([mkPad([12])])==="up");
  ok("십자키 아래(13)", h([mkPad([13])])==="down");
  ok("★ 십자키 대각선", h([mkPad([12,15])])==="right,up", h([mkPad([12,15])]));

  /* 아날로그 스틱도 십자키처럼 */
  ok("스틱 오른쪽",     h([mkPad([], [ 1, 0,0,0])])==="right");
  ok("스틱 위",         h([mkPad([], [ 0,-1,0,0])])==="up");
  ok("★ 스틱 대각선",   h([mkPad([], [ 0.8,-0.8,0,0])])==="right,up");
  ok("★ 살짝 기울인 건 무시", h([mkPad([], [0.3,0.3,0,0])])==="", h([mkPad([], [0.3,0.3,0,0])]));
  ok("축이 이상해도 안 터짐", h([mkPad([], [NaN,undefined,0,0])])==="");

  /* 게임에서 진짜 쓰는 조합 */
  ok("★★ 대각선 + A + B 동시",
     h([mkPad([0,1,12,15])])==="A,B,right,up", h([mkPad([0,1,12,15])]));

  /* ★ 바뀐 것만 보내야 합니다. 안 그러면 1초에 60번씩 눌립니다. */
  ok("같으면 아무것도 안 보냄",
     gamepadEdges(["A","right"], ["A","right"]).length===0);
  ok("★ 새로 눌린 것만", JSON.stringify(gamepadEdges(["A"], ["A","up"]))==='[["up",true]]');
  ok("★ 뗀 것만",       JSON.stringify(gamepadEdges(["A","up"], ["up"]))==='[["A",false]]');
  ok("눌림과 뗌이 같이", gamepadEdges(["A"], ["B"]).length===2);
  ok("처음엔 전부 눌림", JSON.stringify(gamepadEdges([], ["A"]))==='[["A",true]]');
  ok("★ 전부 놓기",     JSON.stringify(gamepadEdges(["A"], []))==='[["A",false]]');
}

console.log("\n[2] ★ 대각선 떨림 방지");
{ /* 45도 바로 근처에서 손가락이 미세하게 흔들려도 방향이 안 바뀌어야 함 */
  let d="right", flips=0;
  for(let i=0;i<200;i++){
    const jitter=(i%2?1:-1)*0.03;
    const nd=toDir(R*0.72, R*(-0.70+jitter), R, d);
    if(nd!==d){ flips++; d=nd; }
  }
  ok("45도 근처에서 안 떨림", flips===0, "바뀐 횟수 "+flips);
  /* 관성이 없으면 어떻게 되는지 (비교용) */
  let d2=null, f2=0;
  for(let i=0;i<200;i++){
    const jitter=(i%2?1:-1)*0.03;
    const nd=toDir(R*0.72, R*(-0.70+jitter), R, null);
    if(nd!==d2){ f2++; d2=nd; }
  }
  ok("관성 없으면 실제로 떨림(대조)", f2>50, "바뀐 횟수 "+f2);
  /* 그래도 확실히 꺾으면 바뀌어야 함 */
  ok("확실히 꺾으면 바뀜", toDir(R*0.1, -R, R, "right")==="up");
}

console.log("\n[3] 손가락 따라가기");
{ const {p,log}=mk();
  p.down(1, 100, 100);
  ok("닿기만 해선 안 움직임", log.length===0);
  p.move(1, 100+R, 100);
  ok("밀면 오른쪽", log.join(",")==="right+", log.join(","));
  p.move(1, 100, 100-R);
  ok("★ 방향 바꾸면 옛 방향을 뗌", log.join(",")==="right+,right-,up+", log.join(","));
  p.up(1);
  ok("떼면 풀림", p.held.length===0);
  ok("뗐다는 신호가 감", log[log.length-1]==="up-");
}

console.log("\n[4] ★ 판 밖으로 나가도 안 끊김");
{ const {p,log}=mk();
  p.down(1, 100, 100);
  p.move(1, 900, 100);            /* 화면 저 끝까지 */
  ok("멀리 나가도 계속 눌림", p.held.join(",")==="right");
  p.move(1, -900, 100);
  ok("반대편 끝으로 가도 따라옴", p.held.join(",")==="left");
}

console.log("\n[5] ★ 전화 오면 (pointercancel)");
{ const {p,log}=mk();
  p.down(1,100,100); p.move(1,100+R,100);
  ok("걷는 중", p.held.join(",")==="right");
  p.up(1);                        /* cancel 도 같은 길로 들어옵니다 */
  ok("취소되면 손 뗌", p.held.length===0, p.held.join(","));
  ok("★ 눌린 채 고착 안 됨", log[log.length-1]==="right-",
     "이게 없으면 알림 뜬 뒤 계속 걸어감");
}

console.log("\n[6] ★ 두 손 동시");
{ const {p,log}=mk();
  p.down(1,100,100); p.move(1,100,100+R);   /* 왼손: 아래로 */
  p.btnDown(2,"A");                          /* 오른손: A */
  ok("둘 다 눌림", p.held.join(",")==="A,down", p.held.join(","));
  p.btnDown(3,"B");
  ok("셋도 됨", p.held.join(",")==="A,B,down");
  p.btnUp(2);
  ok("A만 떼짐", p.held.join(",")==="B,down");
  ok("★ 버튼 떼도 이동은 유지", p.held.includes("down"));
  p.up(1);
  ok("이동만 떼짐", p.held.join(",")==="B");
}

console.log("\n[7] 손가락 구분");
{ const {p}=mk();
  p.down(1,100,100);
  ok("두 번째 손가락은 이동을 못 뺏음", p.down(2,300,300)===false);
  p.move(2,300,300+R);
  ok("남의 손가락 움직임은 무시", p.held.length===0);
  ok("남의 손가락 뗌도 무시", p.up(2)===false);
  ok("원래 손가락은 그대로", p.stickId===1);
  ok("같은 버튼 두 번 눌림 방지", (p.btnDown(5,"A"), p.btnDown(5,"A")===false));
}

console.log("\n[8] ★ 전부 떼기 (화면 나갈 때)");
{ const {p,log}=mk();
  p.down(1,100,100); p.move(1,100+R,100); p.btnDown(2,"A"); p.btnDown(3,"start");
  ok("셋 눌린 상태", p.held.length===3);
  p.releaseAll();
  ok("전부 풀림", p.held.length===0);
  const tail=log.slice(-3).sort().join(",");
  ok("★ 뗐다는 신호가 전부 감", tail==="A-,right-,start-", tail);
  ok("두 번 해도 안 죽음", (p.releaseAll(), true));
}

console.log("\n[8-2] ★ 같은 버튼을 두 손가락으로");
{ const {p,log}=mk();
  p.btnDown(1,"A"); p.btnDown(2,"A");
  ok("누름은 두 번 감", log.filter(x=>x==="A+").length===2, log.join(","));
  p.btnUp(1);
  ok("★ 하나 떼도 안 놓임", !log.includes("A-"), log.join(","));
  ok("아직 눌린 상태", p.held.includes("A"));
  p.btnUp(2);
  ok("마지막을 떼면 놓임", log.filter(x=>x==="A-").length===1, log.join(","));
}
{ const {p,log}=mk();
  p.btnDown(1,"A"); p.btnDown(2,"A"); p.btnDown(3,"B");
  p.releaseAll();
  ok("★ releaseAll 도 이름별로 한 번씩", log.filter(x=>x==="A-").length===1,
     "A- 가 "+log.filter(x=>x==="A-").length+"번");
  ok("B 도 한 번", log.filter(x=>x==="B-").length===1);
  ok("전부 풀림", p.held.length===0);
}

console.log("\n[9] 화면에 붙였다 떼기");
{ const evs={}; const el={ addEventListener:(t,f)=>{(evs[t]=evs[t]||[]).push(f);},
                           removeEventListener:(t,f)=>{ evs[t]=(evs[t]||[]).filter(x=>x!==f); },
                           setPointerCapture(){ this.captured=true; }, classList:{add(){},remove(){}} };
  const {p,log}=mk();
  p.attach(el, []);
  ok("붙음", (evs["pointerdown"]||[]).length===1);
  ok("취소도 듣고 있음", (evs["pointercancel"]||[]).length===1);
  evs["pointerdown"][0]({pointerId:1,clientX:0,clientY:0,preventDefault(){}});
  ok("★ 손가락 잡아둠(setPointerCapture)", el.captured===true);
  evs["pointermove"][0]({pointerId:1,clientX:R,clientY:0,preventDefault(){}});
  ok("움직임 전달", p.held.join(",")==="right");
  p.detach();
  ok("떼면 눌린 것도 풀림", p.held.length===0);
  ok("이벤트도 떨어짐", (evs["pointerdown"]||[]).length===0);
}

console.log("\n[10] ★★ v2 — MENU 는 SELECT + L + R 을 한꺼번에");
{ const { gamepadResolve, gamepadEdges, MENU_COMBO } = P;
  const r = h => gamepadResolve(h);

  ok("(준비) 조합이 셋", MENU_COMBO.length===3);
  ok("아무것도 아니면 그대로", r(["A","up"]).menu===false && r(["A","up"]).held.join(",")==="A,up");

  /* 하나씩만 눌러서는 절대 안 열려야 합니다 — 이게 v1 의 문제였습니다 */
  ok("★ SELECT 혼자로는 안 열림", r(["select"]).menu===false);
  ok("★ L 혼자로는 안 열림",      r(["L"]).menu===false);
  ok("★ R 혼자로는 안 열림",      r(["R"]).menu===false);
  ok("★ L+R 둘로도 안 열림",      r(["L","R"]).menu===false);
  ok("★ SELECT+L 로도 안 열림",   r(["select","L"]).menu===false);
  ok("★★ 셋을 다 눌러야 열림",    r(["L","R","select"]).menu===true);
  ok("차례가 달라도 열림",        r(["select","R","L"]).menu===true);

  /* ★ 조합이 성립하면 그 셋은 **게임에 안 들어가야** 합니다.
       안 그러면 메뉴를 열면서 게임에도 SELECT·L·R 이 들어가서,
       돌아왔을 때 캐릭터가 엉뚱한 짓을 하고 있습니다. */
  const got = r(["A","L","R","select","up"]);
  ok("★★ 조합에 쓰인 셋은 걷어냄", got.held.join(",")==="A,up", got.held.join(","));
  ok("★ 나머지 게임 입력은 그대로 감", got.held.indexOf("A")>=0 && got.held.indexOf("up")>=0);

  /* ★ 조합을 만들어 가는 도중에 눌렸던 것은 제대로 놓여야 합니다.
       (SELECT 를 먼저 눌렀다가 L·R 을 마저 누르는 실제 손동작) */
  let prev = [];
  const step = held => { const x=r(held); const e=gamepadEdges(prev, x.held); prev=x.held; return {e, menu:x.menu}; };
  let s = step(["select"]);
  ok("SELECT 혼자는 게임 입력이 맞음", JSON.stringify(s.e)==='[["select",true]]', JSON.stringify(s.e));

  /* ★★★ 여기가 이번 세션에서 두 번 뒤집은 부분입니다. ★★★

     사람은 세 버튼을 16ms 안에 동시에 못 누릅니다. SELECT → L → R 로
     누르면 그 사이 프레임의 SELECT·L 이 게임으로 들어갑니다.
     그래서 한때 "조합을 만드는 중"(SELECT + 어깨)도 걷어냈습니다.

     ★ 그런데 그게 더 나빴습니다 —
       어깨 버튼에 손가락을 얹어둔 동안 **SELECT 가 통째로 죽습니다.**
       게임보이·컬러에는 어깨 버튼이 아예 없어서 거기 손가락을 얹기 쉬운데,
       그러면 SELECT 가 아무 반응이 없습니다. 화면에 표시도 없습니다.

     그래서 되돌렸습니다. **조용히 계속 죽는 입력**보다
     **메뉴 열 때 한 번 스치는 입력**이 낫다고 판단했습니다.
     아래 검사는 그 판단을 못 박아 둡니다 — 나중에 누가 다시 뒤집으려 하면
     여기 적힌 이유를 먼저 읽게 됩니다.                                  */
  s = step(["select","L"]);
  ok("★★★ 어깨를 얹고 있어도 SELECT 를 안 잡아먹음",
     !/\["select",false\]/.test(JSON.stringify(s.e)), JSON.stringify(s.e));
  ok("★ L 은 게임 입력으로 감 (GBA 에서 진짜 버튼)",
     JSON.stringify(s.e)==='[["L",true]]', JSON.stringify(s.e));
  ok("아직 메뉴는 아님", s.menu===false);

  s = step(["select","L","R"]);
  ok("★★ R 까지 누르면 메뉴가 열림", s.menu===true);
  ok("★★ 그 순간 눌려 있던 것들이 게임에서 놓임 (눌린 채 안 남게)",
     s.e.length===2 && s.e.every(([n,d])=>d===false && (n==="select"||n==="L")),
     JSON.stringify(s.e));

  s = step([]);
  ok("손을 다 떼면 메뉴 신호도 꺼짐", s.menu===false);
  ok("★★ 눌린 채 남는 것이 하나도 없음", s.e.length===0, JSON.stringify(s.e));

  /* ★ 조합을 만들다 만 경우 — 눌린 채 남으면 안 됩니다 */
  prev=[];
  s = step(["select"]);
  s = step(["select","R"]);
  s = step([]);
  ok("★★ 만들다 말아도 전부 놓임",
     JSON.stringify(s.e.map(x=>x[1]))==="[false,false]", JSON.stringify(s.e));

  /* ★ L+R 만 쥔 것은 진짜 게임 조작이라 그대로 통과해야 합니다 */
  prev=[];
  s = step(["L","R"]);
  ok("★★ L+R 둘만은 게임 조작 그대로", s.menu===false
     && /\["L",true\]/.test(JSON.stringify(s.e)) && /\["R",true\]/.test(JSON.stringify(s.e)),
     JSON.stringify(s.e));
  ok("★ 그것만으로는 메뉴가 안 열림", s.menu===false);

  ok("빈 것도 안 터짐", r([]).menu===false && r(null).held.length===0);
}

console.log(`\n${"=".repeat(46)}\n통과 ${pass}  실패 ${fail}\n`);
process.exit(fail?1:0);
