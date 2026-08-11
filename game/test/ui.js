/* 화면 흐름 검사 (v2) — 진짜 브라우저 없이

   ★ v1 과 달라진 점
     · 시스템이 셋 (GB / GBC / GBA). 게임&워치는 없어졌습니다.
     · 메뉴 조작은 전부 손가락입니다 (tapRow / tapMenu / corner).
       SELECT·START 는 게임 전용이라 여기서 검사할 것이 없습니다.
     · 롬 판별은 **진짜 game.js 의 detectSystem** 을 물려서 검사합니다.
       가짜를 끼우면 "가짜가 통과했다"만 확인하게 됩니다.
         (인계서 8장 — RomStore 가 한 줄도 안 돌던 사고가 그래서 났습니다.) */
const path=require("path");
const UI=path.join(__dirname,"..","ui.js");
const GM=require(path.join(__dirname,"..","game.js"));
let pass=0,fail=0;
const ok=(n,c,x)=>{ if(c){pass++;console.log("  OK   "+n);} else {fail++;console.log("  ★실패 "+n+(x?"  → "+x:""));} };

function fresh(opt={}){
  delete require.cache[require.resolve(UI)];
  const { Ui } = require(UI);
  const db = new Map();
  /* ★ 게임이 "있는 것" 과 "돌고 있는 것" 은 다릅니다.
       멈춰도(pause) 에뮬레이터는 살아 있어서 저장이 됩니다.
       처음에 이걸 하나로 묶어놨다가 엉뚱한 실패가 났습니다.        */
  let started=null, alive=false, running=false, pressed=[], colorSet=[], ep=0;
  const engine = {
    start(mod,bytes,o,born){ if(opt.badRom) throw new Error("BAD ROM");
                        /* ★ 진짜와 같게 세대를 대조합니다. 이게 없으면
                             "읽는 중에 나갔다" 경로가 검사에서 한 줄도 안 돕니다. */
                        if(born!==undefined && born!==ep) return null;
                        started={mod,bytes,o}; alive=true; running=true; return {}; },
    epoch:()=>ep,
    stop(){ ep++; alive=false; running=false; started=null; },
    pause(){ running=false; }, resume(){ if(alive) running=true; },
    isRunning:()=>running,
    press:(n,d)=>pressed.push(n+(d?"+":"-")),
    saveState:()=> alive ? new Uint8Array([1,2,3]) : null,
    loadState:(b)=> alive && b && b.length===3,
    setColorMode:(r)=>{ colorSet.push(!!r); return alive; },
  };
  /* 가짜 보관소. ★ id 는 **내용**으로 정합니다 — 진짜 RomStore 와 같은 규약.
       이름으로 정하면 "같은 롬을 다른 이름으로 넣기" 를 검사할 수 없습니다. */
  const idOf = b => { let s=0; for(let i=0;i<b.length;i++) s=(s+b[i]*(i%7+1))>>>0;
                      return "k"+b.length+"-"+s; };
  const store = {
    async list(){ if(opt.noDb) throw new Error("no-indexeddb");
                  return [...db.values()].map(r=>({id:r.id,title:r.title,file:r.file,
                    system:r.system||"gb", fromBundled:r.fromBundled||null,
                    size:r.size,hasSram:!!r.sram,states:r.states.map(x=>!!x),
                    played:r.played||0,added:r.added||0})); },
    async add(bytes,name,extra){ if(opt.addFail) throw new Error("full");
      const id=idOf(bytes);
      const old=db.get(id);
      const rec={id,title:(name||"").replace(/\.[^.]*$/,"").toUpperCase(),file:name,
                 size:bytes.length,rom:bytes,sram:old?old.sram:null,
                 states:old?old.states:[null,null,null],played:old?old.played:0,
                 added:old?old.added:Date.now(),
                 system:(extra&&extra.system)||GM.detectSystem(bytes)||"gb",
                 fromBundled:(extra&&extra.fromBundled)||(old?old.fromBundled:null)};
      if(old){ rec.title=old.title; rec.file=old.file; }
      db.set(id,rec); return rec; },
    async get(id){ return db.get(id)||null; },
    async patch(id,ch){ const r=db.get(id); if(!r) return null; Object.assign(r,ch); return r; },
    /* ★ 진짜 RomStore 와 같은 규약 — 슬롯 한 칸만 원자적으로 바꿉니다.
         가짜에 이게 없으면 화면 쪽이 옛 길(get→patch)로 빠져서,
         **고쳐놓은 길이 검사에서 한 번도 안 돕니다.** */
    async putSlot(id,n,v){ const r=db.get(id); if(!r) return false;
      const s=(r.states||[null,null,null]).slice(); s[n]=v; r.states=s; return true; },
    async remove(id){ db.delete(id); },
  };
  const ui = new Ui({
    store, engine,
    readFile: async f => f.bytes,
    /* ★ 진짜 판별기를 씁니다 */
    detectSystem: GM.detectSystem,
    fetchRom: async p => { if(opt.fetchFail) throw new Error("404");
                           return rom({sys:"gb"}); },
    loadCore: async sys => { if(opt.noWasm) throw new Error("nope");
                             if(sys==="gba" && !opt.gbaCore) throw new Error("no-mgba");
                             return {core:sys}; },
    canvas: null,
    prefs: opt.prefs,
  });
  if(!opt.keepPrefs) ui._reset();
  return { ui, db, engine, store,
           get started(){return started;}, get pressed(){return pressed;},
           get colorSet(){return colorSet;} };
}

/* ── 진짜처럼 생긴 롬 만들기 ────────────────────────────────────────────
   game.js 의 detectSystem 을 그대로 통과해야 하므로 고정 바이트를 넣습니다.
     gb   0x104~0x113 닌텐도 로고, 0x143 = 0
     gbc  같은 로고 + 0x143 = 0xC0
     gba  0xB2 = 0x96
   tag 로 내용을 다르게 만들 수 있습니다 (같은 롬으로 안 세지게).        */
const LOGO=[0xCE,0xED,0x66,0x66,0xCC,0x0D,0x00,0x0B,0x03,0x73,0x00,0x83,0x00,0x0C,0x00,0x0D];
/* ★ GBA 닌텐도 로고 앞부분. 진짜 GBA 롬(jsmolka/gba-tests, MIT)에서 떠온 것입니다. */
const GBA_LOGO=[
  0x24,0xFF,0xAE,0x51,0x69,0x9A,0xA2,0x21,0x3D,0x84,0x82,0x0A,0x84,0xE4,0x09,0xAD,
  0x11,0x24,0x8B,0x98,0xC0,0x81,0x7F,0x21,0xA3,0x52,0xBE,0x19,0x93,0x09,0xCE,0x20];
/* via 로 "어느 근거로 GBA 라고 인정받는지" 를 고릅니다.
     "logo"     로고 바이트로 (정품·홈브루 대부분)
     "checksum" 헤더 체크섬으로 (로고가 잘린 별난 파일)
     "weak"     0xB2 의 0x96 만 (★ 이건 **거부되어야** 합니다) */
function rom({sys="gb", size=0x8000, tag=0, broken=false, via="logo", title=""}={}){
  const b=new Uint8Array(size);
  if(broken) return b;
  if(sys==="gba"){
    if(size>=0xC0){
      b[0xB2]=0x96;
      if(via==="logo") GBA_LOGO.forEach((v,i)=>b[0x04+i]=v);
      if(title) for(let i=0;i<title.length && i<12;i++) b[0xA0+i]=title.charCodeAt(i);
      if(via==="checksum"){
        let c=0; for(let i=0xA0;i<=0xBC;i++) c=(c-b[i])&0xFF;
        b[0xBD]=(c-0x19)&0xFF;
      }
    }
  }
  else {
    if(size>=0x150){ LOGO.forEach((v,i)=>b[0x104+i]=v); b[0x143]= sys==="gbc" ? 0xC0 : 0x00; }
  }
  if(tag && size>0x200) b[0x200]=tag;      /* 내용을 다르게 */
  return b;
}
const file=(name,o={})=>({ name, bytes:rom(o), size:(o.size===undefined?0x8000:o.size) });

(async()=>{

console.log("\n[1] 시스템 셋 → 목록");
{ const t=fresh();
  ok("처음엔 시스템 화면", t.ui.state.screen==="system");
  ok("★ 시스템이 셋", t.ui.rows()===3, t.ui.rows());
  ok("★ 게임&워치가 없음", !t.ui.systems().some(s=>/WATCH|G&W/i.test(s.name)));
  ok("차례가 GB / GBC / GBA", t.ui.systems().map(s=>s.id).join(",")==="gb,gbc,gba");
  await t.ui.pickSystem("gb");
  ok("목록으로 감", t.ui.state.screen==="list");
  /* ★ 기본 게임 5개는 헤더대로 갈립니다 — GB 3개(TOBU/2048/WORDLE),
       GBC 2개(TOBU DX/LIBBET). 둘은 0x143 이 0x80 인 컬러 겸용 게임입니다. */
  ok("★ GB 목록에 기본 게임 3개", t.ui.state.count===3, t.ui.state.count);
  ok("★ 그 셋이 맞음", t.ui.list().map(r=>r.file).join(",")==="tobu.gb,2048.gb,WORDLE.gb",
     t.ui.list().map(r=>r.file).join(","));
  await t.ui.pickSystem("gbc");
  ok("★★ GBC 목록에 컬러 겸용 2개", t.ui.state.count===2, t.ui.state.count);
  ok("★ 그 둘이 맞음", t.ui.list().map(r=>r.file).join(",")==="tobudx.gb,libbet.gb",
     t.ui.list().map(r=>r.file).join(","));
  await t.ui.pickSystem("gba");
  ok("★ GBA 목록도 비어 있음", t.ui.state.count===0);
  ok("이름이 바뀜", t.ui.systemName()==="GAME BOY ADVANCE", t.ui.systemName());
  await t.ui.pickSystem("없는것");
  ok("★ 없는 시스템은 무시", t.ui.state.systemId==="gba", t.ui.state.systemId);
}

console.log("\n[2] 목록에서 움직이기");
{ const t=fresh(); await t.ui.pickSystem("gb");
  t.ui.move(1); ok("아래로", t.ui.state.cursor===1);
  t.ui.move(-1); ok("위로", t.ui.state.cursor===0);
  t.ui.move(-1); ok("맨 위에서 위 → 맨 아래로 감", t.ui.state.cursor===2, t.ui.state.cursor);
  t.ui.move(1);  ok("맨 아래에서 아래 → 맨 위로", t.ui.state.cursor===0);
  ok("★ 없는 줄로는 못 감", t.ui.setCursor(99)===false && t.ui.setCursor(-1)===false);
}

console.log("\n[3] 롬 넣기 — ★ 롬을 보고 제 시스템으로 보냄");
{ const t=fresh(); await t.ui.pickSystem("gb");
  const before=t.ui.state.count;
  const r1=await t.ui.addRom(file("MYGAME.gb",{tag:1}));
  ok("목록이 늘어남", t.ui.state.count===before+1, t.ui.state.count);
  ok("넣은 것에 커서가 감", t.ui.selected().title==="MYGAME", t.ui.selected().title);
  ok("게임보이로 분류됨", r1.system==="gb", r1&&r1.system);

  /* ★★ 여기가 v2 의 핵심입니다 — 게임보이 목록에서 GBC 롬을 넣으면 */
  const r2=await t.ui.addRom(file("COLORED.gbc",{sys:"gbc",tag:2}));
  ok("★ GBC 롬은 GBC 로 분류", r2 && r2.system==="gbc", r2&&r2.system);
  ok("★ 게임보이 목록에는 안 늘어남", t.ui.state.count===before+1, t.ui.state.count);
  ok("★ 어디로 갔는지 알려줌", /ADDED TO GAME BOY COLOR/.test(t.ui.state.notice), t.ui.state.notice);
  await t.ui.pickSystem("gbc");
  ok("★ GBC 목록에 있음", t.ui.state.count===3 && t.ui.list().some(r=>r.title==="COLORED"),
     t.ui.list().map(r=>r.title).join("|"));

  const r3=await t.ui.addRom(file("ADV.gba",{sys:"gba",tag:3}));
  ok("★ GBA 롬은 GBA 로 분류", r3 && r3.system==="gba", r3&&r3.system);
  await t.ui.pickSystem("gba");
  ok("★ GBA 목록에 있음", t.ui.state.count===1, t.ui.state.count);
  ok("★ 체크섬만 맞는 GBA 롬도 받아줌",
     (await t.ui.addRom(file("CK.gba",{sys:"gba",via:"checksum",tag:71})))!==null, t.ui.state.notice);
  /* ★★ 0xB2 한 바이트만 맞는 잡파일은 **거부되어야** 합니다.
         전에는 이걸 받아줘서 사진 파일이 "PHOTO" 라는 GBA 게임이 됐습니다. */
  const weak=await t.ui.addRom(file("photo.gba",{sys:"gba",via:"weak",tag:72}));
  ok("★★ 0x96 한 바이트만으로는 GBA 로 안 받음", weak===null, weak&&weak.system);
  ok("이유를 알려줌", /NOT A GAME/.test(t.ui.state.notice), t.ui.state.notice);

  /* 거절해야 하는 것들 */
  await t.ui.pickSystem("gb");
  const n=t.ui.state.count;
  const bad1=await t.ui.addRom(file("tiny.gb",{size:100}));
  ok("너무 작은 파일은 거부", bad1===null && /NOT A GAME/.test(t.ui.state.notice), t.ui.state.notice);
  const bad2=await t.ui.addRom(file("notes.txt",{broken:true}));
  ok("★ 롬이 아니면 거부 (고정 바이트 확인)", bad2===null,
     "전에는 크기만 봐서 .txt 도 게임으로 들어갔습니다");
  const bad3=await t.ui.addRom({name:"huge.gb", bytes:rom({}), size:99*1024*1024});
  ok("★ 어마어마하게 큰 파일은 읽지도 않음", bad3===null && /TOO BIG/.test(t.ui.state.notice), t.ui.state.notice);
  ok("거부해도 목록은 그대로", t.ui.state.count===n, t.ui.state.count);
  ok("파일이 없으면 조용히 null", await t.ui.addRom(null)===null);
}

console.log("\n[3-2] ★ 같은 롬을 다시 넣어도 두 번 안 뜸");
{ const t=fresh(); await t.ui.pickSystem("gb");
  const n=t.ui.state.count;
  await t.ui.addRom(file("A.gb",{tag:9}));
  await t.ui.addRom(file("B.gb",{tag:9}));      /* 이름만 다르고 내용 같음 */
  ok("★ 하나만 늘어남", t.ui.state.count===n+1, t.ui.state.count);
}

console.log("\n[4] 지우기 — 반드시 한 번 물어봄");
{ const t=fresh(); await t.ui.pickSystem("gb");
  await t.ui.addRom(file("MINE.gb",{tag:4}));
  const at=t.ui.state.cursor;
  ok("★ 물어보기 전에는 확인창이 없음", t.ui.state.confirm===null);
  ok("물어봄", t.ui.askRemove(at)===true);
  ok("★ 확인창에 이름이 뜸", t.ui.state.confirm && t.ui.state.confirm.title==="MINE",
     t.ui.state.confirm && t.ui.state.confirm.title);
  ok("★ 물어보는 중에는 커서가 안 움직임",
     (t.ui.move(1), t.ui.state.cursor===at), t.ui.state.cursor+" vs "+at);
  ok("★ 물어보는 중에는 시작도 안 됨", await t.ui.play()===false);
  ok("★ 물어보는 중에는 파일도 안 받음", await t.ui.addRom(file("X.gb",{tag:5}))===null);
  ok("안 지우기", t.ui.cancelRemove()===true && t.ui.state.confirm===null);
  ok("안내가 KEPT", /KEPT/.test(t.ui.state.notice), t.ui.state.notice);
  const cnt=t.ui.state.count;
  t.ui.askRemove(at);
  ok("★ 지움", await t.ui.confirmRemove()===true);
  ok("목록 줄어듦", t.ui.state.count===cnt-1, t.ui.state.count);
  ok("안내에 이름이 들어감", /DELETED — MINE/.test(t.ui.state.notice), t.ui.state.notice);
  ok("★ 두 번 눌러도 두 번 안 지움", await t.ui.confirmRemove()===false);
  /* 기본 게임은 못 지웁니다 */
  t.ui.setCursor(0);
  ok("★ 기본 게임은 물어보지도 않음", t.ui.askRemove(0)===false);
  ok("이유를 알려줌", /BUILT-IN/.test(t.ui.state.notice), t.ui.state.notice);
  ok("★ 확인창이 안 뜸", t.ui.state.confirm===null);
}

console.log("\n[5] 시작");
{ const t=fresh(); await t.ui.pickSystem("gb");
  ok("시작됨", await t.ui.play()===true);
  ok("플레이 화면", t.ui.state.screen==="play");
  ok("에뮬 돌고 있음", t.ui.state.running);
  ok("제목이 잡힘", t.ui.state.title.length>0, t.ui.state.title);
  ok("★ 어느 시스템인지 에뮬에 알려줌", t.started.o.system==="gb", t.started.o.system);
  ok("★ 코어도 그 시스템 것", t.started.mod.core==="gb", t.started.mod.core);

  const t2=fresh({noWasm:true}); await t2.ui.pickSystem("gb");
  ok("에뮬 못 부르면 시작 안 함", await t2.ui.play()===false);
  ok("화면 안 넘어감", t2.ui.state.screen==="list");
  ok("안내가 나옴", /EMULATOR/.test(t2.ui.state.notice), t2.ui.state.notice);

  const t3=fresh({fetchFail:true}); await t3.ui.pickSystem("gb");
  ok("롬 파일 없으면 시작 안 함", await t3.ui.play()===false);
  const t4=fresh({badRom:true}); await t4.ui.pickSystem("gb");
  ok("나쁜 롬이면 안내", await t4.ui.play()===false && /BAD ROM/.test(t4.ui.state.notice), t4.ui.state.notice);
  ok("나쁜 롬이어도 목록에 남아있음", t4.ui.state.screen==="list");
  const t5=fresh(); await t5.ui.pickSystem("gba");
  ok("★ 게임이 없으면 안내", await t5.ui.play()===false && /NO GAME/.test(t5.ui.state.notice));
}

console.log("\n[5-2] ★ GBA 코어가 없을 때 — 검은 화면이 아니라 이유가 떠야 함");
{ const t=fresh(); await t.ui.pickSystem("gba");
  await t.ui.addRom(file("ADV.gba",{sys:"gba",tag:7}));
  ok("(준비) GBA 목록에 있음", t.ui.state.count===1);
  ok("★ 시작 안 됨", await t.ui.play()===false);
  ok("★ GBA 라고 콕 집어 알려줌", /GBA EMULATOR NOT AVAILABLE/.test(t.ui.state.notice), t.ui.state.notice);
  ok("★ 목록에 그대로 있음 (갇히지 않음)", t.ui.state.screen==="list");

  const t2=fresh({gbaCore:true}); await t2.ui.pickSystem("gba");
  await t2.ui.addRom(file("ADV.gba",{sys:"gba",tag:7}));
  ok("★ 코어가 있으면 시작됨", await t2.ui.play()===true);
  ok("GBA 코어를 받아감", t2.started.mod.core==="gba", t2.started.mod.core);
}

console.log("\n[6] 메뉴");
{ const t=fresh(); await t.ui.pickSystem("gb"); await t.ui.play();
  ok("메뉴 열림", t.ui.openMenu()===true && t.ui.state.screen==="menu");
  ok("★ 메뉴 열면 게임 멈춤", !t.ui.state.running);
  ok("메뉴 닫으면 다시 돎", t.ui.closeMenu()===true && t.ui.state.running);
  ok("플레이 중 아니면 메뉴 안 열림", (t.ui.quit(), t.ui.openMenu()===false));
}

console.log("\n[7] 저장 칸 — ★ v2 는 LOAD 와 SAVE 가 따로");
{ const t=fresh(); await t.ui.pickSystem("gb"); await t.ui.play(); t.ui.openMenu();
  ok("빈 칸 불러오기는 실패", await t.ui.loadSlot(0)===false && /EMPTY/.test(t.ui.state.notice));
  ok("2번 칸에 저장", await t.ui.saveSlot(1)===true && /SLOT 2/.test(t.ui.state.notice), t.ui.state.notice);
  ok("2번 칸 불러오기", await t.ui.loadSlot(1)===true);
  ok("불러오면 메뉴 닫힘", t.ui.state.screen==="play");
  ok("다른 칸은 여전히 비어있음", (t.ui.openMenu(), await t.ui.loadSlot(2)===false));

  /* ★ 손가락으로 누르는 길 — 줄 번호 + 무엇을 할지 */
  const t2=fresh(); await t2.ui.pickSystem("gb"); await t2.ui.play(); t2.ui.openMenu();
  ok("★ SAVE 를 누르면 저장", await t2.ui.tapMenu(1,"save")===true, t2.ui.state.notice);
  ok("★ 칸 표시가 SAVED 로", t2.ui.menuItems()[1].sub==="SAVED", t2.ui.menuItems()[1].sub);
  ok("★ LOAD 를 누르면 불러옴", await t2.ui.tapMenu(1,"load")===true);
  ok("불러오면 게임으로 돌아감", t2.ui.state.screen==="play");
  t2.ui.openMenu();
  ok("★ 빈 칸에 LOAD 는 실패하고 안내", await t2.ui.tapMenu(3,"load")===false && /EMPTY/.test(t2.ui.state.notice));
  ok("★ 없는 줄은 무시", await t2.ui.tapMenu(99,"load")===false);
}

console.log("\n[8] ★ 끝내기");
{ const t=fresh(); await t.ui.pickSystem("gb"); await t.ui.play();
  await t.ui.quit();
  ok("에뮬 정지", !t.ui.state.running);
  ok("목록으로 돌아옴", t.ui.state.screen==="list");
  ok("하던 게임 지워짐", t.ui.state.title==="");
  const t2=fresh(); await t2.ui.pickSystem("gb"); await t2.ui.play();
  t2.ui.exitToTempad();
  ok("템패드로 나가도 에뮬 정지", !t2.ui.state.running);
  ok("시스템 화면으로", t2.ui.state.screen==="system");
}

console.log("\n[9] ★★ 게임 버튼이 새지 않는가 — v2 의 제1원칙");
{ const t=fresh(); await t.ui.pickSystem("gb");
  t.ui.press("A",true);
  ok("목록에서 누른 건 게임에 안 감", t.pressed.length===0);
  await t.ui.play();
  t.ui.press("A",true); t.ui.press("A",false);
  ok("플레이 중에는 전달됨", t.pressed.join(",")==="A+,A-", t.pressed.join(","));
  t.ui.openMenu();
  const n=t.pressed.length;
  t.ui.press("up",true); t.ui.press("select",true); t.ui.press("start",true);
  t.ui.press("L",true); t.ui.press("R",true);
  ok("★ 메뉴에서 누른 건 하나도 게임에 안 감", t.pressed.length===n, t.pressed.slice(n).join(","));
}

console.log("\n[10] 저장소가 막혔을 때 (file:// 로 열면 이렇게 됨)");
{ const t=fresh({noDb:true}); await t.ui.pickSystem("gb");
  ok("기본 게임은 그래도 보임", t.ui.state.count===3, t.ui.state.count);
  ok("안내가 나옴", /STORAGE/.test(t.ui.state.notice), t.ui.state.notice);
  ok("시작도 됨", await t.ui.play()===true);
}

console.log("\n[11] 메뉴 안에서 고르기");
{ const t=fresh(); await t.ui.pickSystem("gb");
  t.ui.move(2);                                  /* 목록 3번째로 */
  const keep=t.ui.state.cursor;
  await t.ui.play(); t.ui.openMenu();
  ok("메뉴는 맨 위(RESUME)부터", t.ui.state.cursor===0);
  ok("메뉴 줄 수가 목록이 아니라 메뉴 것", t.ui.rows()===7, t.ui.rows());
  t.ui.move(-1);
  ok("메뉴 맨 위에서 위 → 맨 아래(EXIT)", t.ui.menuItems()[t.ui.state.cursor].key==="tempad");
  t.ui.move(1);
  ok("RESUME 고르면 게임으로", await t.ui.chooseMenu()===true && t.ui.state.screen==="play");
  ok("★ 목록 자리 기억함", t.ui.state.cursor===keep, t.ui.state.cursor+" vs "+keep);

  t.ui.openMenu(); t.ui.move(4);                 /* CHANGE GAME */
  ok("고른 게 CHANGE GAME", t.ui.menuItems()[t.ui.state.cursor].key==="game");
  ok("고르면 나감", await t.ui.chooseMenu()===true);
  ok("에뮬 정지", !t.ui.state.running);
  ok("목록으로", t.ui.state.screen==="list");
  ok("★ 목록 자리 기억함", t.ui.state.cursor===keep);
}

console.log("\n[12] 시스템 화면 커서");
{ const t=fresh();
  ok("시스템은 3줄", t.ui.rows()===3);
  t.ui.move(1); ok("두번째", t.ui.state.cursor===1);
  t.ui.move(1); ok("세번째", t.ui.state.cursor===2);
  t.ui.move(1); ok("돌아옴", t.ui.state.cursor===0);
  await t.ui.pickSystem("gb");
  t.ui.move(3);
  t.ui.backToSystem();
  ok("시스템으로 돌아가면 커서 0", t.ui.state.cursor===0 && t.ui.state.screen==="system");
}

console.log("\n[13] ★ 어디서든 나갈 길이 있는가 (구석 버튼)");
{ const t=fresh();
  ok("★ 시스템 화면에서는 EXIT", t.ui.cornerLabel()==="EXIT", t.ui.cornerLabel());
  await t.ui.pickSystem("gb");
  ok("목록에서는 BACK", t.ui.cornerLabel()==="BACK", t.ui.cornerLabel());
  ok("실제로 감", (await t.ui.corner())==="system" && t.ui.state.screen==="system");
  await t.ui.pickSystem("gb"); await t.ui.play();
  ok("게임 중에는 MENU", t.ui.cornerLabel()==="MENU");
  ok("★ 게임 중 유일한 탈출구가 작동", (await t.ui.corner())==="menu" && t.ui.state.screen==="menu");
  ok("★ 게임이 멈춤", !t.ui.state.running);
  ok("메뉴에서는 RESUME", t.ui.cornerLabel()==="RESUME");
  ok("되돌아감", (await t.ui.corner())==="play" && t.ui.state.running);
  /* 시스템 화면에서 EXIT 를 누르면 진짜로 나갑니다 */
  { let left=false;
    const t2=fresh(); t2.ui.d.onExit=()=>{left=true;};
    ok("★ 시스템 화면에서 누르면 나감", (await t2.ui.corner())==="tempad" && left);
  }
}

console.log("\n[13-2] ★★★ 게임을 켜는 도중에 확인창이 떴다면 — 반드시 풀려야 함");
{ /* 롬을 읽고 에뮬레이터를 준비하는 데 구형 폰은 1~3초 걸립니다.
     그 사이에 다른 손가락이 줄을 길게 눌러 "지울까요?" 를 띄울 수 있습니다.
     그대로 두면 게임은 켜졌는데 pending 이 살아남습니다.

     ★★ 이 검사를 처음에 이렇게 썼습니다 —
          ok("물음표가 안 남아있음", state.confirm === null)
        그런데 confirm 은 **목록 화면일 때만** 내보내집니다. 게임 화면이면
        pending 이 살아 있어도 무조건 null 입니다. 즉 이 단언은
        **기능이 통째로 죽어도 통과합니다.** (방해검사로 잡았습니다.)

        그래서 "무엇이 안 보인다" 가 아니라 **"무엇이 실제로 된다"** 를 봅니다.
        pending 이 남아 있으면 move()·tapRow()·addRom() 이 전부 막히므로,
        그것들이 되는지를 확인하면 확실합니다.                            */
  const t=fresh(); await t.ui.pickSystem("gb");
  await t.ui.addRom(file("MINE.gb",{tag:8}));
  const at=t.ui.state.cursor;
  /* 게임을 켜는 도중에 길게 누른 상황을 그대로 만듭니다 */
  const p=t.ui.play();
  t.ui.askRemove(at);
  ok("(준비) 켜는 도중에 확인창이 떴음", t.ui.state.confirm!==null);
  await p;
  ok("★ 게임이 켜짐", t.ui.state.screen==="play", t.ui.state.screen);
  ok("★ 구석 버튼이 KEEP 이 아니라 MENU", t.ui.cornerLabel()==="MENU", t.ui.cornerLabel());
  ok("★ 눌리면 메뉴가 열림", (await t.ui.corner())==="menu");

  /* ★★ 여기가 진짜 단언입니다 — 메뉴 커서가 실제로 움직여야 합니다.
         pending 이 남아 있으면 move() 가 첫 줄에서 그냥 돌아갑니다. */
  const c0=t.ui.state.cursor;
  t.ui.move(1);
  ok("★★★ 메뉴 커서가 실제로 움직임", t.ui.state.cursor===c0+1,
     c0+" → "+t.ui.state.cursor+" (안 움직이면 pending 이 남은 것)");
  t.ui.move(-1);
  ok("★★ 저장도 실제로 됨", await t.ui.tapMenu(1,"save")===true, t.ui.state.notice);

  /* 목록으로 나온 뒤에도 멀쩡해야 합니다 */
  await t.ui.quit();
  ok("★★★ 목록에서 줄 탭이 실제로 먹힘", await t.ui.tapRow(0)==="select" || t.ui.state.screen==="play",
     "busy 가 나오면 pending 이 남은 것");
  ok("★★ 파일도 다시 받음", (await t.ui.addRom(file("N2.gb",{tag:12})))!==null, t.ui.state.notice);
}

console.log("\n[14] ★ 메뉴에서 나가는 세 갈래");
{ const t=fresh(); await t.ui.pickSystem("gb"); await t.ui.play();
  t.ui.openMenu(); t.ui.move(5);                 /* CHANGE SYSTEM */
  ok("고른 게 CHANGE SYSTEM", t.ui.menuItems()[t.ui.state.cursor].key==="system");
  await t.ui.chooseMenu();
  ok("기기 고르는 화면으로", t.ui.state.screen==="system");
  ok("에뮬 정지", !t.ui.state.running);

  const t2=fresh(); await t2.ui.pickSystem("gb"); await t2.ui.play();
  t2.ui.openMenu(); t2.ui.move(6);               /* EXIT */
  ok("고른 게 EXIT", t2.ui.menuItems()[t2.ui.state.cursor].key==="tempad");
  await t2.ui.chooseMenu();
  ok("★ 템패드로 나감 + 에뮬 정지", !t2.ui.state.running && t2.ui.state.screen==="system");
}

console.log("\n[14-2] ★★ 구석 버튼이 페이지를 떠나지 않는가");
{ /* 게임 관련 화면 셋에서 눌러봅니다. 한 번이라도 나가면 실패입니다.
     (시스템 화면만은 EXIT 라고 적혀 있으므로 나가는 게 맞습니다.) */
  for(const [name,setup] of [
      ["목록",    async u=>{ await u.pickSystem("gb"); }],
      ["게임중",  async u=>{ await u.pickSystem("gb"); await u.play(); }],
      ["메뉴",    async u=>{ await u.pickSystem("gb"); await u.play(); u.openMenu(); }]]){
    const t=fresh(); let left=false;
    t.ui.d.onExit = () => { left = true; };
    await setup(t.ui);
    await t.ui.corner();
    ok(name+" 에서 눌러도 안 나감", !left);
  }
}

console.log("\n[14-3] ★ 남의 세이브는 거부");
{ const t=fresh(); await t.ui.pickSystem("gb"); await t.ui.play(); t.ui.openMenu();
  ok("슬롯에 저장됨", await t.ui.tapMenu(1,"save")===true, t.ui.state.notice);
  const rec=[...t.db.values()][0];
  ok("기록이 생김", !!rec);
  /* 다른 게임의 것처럼 롬 표시를 바꿔치기합니다 */
  rec.states[0]={ rom:"다른게임", system:"gb", bytes:new Uint8Array([1,2,3]) };
  ok("★ 남의 세이브라고 거부", await t.ui.tapMenu(1,"load")===false);
  ok("안내가 나옴", /ANOTHER GAME/.test(t.ui.state.notice), t.ui.state.notice);
  /* ★ v2 — 시스템이 다른 것도 막습니다 (코어가 둘이라 새로 생긴 위험) */
  rec.states[0]={ rom:rec.id, system:"gba", bytes:new Uint8Array([1,2,3]) };
  ok("★ 다른 기기의 세이브도 거부", await t.ui.tapMenu(1,"load")===false);
  ok("안내가 나옴", /ANOTHER SYSTEM/.test(t.ui.state.notice), t.ui.state.notice);
}

console.log("\n[15] ★ 갇히는 화면이 없는가");
{ for(const [name,setup] of [
      ["시스템",  async u=>{}],
      ["목록",    async u=>{ await u.pickSystem("gb"); }],
      ["게임중",  async u=>{ await u.pickSystem("gb"); await u.play(); }],
      ["메뉴",    async u=>{ await u.pickSystem("gb"); await u.play(); u.openMenu(); }],
      ["GBA빈목록", async u=>{ await u.pickSystem("gba"); }]]){
    const t=fresh(); await setup(t.ui);
    const lbl=t.ui.cornerLabel();
    ok(name+" 화면에 나갈 표시가 있음", typeof lbl==="string" && lbl.length>0, lbl);
  }
}

console.log("\n[16] ★★ v2 — 손가락으로 줄 누르기 (첫 탭 = 고르기, 재탭 = 시작)");
{ const t=fresh(); await t.ui.pickSystem("gb");
  ok("(준비) 커서는 0", t.ui.state.cursor===0);
  ok("★ 다른 줄 첫 탭은 고르기만", await t.ui.tapRow(2)==="select");
  ok("커서가 옮겨감", t.ui.state.cursor===2);
  ok("★ 게임은 안 켜짐", t.ui.state.screen==="list");
  ok("★ 같은 줄 재탭이면 시작", await t.ui.tapRow(2)==="play");
  ok("게임 화면", t.ui.state.screen==="play");

  const t2=fresh(); await t2.ui.pickSystem("gb");
  ok("★ 없는 줄은 아무 일도 안 함", await t2.ui.tapRow(99)==="none" && t2.ui.state.screen==="list");
  ok("음수도 마찬가지", await t2.ui.tapRow(-1)==="none");
  t2.ui.askRemove(0);          /* 기본 게임이라 거부됨 */
  await t2.ui.addRom(file("Z.gb",{tag:11}));
  const at=t2.ui.state.cursor;
  t2.ui.askRemove(at);
  ok("★ 지울까 물어보는 중에는 줄 탭을 안 받음", await t2.ui.tapRow(0)==="busy");
  ok("게임도 안 켜짐", t2.ui.state.screen==="list");
}

console.log("\n[16-2] ★★ 넣기 안내는 다음 행동에서 물러나야 합니다");
{ /* "ADDED 21" 이 목록을 훑는 내내 남아 있으면 자리만 차지하고,
     방금 일어난 일처럼 계속 보입니다. (2026-08-11 형님 지적)
   ★ 지우는 곳은 목록에서 뭔가를 누를 때입니다. 화면 그리는 쪽에서
     지우면 게임 중에 떠야 하는 저장 실패 안내까지 같이 지워집니다. */
  const t=fresh(); await t.ui.pickSystem("gb");
  await t.ui.addRoms([file("a.gb",{tag:1}), file("b.gb",{tag:2})]);
  ok("(준비) 안내가 떴음", /ADDED 2/.test(t.ui.state.notice), t.ui.state.notice);
  t.ui.move(1);
  ok("★★★ 커서를 움직이면 물러남", t.ui.state.notice === "",
     JSON.stringify(t.ui.state.notice));

  const t2=fresh(); await t2.ui.pickSystem("gb");
  await t2.ui.addRoms([file("c.gb",{tag:3})]);
  ok("(준비) 안내가 떴음", /ADDED 1/.test(t2.ui.state.notice), t2.ui.state.notice);
  await t2.ui.tapRow(1);
  ok("★★★ 줄을 누르면 물러남", t2.ui.state.notice === "",
     JSON.stringify(t2.ui.state.notice));

  const t3=fresh(); await t3.ui.pickSystem("gb");
  await t3.ui.addRoms([file("d.gb",{tag:4})]);
  t3.ui.setCursor(0);
  ok("★★ 손가락으로 줄을 골라도 물러남", t3.ui.state.notice === "",
     JSON.stringify(t3.ui.state.notice));
}

console.log("\n[17] ★★ v2 — 토글 두 개 (컬러 / 조작판)");
{ const t=fresh();
  ok("기본은 템패드 주황", t.ui.state.colorReal===false);
  ok("기본은 조작판 보임", t.ui.state.padVisible===true);
  ok("★ 컬러 토글", t.ui.toggleColor()===true && t.ui.state.colorReal===true);
  ok("안내가 나옴", /REAL COLOR/.test(t.ui.state.notice), t.ui.state.notice);
  ok("★ 되돌아옴", t.ui.toggleColor()===false && t.ui.state.colorReal===false);
  ok("★ 조작판 토글", t.ui.togglePad()===false && t.ui.state.padVisible===false);
  ok("★ 되돌아옴", t.ui.togglePad()===true && t.ui.state.padVisible===true);

  /* ★ 게임 중이면 에뮬레이터에도 바로 알려줘야 합니다 */
  const t2=fresh(); await t2.ui.pickSystem("gb"); await t2.ui.play();
  const n=t2.colorSet.length;
  t2.ui.toggleColor();
  ok("★ 게임 중 토글은 에뮬에 전달됨", t2.colorSet.length===n+1 && t2.colorSet[n]===true,
     t2.colorSet.join(","));
  /* ★★ 그런데 **게임 화면에는 글자를 남기지 않습니다.**
       여기는 게임 화면이고, 구석 버튼에 이미 COLOR / AMBER 라고 적혀
       있습니다. 같은 말을 게임 위에 겹쳐 쓸 이유가 없습니다.
       (2026-08-11 형님 지적 — "게임화면이잖아") */
  ok("★★★ 게임 중에는 색 안내가 화면에 안 남음", t2.ui.state.notice === "",
     JSON.stringify(t2.ui.state.notice));
  /* 목록에서는 눌렸다는 걸 알려주는 값이 있으니 남깁니다 */
  const tList=fresh(); await tList.ui.pickSystem("gb");
  tList.ui.toggleColor();
  ok("★ 목록에서는 색 안내가 나옴", /REAL COLOR/.test(tList.ui.state.notice),
     tList.ui.state.notice);
  ok("★ 시작할 때 지금 설정을 넘겨줌", t2.started.o.colorReal===false, String(t2.started.o.colorReal));

  /* 저장되는가 */
  const box=new Map();
  const prefs={ get:k=>box.get(k)||null, set:(k,v)=>box.set(k,v) };
  const t3=fresh({prefs});
  t3.ui.toggleColor(); t3.ui.togglePad();
  ok("★ 설정이 저장됨", box.get("color")==="real" && box.get("pad")==="off",
     box.get("color")+"/"+box.get("pad"));
  const t4=fresh({prefs, keepPrefs:true});
  ok("★ 다음에 켜도 이어짐", t4.ui.state.colorReal===true && t4.ui.state.padVisible===false,
     t4.ui.state.colorReal+"/"+t4.ui.state.padVisible);
}

console.log("\n[18] ★ 시스템별 목록이 섞이지 않는가");
{ const t=fresh(); await t.ui.pickSystem("gb");
  await t.ui.addRom(file("G1.gb", {tag:21}));
  await t.ui.addRom(file("C1.gbc",{sys:"gbc",tag:22}));
  await t.ui.addRom(file("A1.gba",{sys:"gba",tag:23}));
  await t.ui.pickSystem("gb");
  ok("GB 는 기본 3 + 1", t.ui.state.count===4, t.ui.state.count);
  ok("★ GB 목록에 GBA 게임이 없음", !t.ui.list().some(r=>r.title==="A1"));
  await t.ui.pickSystem("gbc");
  ok("GBC 는 기본 2 + 1", t.ui.state.count===3 && t.ui.list().some(r=>r.title==="C1"),
     t.ui.list().map(r=>r.title).join("|"));
  await t.ui.pickSystem("gba");
  ok("GBA 는 1개", t.ui.state.count===1 && t.ui.list()[0].title==="A1");
}

console.log("\n[19] ★ 여러 개 한꺼번에 넣기");
{ const t=fresh(); await t.ui.pickSystem("gb");
  const files=[ file("a.gb",{tag:31}), file("b.gbc",{sys:"gbc",tag:32}),
                file("c.gba",{sys:"gba",tag:33}), file("d.txt",{broken:true}),
                {name:"e.png", bytes:rom({}), size:0x8000},   /* 이름이 롬이 아님 */
                file("f.gb",{size:100}) ];                    /* 너무 작아 롬이 아님 */
  const r=await t.ui.addRoms(files);
  ok("★ 진짜 롬 3개만 들어감", r.added===3, JSON.stringify(r));
  /* .txt 와 .png 는 이름에서 이미 걸러져 후보에 들지도 않습니다 */
  ok("★ 이름이 롬이 아닌 건 아예 안 셈", r.total===4, r.total);
  /* 후보 4개 중 f.gb 는 너무 작아 내용 검사에서 걸립니다 */
  ok("★ 이름은 맞지만 내용이 롬이 아닌 건 걸러짐", r.bad===1, r.bad);
  ok("★ 다른 시스템으로 간 개수를 알려줌", r.elsewhere===2, r.elsewhere);
  ok("GB 목록에는 1개만 늘어남", t.ui.state.count===4, t.ui.state.count);
  ok("안내에 개수가 들어감", /ADDED 3/.test(t.ui.state.notice), t.ui.state.notice);

  /* 같은 것을 또 넣으면 새로 센 것이 없어야 합니다 */
  const r2=await t.ui.addRoms(files);
  ok("★ 다시 넣으면 새로 안 셈", r2.added===0 && r2.dup===3, JSON.stringify(r2));
  /* ★★ 숫자만으로는 **어느 게임이 빠졌는지** 알 수 없습니다.
       "3 ALREADY IN" 만 보고는 무엇이 안 들어갔는지 모릅니다.
       (2026-08-11 형님 지적 — "뭐뭐 중복되서 뺏음 이라고 표시")
     ★ 중복 판정은 **롬 내용 지문**으로 합니다 — 파일 이름은 안 봅니다. */
  ok("★★★ 중복된 게임 이름이 안내에 나옴", /ALREADY IN \(/.test(t.ui.state.notice),
     t.ui.state.notice);
  { const shown = (t.ui.state.notice.match(/ALREADY IN \(([^)]*)\)/) || [])[1] || "";
    ok("★★★ 실제 게임 이름이 들어 있음",
       shown.split(", ").filter(Boolean).length >= 1
       && t.ui.list().some(r => shown.indexOf(r.title) >= 0), shown); }

  const t2=fresh(); await t2.ui.pickSystem("gb");
  const r3=await t2.ui.addRoms([{name:"x.jpg",bytes:new Uint8Array(10),size:10}]);
  ok("★ 롬 파일이 하나도 없으면 그렇게 말함", /NO GAME FILES/.test(t2.ui.state.notice), t2.ui.state.notice);
  ok("아무것도 안 들어감", r3.added===0);

  /* 저장이 계속 실패하면 중간에 그만둡니다 */
  const t3=fresh({addFail:true}); await t3.ui.pickSystem("gb");
  const many=[]; for(let i=0;i<20;i++) many.push(file("m"+i+".gb",{tag:40+i}));
  const r4=await t3.ui.addRoms(many);
  ok("★ 연달아 실패하면 그만둠", r4.stopped==="SAVE", String(r4.stopped));
  ok("★ 20개를 다 시도하지 않음", r4.failed===3, r4.failed);
  ok("이유를 제대로 씀", /STORAGE FULL/.test(t3.ui.state.notice), t3.ui.state.notice);

  /* ★★ 게임이 **한두 개뿐인** zip 은 아무리 실패해도 연속 3회가 안 나옵니다.
       그래서 전에는 "ADDED 0 / 1 FAILED" 만 뜨고 **용량 이야기가 없었습니다.**
       아드님은 zip 이 잘못된 줄 알고 다시 받으러 갑니다 — 정반대 진단입니다. */
  const t5=fresh({addFail:true}); await t5.ui.pickSystem("gb");
  const r5=await t5.ui.addRoms([file("solo.gb",{tag:88})]);
  ok("★ 하나만 넣다 실패해도 셈은 맞음", r5.added===0 && r5.failed===1, JSON.stringify(r5));
  ok("★★★ 하나뿐이어도 용량 이야기를 해줌",
     /STORAGE FULL/.test(t5.ui.state.notice), t5.ui.state.notice);
  ok("★ 그런데 '그만뒀다' 고는 안 함 (그만둘 것도 없었음)",
     !/STOPPED/.test(t5.ui.state.notice), t5.ui.state.notice);

  /* ★★ 확인창이 떠 있는 동안 넣으면 **말없이** 돌아서면 안 됩니다.
       12개짜리 zip 이 통째로 사라진 채 안내칸이 비어 있었습니다. */
  const t6=fresh(); await t6.ui.pickSystem("gb");
  await t6.ui.addRom(file("Q.gb",{tag:87}));
  ok("(준비) 확인창이 떴음",
     t6.ui.askRemove(t6.ui.list().findIndex(x=>!x.bundled)) && t6.ui.state.confirm !== null,
     JSON.stringify(t6.ui.state.confirm));
  const n6=t6.ui.state.count;
  const r6=await t6.ui.addRoms([file("z1.gb",{tag:86}), file("z2.gb",{tag:85})]);
  ok("★ 확인창 중에는 안 들어감", r6.added===0 && t6.ui.state.count===n6,
     JSON.stringify(r6));
  ok("★★★ 왜 안 됐는지 말해줌", /FINISH THE QUESTION/.test(t6.ui.state.notice),
     JSON.stringify(t6.ui.state.notice));
}

console.log("\n[20] ★ 기본 게임 지키기 — 이름이 같은 남의 롬이 들어와도");
{ /* 롬 묶음 폴더에는 2048.gb tobu.gb 같은 흔한 이름이 거의 반드시 있습니다.
     이름으로 짝을 맞추면 기본 게임이 목록에서 사라지고 남의 롬이
     기본 게임의 이름·라이선스 표기를 뒤집어씁니다. */
  const t=fresh(); await t.ui.pickSystem("gb");
  const n=t.ui.state.count;
  await t.ui.addRom(file("2048.gb",{tag:99}));      /* 이름만 같은 남의 롬 */
  ok("★ 목록이 늘어남 (기본 게임을 밀어내지 않음)", t.ui.state.count===n+1, t.ui.state.count);
  /* ★ 핵심은 "기본 게임이 살아 있는가" 입니다.
       남의 롬은 제 이름으로 따로 한 줄 생기는 게 맞습니다 (지울 수도 있고).
       v1 의 사고는 기본 게임이 **사라지고** 남의 롬이 그 자리를 차지한 것이었습니다. */
  const bundled=t.ui.list().find(r=>r.bundled && r.title==="2048");
  ok("★ 기본 2048 이 그대로 있음", !!bundled, t.ui.list().map(r=>r.title).join("|"));
  ok("★ 기본 게임 표시가 살아있음", !!bundled && bundled.note==="ZLIB  SANQUI",
     bundled && bundled.note);
  ok("★ 기본 게임은 여전히 못 지움", t.ui.askRemove(t.ui.list().indexOf(bundled))===false);
  const mine=t.ui.list().find(r=>!r.bundled);
  ok("★ 남의 롬은 따로 한 줄로 있음", !!mine && mine.title==="2048");
  ok("★ 그건 지울 수 있음", t.ui.askRemove(t.ui.list().indexOf(mine))===true);
}

console.log("\n[21] ★★★ 게임을 켜는 동안 다른 데로 가버리면 — 늦게 켜지면 안 됨");
{ /* 롬 읽기 + 코어 준비는 구형 폰에서 1~3초 걸립니다. 그 사이에 아드님이
     BACK 을 누르고 다른 기기를 골라버릴 수 있습니다. 그때 늦게 끝난 play()
     가 화면을 낚아채면 **"게임이 하나도 없네" 하고 보는 중에 딴 게임이
     켜집니다.** (2026-08-11 교차검사에서 재현해서 잡았습니다.) */
  const t=fresh(); await t.ui.pickSystem("gb");
  const p=t.ui.play();                 /* 켜는 중… */
  t.ui.backToSystem();                 /* 그 사이에 나가서 */
  await t.ui.pickSystem("gba");        /* 다른 기기를 고름 */
  const okStarted=await p;
  ok("★★★ 늦게 끝난 play 가 화면을 안 낚아챔", okStarted===false, String(okStarted));
  ok("★★ 화면이 GBA 목록 그대로", t.ui.state.screen==="list" && t.ui.state.systemId==="gba",
     t.ui.state.screen+"/"+t.ui.state.systemId);
  ok("★ 게임이 안 돌고 있음", !t.ui.state.running);
  ok("★ 엉뚱한 안내도 안 뜸", !/EMULATOR|BAD ROM/.test(t.ui.state.notice), t.ui.state.notice);

  /* 시스템을 안 바꾸고 그냥 나갔다 와도 마찬가지 */
  const t2=fresh(); await t2.ui.pickSystem("gb");
  const p2=t2.ui.play();
  await t2.ui.pickSystem("gb");        /* 같은 목록을 다시 골라도 새 화면입니다 */
  ok("★★ 다시 고른 경우에도 안 낚아챔", await p2===false);
  ok("게임 안 돎", !t2.ui.state.running);

  /* 아무 방해가 없으면 당연히 켜져야 합니다 (긍정형 대조군) */
  const t3=fresh(); await t3.ui.pickSystem("gb");
  ok("★ 방해가 없으면 제대로 켜짐", await t3.ui.play()===true && t3.ui.state.screen==="play");
}

console.log("\n[22] ★★ 목록이 새로 읽혀도 메뉴 커서가 안 흔들려야 함");
{ /* 300개 넣기가 도는 중에 게임을 켜고 MENU 를 열면, 마지막 refresh 가
     **메뉴 커서를 말없이 옮겨서** 안 고른 항목이 실행됐습니다. */
  const t=fresh(); await t.ui.pickSystem("gb");
  await t.ui.play(); t.ui.openMenu();
  t.ui.move(6);
  ok("(준비) 메뉴 맨 아래 EXIT 에 있음",
     t.ui.menuItems()[t.ui.state.cursor].key==="tempad", t.ui.state.cursor);
  await t.ui.refresh();               /* 목록이 새로 읽힘 (게임 3개뿐) */
  ok("★★★ 메뉴 커서가 그대로", t.ui.state.cursor===6, t.ui.state.cursor);
  ok("★★ 고른 항목도 그대로 EXIT",
     t.ui.menuItems()[t.ui.state.cursor].key==="tempad",
     t.ui.menuItems()[t.ui.state.cursor].key);
}

console.log("\n[23] ★ 화면에 안 맞는 조작은 무시 (잘못 불려도 사고가 안 나게)");
{ const t=fresh(); await t.ui.pickSystem("gb");
  ok("★ 목록에서 메뉴 항목을 고르는 건 무시", await t.ui.tapMenu(6,"load")===false);
  ok("★ 그래서 템패드로 안 나감", t.ui.state.screen==="list", t.ui.state.screen);
  await t.ui.play();
  ok("★ 게임 중에 줄 탭은 무시", await t.ui.tapRow(0)==="none");
  ok("★ 게임 중에 play 를 또 불러도 무시", await t.ui.play()===false);
  ok("게임 화면 그대로", t.ui.state.screen==="play");
}

console.log("\n[24] ★★ 기본 게임을 저장해도 목록에서 안 사라져야 함");
{ /* 기본 게임에 슬롯 저장을 하면 보관 기록이 생깁니다. 그 기록의 시스템이
     화면이 믿는 것과 어긋나면 **게임이 목록에서 통째로 사라지고** 세이브도
     "다른 기기의 것" 이라며 못 읽게 됩니다. 실제로 LIBBET·TOBU DX 가 그랬습니다. */
  for (const [sys, fileName, title] of [["gb","tobu.gb","TOBU TOBU GIRL"],
                                        ["gbc","libbet.gb","LIBBET"]]) {
    const t=fresh(); await t.ui.pickSystem(sys);
    const at=t.ui.list().findIndex(r=>r.file===fileName);
    ok(`(준비) ${title} 이 ${sys.toUpperCase()} 목록에 있음`, at>=0, at);
    t.ui.setCursor(at);
    const n0=t.ui.state.count;
    await t.ui.play(); t.ui.openMenu();
    ok(`${title} 슬롯 저장됨`, await t.ui.tapMenu(1,"save")===true, t.ui.state.notice);
    await t.ui.quit();
    ok(`★★★ ${title} 이 여전히 ${sys.toUpperCase()} 목록에 있음`,
       t.ui.state.count===n0 && t.ui.list().some(r=>r.file===fileName),
       t.ui.list().map(r=>r.file).join("|"));
    ok(`★ 이름·라이선스 표기도 그대로`,
       (t.ui.list().find(r=>r.file===fileName)||{}).title===title,
       (t.ui.list().find(r=>r.file===fileName)||{}).title);
    /* 그 세이브를 다시 읽을 수 있어야 합니다 */
    t.ui.setCursor(t.ui.list().findIndex(r=>r.file===fileName));
    await t.ui.play(); t.ui.openMenu();
    ok(`★★★ ${title} 세이브를 다시 불러올 수 있음`,
       await t.ui.tapMenu(1,"load")===true, t.ui.state.notice);
  }
}

console.log("\n[25] ★★ 같은 롬을 다시 넣어도 기록이 다른 목록으로 안 옮겨감");
{ const t=fresh(); await t.ui.pickSystem("gb");
  const r1=await t.ui.addRom(file("MINE.gb",{tag:61}));
  ok("(준비) 게임보이로 들어감", r1.system==="gb", r1.system);
  /* 같은 바이트를 다시 넣습니다 */
  const r2=await t.ui.addRom(file("MINE-again.gb",{tag:61}));
  ok("★ 같은 기록으로 들어감", r2.id===r1.id);
  ok("★★ 시스템이 안 바뀜", r2.system==="gb", r2.system);
  ok("★ 이름도 처음 것을 지킴", r2.title==="MINE", r2.title);
}

console.log("\n[26] ★★★ 슬롯 세 칸을 연달아 저장해도 다 남아야 함");
{ const t=fresh(); await t.ui.pickSystem("gb"); await t.ui.play(); t.ui.openMenu();
  ok("SLOT 1 저장", await t.ui.tapMenu(1,"save")===true, t.ui.state.notice);
  ok("SLOT 2 저장", await t.ui.tapMenu(2,"save")===true, t.ui.state.notice);
  ok("SLOT 3 저장", await t.ui.tapMenu(3,"save")===true, t.ui.state.notice);
  const marks=t.ui.menuItems().slice(1,4).map(m=>m.sub);
  ok("★★★ 세 칸이 전부 SAVED", marks.join(",")==="SAVED,SAVED,SAVED", marks.join(","));
  ok("★★ SLOT 1 을 실제로 불러올 수 있음", await t.ui.tapMenu(1,"load")===true, t.ui.state.notice);
  t.ui.openMenu();
  ok("★★ SLOT 3 도 불러올 수 있음", await t.ui.tapMenu(3,"load")===true, t.ui.state.notice);

  /* 겹쳐서 눌러도 (await 안 하고 연달아) */
  const t2=fresh(); await t2.ui.pickSystem("gb"); await t2.ui.play(); t2.ui.openMenu();
  await Promise.all([t2.ui.tapMenu(1,"save"), t2.ui.tapMenu(2,"save")]);
  const m2=t2.ui.menuItems().slice(1,3).map(m=>m.sub);
  ok("★★★ 겹쳐 눌러도 두 칸 다 남음", m2.join(",")==="SAVED,SAVED", m2.join(","));
}

console.log("\n[27] ★★ 저장이 실패해도 메뉴가 죽으면 안 됨");
{ /* 예전에는 저장소가 빈 값을 주면 playing 이 null 이 되어, 그 뒤로
     저장·불러오기가 영영 안 되고 메뉴에 게임 이름도 사라졌습니다. */
  const t=fresh(); await t.ui.pickSystem("gb");
  await t.ui.play(); t.ui.openMenu();
  const title=t.ui.state.title;
  ok("(준비) 기본 게임이고 이름이 있음", title.length>0, title);
  /* 저장소가 빈 값을 돌려주게 만듭니다 */
  const realAdd=t.store.add;
  t.store.add = async()=>null;
  ok("★ 저장은 실패로 보고", await t.ui.tapMenu(1,"save")===false);
  ok("★ 이유를 알려줌", /SAVE FAILED/.test(t.ui.state.notice), t.ui.state.notice);
  ok("★★★ 게임 이름이 안 사라짐", t.ui.state.title===title, t.ui.state.title);
  /* 저장소가 돌아오면 다시 저장돼야 합니다 */
  t.store.add = realAdd;
  ok("★★★ 되살아나서 저장됨", await t.ui.tapMenu(1,"save")===true, t.ui.state.notice);
  ok("★★ 불러오기도 됨", await t.ui.tapMenu(1,"load")===true, t.ui.state.notice);
}

console.log("\n[28] ★★ 게임 안 저장(배터리 세이브)이 실패하면 알려주고 다시 시도해야 함");
{ /* 저장공간이 차면 게임 안의 "리포트" 가 아무 말 없이 사라졌습니다. */
  const t=fresh(); await t.ui.pickSystem("gb"); await t.ui.play();
  const onSram=t.started.o.onSram;
  ok("(준비) 저장 통로가 있음", typeof onSram==="function");
  t.store.patch = async()=>{ throw new Error("QuotaExceededError"); };
  let threw=false;
  try { await onSram(new Uint8Array([1,2,3])); } catch(e){ threw=true; }
  ok("★★★ 실패를 삼키지 않고 알림 (다시 시도할 수 있게)", threw===true);
  ok("★★ 화면에도 알려줌", /COULD NOT SAVE/.test(t.ui.state.notice), t.ui.state.notice);
}

console.log(`\n${"=".repeat(46)}\n통과 ${pass}  실패 ${fail}\n`);
process.exit(fail?1:0);
})();
