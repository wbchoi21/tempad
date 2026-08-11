/* ============================================================================
   game/index.html 안의 코드를 진짜로 실행해봅니다. (v2)

   문법 검사만으로는 draw() 가 터지는지, 버튼이 제대로 연결됐는지,
   없는 id 를 부르는지 알 수 없습니다. 그래서 가짜 DOM 을 만들어
   **진짜 코드를 그대로 돌립니다.**

   ★★ v2 에서 새로 보는 것 ★★
     · 구석 존(MENU/CLR/PAD)이 pointerup 으로 동작하는가
       — click 을 쓰면 아이폰에서 안 눌릴 수 있습니다 (인계서 12장 B-2)
     · 목록·메뉴가 손가락 탭으로 움직이는가
     · 지우기 확인이 화면 버튼으로 되는가
     · 게임패드 SELECT+L+R 조합이 메뉴를 여는가
     · 배치 공식이 시스템·조작판 상태에 따라 달라지는가
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
/* GBA 롬 — 0xB2 의 고정값 0x96 **과 닌텐도 로고**로 알아봅니다.
   ★ 0x96 한 바이트만으로는 이제 안 통합니다 (아무 파일이나 GBA 로 등록되던
     구멍을 막았습니다). 로고는 진짜 GBA 롬에서 떠온 것입니다. */
const GBA_LOGO=[
  0x24,0xFF,0xAE,0x51,0x69,0x9A,0xA2,0x21,0x3D,0x84,0x82,0x0A,0x84,0xE4,0x09,0xAD,
  0x11,0x24,0x8B,0x98,0xC0,0x81,0x7F,0x21,0xA3,0x52,0xBE,0x19,0x93,0x09,0xCE,0x20];
function makeGbaRom(seed=1){
  const b=new Uint8Array(0x20000);
  b[0xB2]=0x96;
  GBA_LOGO.forEach((v,i)=>b[0x04+i]=v);
  b[0x200]=seed;
  return b;
}
/* 파일 고르기 흉내 — input.files 에 넣을 것 */
function fakeFile(name, seed, title){
  const b=makeRom(seed, title===undefined ? "MYGAME" : title);
  return { name, size:b.length, _bytes:b };
}
function fakeGbaFile(name, seed){
  const b=makeGbaRom(seed);
  return { name, size:b.length, _bytes:b };
}
let pass=0,fail=0;
const ok=(n,c,x)=>{ if(c){pass++;console.log("  OK   "+n);} else {fail++;console.log("  ★실패 "+n+(x!==undefined?"  → "+x:""));} };

const html=fs.readFileSync(path.join(D,"index.html"),"utf8");
const pageJs=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join("\n");
const ids=[...new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m=>m[1]))];

function mkClassList(){
  return { _s:new Set(),
    add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
    contains(c){return this._s.has(c);},
    /* ★ v2 가 씁니다 (dev.classList.toggle("hidepad", ...)) */
    toggle(c,on){ if(on===undefined) on=!this._s.has(c);
                  if(on) this._s.add(c); else this._s.delete(c); return on; } };
}

function makeEl(id){
  const el={
    id, style:{ cssText:"", setProperty(){}, },
    classList: mkClassList(),
    dataset:{}, _html:"", textContent:"", value:"", files:[], listeners:{},
    /* 진짜 <input> 에는 이 속성이 있습니다. 폴더 고르기가 되는지 볼 때 씁니다. */
    webkitdirectory:false,
    get innerHTML(){ return this._html; },
    set innerHTML(v){ this._html=v; },
    addEventListener(t,f){ (this.listeners[t]=this.listeners[t]||[]).push(f); },
    removeEventListener(){}, click(){ this._clicked=(this._clicked||0)+1; this.fire("click"); },
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

/* ★ 목록·메뉴의 한 줄을 흉내냅니다. 진짜 DOM 이 없어서 closest 를 손으로 만듭니다.
     index.html 의 hit() 이 "[data-act]" "[data-i]" 같은 걸로 찾으므로,
     dataset 에 그 이름이 있으면 자기 자신을 돌려줍니다. */
function node(dataset){
  const n={ dataset: dataset||{}, classList: mkClassList() };
  n.closest = sel => {
    const m = String(sel).match(/\[data-([\w-]+)\]/);
    if(!m) return null;
    const key = m[1].replace(/-(\w)/g,(_,c)=>c.toUpperCase());
    return (key in n.dataset) ? n : null;
  };
  return n;
}
/* ★★ 줄 **안쪽**을 누른 상황. 진짜 화면에서는 손가락이 줄 자체가 아니라
     그 안의 제목 글자(<div class="t">…</div>)에 닿습니다. 그때 closest 가
     부모로 거슬러 올라가 줄을 찾아야 합니다.
     예전 가짜는 부모로 안 올라가서, **이 경로를 한 번도 안 지났습니다.**
     그래서 hit() 에서 closest 를 없애도 검사가 전부 통과했습니다.
     (2026-08-11 교차검사에서 실증해서 넣었습니다.) */
function inner(parent){
  const n={ dataset:{}, classList: mkClassList(), parentNode: parent };
  n.closest = sel => parent.closest(sel);
  return n;
}

/* 샌드박스의 setTimeout 은 가짜(모아뒀다 flush)라, 진짜가 필요한 곳에 씁니다 */
const realTimeout = setTimeout;

function run(opts={}){
  const els={}; ids.forEach(i=>els[i]=makeEl(i));
  const store=new Map(opts.prefill||[]);
  const timers=[];
  const rafQ=[];
  const pads=[];
  /* ★ this 를 안 쓰고 여기에 모읍니다. vm 안에서 부르면 this 가
       샌드박스가 아니라 대리자라, this._l 로 모으면 검사에서 못 찾습니다. */
  const winL={};
  const docL={};
  const sandbox={
    console,
    document:{
      getElementById:i=>els[i]||null,
      /* ★ <script> 를 만들면 진짜 브라우저처럼 성공/실패를 알려줍니다.
           안 그러면 mgba.js 를 부르는 곳이 **영영 안 끝나는 약속**을
           기다리며 조용히 멈춥니다. */
      createElement:(tag)=>{
        const e=makeEl("tmp");
        if(String(tag).toLowerCase()==="script"){
          let src="";
          Object.defineProperty(e,"src",{ get:()=>src, set(v){ src=v;
            /* 호스트의 진짜 setTimeout 을 씁니다 (샌드박스 것은 가짜라 안 터집니다) */
            realTimeout(()=>{ if(opts.mgba && e.onload) e.onload();
                              else if(e.onerror) e.onerror(); },0); } });
        }
        return e;
      },
      body:{ appendChild(){}, },
      documentElement:{ clientWidth:opts.W||844, clientHeight:opts.H||390,
                        style:{ setProperty(){}, } },
      addEventListener(t,f){ (docL[t]=docL[t]||[]).push(f); },
      visibilityState:"visible",
      querySelectorAll:()=>[],
    },
    window:null,
    localStorage:{ getItem:k=>store.has(k)?store.get(k):null,
                   setItem:(k,v)=>store.set(k,String(v)) },
    matchMedia:()=>({ matches:!!opts.coarse }),
    navigator:{ userAgent: opts.ua || "Mozilla/5.0 (Linux; Android 13)", standalone:false,
                getGamepads:()=>pads, vibrate(){}, maxTouchPoints: opts.touch||0 },
    getComputedStyle:()=>({ top:"0px",left:"0px",bottom:"0px",right:"0px",fontSize:"13px" }),
    /* ★ 그림 프레임도 적어뒀다가 검사에서 직접 돌립니다.
         전에는 절대 안 불려서, 프레임마다 도는 코드(게임패드 읽기 등)가
         한 줄도 실행되지 않았습니다. */
    requestAnimationFrame:(f)=>{ rafQ.push(f); return rafQ.length; },
    cancelAnimationFrame:(h)=>{ if(rafQ[h-1]) rafQ[h-1]=null; },
    /* ★ 이게 없으면 게임 시작이 조용히 실패합니다 (한참 못 찾았습니다) */
    setInterval:()=>1, clearInterval(){},
    /* ★ 예전에는 빈 함수라 window 에 붙인 손이 전부 사라졌습니다.
         그래서 "게임패드가 꽂혔다" 같은 알림을 검사에서 쏠 수가 없었습니다. */
    addEventListener:(t,f)=>{ (winL[t]=winL[t]||[]).push(f); },
    /* ★ 예전에는 setTimeout 이 아무것도 안 하고 0 만 돌려줬습니다.
         그러면 "길게 누르기" 같은 코드가 **영원히 오지 않는 약속을
         기다리며** 조용히 멈춥니다. 이제는 적어뒀다가 flush() 로 터뜨립니다. */
    setTimeout:(f,ms)=>{ timers.push({f,ms:ms||0,dead:false}); return timers.length; },
    clearTimeout:(h)=>{ const t=timers[h-1]; if(t) t.dead=true; },
    fetch:async()=>({ ok:true, arrayBuffer:async()=>makeRom(200,"BUNDLED").buffer }),
    location:{ href:"", replace(u){ this.href=u; this._replaced=(this._replaced||0)+1; } },
    AudioContext:function(){ return { sampleRate:48000, resume(){}, suspend(){}, currentTime:0,
      createBuffer:(c,n)=>({getChannelData:()=>new Float32Array(n)}),
      createBufferSource:()=>({connect(){},start(){}}) }; },
    /* ★★ 가짜 binjgb 모듈. ★★
         v1 검사는 빈 객체({})를 줬습니다. 그러면 Session 만드는 첫 줄
         (_malloc)에서 터져서 **게임을 켜는 길이 검사에서 한 번도 안 돌았습니다.**
         메뉴·저장칸·컬러토글이 전부 그 뒤에 있으니 통째로 안 본 셈입니다.
         그래서 진짜 binjgb 가 내주는 함수들을 흉내 냅니다.
         (아래 __mkBinjgb 를 샌드박스 안에서 만듭니다 — 메모리 버퍼가
          샌드박스 것이어야 Uint8Array 가 얹힙니다.) */
    Binjgb: opts.noBinjgb ? undefined : (async()=>vm.runInContext("__mkBinjgb()", sandbox)),
    /* ★ 진짜 게임보이 롬처럼 닌텐도 로고를 넣어줍니다.
         전에는 0 으로 채운 버퍼라 판별기가 무조건 거절했고,
         그래서 "파일을 넣는다" 는 길이 검사에서 한 번도 안 돌았습니다. */
    FileReader:function(){
      this.readAsArrayBuffer=(f)=>{
        const b=new Uint8Array((f && f._bytes) || makeRom());
        this.onloadend({target:{result:b.buffer}});
      };
    },
    /* ★★ 전에는 indexedDB 를 아예 막아뒀습니다(undefined).
           그러면 기본 게임만 보이고, 기본 게임은 못 지우므로
           **지우기 확인 화면이 검사에서 한 번도 안 그려졌습니다.** */
    indexedDB: opts.noDb ? undefined : makeIDB(),
    Uint8Array, Uint8ClampedArray, Math, JSON, Promise, Number, String, Object, Array,
    Date, Error, isFinite, Set, Map, RegExp, Boolean,
  };
  sandbox.window=sandbox;
  sandbox.globalThis=sandbox;
  if(opts.mgba) sandbox.MgbaCore = { load: async()=>({core:"mgba"}) };
  vm.createContext(sandbox);
  /* 부품들을 먼저 넣습니다 (실제 <script src> 순서와 같게) */
  for(const f of ["game.js","ui.js","pad.js"])
    vm.runInContext(fs.readFileSync(path.join(D,f),"utf8"), sandbox, {filename:f});
  /* 가짜 에뮬레이터 알맹이 — 샌드박스 안에서 만듭니다 */
  vm.runInContext(`
    globalThis.__mkBinjgb = function(){
      var heap = new ArrayBuffer(1<<20);
      var next = 16;
      var m = {
        HEAP8: new Int8Array(heap),
        _malloc: function(n){ var p=next; next += (n+15)&~15; return p; },
        _free: function(){ m._freed=(m._freed||0)+1; },
        _emulator_new_simple: function(){ return 1000; },
        _joypad_new: function(){ return 2000; },
        _rewind_new_simple: function(){ return 3000; },
        _emulator_set_default_joypad_callback: function(){},
        _get_frame_buffer_ptr: function(){ return 0x10000; },
        _get_frame_buffer_size: function(){ return 160*144*4; },
        _get_audio_buffer_ptr: function(){ return 0x40000; },
        _get_audio_buffer_capacity: function(){ return 4096*2; },
        _emulator_get_ticks_f64: function(){ return 0; },
        /* 1 = 새 그림, 4 = 여기까지 돌았음 → 한 바퀴에 확실히 빠져나옵니다 */
        _emulator_run_until_f64: function(){ return 1|4; },
        _rewind_append: function(){},
        _emulator_was_ext_ram_updated: function(){ return 0; },
        _state_file_data_new: function(){ return 0x50000; },
        _ext_ram_file_data_new: function(){ return 0x60000; },
        _get_file_data_ptr: function(p){ return p+16; },
        _get_file_data_size: function(){ return 64; },
        _emulator_write_state: function(){}, _emulator_read_state: function(){ return 0; },
        _emulator_write_ext_ram: function(){}, _emulator_read_ext_ram: function(){},
        _file_data_delete: function(){ m._deleted=(m._deleted||0)+1; },
        _emulator_delete: function(){}, _rewind_delete: function(){}, _joypad_delete: function(){}
      };
      ["A","B","up","down","left","right","select","start"].forEach(function(n){
        m["_set_joyp_"+n] = function(){ (m._keys=m._keys||[]).push(n); };
      });
      return m;
    };
  `, sandbox, {filename:"fake-binjgb"});
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
  /* 한 프레임 돌립니다 (게임패드 읽기가 여기서 돕니다) */
  const frame = (n=1) => {
    for(let k=0;k<n;k++){
      const q=rafQ.slice(); rafQ.length=0;
      for(const f of q){ if(f) try{ f(); }catch(e){} }
    }
  };
  const emit = (t,ev) => (winL[t]||[]).forEach(f=>f(ev||{}));
  const emitDoc = (t,ev) => (docL[t]||[]).forEach(f=>f(ev||{}));
  return { sandbox, els, err, read, timers, flush, pads, frame, winL, docL, emit, emitDoc, store };
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
/* #page 안의 줄·버튼을 손가락으로 누르기 */
function tapNode(page, n, opt={}){
  const id = ++tapId;
  const ev = t => ({ preventDefault(){}, pointerId:id, target:n,
                     clientX:opt.x||0, clientY:opt.y||0 });
  page.fire("pointerdown", ev());
  if(opt.hold) return id;               /* 떼지 않고 붙들고 있기 */
  page.fire("pointerup", ev());
  return id;
}

/* ★ 가짜 저장소(IndexedDB)가 진짜처럼 여러 번 쉬었다 갑니다.
     짧게 기다리면 **목록이 아직 안 온 채로** 검사하게 되어,
     제품은 멀쩡한데 검사만 실패합니다. 실제로 여기서 한 번 헛짚었습니다. */
const wait = async (n=25) => { for(let i=0;i<n;i++) await new Promise(r=>setTimeout(r,1)); };
/* 화면 상태를 읽습니다 */
const S = r => r.read("ui.state");

(async () => {

console.log("\n[1] 화면이 뜨는가");
{ const r=run();
  ok("코드가 끝까지 돔", !r.err, r.err && (r.err.message+" @ "+(r.err.stack||"").split("\n")[1]));
  ok("ui 가 만들어짐", !!r.read("ui"));
  ok("십자키가 붙음", !!r.read("pad"));
  await wait();
  ok("첫 화면이 그려짐", /SELECT SYSTEM/.test(r.els.page.innerHTML), r.els.page.innerHTML.slice(0,60));
  ok("오른쪽 안내글도 그려짐", /FIELD UNIT/.test(r.els.info.innerHTML));
  ok("★ 시스템 셋이 다 보임",
     /GAME BOY<|GAME BOY COLOR|GAME BOY ADVANCE/.test(r.els.page.innerHTML)
     && /ADVANCE/.test(r.els.page.innerHTML), r.els.page.innerHTML.slice(0,200));
  ok("★ 게임&워치는 흔적도 없음", !/WATCH/i.test(r.els.page.innerHTML+r.els.info.innerHTML));
}

console.log("\n[2] ★★ 없는 id 를 부르지 않는가");
{ /* exitFull() 이 아예 없는데 try{}catch 안에서 조용히 실패해
     전체화면이 영영 안 풀린 적이 있습니다. 그 뒤로 상설 검사입니다. */
  const used=[...new Set([...pageJs.matchAll(/\$\("([\w-]+)"\)/g)].map(m=>m[1]))];
  const missing=used.filter(i=>!ids.includes(i));
  ok("★ $() 로 부르는 id 가 전부 실제로 있음", missing.length===0, missing.join(","));
  ok("(참고) 쓰는 id 개수", used.length>10, used.length);
}

console.log("\n[3] ★★ 구석 존 — 게임 중 유일한 탈출구");
{ const r=run(); await wait();
  ok("★ MENU/CLR/PAD 세 버튼이 다 있음",
     !!r.els.zMain && !!r.els.zClr && !!r.els.zPad);
  ok("시스템 화면에서는 EXIT", r.els.zMain.textContent==="EXIT", r.els.zMain.textContent);

  /* 목록으로 들어갔다가 */
  tapNode(r.els.page, node({s:"gb"})); await wait();
  ok("목록으로 들어감", S(r).screen==="list", S(r).screen);
  ok("구석 버튼이 BACK 으로 바뀜", r.els.zMain.textContent==="BACK", r.els.zMain.textContent);
  tap(r.els.zMain); await wait();
  ok("★ 눌러서 시스템 화면으로 돌아옴", S(r).screen==="system", S(r).screen);
}

console.log("\n[3-2] ★★★ 버튼이 click 이 아니라 pointerup 으로 동작하는가");
{ /* 인계서 12장 B-2 — "제일 위험한 미확인 항목".
     v1 은 pointerdown 에서 preventDefault 한 뒤 click 을 기다렸습니다.
     아이폰 사파리가 click 을 안 보내면 게임에서 못 나옵니다.
     v2 는 click 을 아예 안 씁니다. 그걸 여기서 못박습니다. */
  const r=run(); await wait();
  ok("★★ zMain 에 click 을 듣는 곳이 없음",
     !(r.els.zMain.listeners["click"] || []).length,
     (r.els.zMain.listeners["click"]||[]).length);
  ok("★★ pointerdown/pointerup 을 듣고 있음",
     (r.els.zMain.listeners["pointerdown"]||[]).length>0
     && (r.els.zMain.listeners["pointerup"]||[]).length>0);
  ok("★ 취소도 듣고 있음 (전화가 오면)",
     (r.els.zMain.listeners["pointercancel"]||[]).length>0);

  /* click 을 한 번도 안 쓰고 실제로 화면이 넘어가야 합니다 */
  tapNode(r.els.page, node({s:"gb"})); await wait();
  const before=S(r).screen;
  tap(r.els.zMain); await wait();
  ok("★★ click 없이 실제로 동작함", before==="list" && S(r).screen==="system", before+"→"+S(r).screen);

  /* 소스에 click 리스너 자체가 없어야 합니다 */
  ok("★★ 소스에 addEventListener(\"click\") 이 없음",
     !/addEventListener\(\s*["']click["']/.test(pageJs));

  /* 눌렀다가 손가락이 밖으로 나가면 실행되면 안 됩니다 */
  const r2=run(); await wait();
  const scr=S(r2).screen;
  r2.els.zMain.fire("pointerdown",{preventDefault(){},pointerId:7});
  r2.els.zMain.fire("pointerleave",{});
  r2.els.zMain.fire("pointerup",{preventDefault(){},pointerId:7});
  await wait();
  ok("★ 밖으로 나갔다 떼면 아무 일 없음", S(r2).screen===scr, S(r2).screen);
}

console.log("\n[4] ★★ 목록을 손가락으로 (첫 탭 = 고르기, 재탭 = 시작)");
{ const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  /* ★ 기본 게임 5개 중 GB 목록에 뜨는 것은 3개 (2개는 컬러 겸용이라 GBC 목록) */
  ok("(준비) 목록", S(r).screen==="list" && S(r).count===3, S(r).count);
  ok("★ 넣기 버튼이 보임", /\+ ADD GAME/.test(r.els.page.innerHTML));

  /* ★ 줄 **안쪽**(제목 글자)을 누릅니다 — 진짜 손가락이 닿는 자리입니다 */
  tapNode(r.els.page, inner(node({i:"2"}))); await wait();
  ok("★★ 줄 안쪽을 눌러도 그 줄로 인식됨", S(r).cursor===2 && S(r).screen==="list", S(r).cursor);
  tapNode(r.els.page, node({i:"2"})); await wait();
  ok("★★ 같은 줄 재탭이면 게임이 켜짐", S(r).screen==="play", S(r).screen);
  ok("에뮬이 돌고 있음", S(r).running);
  ok("★ 게임 중에는 목록이 숨겨짐", r.els.page.style.display==="none", r.els.page.style.display);
  ok("★ 게임 화면이 보임", r.els.screen.style.visibility==="visible");
  ok("구석 버튼이 MENU", r.els.zMain.textContent==="MENU", r.els.zMain.textContent);
}

console.log("\n[5] ★★ 길게 눌러 지우기 → 화면 버튼으로 확인");
{ const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  /* 지울 수 있는 롬을 하나 넣습니다 */
  /* ★ 제목은 롬 헤더에서 옵니다 (파일 이름이 아니라). 헤더에 MINE 을 넣습니다. */
  r.els.file.files=[fakeFile("MINE.gb",42,"MINE")];
  r.els.file.fire("change",{target:r.els.file}); await wait();
  ok("(준비) 롬이 들어감", S(r).count===4, S(r).count);
  const mine=r.read("ui.list().findIndex(x=>!x.bundled)");
  ok("(준비) 내 롬 자리를 찾음", mine>=0, mine);

  /* 길게 누릅니다 */
  const n=node({i:String(mine)});
  tapNode(r.els.page, n, {hold:true});
  ok("★ 누르는 동안 막대가 참", n.classList.contains("holding"));
  r.flush(); await wait();
  ok("★★ 확인창이 뜸", S(r).confirm && S(r).confirm.title==="MINE",
     S(r).confirm && S(r).confirm.title);
  ok("★ 화면에 DELETE 와 KEEP 버튼이 그려짐",
     /data-ask="keep"/.test(r.els.page.innerHTML) && /data-ask="del"/.test(r.els.page.innerHTML));
  ok("★ 되돌릴 수 없다고 경고함", /FOREVER/.test(r.els.page.innerHTML));
  ok("★★ START 로 지우라는 옛 안내가 없음", !/PRESS START/i.test(r.els.page.innerHTML));

  /* ★ 창이 막 떴을 때는 안 눌려야 합니다 (ARM_MS) */
  tapNode(r.els.page, node({ask:"del"})); await wait();
  ok("★★ 뜨자마자 누른 건 안 먹힘 (실수 방지)", S(r).confirm!==null);
  ok("아직 안 지워짐", S(r).count===4, S(r).count);

  /* 시간이 지난 뒤 KEEP */
  r.read("armAt = 0");
  tapNode(r.els.page, node({ask:"keep"})); await wait();
  ok("★ KEEP 을 누르면 안 지워짐", S(r).confirm===null && S(r).count===4, S(r).count);
  ok("KEPT 라고 알려줌", /KEPT/.test(S(r).notice), S(r).notice);

  /* 다시 띄워서 DELETE */
  const n2=node({i:String(mine)});
  tapNode(r.els.page, n2, {hold:true});
  r.flush(); await wait();
  ok("(준비) 다시 뜸", S(r).confirm!==null);
  r.read("armAt = 0");
  tapNode(r.els.page, node({ask:"del"})); await wait();
  ok("★★ DELETE 를 눌러야 지워짐", S(r).count===3, S(r).count);
  ok("이름을 넣어 알려줌", /DELETED/.test(S(r).notice), S(r).notice);
}

console.log("\n[5-2] ★ 기본 게임은 길게 눌러도 안 지워짐");
{ const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  const n=node({i:"0"});
  tapNode(r.els.page, n, {hold:true});
  r.flush(); await wait();
  ok("★ 확인창이 안 뜸", S(r).confirm===null);
  ok("이유를 알려줌", /BUILT-IN/.test(S(r).notice), S(r).notice);
}

console.log("\n[5-3] ★ 손가락이 움직이면 지우기가 취소됨 (스크롤하려던 것)");
{ const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  r.els.file.files=[fakeFile("MINE.gb",43)];
  r.els.file.fire("change",{target:r.els.file}); await wait();
  const mine=r.read("ui.list().findIndex(x=>!x.bundled)");
  const n=node({i:String(mine)});
  const id=tapNode(r.els.page, n, {hold:true, x:0, y:0});
  r.els.page.fire("pointermove",{pointerId:id, clientX:0, clientY:40, target:n});
  r.flush(); await wait();
  ok("★★ 움직였으면 확인창이 안 뜸", S(r).confirm===null);

  /* 전화가 와도(pointercancel) 취소되어야 합니다 */
  const n2=node({i:String(mine)});
  const id2=tapNode(r.els.page, n2, {hold:true});
  r.els.page.fire("pointercancel",{pointerId:id2, target:n2});
  r.flush(); await wait();
  ok("★★ 전화가 와도 확인창이 안 뜸", S(r).confirm===null);
}

console.log("\n[5-4] ★ 두 번째 손가락이 첫 번째를 덮어쓰지 않는가");
{ /* 안 묶어두면 빈 곳을 톡 쳤는데 게임이 켜집니다 */
  const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  const a=node({i:"1"});
  r.els.page.fire("pointerdown",{preventDefault(){},pointerId:11,target:a,clientX:0,clientY:0});
  /* 두 번째 손가락이 다른 줄을 누릅니다 — 무시되어야 합니다 */
  const b=node({i:"3"});
  r.els.page.fire("pointerdown",{preventDefault(){},pointerId:12,target:b,clientX:0,clientY:0});
  r.els.page.fire("pointerup",{preventDefault(){},pointerId:12,target:b,clientX:0,clientY:0});
  await wait();
  ok("★★ 두 번째 손가락은 무시됨", S(r).cursor!==3, S(r).cursor);
  r.els.page.fire("pointerup",{preventDefault(){},pointerId:11,target:a,clientX:0,clientY:0});
  await wait();
  ok("★ 첫 번째 손가락은 제대로 먹힘", S(r).cursor===1, S(r).cursor);
}

console.log("\n[6] ★★ 메뉴 — 줄마다 LOAD / SAVE");
{ const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  ok("(준비) 게임 중", S(r).screen==="play", S(r).screen);
  tap(r.els.zMain); await wait();
  ok("★ 메뉴가 열림", S(r).screen==="menu");
  ok("★ 게임이 멈춤", !S(r).running);
  ok("★ LOAD/SAVE 버튼이 그려짐",
     /data-act="load"/.test(r.els.page.innerHTML) && /data-act="save"/.test(r.els.page.innerHTML));
  ok("★ 저장 칸이 셋", (r.els.page.innerHTML.match(/data-act="save"/g)||[]).length===3,
     (r.els.page.innerHTML.match(/data-act="save"/g)||[]).length);
  ok("처음엔 전부 EMPTY", (r.els.page.innerHTML.match(/EMPTY/g)||[]).length===3);

  /* SLOT 1 에 저장 */
  tapNode(r.els.page, node({m:"1", act:"save"})); await wait();
  ok("★★ SAVE 를 누르면 저장됨", /SAVED TO SLOT 1/.test(S(r).notice), S(r).notice);
  ok("★ 표시가 SAVED 로 바뀜", (r.els.page.innerHTML.match(/SAVED<|>SAVED/g)||[]).length>=1,
     r.els.page.innerHTML.match(/EMPTY|SAVED/g));

  /* 불러오기 */
  tapNode(r.els.page, node({m:"1", act:"load"})); await wait();
  ok("★★ LOAD 를 누르면 게임으로 돌아감", S(r).screen==="play", S(r).screen);
  ok("돌고 있음", S(r).running);

  /* RESUME 줄 */
  tap(r.els.zMain); await wait();
  tapNode(r.els.page, node({m:"0"})); await wait();
  ok("★ RESUME 줄을 누르면 게임으로", S(r).screen==="play");

  /* EXIT 줄 */
  tap(r.els.zMain); await wait();
  tapNode(r.els.page, node({m:"6"})); await wait();
  ok("★★ EXIT 를 누르면 템패드로 나감", r.sandbox.location._replaced>0, r.sandbox.location.href);
  ok("★ 나가기 전에 에뮬이 멈춤", !S(r).running);
}

console.log("\n[7] ★★ 컬러 토글");
{ const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  ok("(준비) 게임 중", S(r).screen==="play");
  ok("★ 기본은 템패드 주황", S(r).colorReal===false);
  ok("★ 버튼에 AMBER 라고 뜸", r.els.zClr.textContent==="AMBER", r.els.zClr.textContent);
  tap(r.els.zClr); await wait();
  ok("★★ 누르면 실제 컬러로", S(r).colorReal===true);
  ok("★ 버튼 글자가 바뀜", r.els.zClr.textContent==="COLOR", r.els.zClr.textContent);
  tap(r.els.zClr); await wait();
  ok("★ 되돌아옴", S(r).colorReal===false);
  ok("★ 설정이 저장됨", r.store.get("tempad.game.color")==="tempad",
     r.store.get("tempad.game.color"));

  /* 게임 화면이 아닐 때는 컬러 버튼이 안 보입니다 (눌러도 변화가 없으니까) */
  tap(r.els.zMain); await wait();          /* 메뉴 */
  ok("메뉴에서는 보임", r.els.zClr.style.display!=="none", r.els.zClr.style.display);
  r.read("ui.quit()"); await wait();
  r.read("draw()");
  ok("★ 목록에서는 숨김", r.els.zClr.style.display==="none", r.els.zClr.style.display);
}

console.log("\n[8] ★★ 조작판 숨김 토글 — 게임 화면이 커져야 함");
{ /* ★ 좁은 폰 + GBA 로 봅니다.
       넓은 폰에서는 **세로**가 먼저 한계라, 조작판을 숨겨도 화면이 안 커집니다.
       그게 정상입니다 — 비율을 지키니까요. 토글이 실제로 이득인 곳은
       가로가 빠듯한 조합입니다. 거기서 재야 의미가 있습니다. */
  const r=run({W:667,H:375}); await wait();
  tapNode(r.els.page, node({s:"gba"})); await wait();
  const w1=parseInt(r.els.screen.style.width,10);
  ok("(준비) 게임 화면 크기를 잼", w1>0, r.els.screen.style.width);
  ok("★ 조작판이 보이는 상태", S(r).padVisible===true);
  tap(r.els.zPad); await wait();
  ok("★★ 눌러서 조작판이 숨겨짐", S(r).padVisible===false);
  ok("★ 몸통에 hidepad 표시가 붙음", r.els.dev.classList.contains("hidepad"));
  const w2=parseInt(r.els.screen.style.width,10);
  ok("★★ 게임 화면이 더 커짐", w2>w1, w1+" → "+w2);
  /* ★ zPad 의 display 는 draw() 가 늘 "flex" 로 쓰므로 그것만 보면 아무것도
       안 보는 단언이 됩니다. **실제로 눌러서 되살아나는지**를 봅니다. */
  ok("★★ 그래도 MENU 버튼은 남아 있음 (갇히지 않게)",
     r.els.zMain.textContent==="BACK", r.els.zMain.textContent);
  tap(r.els.zPad); await wait();
  ok("★★★ 조작판을 껐어도 PAD 버튼이 실제로 눌려서 되살아남",
     S(r).padVisible===true, String(S(r).padVisible));
  tap(r.els.zPad); await wait();          /* 다시 끄고 아래 검사를 이어갑니다 */
  ok("(준비) 다시 꺼짐", S(r).padVisible===false);
  tap(r.els.zPad); await wait();
  ok("★ 되돌리면 원래 크기", parseInt(r.els.screen.style.width,10)===w1);
  ok("hidepad 표시가 떨어짐", !r.els.dev.classList.contains("hidepad"));
}

console.log("\n[9] ★★ 배치 공식 — 비율은 지키고 최대로");
{ /* 넓은 폰 */
  const r=run({W:900,H:400}); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  const w=parseInt(r.els.screen.style.width,10), h=parseInt(r.els.screen.style.height,10);
  ok("★ 게임보이 비율(10:9)을 지킴", Math.abs(w/h - 160/144) < 0.02, w+"x"+h+" = "+(w/h).toFixed(3));
  ok("★ 세로를 거의 다 씀", h > 400*0.8, h);

  /* GBA 는 비율이 다릅니다 */
  tap(r.els.zMain); await wait();
  tapNode(r.els.page, node({s:"gba"})); await wait();
  ok("(준비) GBA 목록", S(r).systemId==="gba", S(r).systemId);
  const w2=parseInt(r.els.screen.style.width,10), h2=parseInt(r.els.screen.style.height,10);
  ok("★★ GBA 비율(3:2)로 바뀜", Math.abs(w2/h2 - 240/160) < 0.02, w2+"x"+h2+" = "+(w2/h2).toFixed(3));
  ok("★ GBA 가 게임보이보다 가로로 넓음", w2>w, w+" → "+w2);

  /* 좁은 폰에서도 조작판 자리를 지켜야 합니다 */
  const r2=run({W:667,H:375}); await wait();
  tapNode(r2.els.page, node({s:"gba"})); await wait();
  const dw=parseInt(r2.els.dev.style.width,10);
  const gw=parseInt(r2.els.screen.style.width,10);
  ok("★★ 좁은 폰에서 조작판 자리가 남음", (dw-gw)/2 >= 145, "여백 "+((dw-gw)/2));
  const gh2=parseInt(r2.els.screen.style.height,10);
  ok("★ 그래도 비율은 그대로", Math.abs(gw/gh2 - 240/160) < 0.03, gw+"x"+gh2);
}

console.log("\n[10] ★ GBA 의 L·R 버튼은 GBA 일 때만");
{ const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  ok("★ 게임보이에서는 L·R 이 숨겨짐",
     r.els.btnL.style.display==="none" && r.els.btnR.style.display==="none",
     r.els.btnL.style.display);
  tap(r.els.zMain); await wait();
  tapNode(r.els.page, node({s:"gba"})); await wait();
  ok("★★ GBA 에서는 L·R 이 보임",
     r.els.btnL.style.display==="flex" && r.els.btnR.style.display==="flex",
     r.els.btnL.style.display);
}

console.log("\n[11] ★★ 게임패드 — SELECT + L + R 로 메뉴");
{ const mkPad=(down=[])=>({ connected:true, buttons:Array.from({length:17},(_,i)=>
    ({pressed:down.indexOf(i)>=0, value:down.indexOf(i)>=0?1:0})), axes:[0,0,0,0] });
  const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  ok("(준비) 게임 중", S(r).screen==="play", S(r).screen);

  r.pads.push(mkPad());
  r.emit("gamepadconnected",{});
  r.frame();
  ok("★ 패드를 잡음", r.els.diag.textContent==="GAMEPAD", r.els.diag.textContent);

  /* L 만 눌러서는 메뉴가 열리면 안 됩니다 (v1 의 문제) */
  r.pads[0]=mkPad([4]); r.frame(); await wait();
  ok("★★ L 혼자로는 메뉴가 안 열림", S(r).screen==="play", S(r).screen);
  r.pads[0]=mkPad([5]); r.frame(); await wait();
  ok("★★ R 혼자로도 안 열림", S(r).screen==="play");
  r.pads[0]=mkPad([4,5]); r.frame(); await wait();
  ok("★★ L+R 로도 안 열림", S(r).screen==="play");

  /* 셋을 다 눌러야 */
  r.pads[0]=mkPad([4,5,8]); r.frame(); await wait();
  ok("★★★ SELECT+L+R 이면 메뉴가 열림", S(r).screen==="menu", S(r).screen);
  ok("★ 게임이 멈춤", !S(r).running);

  /* 누르고 있는 동안 계속 열렸다 닫혔다 하면 안 됩니다.
     ★★ 프레임을 **홀수 번** 돌립니다. 짝수로 돌리면, 매 프레임 뒤집히는
        고장(누름 판정을 빼먹은 경우)이 마침 제자리로 돌아와 통과합니다.
        인계서 8장의 "5프레임/5줄" 사고와 같은 함정입니다.
        (2026-08-11 교차검사에서 실증해서 고쳤습니다.) */
  r.frame(); r.frame(); r.frame(); await wait();
  ok("★★ 누르고 있어도 한 번만 반응 (홀수 프레임)", S(r).screen==="menu", S(r).screen);
  r.frame(); r.frame(); r.frame(); r.frame(); r.frame(); await wait();
  ok("★★ 더 돌려도 그대로", S(r).screen==="menu", S(r).screen);

  /* 떼었다가 다시 누르면 다시 반응 */
  r.pads[0]=mkPad([]); r.frame(); await wait();
  ok("떼면 그대로 메뉴", S(r).screen==="menu");
  r.pads[0]=mkPad([4,5,8]); r.frame(); await wait();
  ok("★ 다시 누르면 게임으로 돌아감", S(r).screen==="play", S(r).screen);
}

console.log("\n[11-2] ★ 게임패드 버튼이 게임에 제대로 가는가");
{ const mkPad=(down=[])=>({ connected:true, buttons:Array.from({length:17},(_,i)=>
    ({pressed:down.indexOf(i)>=0, value:down.indexOf(i)>=0?1:0})), axes:[0,0,0,0] });
  const r=run({mgba:true}); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  r.pads.push(mkPad()); r.emit("gamepadconnected",{}); r.frame();

  /* 게임에 실제로 전달되는지 — GameMode.press 를 가로채서 봅니다 */
  r.read("window.__seen=[]; GameMode.press=(n,d)=>window.__seen.push(n+(d?'+':'-'));");
  r.pads[0]=mkPad([1]); r.frame(); await wait();
  ok("★ A 가 게임으로 감", (r.read("window.__seen")||[]).join(",")==="A+",
     (r.read("window.__seen")||[]).join(","));
  r.pads[0]=mkPad([1,4]); r.frame(); await wait();
  ok("★★ L 도 게임으로 감 (GBA 용)", (r.read("window.__seen")||[]).join(",")==="A+,L+",
     (r.read("window.__seen")||[]).join(","));
  /* 조합이 되는 순간 셋은 걷어내야 합니다 */
  r.read("window.__seen=[]");
  r.pads[0]=mkPad([1,4,5,8]); r.frame(); await wait();
  const seen=(r.read("window.__seen")||[]).join(",");
  ok("★★ 조합이 되면 L 은 놓임 (게임에 안 남음)", /L-/.test(seen), seen);
  ok("★★ SELECT·R 은 게임에 안 들어감", !/select\+/.test(seen) && !/R\+/.test(seen), seen);
}

console.log("\n[12] ★ 화면에 나오는 글자를 안전하게 감싸는가");
{ /* 게임 이름은 파일 이름에서 옵니다. 파일 이름은 마음대로 지을 수 있습니다. */
  const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  r.els.file.files=[fakeFile('<img src=x onerror=alert(1)>.gb', 77, "")];
  r.els.file.fire("change",{target:r.els.file}); await wait();
  ok("★★ 꺾쇠가 그대로 안 들어감", !/<img /.test(r.els.page.innerHTML),
     r.els.page.innerHTML.slice(0,140));
  ok("★ 대신 안전하게 바뀌어 들어감", /&lt;IMG/i.test(r.els.page.innerHTML),
     r.els.page.innerHTML.slice(0,140));
}

console.log("\n[13] ★ 파일 넣기 — 시스템이 다르면 어디로 갔는지 말해줌");
{ const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  r.els.file.files=[fakeGbaFile("ADV.gba", 55)];
  r.els.file.fire("change",{target:r.els.file}); await wait();
  ok("★★ 게임보이 목록에는 안 늘어남", S(r).count===3, S(r).count);
  ok("★★ GBA 로 갔다고 알려줌", /ADDED TO GAME BOY ADVANCE/.test(S(r).notice), S(r).notice);
  tap(r.els.zMain); await wait();
  tapNode(r.els.page, node({s:"gba"})); await wait();
  ok("★★ GBA 목록에 실제로 있음", S(r).count===1, S(r).count);
}

console.log("\n[13-2] ★ GBA 코어가 없으면 이유가 떠야 함 (검은 화면 금지)");
{ const r=run(); await wait();          /* mgba 없이 */
  tapNode(r.els.page, node({s:"gb"})); await wait();
  r.els.file.files=[fakeGbaFile("ADV.gba", 56)];
  r.els.file.fire("change",{target:r.els.file}); await wait();
  tap(r.els.zMain); await wait();
  tapNode(r.els.page, node({s:"gba"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  ok("★ 게임이 안 켜짐", S(r).screen==="list", S(r).screen);
  ok("★★ GBA 라고 콕 집어 알려줌", /GBA EMULATOR NOT AVAILABLE/.test(S(r).notice), S(r).notice);

  const r2=run({mgba:true}); await wait();
  tapNode(r2.els.page, node({s:"gb"})); await wait();
  r2.els.file.files=[fakeGbaFile("ADV.gba", 56)];
  r2.els.file.fire("change",{target:r2.els.file}); await wait();
  tap(r2.els.zMain); await wait();
  tapNode(r2.els.page, node({s:"gba"})); await wait();
  ok("(준비) GBA 목록에 하나", S(r2).count===1, S(r2).count);
}

console.log("\n[14] ★ 글자 크기 버튼");
{ const r=run(); await wait();
  const v0=r.read("fsNow");
  tap(r.els.fsUp); await wait();
  ok("★ 커짐", r.read("fsNow")===v0+1, r.read("fsNow"));
  tap(r.els.fsDn); tap(r.els.fsDn); await wait();
  ok("★ 작아짐", r.read("fsNow")===v0-1, r.read("fsNow"));
  ok("★ 저장됨", r.store.get("tempad.fs")===String(v0-1), r.store.get("tempad.fs"));
  /* 한계 밖으로는 안 나갑니다 */
  for(let i=0;i<40;i++) tap(r.els.fsUp);
  await wait();
  ok("★ 위 한계에서 멈춤", r.read("fsNow")===26, r.read("fsNow"));
  for(let i=0;i<40;i++) tap(r.els.fsDn);
  await wait();
  ok("★ 아래 한계에서 멈춤", r.read("fsNow")===9, r.read("fsNow"));
}

console.log("\n[15] ★★ 갇히는 화면이 없는가 — 모든 화면에 나갈 표시");
{ for(const [name, go] of [
    ["시스템", async r=>{}],
    ["목록",   async r=>{ tapNode(r.els.page, node({s:"gb"})); await wait(); }],
    ["GBA빈목록", async r=>{ tapNode(r.els.page, node({s:"gba"})); await wait(); }],
    ["게임중", async r=>{ tapNode(r.els.page, node({s:"gb"})); await wait();
                          tapNode(r.els.page, node({i:"0"})); await wait();
                          tapNode(r.els.page, node({i:"0"})); await wait(); }],
    ["메뉴",   async r=>{ tapNode(r.els.page, node({s:"gb"})); await wait();
                          tapNode(r.els.page, node({i:"0"})); await wait();
                          tapNode(r.els.page, node({i:"0"})); await wait();
                          tap(r.els.zMain); await wait(); }],
  ]){
    const r=run(); await wait(); await go(r);
    const t=r.els.zMain.textContent;
    ok(name+" 화면에 나갈 글자가 있음", typeof t==="string" && t.length>0, t);
    ok(name+" 에서 눌러도 안 터짐", (()=>{ try{ tap(r.els.zMain); return true; }catch(e){ return false; } })());
  }
}

console.log("\n[16] ★ 다른 앱으로 갔다 오면");
{ const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  ok("(준비) 게임 중", S(r).screen==="play");
  /* 눌린 버튼이 있는 채로 화면이 꺼집니다 */
  r.read("pad.btnDown(99,'A',null)");
  ok("(준비) A 가 눌려 있음", (r.read("pad.held")||[]).indexOf("A")>=0);
  r.sandbox.document.visibilityState="hidden";
  r.emitDoc("visibilitychange",{});
  await wait();
  ok("★★ 다른 앱으로 가면 눌린 버튼이 놓임", (r.read("pad.held")||[]).length===0,
     (r.read("pad.held")||[]).join(","));
}

console.log("\n[17] ★ 에뮬레이터 파일이 없을 때");
{ const r=run({noBinjgb:true}); await wait();
  ok("★ 그래도 화면은 뜸", !r.err && /SELECT SYSTEM/.test(r.els.page.innerHTML));
  ok("★ 이유를 알려줌", /EMULATOR FILES MISSING/.test(S(r).notice), S(r).notice);
}

console.log("\n[18] ★ 아이폰 사파리 안내");
{ const r=run({ua:"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"});
  await wait();
  ok("★ 홈 화면에 추가하라고 알려줌", /ADD TO HOME SCREEN/.test(S(r).notice), S(r).notice);
  /* 폴더 고르기가 안 되는 기기입니다 */
  ok("★ 폴더 고르기를 못 하는 기기로 판정", r.read("CAN_DIR")===false, r.read("CAN_DIR"));
  const r2=run();
  ok("★ 안드로이드는 폴더 고르기가 됨", r2.read("CAN_DIR")===true, r2.read("CAN_DIR"));
}

console.log("\n[19] ★ 화면이 세로일 때·크기가 이상할 때 안 터지는가");
{ for(const [w,h] of [[0,0],[100,100],[320,240],[2400,1080],[NaN,500]]){
    const r=run({W:w,H:h});
    ok(`${w}x${h} 에서 안 터짐`, !r.err, r.err && r.err.message);
  }
}

console.log("\n[20] ★★ 게임 중에 목록 탭이 새어 들어가지 않는가");
{ const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  ok("(준비) 게임 중", S(r).screen==="play");
  /* 게임 중에는 #page 가 숨겨져 있지만, 혹시 이벤트가 와도 아무 일 없어야 합니다 */
  tapNode(r.els.page, node({i:"3"})); await wait();
  ok("★ 게임 화면 그대로", S(r).screen==="play", S(r).screen);
}

console.log("\n[21] ★★★ 메뉴를 열 때 눌려 있던 게임패드 키가 놓여야 함");
{ /* 패드로 오른쪽을 **누른 채** 화면 MENU 를 누르면, 그 뒤에 방향을 떼도
     "게임 화면이 아니니 무시" 하고 뗌이 버려졌습니다. 그래서 RESUME 했을 때
     **손을 뗐는데 캐릭터가 계속 걸어갔습니다.**
     (2026-08-11 교차검사에서 재현해서 잡았습니다.) */
  const mkPad=(down=[])=>({ connected:true, buttons:Array.from({length:17},(_,i)=>
    ({pressed:down.indexOf(i)>=0, value:down.indexOf(i)>=0?1:0})), axes:[0,0,0,0] });
  const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  ok("(준비) 게임 중", S(r).screen==="play", S(r).screen);
  r.pads.push(mkPad()); r.emit("gamepadconnected",{}); r.frame();

  r.read("window.__seen=[]; GameMode.press=(n,d)=>window.__seen.push(n+(d?'+':'-'));");
  r.pads[0]=mkPad([15]);                    /* 십자키 오른쪽을 누른 채 */
  r.frame(); await wait();
  ok("(준비) 오른쪽이 게임에 눌림", (r.read("window.__seen")||[]).join(",")==="right+",
     (r.read("window.__seen")||[]).join(","));

  tap(r.els.zMain); await wait();            /* 그 상태로 화면 MENU 를 누름 */
  ok("메뉴가 열림", S(r).screen==="menu", S(r).screen);
  ok("★★★ 눌려 있던 방향이 게임에서 놓임",
     /right-/.test((r.read("window.__seen")||[]).join(",")),
     (r.read("window.__seen")||[]).join(","));

  /* 이제 손을 떼고 RESUME 해도 걸어가면 안 됩니다 */
  r.read("window.__seen=[]");
  r.pads[0]=mkPad([]); r.frame(); await wait();
  tap(r.els.zMain); await wait();
  ok("게임으로 돌아옴", S(r).screen==="play", S(r).screen);
  ok("★★ 다시 눌린 것이 없음", !/right\+/.test((r.read("window.__seen")||[]).join(",")),
     (r.read("window.__seen")||[]).join(","));
}

console.log("\n[22] ★★ 조작판을 끄면 GBA 의 L·R 도 같이 사라져야 함");
{ /* L·R 은 인라인 display 를 쓰는데 인라인은 CSS(.hidepad)를 이깁니다.
     그래서 조작판을 껐는데 **L·R 만 유령처럼 남았습니다.** */
  const r=run(); await wait();
  tapNode(r.els.page, node({s:"gba"})); await wait();
  ok("(준비) GBA 목록", S(r).systemId==="gba", S(r).systemId);
  ok("(준비) L·R 이 보임", r.els.btnL.style.display==="flex", r.els.btnL.style.display);
  tap(r.els.zPad); await wait();
  ok("조작판이 꺼짐", S(r).padVisible===false);
  ok("★★★ L 도 사라짐", r.els.btnL.style.display==="none", r.els.btnL.style.display);
  ok("★★★ R 도 사라짐", r.els.btnR.style.display==="none", r.els.btnR.style.display);
  ok("★★ 그래도 MENU 는 남아 있음", r.els.zMain.textContent.length>0, r.els.zMain.textContent);
  /* 게임보이로 옮겨가도 남으면 안 됩니다 */
  tap(r.els.zPad); await wait();             /* 조작판 다시 켜고 */
  tap(r.els.zMain); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  ok("★★ 게임보이에서는 L·R 이 없음",
     r.els.btnL.style.display==="none" && r.els.btnR.style.display==="none",
     r.els.btnL.style.display);
}

console.log("\n[23] ★★ 버튼을 눌렀다가 끌고 나가서 떼면 실행되면 안 됨");
{ /* 터치는 pointerdown 이 일어난 요소에 **자동으로 붙잡혀서**, 손가락이
     밖으로 나가도 pointerleave 가 안 오고 pointerup 도 원래 버튼으로
     돌아옵니다. 그래서 "마음이 바뀌어 끌고 나가서 뗐는데도 그대로 실행"
     되었습니다. 움직인 거리로 직접 판정하게 고쳤습니다. */
  const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  ok("(준비) 목록", S(r).screen==="list");
  const el=r.els.zMain;
  el.fire("pointerdown",{preventDefault(){},pointerId:31,clientX:100,clientY:20});
  el.fire("pointermove",{preventDefault(){},pointerId:31,clientX:100,clientY:200});
  el.fire("pointerup",  {preventDefault(){},pointerId:31,clientX:100,clientY:200});
  await wait();
  ok("★★★ 끌고 나가서 떼면 아무 일도 안 일어남", S(r).screen==="list", S(r).screen);

  /* 제자리에서 떼면 당연히 동작해야 합니다 (긍정형 대조군) */
  el.fire("pointerdown",{preventDefault(){},pointerId:32,clientX:100,clientY:20});
  el.fire("pointerup",  {preventDefault(){},pointerId:32,clientX:102,clientY:22});
  await wait();
  ok("★★ 제자리에서 떼면 제대로 동작", S(r).screen==="system", S(r).screen);
}

console.log("\n[24] ★★ 게임패드만으로 목록·메뉴를 움직일 수 있는가");
{ /* ★ 이 경로(onPress 의 비-플레이 분기)는 검사에서 **한 줄도 안 돌고
       있었습니다.** 패드를 꽂은 아이가 화면을 안 만지고 게임을 고르는
       가장 자연스러운 길인데 말입니다.
       (2026-08-11 교차검사에서 계측으로 드러났습니다.) */
  const mkPad=(down=[])=>({ connected:true, buttons:Array.from({length:17},(_,i)=>
    ({pressed:down.indexOf(i)>=0, value:down.indexOf(i)>=0?1:0})), axes:[0,0,0,0] });
  const r=run(); await wait();
  r.pads.push(mkPad()); r.emit("gamepadconnected",{}); r.frame();

  /* 시스템 고르기 — 십자키로 내려가서 A */
  ok("(준비) 시스템 화면", S(r).screen==="system", S(r).screen);
  r.pads[0]=mkPad([13]); r.frame(); await wait();   /* 아래 */
  ok("★ 패드 십자키로 커서가 내려감", S(r).cursor===1, S(r).cursor);
  r.pads[0]=mkPad([]); r.frame();
  r.pads[0]=mkPad([13]); r.frame(); await wait();
  ok("★ 한 번 더", S(r).cursor===2, S(r).cursor);
  r.pads[0]=mkPad([]); r.frame();
  r.pads[0]=mkPad([1]); r.frame(); await wait();    /* A */
  ok("★★ A 로 시스템이 열림", S(r).screen==="list" && S(r).systemId==="gba",
     S(r).screen+"/"+S(r).systemId);
  r.pads[0]=mkPad([]); r.frame();

  /* 목록에서 B 로 되돌아가기 */
  r.pads[0]=mkPad([0]); r.frame(); await wait();    /* B */
  ok("★ B 로 시스템 화면으로 되돌아감", S(r).screen==="system", S(r).screen);
  r.pads[0]=mkPad([]); r.frame();

  /* 게임보이를 골라 게임을 켜고, 메뉴를 패드로 움직이기 */
  r.pads[0]=mkPad([1]); r.frame(); await wait();    /* A → 커서 0 = gb */
  ok("(준비) 게임보이 목록", S(r).systemId==="gb", S(r).systemId);
  r.pads[0]=mkPad([]); r.frame();
  r.pads[0]=mkPad([1]); r.frame(); await wait();    /* A → 게임 시작 */
  ok("★★ 패드 A 로 게임이 켜짐", S(r).screen==="play", S(r).screen);
  r.pads[0]=mkPad([]); r.frame();

  /* 메뉴를 열고 패드로 항목 고르기 */
  r.pads[0]=mkPad([4,5,8]); r.frame(); await wait();
  ok("(준비) 조합으로 메뉴 열림", S(r).screen==="menu", S(r).screen);
  r.pads[0]=mkPad([]); r.frame(); await wait();
  r.pads[0]=mkPad([13]); r.frame(); await wait();   /* 아래 */
  ok("★★ 메뉴에서 패드 십자키가 먹힘", S(r).cursor===1, S(r).cursor);
  r.pads[0]=mkPad([]); r.frame();
  r.pads[0]=mkPad([0]); r.frame(); await wait();    /* B = 닫기 */
  ok("★★ 패드 B 로 메뉴가 닫힘", S(r).screen==="play", S(r).screen);
}

console.log("\n[25] ★★ 지우기 확인창은 패드로 지울 수 없어야 함");
{ /* 되돌릴 수 없는 일이라 화면 버튼으로만 됩니다. 손에 쥔 패드를
     아무렇게나 눌러 게임이 사라지면 안 됩니다. */
  const mkPad=(down=[])=>({ connected:true, buttons:Array.from({length:17},(_,i)=>
    ({pressed:down.indexOf(i)>=0, value:down.indexOf(i)>=0?1:0})), axes:[0,0,0,0] });
  const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  r.els.file.files=[fakeFile("MINE.gb",91,"MINE")];
  r.els.file.fire("change",{target:r.els.file}); await wait();
  const mine=r.read("ui.list().findIndex(x=>!x.bundled)");
  const n0=S(r).count;
  tapNode(r.els.page, node({i:String(mine)}), {hold:true});
  r.flush(); await wait();
  ok("(준비) 확인창이 떴음", S(r).confirm!==null);

  r.pads.push(mkPad()); r.emit("gamepadconnected",{}); r.frame();
  r.read("armAt = 0");
  /* 패드의 모든 버튼을 눌러봅니다 — 하나라도 지우면 실패입니다 */
  for (const b of [0,1,8,9,4,5,12,13,14,15]) {
    r.pads[0]=mkPad([b]); r.frame(); await wait();
    r.pads[0]=mkPad([]); r.frame(); await wait();
    if (S(r).confirm===null) break;          /* 취소된 것은 정상 */
  }
  ok("★★★ 패드로는 절대 안 지워짐", S(r).count===n0, S(r).count+" vs "+n0);
  ok("★ 게임이 그대로 목록에 있음", r.read("ui.list().some(x=>x.title==='MINE')"));
}

console.log("\n[26] ★★★ 저장 실패 안내가 **실제 화면에** 떠야 함");
{ /* ★ 이게 이번 세션에서 제일 교묘했던 버그입니다.
       "저장 실패를 알려준다" 는 코드를 넣었는데, 그 코드는 3초짜리 타이머
       안에서 notice 만 바꿔놓고 **아무도 다시 그리지 않았습니다.**
       게다가 MENU 를 열면 openMenu 가 notice 를 지웠습니다.
       즉 "조용히 잃지 않게 하겠다" 는 수정이 **여전히 조용했습니다.**
       그래서 notice 가 아니라 **화면에 찍힌 글자**를 봅니다. */
  const r=run(); await wait();
  tapNode(r.els.page, node({s:"gb"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  tapNode(r.els.page, node({i:"0"})); await wait();
  ok("(준비) 게임 중", S(r).screen==="play", S(r).screen);
  const before=r.els.note.textContent;

  /* 저장소가 꽉 찬 상황을 만듭니다 */
  r.read("GameMode.RomStore.patch = async () => { throw new Error('QuotaExceededError'); };");
  r.read("GameMode.RomStore.add   = async () => { throw new Error('QuotaExceededError'); };");
  /* 게임이 스스로 저장했습니다 */
  const onSram = r.read("GameMode.current().opts.onSram");
  ok("(준비) 저장 통로가 있음", typeof onSram==="function");
  try { await onSram(new Uint8Array([1,2,3])); } catch(e) {}
  await wait();

  ok("★★★ 화면 아래에 실제로 안내가 찍힘", /COULD NOT SAVE/.test(r.els.note.textContent),
     "화면글=\""+r.els.note.textContent+"\" (전=\""+before+"\")");

  /* ★ MENU 를 열면 안내가 지워지는데, 다음 저장 시도에서 다시 떠야 합니다.
       한 번 띄우고 잠가두면 아이가 놓쳤을 때 영영 못 봅니다. */
  tap(r.els.zMain); await wait();
  ok("(준비) 메뉴를 열면 안내가 지워짐", !/COULD NOT SAVE/.test(r.els.note.textContent),
     r.els.note.textContent);
  try { await onSram(new Uint8Array([1,2,3])); } catch(e) {}
  await wait();
  ok("★★★ 다음 시도에서 **다시** 뜸 (한 번 놓쳐도 됨)",
     /COULD NOT SAVE/.test(r.els.note.textContent), r.els.note.textContent);
}

console.log(`\n${"=".repeat(46)}\n통과 ${pass}  실패 ${fail}\n`);
process.exit(fail?1:0);
})();
