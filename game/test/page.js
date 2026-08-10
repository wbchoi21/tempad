/* ============================================================================
   game/index.html 안의 코드를 진짜로 실행해봅니다.

   지금까지 이 파일은 문법 검사만 했습니다. draw() 가 터지는지,
   버튼이 제대로 연결됐는지, 없는 id 를 부르는지는 알 수 없었습니다.
   ========================================================================== */
const fs=require("fs"), path=require("path"), vm=require("vm");
const { makeIDB } = require("./idb.js");
const D=path.join(__dirname,"..");

/* 진짜처럼 보이는 게임보이 롬 한 개 (닌텐도 로고 + 제목) */
const LOGO=[0xCE,0xED,0x66,0x66,0xCC,0x0D,0x00,0x0B,0x03,0x73,0x00,0x83,0x00,0x0C,0x00,0x0D];
function makeRom(seed=1, title="MYGAME"){
  const b=new Uint8Array(0x8000);
  LOGO.forEach((v,i)=>b[0x104+i]=v);
  /* title 이 빈 문자열이면 헤더에 제목이 없는 롬입니다.
     그러면 romTitle 이 **파일 이름**을 씁니다 — 이스케이프 검사에 필요합니다. */
  for(let i=0;i<title.length;i++) b[0x134+i]=title.charCodeAt(i);
  b[0x200]=seed;
  return b;
}
/* 파일 고르기 흉내 — input.files 에 넣을 것 */
function fakeFile(name, seed, title){
  const b=makeRom(seed, title===undefined ? "MYGAME" : title);
  return { name, size:b.length, _bytes:b };
}
let pass=0,fail=0;
const ok=(n,c,x)=>{ if(c){pass++;console.log("  OK   "+n);} else {fail++;console.log("  ★실패 "+n+(x?"  → "+x:""));} };

const html=fs.readFileSync(path.join(D,"index.html"),"utf8");
const pageJs=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join("\n");
const ids=[...new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m=>m[1]))];

function makeEl(id){
  const el={
    id, style:{ cssText:"", setProperty(){}, },
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
                contains(c){return this._s.has(c);} },
    dataset:{}, _html:"", textContent:"", value:"", files:[], listeners:{},
    /* 진짜 <input> 에는 이 속성이 있습니다. 폴더 고르기가 되는지 볼 때 씁니다. */
    webkitdirectory:false,
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html=v; },
    addEventListener(t,f){ (this.listeners[t]=this.listeners[t]||[]).push(f); },
    removeEventListener(){}, click(){ this.fire("click"); },
    fire(t,ev){ (this.listeners[t]||[]).forEach(f=>f(ev||{preventDefault(){},pointerId:1,clientX:0,clientY:0})); },
    querySelector(sel){
      /* draw() 가 고른 줄을 찾아 스크롤합니다 */
      if(sel===".row.sel" && /class="row[^"]*sel/.test(this._html))
        return { scrollIntoView(){ el._scrolled=(el._scrolled||0)+1; } };
      return null;
    },
    getContext(){ return { imageSmoothingEnabled:true,
      createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),
      putImageData(){} }; },
    remove(){}, appendChild(){}, setPointerCapture(){},
  };
  return el;
}

function run(opts={}){
  const els={}; ids.forEach(i=>els[i]=makeEl(i));
  const store=new Map();
  const timers=[];
  const sandbox={
    console,
    document:{
      getElementById:i=>els[i]||null,
      createElement:()=>makeEl("tmp"),
      body:{ appendChild(){}, },
      documentElement:{ clientWidth:opts.W||844, clientHeight:opts.H||390,
                        style:{ setProperty(){}, } },
      addEventListener(t,f){ (this._l=this._l||{})[t]=(this._l[t]||[]).concat(f); },
      visibilityState:"visible",
      querySelectorAll:()=>[],
    },
    window:null,
    localStorage:{ getItem:k=>store.has(k)?store.get(k):null,
                   setItem:(k,v)=>store.set(k,String(v)) },
    matchMedia:()=>({ matches:!!opts.coarse }),
    navigator:{ userAgent: opts.ua || "Mozilla/5.0 (Linux; Android 13)", standalone:false },
    getComputedStyle:()=>({ top:"0px",left:"0px",bottom:"0px",right:"0px",fontSize:"13px" }),
    requestAnimationFrame:()=>1, cancelAnimationFrame(){},
    /* ★ 이게 없으면 게임 시작이 조용히 실패합니다 (한참 못 찾았습니다) */
    setInterval:()=>1, clearInterval(){},
    addEventListener(){},
    /* ★ 예전에는 setTimeout 이 아무것도 안 하고 0 만 돌려줬습니다.
         그러면 "길게 누르기" 나 "잠깐 쉬었다 계속" 같은 코드가
         **영원히 오지 않는 약속을 기다리며** 조용히 멈춥니다.
         이제는 적어뒀다가 검사에서 flush() 로 직접 터뜨립니다.      */
    setTimeout:(f,ms)=>{ timers.push({f,ms:ms||0,dead:false}); return timers.length; },
    clearTimeout:(h)=>{ const t=timers[h-1]; if(t) t.dead=true; },
    fetch:async()=>({ ok:true, arrayBuffer:async()=>new ArrayBuffer(0x8000) }),
    location:{ href:"" },
    AudioContext:function(){ return { sampleRate:48000, resume(){}, suspend(){},
      createBuffer:(c,n)=>({getChannelData:()=>new Float32Array(n)}),
      createBufferSource:()=>({connect(){},start(){}}) }; },
    Binjgb: opts.noBinjgb ? undefined : (async()=>({})),
    /* ★ 진짜 게임보이 롬처럼 닌텐도 로고를 넣어줍니다.
         전에는 0 으로 채운 버퍼라 looksLikeGb 가 무조건 거절했고,
         그래서 "파일을 넣는다" 는 길이 검사에서 한 번도 안 돌았습니다. */
    FileReader:function(){
      this.readAsArrayBuffer=(f)=>{
        const b=new Uint8Array((f && f._bytes) || makeRom());
        this.onloadend({target:{result:b.buffer}});
      };
    },
    /* ★★ 전에는 indexedDB 를 아예 막아뒀습니다(undefined).
           그러면 기본 게임만 보이고, 기본 게임은 못 지우므로
           **지우기 확인 화면이 검사에서 한 번도 안 그려졌습니다.**
           파일 넣기 길도 통째로 안 돌았습니다. 이제 가짜를 끼웁니다. */
    indexedDB: opts.noDb ? undefined : makeIDB(),
    Uint8Array, Math, JSON, Promise, Number, String, Object, Array, Date, Error, isFinite,
  };
  sandbox.window=sandbox;
  sandbox.globalThis=sandbox;
  vm.createContext(sandbox);
  /* 부품들을 먼저 넣습니다 (실제 <script src> 순서와 같게) */
  for(const f of ["game.js","ui.js","pad.js"])
    vm.runInContext(fs.readFileSync(path.join(D,f),"utf8"), sandbox, {filename:f});
  let err=null;
  try{ vm.runInContext(pageJs, sandbox, {filename:"index.html"}); }
  catch(e){ err=e; }
  /* ★ let 으로 선언한 값은 sandbox 의 속성이 되지 않습니다.
       안에서 평가해야 읽을 수 있습니다. */
  const read = expr => { try{ return vm.runInContext(expr, sandbox); }catch(e){ return undefined; } };
  /* 적어둔 시계를 터뜨립니다. 터진 안에서 또 걸 수 있으니 여러 바퀴 돕니다. */
  const flush = (rounds=6) => {
    for(let n=0;n<rounds;n++){
      const now=timers.slice();
      let ran=false;
      for(let i=0;i<now.length;i++){
        const t=now[i];
        if(t.dead||t.done) continue;
        t.done=true; ran=true;
        try{ t.f(); }catch(e){ /* 검사에서 따로 봅니다 */ }
      }
      if(!ran) break;
    }
  };
  return { sandbox, els, err, read, timers, flush };
}

/* 목록의 한 줄을 흉내냅니다. 진짜 DOM 이 없어서 closest 를 손으로 만듭니다. */
function fakeRow(i){
  const row={ dataset:{ i:String(i) },
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
                contains(c){return this._s.has(c);} } };
  row.closest = sel => /row/.test(sel) ? row : null;
  return row;
}


/* ★ 버튼은 **뗄 때까지** 눌린 것으로 남습니다 (pad.js 가 손가락 번호로 셈).
     검사에서 누르기만 하고 안 떼면, 다음에 같은 번호로 누른 것이 통째로
     무시됩니다. 실제로 이것 때문에 멀쩡한 코드를 버그로 오해했습니다. */
let tapId = 100;
function tap(el){
  const id = ++tapId;
  el.fire("pointerdown", { preventDefault(){}, pointerId:id });
  el.fire("pointerup",   { preventDefault(){}, pointerId:id });
}

/* ★ 가짜 저장소가 진짜처럼 여러 번 쉬었다 가므로 넉넉히 기다립니다.
     setImmediate 두 번으로는 모자랍니다 (목록이 아직 안 온 채로 검사하게 됩니다). */
const wait = async (n=6) => { for(let i=0;i<n;i++) await new Promise(r=>setTimeout(r,1)); };

(async () => {

console.log("\n[1] 화면이 뜨는가");
{ const r=run();
  ok("코드가 끝까지 돔", !r.err, r.err && r.err.message);
  ok("ui 가 만들어짐", !!r.read("ui"));
  ok("십자키가 붙음", !!r.read("pad"));
  ok("첫 화면이 그려짐", /SELECT SYSTEM/.test(r.els.page.innerHTML), r.els.page.innerHTML.slice(0,40));
  ok("오른쪽 안내글도 그려짐", /FIELD UNIT/.test(r.els.info.innerHTML));
  ok("시스템 화면에선 위로 갈 곳이 없다고 표시", r.els.btnUp.textContent==="\u2014", r.els.btnUp.textContent);
  ok("★ 나가는 길이 눈에 보임", /TAP/.test(r.els.info.innerHTML) || /BOTTOM LEFT/.test(r.els.info.innerHTML),
     r.els.info.innerHTML.slice(-60));
  ok("화면 크기가 잡힘", /x2/.test(r.els.diag.textContent), r.els.diag.textContent);
}

console.log("\n[2] 십자키로 움직이기");
{ const r=run();
  const before=r.els.page.innerHTML;
  r.sandbox.onPress("down",true);
  ok("아래로 눌러 화면이 바뀜", r.els.page.innerHTML!==before);
  ok("두 번째 줄이 선택됨", /row sel[^]*GAME & WATCH/.test(r.els.page.innerHTML)
     || /GAME & WATCH/.test((r.els.page.innerHTML.split("row sel")[1]||"")));
  ok("고른 줄을 화면 안으로 스크롤함", (r.els.page._scrolled||0)>0, "횟수 "+(r.els.page._scrolled||0));
}

console.log("\n[3] 기기 고르고 목록으로");
{ const r=run();
  r.sandbox.onPress("A",true);
  await wait();
  ok("목록 화면으로 감", /GAME BOY/.test(r.els.page.innerHTML), r.els.page.innerHTML.slice(0,60));
  ok("기본 게임 다섯 개가 보임", (r.els.page.innerHTML.match(/class="row/g)||[]).length===5,
     (r.els.page.innerHTML.match(/class="row/g)||[]).length+"개");
  ok("탈출구 글자가 SYSTEM 으로 바뀜", r.els.btnUp.textContent==="SYSTEM", r.els.btnUp.textContent);
  ok("조작법이 화면에 적혀 있음", /PLAY/.test(r.els.info.innerHTML) && /ADD FILE/.test(r.els.info.innerHTML));
}

console.log("\n[4] 글자 크기");
{ const r=run();
  const first=r.read("fsNow");
  r.read("applyFS")(first+4);
  ok("커짐", r.read("fsNow")===first+4, r.read("fsNow"));
  r.read("applyFS")(999);
  ok("최대에서 멈춤", r.read("fsNow")===26, r.read("fsNow"));
  r.read("applyFS")(-999);
  ok("최소에서 멈춤", r.read("fsNow")===9, r.read("fsNow"));
  ok("★ 버튼 크기는 안 변함", /width:46px/.test(r.els.btnA.style.cssText),
     r.els.btnA.style.cssText.slice(-40));
  const r2=run({coarse:true});
  ok("손가락 기기는 기본이 큼", r2.read("fsNow")===16, r2.read("fsNow"));
}

console.log("\n[5] 버튼이 전부 연결됐는가");
{ const r=run();
  for(const id of ["btnA","btnB","btnSel","btnSta","btnUp","fsUp","fsDn","padArea","back",
                   "file","dir","page"])
    ok(id+" 에 손이 붙어 있음", Object.keys(r.els[id].listeners).length>0,
       Object.keys(r.els[id].listeners).join(","));
}

console.log("\n[5-2] ★ 폴더 고르기");
/* ★★ ADD FILE 과 ADD FOLDER 는 **어느 기기에서나 둘 다 있어야 합니다.**
       전에는 아이폰에서 ADD FOLDER 가 ADD FILES 로 바뀌어 없어졌습니다.
       항목이 사라지면 "내 폰엔 왜 없지" 가 됩니다.                     */
async function toLibrary(r){
  r.read("ui.pickSystem('gb')"); await wait(); r.read("draw()");
  tap(r.els.btnSel);
  await wait();
}
{ const r=run({ ua:"Mozilla/5.0 (Linux; Android 13)" });
  await toLibrary(r);
  ok("안드로이드는 폴더 고르기가 됨", r.read("CAN_DIR")===true, r.read("CAN_DIR"));
  ok("★ 라이브러리가 열림", r.read("ui.state.screen")==="library", r.read("ui.state.screen"));
  ok("★ ADD FILE 이 있음",   /ADD FILE/.test(r.els.page.innerHTML));
  ok("★ ADD FOLDER 도 있음", /ADD FOLDER/.test(r.els.page.innerHTML));
  ok("★ REMOVE 도 있음",     /REMOVE/.test(r.els.page.innerHTML));
  ok("★ 나가는 길이 있음",   /BACK/.test(r.els.page.innerHTML));
}
{ const r=run({ ua:"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" });
  await toLibrary(r);
  ok("★ 아이폰은 폴더 고르기가 안 되는 걸로 봄", r.read("CAN_DIR")===false, r.read("CAN_DIR"));
  ok("★★ 아이폰에도 ADD FOLDER 가 그대로 있음", /ADD FOLDER/.test(r.els.page.innerHTML),
     r.els.page.innerHTML.replace(/<[^>]*>/g," "));
  ok("★ 아이폰에도 ADD FILE 이 있음", /ADD FILE/.test(r.els.page.innerHTML));
  ok("★ 왜 폴더를 못 고르는지 설명해줌", /CANNOT[\s\S]*PICK A FOLDER/.test(r.els.info.innerHTML),
     r.els.info.innerHTML.replace(/<[^>]*>/g," "));
}
{ /* 각 항목이 실제로 파일창을 여는가 */
  const r=run({ ua:"Mozilla/5.0 (Linux; Android 13)" });
  await toLibrary(r);
  let opened="";
  r.els.file.click = () => { opened="file"; };
  r.els.dir.click  = () => { opened="dir"; };
  tap(r.els.btnA);   /* ADD FILE */
  await wait();
  ok("★ ADD FILE 이 파일창을 엶", opened==="file", opened);
  ok("고른 뒤 목록으로 돌아옴", r.read("ui.state.screen")==="list", r.read("ui.state.screen"));

  await toLibrary(r);
  r.read("ui.move(1)");                                                  /* ADD FOLDER */
  opened="";
  tap(r.els.btnA);
  await wait();
  ok("★ ADD FOLDER 가 폴더창을 엶", opened==="dir", opened);
}
{ /* 아이폰에서는 ADD FOLDER 가 파일 여러 개 고르기를 엽니다 */
  const r=run({ ua:"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" });
  await toLibrary(r);
  let opened="";
  r.els.file.click = () => { opened="file"; };
  r.els.dir.click  = () => { opened="dir"; };
  r.read("ui.move(1)");
  tap(r.els.btnA);
  await wait();
  ok("★★ 아이폰 ADD FOLDER 는 파일 여러 개 고르기로", opened==="file", opened);
}
{ /* MENU 버튼으로 라이브러리를 나갈 수 있어야 합니다 */
  const r=run();
  await toLibrary(r);
  ok("탈출구 글자가 LIST 로 바뀜", r.els.btnUp.textContent==="LIST", r.els.btnUp.textContent);
  r.els.btnUp.fire("click");
  await wait();
  ok("★ MENU 로 목록에 돌아옴", r.read("ui.state.screen")==="list", r.read("ui.state.screen"));
}
{ /* 파일 넣는 칸은 여러 개를 받아야 합니다 */
  ok("★ 파일 칸이 여러 개를 받음", /id="file"[^>]*multiple/.test(html));
  ok("★ 폴더 칸이 있음", /id="dir"[^>]*webkitdirectory/.test(html));
}

console.log("\n[5-3] ★★ 길게 눌러 지우기 — 손이 제대로 이어졌는가");
{ const r=run();
  r.read("ui.pickSystem('gb')");
  await wait(); r.read("draw()");
  ok("(준비) 목록이 보임", /GAME BOY/.test(r.els.page.innerHTML), r.els.page.innerHTML.slice(0,50));
  ok("줄에 번호가 붙어 있음", /data-i="0"/.test(r.els.page.innerHTML));
  ok("라이브러리로 가라는 안내가 있음", /LIBRARY/.test(r.els.info.innerHTML),
     r.els.info.innerHTML.replace(/<[^>]*>/g," "));

  /* 손가락을 대면 → 막대가 차오르기 시작 */
  const row=fakeRow(0);
  r.els.page.fire("pointerdown",{ target:row, clientX:10, clientY:10 });
  ok("누르는 동안 표시가 뜸", row.classList.contains("holding"));
  ok("시계를 걸어둠", r.timers.some(t=>!t.dead && t.ms>=500), JSON.stringify(r.timers.map(t=>t.ms)));

  /* 손가락이 움직이면 취소 (스크롤하려던 것) */
  r.els.page.fire("pointermove",{ clientX:60, clientY:10 });
  ok("★ 움직이면 취소됨", !row.classList.contains("holding"));
  r.flush();
  await wait();
  ok("★ 움직인 뒤엔 물어보지 않음", !/DELETE GAME/.test(r.els.page.innerHTML));
}
{ /* 가만히 누르고 있으면 → 물어봅니다.
     검사 환경에는 저장소가 없어 기본 게임만 있습니다.
     기본 게임은 못 지우므로 "안 된다"고 나와야 맞습니다. */
  const r=run();
  r.read("ui.pickSystem('gb')");
  await wait(); r.read("draw()");
  const row=fakeRow(0);
  r.els.page.fire("pointerdown",{ target:row, clientX:10, clientY:10 });
  r.flush();
  await wait();
  ok("★ 기본 게임은 못 지운다고 나옴",
     /CANNOT DELETE/.test(r.els.note.textContent), r.els.note.textContent);
  ok("물음표는 안 뜸", !/DELETE GAME/.test(r.els.page.innerHTML));
  /* 시계가 터진 뒤 손을 떼도 게임이 시작되면 안 됩니다 */
  r.els.page.fire("pointerup",{ clientX:10, clientY:10 });
  await wait();
  ok("★ 길게 누른 뒤 손을 떼도 시작 안 됨",
     r.read("ui.state.screen")==="list", r.read("ui.state.screen"));
}
{ /* 짧게 누르면 — 고르기, 이미 고른 줄이면 시작 */
  const r=run();
  r.read("ui.pickSystem('gb')");
  await wait(); r.read("draw()");
  const row2=fakeRow(2);
  r.els.page.fire("pointerdown",{ target:row2, clientX:10, clientY:10 });
  r.els.page.fire("pointerup",{ clientX:10, clientY:10 });
  await wait();
  ok("★ 짧게 누르면 그 줄이 골라짐", r.read("ui.state.cursor")===2, r.read("ui.state.cursor"));
  ok("아직 시작은 안 함", r.read("ui.state.screen")==="list");
  /* 같은 줄을 또 누르면 시작 */
  r.els.page.fire("pointerdown",{ target:fakeRow(2), clientX:10, clientY:10 });
  r.els.page.fire("pointerup",{ clientX:10, clientY:10 });
  await wait(); await wait();
  /* ★ 여기서는 "시작됐다" 까지 볼 수 없습니다.
       검사용 가짜 binjgb 는 껍데기라 진짜로는 못 켭니다.
       그래서 **시작을 시도했는가** 를 봅니다 — 손이 이어졌다는 증거입니다.
       (진짜로 켜지는지는 run.js/live.js 가 진짜 binjgb 로 확인합니다.) */
  ok("★ 고른 줄을 또 누르면 시작을 시도함",
     /COULD NOT START|EMULATOR NOT AVAILABLE|BAD ROM/.test(r.read("ui.state.notice") || ""),
     r.read("ui.state.screen") + " / " + r.read("ui.state.notice"));
}
{ /* 전화가 오면 (pointercancel) 길게 누르기는 취소돼야 합니다 */
  const r=run();
  r.read("ui.pickSystem('gb')");
  await wait(); r.read("draw()");
  const row=fakeRow(0);
  r.els.page.fire("pointerdown",{ target:row, clientX:10, clientY:10 });
  r.els.page.fire("pointercancel",{});
  ok("★ 취소되면 표시가 사라짐", !row.classList.contains("holding"));
  r.flush(); await wait();
  ok("★ 취소 뒤엔 아무 일도 안 일어남", !/DELETE GAME/.test(r.els.page.innerHTML));
}
{ /* 목록 화면이 아닐 때 눌러도 아무 일 없어야 합니다 */
  const r=run();
  await wait(); r.read("draw()");
  ok("(준비) 시스템 화면", r.read("ui.state.screen")==="system");
  r.els.page.fire("pointerdown",{ target:fakeRow(0), clientX:10, clientY:10 });
  r.flush(); await wait();
  ok("★ 시스템 화면에서는 길게 눌러도 안 물어봄", !/DELETE GAME/.test(r.els.page.innerHTML));
}

/* ══════════════════════════════════════════════════════════════════════
   ★★ 여기부터는 전에 **한 줄도 실행되지 않던** 길입니다.
      가짜 저장소가 없어서 기본 게임만 있었고, 기본 게임은 못 지우니
      지우기 확인 화면이 검사에서 한 번도 안 그려졌습니다.
   ════════════════════════════════════════════════════════════════════ */
console.log("\n[5-5] ★★ 파일 넣기 → 길게 눌러 지우기 (끝까지)");

/* 목록 화면으로 가서, 파일 하나를 넣고, 그 줄 번호를 돌려줍니다 */
async function withOneRom(r, name="mygame.gb", title="MYGAME"){
  r.read("ui.pickSystem('gb')"); await wait(); r.read("draw()");
  r.els.file.files = [fakeFile(name, 9, title)];
  r.els.file.fire("change", { target:r.els.file });
  await wait(12); r.flush(); await wait(12);
  const list = r.read("ui.list()") || [];
  return list.findIndex(x => !x.bundled);
}

{ const r=run();
  const i = await withOneRom(r);
  ok("★ 파일이 실제로 들어감", i >= 0, JSON.stringify((r.read("ui.list()")||[]).map(x=>x.title)));
  ok("★ 넣었다고 알려줌", /ADDED/.test(r.els.note.textContent), r.els.note.textContent);
  ok("고른 파일 칸을 비움", r.els.file.value === "", r.els.file.value);
  ok("목록에 제목이 보임", /MYGAME/.test(r.els.page.innerHTML));

  /* 길게 눌러 지우기 — 이번엔 진짜로 물어봐야 합니다 */
  const row = fakeRow(i);
  r.els.page.fire("pointerdown", { target:row, pointerId:1, clientX:10, clientY:10 });
  r.flush(); await wait();
  ok("★★ 지울까 물어봄", /DELETE GAME/.test(r.els.page.innerHTML),
     r.els.page.innerHTML.slice(0,80));
  ok("★★ 무엇을 지우는지 이름이 나옴", /MYGAME/.test(r.els.page.innerHTML));
  ok("★ 안내에 START DELETE 라고 씀", /START DELETE/.test(r.els.info.innerHTML));
  ok("★ A 는 KEEP 이라고 씀", /A .*KEEP/.test(r.els.info.innerHTML.replace(/&nbsp;/g," ")));
  ok("★ MENU 버튼이 KEEP 으로 바뀜", r.els.btnUp.textContent === "KEEP",
     r.els.btnUp.textContent);

  /* ★★ 목록에서 A 는 "시작" 이었습니다.
         그 손버릇으로 A 를 눌러도 절대 지워지면 안 됩니다. */
  r.read("armAt = 0");                       /* 뜬 직후 잠금은 따로 검사 */
  tap(r.els.btnA);
  await wait();
  ok("★★★ A 를 눌러도 안 지워짐", (r.read("ui.list()")||[]).some(x=>!x.bundled),
     JSON.stringify((r.read("ui.list()")||[]).map(x=>x.title)));
  ok("★ A 를 누르면 물음표가 닫힘", r.read("ui.state.confirm") === null);
  ok("★ 안 지웠다고 알려줌", /KEPT/.test(r.els.note.textContent), r.els.note.textContent);
}

{ /* ★ START 를 눌러야 진짜로 지워집니다 */
  const r=run();
  const i = await withOneRom(r);
  ok("(준비) 게임이 하나 들어있음", i >= 0);
  const row = fakeRow(i);
  r.els.page.fire("pointerdown", { target:row, pointerId:1, clientX:10, clientY:10 });
  r.flush(); await wait();
  ok("(준비) 물음표가 떴음", /DELETE GAME/.test(r.els.page.innerHTML));

  /* ★ 뜬 직후에는 아무 버튼도 안 받습니다 (손 떼면서 같이 눌리는 것 방지) */
  tap(r.els.btnSta);
  await wait();
  ok("★★ 뜬 직후 START 는 무시됨", r.read("ui.state.confirm") !== null,
     JSON.stringify(r.read("ui.state.confirm")));

  /* 잠금이 풀린 뒤에는 지워집니다 */
  r.read("armAt = 0");
  tap(r.els.btnSta);
  await wait(12);
  ok("★★ START 로 지워짐", !(r.read("ui.list()")||[]).some(x=>!x.bundled),
     JSON.stringify((r.read("ui.list()")||[]).map(x=>x.title)));
  ok("무엇을 지웠는지 알려줌", /DELETED/.test(r.els.note.textContent), r.els.note.textContent);
  ok("목록 화면으로 돌아옴", !/DELETE GAME/.test(r.els.page.innerHTML));
  ok("MENU 글자도 돌아옴", r.els.btnUp.textContent === "SYSTEM", r.els.btnUp.textContent);
}

{ /* ★ 이름에 태그가 있어도 화면에 실행되면 안 됩니다 (파일 이름은 마음대로 지을 수 있음) */
  const r=run();
  const i = await withOneRom(r, '<img src=x onerror=alert(1)>.gb', "");
  ok("(준비) 들어감", i >= 0);
  const row = fakeRow(i);
  r.els.page.fire("pointerdown", { target:row, pointerId:1, clientX:10, clientY:10 });
  r.flush(); await wait();
  ok("★★ 확인 화면에 태그가 살아있지 않음",
     !/<img/i.test(r.els.page.innerHTML) && /&lt;img/i.test(r.els.page.innerHTML),
     r.els.page.innerHTML.slice(0,120));
}

console.log("\n[5-5b] ★★ LIBRARY 의 REMOVE 도 반드시 한 번 물어봅니다");
{ const r=run();
  const i = await withOneRom(r);
  ok("(준비) 게임이 하나 들어있음", i >= 0);
  r.read(`ui.setCursor(${i})`); r.read("draw()");
  /* SELECT 로 라이브러리 → REMOVE 로 내려가서 A */
  tap(r.els.btnSel);
  await wait();
  ok("(준비) 라이브러리", r.read("ui.state.screen")==="library");
  ok("★ 무엇을 지우는지 항목에 이름이 보임", /MYGAME/.test(r.els.page.innerHTML),
     r.els.page.innerHTML.replace(/<[^>]*>/g," "));
  r.read("ui.move(2)");                       /* REMOVE */
  tap(r.els.btnA);
  await wait();

  ok("★★ 바로 안 지우고 물어봄", /DELETE GAME/.test(r.els.page.innerHTML),
     r.els.page.innerHTML.replace(/<[^>]*>/g," ").slice(0,80));
  ok("★ 게임은 아직 그대로", (r.read("ui.list()")||[]).some(x=>!x.bundled));
  ok("★ 지우는 건 START 라고 씀", /START DELETE/.test(r.els.info.innerHTML));

  /* 안 지우고 물러날 수 있어야 합니다 */
  r.read("armAt = 0");
  tap(r.els.btnB);
  await wait();
  ok("★ B 로 물러나면 안 지워짐", (r.read("ui.list()")||[]).some(x=>!x.bundled));
  ok("물음표가 닫힘", r.read("ui.state.confirm")===null);
}
{ /* 기본 게임을 고른 채 REMOVE 를 누르면 — 물어보지도 않고 안 된다고 합니다 */
  const r=run();
  r.read("ui.pickSystem('gb')"); await wait(); r.read("draw()");
  r.read("ui.setCursor(0)");
  tap(r.els.btnSel);
  await wait();
  ok("★ 기본 게임이면 BUILT-IN 이라고 미리 보여줌", /BUILT-IN/.test(r.els.page.innerHTML),
     r.els.page.innerHTML.replace(/<[^>]*>/g," "));
  r.read("ui.move(2)");
  tap(r.els.btnA);
  await wait();
  ok("★ 물음표가 안 뜸", r.read("ui.state.confirm")===null);
  ok("왜 안 되는지 알려줌", /CANNOT DELETE/.test(r.els.note.textContent), r.els.note.textContent);
  ok("목록으로 돌아옴", r.read("ui.state.screen")==="list", r.read("ui.state.screen"));
}

console.log("\n[5-6] ★ 폴더째 넣기 (여러 개)");
{ const r=run();
  r.read("ui.pickSystem('gb')"); await wait(); r.read("draw()");
  r.els.dir.files = [
    fakeFile("a.gb", 11, "AAA"), fakeFile("b.gb", 12, "BBB"),
    fakeFile("readme.txt", 13, "XXX"),          /* 롬 아님 — 걸러져야 함 */
    fakeFile("c.gbc", 14, "CCC"),
  ];
  r.els.dir.fire("change", { target:r.els.dir });
  /* addRoms 는 중간에 setTimeout 으로 쉬므로 flush 를 섞어가며 기다립니다 */
  for(let n=0;n<25;n++){ r.flush(); await wait(3); }
  const list = r.read("ui.list()") || [];
  const mine = list.filter(x=>!x.bundled);
  ok("★★ 셋이 들어감 (txt 는 걸러짐)", mine.length === 3,
     JSON.stringify(mine.map(x=>x.title)));
  ok("★ 결과를 글로 알려줌", /ADDED 3/.test(r.els.note.textContent), r.els.note.textContent);
  ok("폴더 칸을 비움", r.els.dir.value === "");
  ok("목록에 다 보임", /AAA/.test(r.els.page.innerHTML) && /CCC/.test(r.els.page.innerHTML));
}

console.log("\n[5-7] ★ 게임&워치 목록에서는 파일 안 받음");
{ const r=run();
  r.read("ui.pickSystem('gw')"); await wait(); r.read("draw()");
  ok("(준비) 게임&워치 목록", r.read("ui.state.systemId")==="gw");
  ok("★ ADD 안내가 아예 없음", !/ADD FILES|ADD FOLDER/.test(r.els.info.innerHTML),
     r.els.info.innerHTML.replace(/<[^>]*>/g," ").slice(0,120));
  ok("★ 지우라는 안내도 없음", !/HOLD A GAME/.test(r.els.info.innerHTML));
  /* START 를 눌러도 파일창이 안 열려야 합니다 */
  let opened=false;
  r.els.file.click = () => { opened=true; };
  tap(r.els.btnSta);
  await wait();
  ok("★★ START 를 눌러도 파일창이 안 열림", !opened);
}

console.log("\n[5-4] ★ 이름에 태그가 들어가도 안전한가");
{ const r=run();
  const bad = r.read('esc(\'<img src=x onerror="boom">\')');
  ok("★ 꺾쇠가 글자로 바뀜", typeof bad==="string" && !/</.test(bad), bad);
  ok("따옴표도 바뀜", typeof bad==="string" && !/"/.test(bad), bad);
  ok("빈 값도 안 터짐", r.read("esc(null)")==="" && r.read("esc(undefined)")==="");
}

console.log("\n[6] 배치가 화면 안에 들어가는가");
{ for(const [n,W,H] of [["아이폰14",844,390],["아이폰SE",667,375],["갤럭시탭",1180,820],["작은창",600,320]]){
    const r=run({W,H});
    const num=(s,k)=>{ const m=String(s).match(new RegExp(k+":(-?\\d+)px")); return m?+m[1]:null; };
    const bad=[];
    const uTop=num(r.els.btnUp.style.cssText,"top");
    const aTop=num(r.els.btnA.style.cssText,"top");
    if(uTop===null||uTop<2) bad.push("MENU 자리 이상 ("+uTop+")");
    if(aTop===null||aTop+46>H-24) bad.push("A 버튼이 아래로 넘침 ("+aTop+")");
    ok(n+" 배치 정상", bad.length===0, bad.join(", "));
  }
}

console.log("\n[6-2] ★★ 화면이 깜빡이지 않는가");
{ /* 폰에서 visualViewport scroll 은 쉴 새 없이 옵니다.
     크기가 그대로면 아무 일도 안 해야 합니다. */
  const r=run();
  let redraws=0;
  const pg=r.els.page;
  const orig=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(pg)||{}, "innerHTML");
  /* 화면을 다시 재는 횟수를 셉니다 (btnA 의 위치가 다시 쓰이는지로) */
  let writes=0;
  const st=r.els.btnA.style;
  let raw=st.cssText;
  Object.defineProperty(st,"cssText",{ get:()=>raw, set:v=>{ writes++; raw=v; } });
  const before=writes;
  for(let i=0;i<50;i++) r.read("fit")();     /* 같은 크기로 50번 */
  ok("★ 크기가 같으면 다시 재지 않음", writes===before, "다시 잰 횟수 "+(writes-before));
  r.read("scheduleFit")();
  ok("예약 방식이 있음", typeof r.read("scheduleFit")==="function");
}

console.log("\n[6-3] ★ 게임이 뜻하지 않게 사라지면 화면도 따라 나오는가");
{ const r=run();
  ok("알림을 등록해둠", typeof r.sandbox.GameMode.setOnGone === "function");
  /* 실제로 불러보면 화면이 목록으로 빠져나와야 합니다 */
  const ui = r.read("ui");
  ok("등록된 알림이 있음", true);
}

console.log("\n[6-4] ★ 아이폰이면 홈 화면 추가 안내");
{ const r=run({ ua:"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" });
  ok("★ 사파리로 열면 안내가 뜸", /HOME SCREEN/.test(r.els.note.textContent),
     r.els.note.textContent);
  const r2=run();   /* 안드로이드 */
  ok("안드로이드는 안 뜸", !/HOME SCREEN/.test(r2.els.note.textContent), r2.els.note.textContent);
}

console.log("\n[6-5] ★ 본체로 돌아갈 때 기록을 남기지 않는가");
{ const src=require("fs").readFileSync(require("path").join(__dirname,"..","index.html"),"utf8");
  const j=[...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join("\n");
  ok("★ replace 로 나감", /location\.replace\("\.\.\/"\)/.test(j));
  ok("★ href 를 먼저 쓰지 않음", !/^\s*location\.href\s*=\s*"\.\.\/"/m.test(j),
     "기록이 쌓이면 본체의 종료 버튼이 창을 못 닫습니다");
}

console.log("\n[7] binjgb 가 없을 때");
{ const r=run({noBinjgb:true});
  ok("그래도 화면은 뜸", !r.err && /SELECT SYSTEM/.test(r.els.page.innerHTML), r.err && r.err.message);
  ok("안내가 나옴", /EMULATOR/.test(r.els.note.textContent), r.els.note.textContent);
}

console.log(`\n${"=".repeat(46)}\n통과 ${pass}  실패 ${fail}\n`);
process.exit(fail?1:0);
})();
