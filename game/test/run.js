const F = require("./fake.js");
let pass=0, fail=0;
const ok = (name, cond, extra) => { if(cond){pass++; console.log("  OK   "+name);}
  else {fail++; console.log("  ★실패 "+name+(extra?"  → "+extra:""));} };

function fresh(opt){
  F.reset();
  const dom = F.makeDom();
  /* 어느 컴퓨터에서 돌려도 되게 이 파일 기준 상대 경로로 찾는다 */
  delete require.cache[require.resolve("../game.js")];
  const G = require("../game.js");
  const mod = F.makeModule(opt||{});
  const rom = new Uint8Array(0x8000);
  const title = "TVA TEST";
  for(let i=0;i<title.length;i++) rom[0x134+i] = title.charCodeAt(i);
  return { dom, G, mod, rom };
}

(async () => {
console.log("\n[1] 색 바꾸기");
{ const {G}=fresh();
  /* ★ 알파를 **0 으로 시작**합니다. createImageData 가 실제로 그렇습니다.
       예전에는 입력 알파가 이미 255 라, "알파를 255 로 못 박는다" 는 단언이
       **코드를 빼도 통과했습니다.** (2026-08-11 교차검사에서 실증) */
  const d=new Uint8Array([0,0,0,0, 70,70,70,0, 140,140,140,0, 255,255,255,0]);
  G.tintOrange(d);
  ok("가장 어두운 → #040506", d[0]===4&&d[1]===5&&d[2]===6);
  ok("가장 밝은 → #F8861E", d[12]===248&&d[13]===134&&d[14]===30);
  ok("4단계로만 나옴", new Set([d[0],d[4],d[8],d[12]]).size===4);
  ok("★★ 투명도를 255 로 못 박음 (0 으로 시작해도)",
     d[3]===255 && d[7]===255 && d[11]===255 && d[15]===255,
     [d[3],d[7],d[11],d[15]].join(","));
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
  /* ★ 없애지 않고 멈춥니다. 없애면 화면은 게임인데 되살릴 방법이 없어 갇힙니다. */
  ok("오류 나면 게임 정지", !G.isRunning(), "루프가 초당 60번 오류 뱉는 것 방지");
  ok("★ 오류 나도 되살릴 수 있음", G.current()!==null && !G.current().dead);
  G.resume();
  ok("★ RESUME 으로 살아남", G.isRunning());
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

console.log("\n[7-2] ★★★ 배터리 세이브가 실패하면 다시 시도해야 함");
{ /* 저장공간이 차면 게임 안의 "리포트" 가 아무 말 없이 영영 사라졌습니다.
     sramDirty 를 쓰기 **전에** 꺼버리고 실패를 흘렸기 때문입니다.
     이제 실패하면 표시를 되살려 3초 뒤에 다시 시도합니다.
     (2026-08-11 교차검사에서 잡았습니다.) */
  const {dom,G,mod,rom}=fresh();
  let tries=0, fail=true;
  const s=G.start(mod,rom,{ onSram: async () => { tries++; if(fail) throw new Error("full"); } });

  mod._setSramDirty(true); dom.tick(16);
  ok("(준비) 게임이 저장한 걸 감지", s.sramDirty===true);
  s.flushSram();
  await new Promise(r=>setTimeout(r,5));          /* 거절이 도착할 틈 */
  ok("★ 한 번 시도했음", tries===1, tries);
  ok("★★★ 실패했으니 표시가 되살아남 (다음에 다시 시도)", s.sramDirty===true,
     "false 면 그 저장은 영영 사라집니다");

  /* 저장공간이 생기면 다음 시도에서 성공해야 합니다 */
  fail=false;
  s.flushSram();
  await new Promise(r=>setTimeout(r,5));
  ok("★★ 두 번째 시도에서 저장됨", tries===2, tries);
  ok("★ 성공했으면 표시가 꺼짐", s.sramDirty===false);
  G.stop();
}

console.log("\n[8] 세이브 스테이트");
{ const {G,mod,rom}=fresh();
  G.start(mod,rom,{});
  const st=G.saveState();
  ok("바이트 배열이 나옴", st instanceof Uint8Array && st.length===64, st?st.length:"null");
  ok("크기 맞으면 불러와짐", G.loadState(st)===true);
  ok("크기 다르면 거부", G.loadState(new Uint8Array(3))===false);
  /* ★ 하한선(>=3)이면 세 곳 중 두 곳을 빼도 통과합니다. 정확한 개수로 봅니다.
       여기까지 온 것: saveState 1회 + loadState 2회 = 3회 */
  ok("★ FileData 를 정확히 3번 지움", F.log.filter(x=>x==="filedata.delete").length===3,
     F.log.filter(x=>x==="filedata.delete").length);
  G.stop();
  ok("게임 없으면 null", G.saveState()===null);
}

console.log("\n[9] 버튼");
{ const {G,mod,rom}=fresh();
  G.start(mod,rom,{});
  G.press("up",true); G.press("A",true); G.press("up",false);
  ok("누름이 전달됨", F.log.includes("joyp.up=1")&&F.log.includes("joyp.A=1"));
  ok("뗌도 전달됨", F.log.includes("joyp.up=0"));
  /* ★ 예전에는 `ok("...", true)` 였습니다. 글자 그대로 참이라 아무것도 안 봅니다. */
  const before=F.log.length;
  G.press("없는버튼",true);
  ok("★ 없는 버튼은 아무 일도 안 함", F.log.length===before, F.log.slice(before).join(","));
  G.stop();
  const n=F.log.length; G.press("down",true);
  ok("★ 끝난 뒤 누르면 무시", F.log.length===n, "죽은 에뮬을 건드리면 터짐");
}

console.log("\n[8-2] ★ 에뮬레이터가 거절한 세이브는 실패로");
{ const {G,mod,rom}=fresh({badState:true});
  G.start(mod,rom,{});
  const st=G.saveState();
  ok("★ 에뮬이 거절하면 false", G.loadState(st)===false,
     "전에는 무조건 true 라 '불러왔다' 고 거짓말했습니다");
  G.stop();
}

console.log("\n[9-2] ★ 다른 앱 갔다 오면 다시 돌아야 함");
{ const {dom,G,mod,rom}=fresh();
  G.start(mod,rom,{});
  global.document.visibilityState="hidden"; dom.fire("visibilitychange");
  ok("나가면 멈춤", !G.isRunning());
  global.document.visibilityState="visible"; dom.fire("visibilitychange");
  ok("★ 돌아오면 저절로 다시 돎", G.isRunning(), "전에는 멈춘 채로 갇혔습니다");
  G.stop();
}

console.log("\n[9-3] ★ 롬 읽는 사이에 나가면 유령이 안 생겨야 함");
{ const {G,mod,rom}=fresh();
  const born = G.epoch();
  G.stop();                       /* 그 사이에 나감 → 세대가 바뀜 */
  const s = G.start(mod, rom, {}, born);
  ok("★ 시작 안 됨", s===null, "전에는 뒤늦게 켜져서 배경에서 계속 돌았습니다");
  ok("아무것도 안 돌고 있음", !G.isRunning());
  ok("세대가 맞으면 정상 시작", G.start(mod,rom,{},G.epoch())!==null);
  G.stop();
}

console.log("\n[9-4] ★ 시작을 두 번 해도 타이머가 하나");
{ const {dom,G,mod,rom}=fresh();
  const s=G.start(mod,rom,{});
  s.start();
  ok("타이머 하나뿐", dom.timers.size===1, "개수 "+dom.timers.size);
  G.stop();
  ok("정리하면 없음", dom.timers.size===0);
}

console.log("\n[10] 나쁜 롬");
{ const {G,mod,rom}=fresh({badRom:true});
  let msg=null;
  try{ G.start(mod,rom,{}); }catch(e){ msg=e.message; }
  ok("오류를 냄", msg==="BAD ROM", msg);
  ok("★ 실패해도 메모리 안 샘", mod._alive.size===0, [...mod._alive].join(","));
  ok("게임이 남아있지 않음", G.current()===null||G.current().dead);
}

console.log("\n[12] ★★ 일부러 끈 것과 사고로 사라진 것을 구분하는가");
{ /* 평범하게 CHANGE GAME 을 눌렀을 뿐인데 화면에 "GAME STOPPED" 라는
     사고 안내가 뜨고 quit() 이 두 번 돌았습니다.
     (2026-08-11 교차검사에서 재현해서 잡았습니다.) */
  const {G,mod,rom}=fresh();
  let gone=0;
  G.setOnGone(()=>gone++);

  G.start(mod,rom,{});
  ok("(준비) 돌고 있음", G.isRunning());
  G.stop();                                  /* ← 일부러 끔 (목록으로 나가기) */
  ok("★ 멈추긴 함", !G.isRunning());
  ok("★★★ 일부러 껐을 때는 사고 안내가 안 뜸", gone===0, "onGone "+gone+"회");

  /* 사고로 사라진 경우(페이지를 떠남·얼어붙음)는 반드시 알려야 합니다 —
     안 알리면 "PLAYING" 이라 적힌 멈춘 화면에 갇힙니다. */
  G.start(mod,rom,{});
  G._guards.hardStop();                      /* ← 사고 */
  ok("★★★ 사고로 사라졌을 때는 알려줌", gone===1, "onGone "+gone+"회");
  G.setOnGone(null);
}

console.log("\n[13] ★★ 메뉴를 열어둔 채 폰을 껐다 켜면 — 게임이 몰래 다시 돌면 안 됨");
{ const {dom,G,mod,rom}=fresh();
  G.start(mod,rom,{});
  ok("(준비) 돌고 있음", G.isRunning());

  G.pause();                                  /* ← 아드님이 메뉴를 엶 */
  ok("메뉴를 열면 멈춤", !G.isRunning());

  /* 폰 화면을 껐다 켭니다 */
  dom.fire("visibilitychange");               /* visible 그대로여도 한 번 */
  global.document.visibilityState="hidden";
  G._guards.onVisibility();
  global.document.visibilityState="visible";
  G._guards.onVisibility();
  ok("★★★ 메뉴 때문에 멈춘 것은 그대로 멈춰 있음", !G.isRunning(),
     "다시 돌면 메뉴 뒤에서 게임이 돌고 소리가 납니다");

  /* RESUME 을 누르면 당연히 다시 돌아야 합니다 (긍정형 대조군) */
  G.resume();
  ok("★★ RESUME 을 누르면 다시 돎", G.isRunning());

  /* 반대로 **백그라운드 때문에** 멈춘 것은 돌아오면 다시 돌아야 합니다 */
  global.document.visibilityState="hidden";
  G._guards.onVisibility();
  ok("다른 앱으로 가면 멈춤", !G.isRunning());
  global.document.visibilityState="visible";
  G._guards.onVisibility();
  ok("★★ 돌아오면 저절로 다시 돎", G.isRunning());
  G.stop();
}

console.log("\n[14] ★ GBA 롬 알아보기");
{ const {G}=fresh();
  const gbaLogo=[0x24,0xFF,0xAE,0x51,0x69,0x9A,0xA2,0x21,0x3D,0x84,0x82,0x0A,0x84,0xE4,0x09,0xAD,
                 0x11,0x24,0x8B,0x98,0xC0,0x81,0x7F,0x21,0xA3,0x52,0xBE,0x19,0x93,0x09,0xCE,0x20];
  const mk=(o={})=>{ const b=new Uint8Array(0x1000);
    if(o.fixed!==false) b[0xB2]=0x96;
    if(o.logo!==false) gbaLogo.forEach((v,i)=>b[0x04+i]=v);
    if(o.title) for(let i=0;i<o.title.length;i++) b[0xA0+i]=o.title.charCodeAt(i);
    if(o.checksum){ let c=0; for(let i=0xA0;i<=0xBC;i++) c=(c-b[i])&0xFF; b[0xBD]=(c-0x19)&0xFF; }
    return b; };

  ok("★ 로고가 맞으면 GBA", G.detectSystem(mk())==="gba");
  ok("★ 체크섬만 맞아도 GBA", G.detectSystem(mk({logo:false,checksum:true}))==="gba");
  /* ★★ 여기가 핵심입니다 — 0xB2 한 바이트만으로는 안 됩니다.
         전에는 이것 때문에 사진 파일이 "PHOTO" 라는 GBA 게임이 됐습니다. */
  ok("★★★ 0x96 한 바이트만으로는 GBA 가 아님",
     G.detectSystem(mk({logo:false}))===null, G.detectSystem(mk({logo:false})));
  ok("★ 0x96 도 없으면 당연히 아님", G.detectSystem(mk({fixed:false,logo:false}))===null);
  ok("★ 너무 짧으면 아님", G.detectSystem(new Uint8Array(0x80))===null);

  /* ★ GBA 는 제목이 0xA0 에 있습니다. 게임보이 자리를 읽으면 쓰레기가 나옵니다. */
  ok("★★ GBA 제목을 제자리에서 읽음",
     G.romTitle(mk({title:"POKEMON EMER"}))==="POKEMON EMER",
     G.romTitle(mk({title:"POKEMON EMER"})));
  ok("★ 제목이 없으면 파일 이름을 씀",
     G.romTitle(mk(), "ruby.gba")==="RUBY", G.romTitle(mk(),"ruby.gba"));
  /* 게임보이 롬은 여전히 게임보이 자리에서 읽어야 합니다 */
  const gb=new Uint8Array(0x8000);
  [0xCE,0xED,0x66,0x66,0xCC,0x0D,0x00,0x0B,0x03,0x73,0x00,0x83,0x00,0x0C,0x00,0x0D]
    .forEach((v,i)=>gb[0x104+i]=v);
  "TETRIS".split("").forEach((c,i)=>gb[0x134+i]=c.charCodeAt(0));
  ok("★ 게임보이 제목은 그대로", G.romTitle(gb)==="TETRIS", G.romTitle(gb));
}

console.log("\n[11] ★★★ 저장을 300번 반복해도 메모리가 안 새는가");
{ /* 이 프로젝트에서 제일 비싸게 배운 버그입니다.
     `_file_data_delete` 는 **속에 든 자료만** 돌려주고 껍데기(16바이트)는
     남깁니다. `_free(ptr)` 를 따로 안 부르면 한 번 저장할 때마다 껍데기가
     쌓이고, 그 껍데기가 돌려준 195KB 자리를 가로막습니다.
     binjgb 는 메모리를 못 늘리게 지어져 있어서, 16MB 를 다 쓰면
     **에뮬레이터가 영구히 멈춥니다. 실제로 저장 71번째에 죽었습니다.**

     ★ 2026-08-11 방해검사에서 알게 된 것 —
       예전 가짜는 껍데기를 추적하지 않아서, `_free` 를 통째로 빼도
       검사가 전부 통과했습니다. **이 버그를 아무도 안 보고 있었습니다.**
       가짜를 고치고 이 검사를 새로 넣었습니다. */
  const {G,mod,rom}=fresh();
  G.start(mod,rom,{});
  const base = mod._alive.size;
  ok("(준비) 게임이 떠 있음", base>0, base);

  for(let i=0;i<300;i++){
    const s = G.saveState();
    if(!s){ ok("저장이 됨", false, i+"번째에서 실패"); break; }
    G.loadState(s);
  }
  ok("★★★ 300번 저장·불러오기 뒤에도 메모리가 안 늘어남",
     mod._alive.size===base, base+" → "+mod._alive.size);

  /* 배터리 세이브도 같은 구조입니다 */
  for(let i=0;i<300;i++){ mod._setSramDirty(true); G.flushSram(); }
  ok("★★★ 배터리 세이브 300번도 안 늘어남",
     mod._alive.size===base, base+" → "+mod._alive.size);

  /* 불러오기(loadSram)도 껍데기를 씁니다 */
  const cur = G.current();
  for(let i=0;i<300;i++) cur.loadSram(new Uint8Array(32));
  ok("★★★ 세이브 불러오기 300번도 안 늘어남",
     mod._alive.size===base, base+" → "+mod._alive.size);

  G.stop();
  ok("★ 끝내면 전부 반납됨", mod._alive.size===0, [...mod._alive].join(","));
}

console.log(`\n${"=".repeat(46)}\n통과 ${pass}  실패 ${fail}\n`);
process.exit(fail?1:0);
})();
