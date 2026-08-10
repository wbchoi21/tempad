const F = require("./fake.js");
let pass=0, fail=0;
const ok = (name, cond, extra) => { if(cond){pass++; console.log("  OK   "+name);}
  else {fail++; console.log("  ★실패 "+name+(extra?"  → "+extra:""));} };

function fresh(opt){
  F.reset();
  const dom = F.makeDom();
  delete require.cache[require.resolve("/sessions/quirky-bold-heisenberg/mnt/Daniel_Tempad/web/game/game.js")];
  const G = require("/sessions/quirky-bold-heisenberg/mnt/Daniel_Tempad/web/game/game.js");
  const mod = F.makeModule(opt||{});
  const rom = new Uint8Array(0x8000);
  const title = "TVA TEST";
  for(let i=0;i<title.length;i++) rom[0x134+i] = title.charCodeAt(i);
  return { dom, G, mod, rom };
}

console.log("\n[1] 색 바꾸기");
{ const {G}=fresh();
  const d=new Uint8Array([0,0,0,255, 70,70,70,255, 140,140,140,255, 255,255,255,255]);
  G.tintOrange(d);
  ok("가장 어두운 → #040506", d[0]===4&&d[1]===5&&d[2]===6);
  ok("가장 밝은 → #F8861E", d[12]===248&&d[13]===134&&d[14]===30);
  ok("4단계로만 나옴", new Set([d[0],d[4],d[8],d[12]]).size===4);
  ok("투명도는 안 건드림", d[3]===255);
}

console.log("\n[2] 롬 제목 읽기");
{ const {G,rom}=fresh();
  ok("헤더에서 제목", G.romTitle(rom)==="TVA TEST", G.romTitle(rom));
  const junk=new Uint8Array(0x8000); junk.fill(0xFF);
  ok("깨진 헤더 → UNTITLED", G.romTitle(junk)==="UNTITLED", G.romTitle(junk));
  ok("짧은 파일도 안 죽음", G.romTitle(new Uint8Array(10))==="UNTITLED");
  /* 실제 롬에서 걸린 것들 */
  const cgb=new Uint8Array(0x8000); "TOBUDX".split("").forEach((c,i)=>cgb[0x134+i]=c.charCodeAt(0));
  cgb[0x143]=0xC0;
  ok("컬러표시(0x143)를 제목으로 안 읽음", G.romTitle(cgb)==="TOBUDX", G.romTitle(cgb));
  const mfr=new Uint8Array(0x8000); "2048-gb".split("").forEach((c,i)=>mfr[0x134+i]=c.charCodeAt(0));
  for(let i=0x13F;i<=0x142;i++) mfr[i]=0x58;                    /* XXXX */
  for(let i=0x134+7;i<0x13F;i++) mfr[i]=0x20;                   /* 빈칸 */
  ok("제조사 코드를 제목에서 잘라냄", G.romTitle(mfr)==="2048-gb", G.romTitle(mfr));
  const empty=new Uint8Array(0x8000);
  ok("제목 없으면 파일 이름 사용", G.romTitle(empty,"WORDLE.gb")==="WORDLE", G.romTitle(empty,"WORDLE.gb"));
  ok("파일 이름도 없으면 UNTITLED", G.romTitle(empty)==="UNTITLED");
  const a=G.romKey(rom); const b=new Uint8Array(rom); b[500]=1;
  ok("같은 롬은 같은 열쇠", a===G.romKey(rom));
  ok("다른 롬은 다른 열쇠", a!==G.romKey(b));
}

console.log("\n[3] 시작과 정리");
{ const {dom,G,mod,rom}=fresh();
  const s=G.start(mod,rom,{});
  ok("돌고 있음", G.isRunning());
  ok("화면 예약됨", dom.rafs.size===1);
  ok("자동저장 타이머 있음", dom.timers.size===1);
  ok("메모리 잡음", mod._alive.size>0);
  G.stop();
  ok("멈춤", !G.isRunning());
  ok("화면 예약 취소", dom.rafs.size===0);
  ok("타이머 정리", dom.timers.size===0);
  ok("메모리 전부 반납", mod._alive.size===0, [...mod._alive].join(","));
  ok("소리 끔", dom.audio.state==="suspended");
  ok("두 번 정리해도 안 죽음", (()=>{try{G.stop();s.destroy();return true;}catch(e){return false;}})());
}

console.log("\n[4] ★ 좀비 방지");
{ const {dom,G,mod,rom}=fresh();
  const a=G.start(mod,rom,{});
  const b=G.start(mod,rom,{});           /* 앞의 것을 정리해야 함 */
  ok("앞 게임 죽음", a.dead===true);
  ok("뒤 게임만 살아있음", G.current()===b && !b.dead);
  ok("화면 예약이 하나뿐", dom.rafs.size===1, "개수 "+dom.rafs.size);
  /* 정리된 뒤에 옛 프레임이 돌아도 다시 예약하면 안 됨 */
  G.stop();
  const before=dom.rafs.size;
  a.frame(16); b.frame(16);
  ok("죽은 게임은 다시 예약 안 함", dom.rafs.size===before, "전 "+before+" 후 "+dom.rafs.size);
}

console.log("\n[5] ★ 비정상 종료 방어");
{ const {dom,G,mod,rom}=fresh();
  G.start(mod,rom,{});
  global.document.visibilityState="hidden";
  dom.fire("visibilitychange");
  ok("화면 꺼지면 멈춤", !G.isRunning());
  ok("화면 꺼지면 소리도 끔", dom.audio.state==="suspended");
  G.resume();
  ok("돌아오면 다시 돎", G.isRunning());
  dom.fire("pagehide");
  ok("페이지 떠나면 완전 정리", G.current()===null && mod._alive.size===0);
}
{ const {dom,G,mod,rom}=fresh();
  G.start(mod,rom,{});
  dom.fire("error");
  ok("오류 나면 게임 정지", G.current()===null, "루프가 초당 60번 오류 뱉는 것 방지");
  ok("오류 나도 메모리 반납", mod._alive.size===0);
}
{ const {dom,G,mod,rom}=fresh();
  G.start(mod,rom,{});
  dom.fire("freeze");
  ok("브라우저가 얼려도 정리", G.current()===null);
}

console.log("\n[6] ★ 한 단계가 실패해도 나머지는 돌아야 함");
{ const {dom,G,mod,rom}=fresh({throwOnRewindDelete:true});
  G.start(mod,rom,{});
  let threw=false;
  try{ G.stop(); }catch(e){ threw=true; }
  ok("정리 중 오류가 밖으로 안 샘", !threw);
  ok("그래도 화면 예약은 취소됨", dom.rafs.size===0);
  ok("그래도 타이머는 정리됨", dom.timers.size===0);
  ok("그래도 에뮬은 지워짐(=롬도 같이 반납)", F.log.includes("emu.delete"));
}

console.log("\n[7] 배터리 세이브 (게임 자체 저장)");
{ const {dom,G,mod,rom}=fresh();
  let saved=null;
  const s=G.start(mod,rom,{ onSram: b => saved=b });
  ok("안 바뀌었으면 저장 안 함", s.flushSram()===false && saved===null);
  mod._setSramDirty(true);
  dom.tick(16);                                  /* 한 프레임 돌리면 감지 */
  ok("게임이 저장한 걸 감지", s.sramDirty===true);
  ok("저장 실행됨", s.flushSram()===true);
  ok("바이트를 넘겨줌", saved && saved.length===32, saved?saved.length:"null");
  ok("한 번 저장하면 표시 지워짐", s.flushSram()===false);
  saved=null; mod._setSramDirty(true); dom.tick(32);
  G.stop();
  ok("★ 나가기 전에 마지막 저장", saved!==null, "이게 없으면 진행이 날아감");
}

console.log("\n[8] 세이브 스테이트");
{ const {G,mod,rom}=fresh();
  G.start(mod,rom,{});
  const st=G.saveState();
  ok("바이트 배열이 나옴", st instanceof Uint8Array && st.length===64, st?st.length:"null");
  ok("크기 맞으면 불러와짐", G.loadState(st)===true);
  ok("크기 다르면 거부", G.loadState(new Uint8Array(3))===false);
  ok("메모리 누수 없음(FileData 삭제)", F.log.filter(x=>x==="filedata.delete").length>=3);
  G.stop();
  ok("게임 없으면 null", G.saveState()===null);
}

console.log("\n[9] 버튼");
{ const {G,mod,rom}=fresh();
  G.start(mod,rom,{});
  G.press("up",true); G.press("A",true); G.press("up",false);
  ok("누름이 전달됨", F.log.includes("joyp.up=1")&&F.log.includes("joyp.A=1"));
  ok("뗌도 전달됨", F.log.includes("joyp.up=0"));
  G.press("없는버튼",true);
  ok("없는 버튼은 무시", true);
  G.stop();
  const n=F.log.length; G.press("down",true);
  ok("★ 끝난 뒤 누르면 무시", F.log.length===n, "죽은 에뮬을 건드리면 터짐");
}

console.log("\n[10] 나쁜 롬");
{ const {G,mod,rom}=fresh({badRom:true});
  let msg=null;
  try{ G.start(mod,rom,{}); }catch(e){ msg=e.message; }
  ok("오류를 냄", msg==="BAD ROM", msg);
  ok("★ 실패해도 메모리 안 샘", mod._alive.size===0, [...mod._alive].join(","));
  ok("게임이 남아있지 않음", G.current()===null||G.current().dead);
}

console.log(`\n${"=".repeat(46)}\n통과 ${pass}  실패 ${fail}\n`);
process.exit(fail?1:0);
