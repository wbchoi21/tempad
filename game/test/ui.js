/* 화면 흐름 검사 — 진짜 브라우저 없이 */
const path=require("path");
const UI=path.join(__dirname,"..","ui.js");
let pass=0,fail=0;
const ok=(n,c,x)=>{ if(c){pass++;console.log("  OK   "+n);} else {fail++;console.log("  ★실패 "+n+(x?"  → "+x:""));} };

function fresh(opt={}){
  delete require.cache[require.resolve(UI)];
  const { Ui } = require(UI);
  const db = new Map();
  /* ★ 게임이 "있는 것" 과 "돌고 있는 것" 은 다릅니다.
       멈춰도(pause) 에뮬레이터는 살아 있어서 저장이 됩니다.
       처음에 이걸 하나로 묶어놨다가 엉뚱한 실패가 났습니다.        */
  let started=null, alive=false, running=false, pressed=[];
  const engine = {
    start(mod,bytes,o){ if(opt.badRom) throw new Error("BAD ROM");
                        started={bytes,o}; alive=true; running=true; return {}; },
    stop(){ alive=false; running=false; started=null; },
    pause(){ running=false; }, resume(){ if(alive) running=true; },
    isRunning:()=>running,
    press:(n,d)=>pressed.push(n+(d?"+":"-")),
    saveState:()=> alive ? new Uint8Array([1,2,3]) : null,
    loadState:(b)=> alive && b && b.length===3,
  };
  const store = {
    async list(){ if(opt.noDb) throw new Error("no-indexeddb");
                  return [...db.values()].map(r=>({id:r.id,title:r.title,file:r.file,
                    size:r.size,hasSram:!!r.sram,states:r.states.map(x=>!!x),played:r.played||0,added:r.added||0})); },
    async add(bytes,name){ const id="k"+(db.size+1)+name;
      const old=db.get(id);
      const rec={id,title:(name||"").replace(/\.[^.]*$/,"").toUpperCase(),file:name,
                 size:bytes.length,rom:bytes,sram:old?old.sram:null,
                 states:old?old.states:[null,null,null],played:0,added:Date.now()};
      db.set(id,rec); return rec; },
    async get(id){ return db.get(id)||null; },
    async patch(id,ch){ const r=db.get(id); if(!r) return null; Object.assign(r,ch); return r; },
    async remove(id){ db.delete(id); },
  };
  const ui = new Ui({
    store, engine,
    readFile: async f => f.bytes,
    fetchRom: async p => { if(opt.fetchFail) throw new Error("404");
                           return new Uint8Array(0x8000); },
    loadWasm: async () => { if(opt.noWasm) throw new Error("nope"); return {}; },
    canvas: null,
  });
  ui._reset();
  return { ui, db, engine, get started(){return started;}, get pressed(){return pressed;} };
}
const romFile=(name,size=0x8000)=>({ name, bytes:new Uint8Array(size) });

console.log("\n[1] 시스템 고르기 → 목록");
{ const t=fresh(); 
  ok("처음엔 시스템 화면", t.ui.state.screen==="system");
  await0(); async function await0(){}
  t.ui.pickSystem("gb").then(()=>{
    ok("목록으로 감", t.ui.state.screen==="list");
    ok("기본 게임 5개가 보임", t.ui.state.count===5, t.ui.state.count);
    t.ui.pickSystem("gw").then(()=>{
      ok("게임&워치는 아직 비어있음", t.ui.state.count===0);
      run2();
    });
  });
}

function run2(){
console.log("\n[2] 목록에서 움직이기");
(async()=>{
  const t=fresh(); await t.ui.pickSystem("gb");
  t.ui.move(1); ok("아래로", t.ui.state.cursor===1);
  t.ui.move(-1); ok("위로", t.ui.state.cursor===0);
  t.ui.move(-1); ok("맨 위에서 위 → 맨 아래로 감", t.ui.state.cursor===4, t.ui.state.cursor);
  t.ui.move(1);  ok("맨 아래에서 아래 → 맨 위로", t.ui.state.cursor===0);

  console.log("\n[3] 롬 넣기");
  const t2=fresh(); await t2.ui.pickSystem("gb");
  const before=t2.ui.state.count;
  await t2.ui.addRom(romFile("MYGAME.gb"));
  ok("목록이 늘어남", t2.ui.state.count===before+1);
  ok("넣은 것에 커서가 감", t2.ui.selected().title==="MYGAME", t2.ui.selected().title);
  const r=await t2.ui.addRom(romFile("tiny.gb", 100));
  ok("너무 작은 파일은 거부", r===null && /NOT A GAME BOY/.test(t2.ui.state.notice));
  ok("거부해도 목록은 그대로", t2.ui.state.count===before+1);

  console.log("\n[4] 지우기");
  ok("넣은 것은 지워짐", await t2.ui.removeRom()===true);
  ok("목록 줄어듦", t2.ui.state.count===before);
  await t2.ui.refresh();
  ok("기본 게임은 못 지움", await t2.ui.removeRom()===false && /CANNOT REMOVE/.test(t2.ui.state.notice));

  console.log("\n[5] 시작");
  const t3=fresh(); await t3.ui.pickSystem("gb");
  ok("시작됨", await t3.ui.play()===true);
  ok("플레이 화면", t3.ui.state.screen==="play");
  ok("에뮬 돌고 있음", t3.ui.state.running);
  ok("제목이 잡힘", t3.ui.state.title.length>0, t3.ui.state.title);

  const t4=fresh({noWasm:true}); await t4.ui.pickSystem("gb");
  ok("에뮬 못 부르면 시작 안 함", await t4.ui.play()===false);
  ok("화면 안 넘어감", t4.ui.state.screen==="list");
  ok("안내가 나옴", /EMULATOR/.test(t4.ui.state.notice), t4.ui.state.notice);

  const t5=fresh({fetchFail:true}); await t5.ui.pickSystem("gb");
  ok("롬 파일 없으면 시작 안 함", await t5.ui.play()===false);
  const t6=fresh({badRom:true}); await t6.ui.pickSystem("gb");
  ok("나쁜 롬이면 안내", await t6.ui.play()===false && /BAD ROM/.test(t6.ui.state.notice), t6.ui.state.notice);
  ok("나쁜 롬이어도 목록에 남아있음", t6.ui.state.screen==="list");

  console.log("\n[6] 메뉴");
  const t7=fresh(); await t7.ui.pickSystem("gb"); await t7.ui.play();
  ok("메뉴 열림", t7.ui.openMenu()===true && t7.ui.state.screen==="menu");
  ok("★ 메뉴 열면 게임 멈춤", !t7.ui.state.running);
  ok("메뉴 닫으면 다시 돎", t7.ui.closeMenu()===true && t7.ui.state.running);
  ok("플레이 중 아니면 메뉴 안 열림", (t7.ui.quit(), t7.ui.openMenu()===false));

  console.log("\n[7] 저장 칸");
  const t8=fresh(); await t8.ui.pickSystem("gb"); await t8.ui.play(); t8.ui.openMenu();
  ok("빈 칸 불러오기는 실패", await t8.ui.loadSlot(0)===false && /EMPTY/.test(t8.ui.state.notice));
  ok("2번 칸에 저장", await t8.ui.saveSlot(1)===true && /SLOT 2/.test(t8.ui.state.notice), t8.ui.state.notice);
  ok("2번 칸 불러오기", await t8.ui.loadSlot(1)===true);
  ok("불러오면 메뉴 닫힘", t8.ui.state.screen==="play");
  ok("다른 칸은 여전히 비어있음", (t8.ui.openMenu(), await t8.ui.loadSlot(2)===false));
  ok("★ 저장 칸이 아닌 데서 START 누르면 안내", (t8.ui.openMenu(), await t8.ui.saveMenu()===false));

  console.log("\n[8] ★ 끝내기");
  const t9=fresh(); await t9.ui.pickSystem("gb"); await t9.ui.play();
  await t9.ui.quit();
  ok("에뮬 정지", !t9.ui.state.running);
  ok("목록으로 돌아옴", t9.ui.state.screen==="list");
  ok("하던 게임 지워짐", t9.ui.state.title==="");
  const t10=fresh(); await t10.ui.pickSystem("gb"); await t10.ui.play();
  t10.ui.exitToTempad();
  ok("템패드로 나가도 에뮬 정지", !t10.ui.state.running);
  ok("시스템 화면으로", t10.ui.state.screen==="system");

  console.log("\n[9] ★ 버튼이 새지 않는가");
  const t11=fresh(); await t11.ui.pickSystem("gb");
  t11.ui.press("A",true);
  ok("목록에서 누른 건 게임에 안 감", t11.pressed.length===0);
  await t11.ui.play();
  t11.ui.press("A",true); t11.ui.press("A",false);
  ok("플레이 중에는 전달됨", t11.pressed.join(",")==="A+,A-", t11.pressed.join(","));
  t11.ui.openMenu();
  const n=t11.pressed.length;
  t11.ui.press("up",true);
  ok("★ 메뉴에서 누른 건 게임에 안 감", t11.pressed.length===n);

  console.log("\n[10] 저장소가 막혔을 때 (file:// 로 열면 이렇게 됨)");
  const t12=fresh({noDb:true}); await t12.ui.pickSystem("gb");
  ok("기본 게임은 그래도 보임", t12.ui.state.count===5, t12.ui.state.count);
  ok("안내가 나옴", /STORAGE/.test(t12.ui.state.notice), t12.ui.state.notice);
  ok("시작도 됨", await t12.ui.play()===true);

  console.log("\n[11] 메뉴 안에서 고르기");
  const t13=fresh(); await t13.ui.pickSystem("gb");
  t13.ui.move(2);                                  /* 목록 3번째로 */
  const keep=t13.ui.state.cursor;
  await t13.ui.play(); t13.ui.openMenu();
  ok("메뉴는 맨 위(RESUME)부터", t13.ui.state.cursor===0);
  ok("메뉴 줄 수가 목록이 아니라 메뉴 것", t13.ui.rows()===7, t13.ui.rows());
  t13.ui.move(-1);
  ok("메뉴 맨 위에서 위 → 맨 아래(EXIT)", t13.ui.menuItems()[t13.ui.state.cursor].key==="tempad");
  t13.ui.move(1);
  ok("RESUME 고르면 게임으로", await t13.ui.chooseMenu()===true && t13.ui.state.screen==="play");
  ok("★ 목록 자리 기억함", t13.ui.state.cursor===keep, t13.ui.state.cursor+" vs "+keep);

  t13.ui.openMenu(); t13.ui.move(2);               /* SLOT 2 */
  ok("고른 게 SLOT 2", t13.ui.menuItems()[t13.ui.state.cursor].key==="slot1");
  ok("빈 칸은 A 로 못 불러옴", await t13.ui.chooseMenu()===false);
  ok("START 로 저장됨", await t13.ui.saveMenu()===true);
  ok("칸 표시가 SAVED 로 바뀜", t13.ui.menuItems()[2].sub==="SAVED", t13.ui.menuItems()[2].sub);
  ok("이제 A 로 불러와짐", await t13.ui.chooseMenu()===true && t13.ui.state.screen==="play");

  t13.ui.openMenu();
  t13.ui.move(4);                                  /* CHANGE GAME */
  ok("고른 게 CHANGE GAME", t13.ui.menuItems()[t13.ui.state.cursor].key==="game");
  ok("고르면 나감", await t13.ui.chooseMenu()===true);
  ok("에뮬 정지", !t13.ui.state.running);
  ok("목록으로", t13.ui.state.screen==="list");
  ok("★ 목록 자리 기억함", t13.ui.state.cursor===keep);

  console.log("\n[13] ★ 어디서든 나갈 길이 있는가");
  const t15=fresh();
  ok("시스템 화면 → TEMPAD", t15.ui.upLabel()==="TEMPAD");
  await t15.ui.pickSystem("gb");
  ok("목록 → SYSTEM", t15.ui.upLabel()==="SYSTEM");
  ok("실제로 감", (await t15.ui.up())==="system" && t15.ui.state.screen==="system");
  await t15.ui.pickSystem("gb"); await t15.ui.play();
  ok("게임 중 → MENU", t15.ui.upLabel()==="MENU");
  ok("★ 게임 중 유일한 탈출구가 작동", (await t15.ui.up())==="menu" && t15.ui.state.screen==="menu");
  ok("★ 게임이 멈춤", !t15.ui.state.running);
  ok("메뉴 → RESUME", t15.ui.upLabel()==="RESUME");
  ok("되돌아감", (await t15.ui.up())==="play" && t15.ui.state.running);

  console.log("\n[14] ★ 메뉴에서 나가는 세 갈래");
  const t16=fresh(); await t16.ui.pickSystem("gb"); await t16.ui.play();
  t16.ui.openMenu(); t16.ui.move(5);               /* CHANGE SYSTEM */
  ok("고른 게 CHANGE SYSTEM", t16.ui.menuItems()[t16.ui.state.cursor].key==="system");
  await t16.ui.chooseMenu();
  ok("기기 고르는 화면으로", t16.ui.state.screen==="system");
  ok("에뮬 정지", !t16.ui.state.running);

  const t17=fresh(); await t17.ui.pickSystem("gb"); await t17.ui.play();
  t17.ui.openMenu(); t17.ui.move(6);               /* EXIT */
  ok("고른 게 EXIT", t17.ui.menuItems()[t17.ui.state.cursor].key==="tempad");
  await t17.ui.chooseMenu();
  ok("★ 템패드로 나감 + 에뮬 정지", !t17.ui.state.running && t17.ui.state.screen==="system");

  console.log("\n[15] ★ 갇히는 화면이 없는가");
  for(const [name,setup] of [
      ["시스템",  async u=>{}],
      ["목록",    async u=>{ await u.pickSystem("gb"); }],
      ["게임중",  async u=>{ await u.pickSystem("gb"); await u.play(); }],
      ["메뉴",    async u=>{ await u.pickSystem("gb"); await u.play(); u.openMenu(); }]]){
    const t=fresh(); await setup(t.ui);
    const lbl=t.ui.upLabel();
    ok(name+" 화면에 나가는 길이 보임", typeof lbl==="string" && lbl.length>0, lbl);
  }

  console.log("\n[12] 시스템 화면 커서");
  const t14=fresh();
  ok("시스템은 2줄", t14.ui.rows()===2);
  t14.ui.move(1); ok("두번째", t14.ui.state.cursor===1);
  t14.ui.move(1); ok("돌아옴", t14.ui.state.cursor===0);
  await t14.ui.pickSystem("gb");
  t14.ui.move(3);
  t14.ui.backToSystem();
  ok("시스템으로 돌아가면 커서 0", t14.ui.state.cursor===0 && t14.ui.state.screen==="system");

  console.log(`\n${"=".repeat(46)}\n통과 ${pass}  실패 ${fail}\n`);
  process.exit(fail?1:0);
})();
}
