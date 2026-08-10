const P = require(require("path").join(__dirname,"..","pad.js"));
const { Pad, toDir, RADIUS } = P;
let pass=0,fail=0;
const ok=(n,c,x)=>{ if(c){pass++;console.log("  OK   "+n);} else {fail++;console.log("  ★실패 "+n+(x?"  → "+x:""));} };
const mk=()=>{ const log=[]; const p=new Pad({onPress:(n,d)=>log.push(n+(d?"+":"-"))}); return {p,log}; };
const R=RADIUS;

console.log("\n[1] 방향 판정");
{ ok("가만히 두면 없음", toDir(0,0,R)===null);
  ok("살짝 얹은 정도는 무시", toDir(4,0,R)===null, toDir(4,0,R));
  ok("반쯤만 밀면 아직 안 침", toDir(R*0.4,0,R)===null);
  ok("확실히 밀면 오른쪽", toDir(R,0,R)==="right");
  ok("왼쪽", toDir(-R,0,R)==="left");
  ok("위", toDir(0,-R,R)==="up");
  ok("아래", toDir(0,R,R)==="down");
  ok("대각선도 4방향 중 하나만", ["up","right"].includes(toDir(R,-R,R)), toDir(R,-R,R));
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

console.log(`\n${"=".repeat(46)}\n통과 ${pass}  실패 ${fail}\n`);
process.exit(fail?1:0);
