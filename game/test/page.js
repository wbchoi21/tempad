/* ============================================================================
   game/index.html 안의 코드를 진짜로 실행해봅니다.

   지금까지 이 파일은 문법 검사만 했습니다. draw() 가 터지는지,
   버튼이 제대로 연결됐는지, 없는 id 를 부르는지는 알 수 없었습니다.
   ========================================================================== */
const fs=require("fs"), path=require("path"), vm=require("vm");
const D=path.join(__dirname,"..");
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
    getComputedStyle:()=>({ top:"0px",left:"0px",bottom:"0px",right:"0px",fontSize:"13px" }),
    requestAnimationFrame:()=>1, cancelAnimationFrame(){},
    addEventListener(){}, setTimeout:(f)=>{ return 0; }, clearTimeout(){},
    fetch:async()=>({ ok:true, arrayBuffer:async()=>new ArrayBuffer(0x8000) }),
    location:{ href:"" },
    AudioContext:function(){ return { sampleRate:48000, resume(){}, suspend(){},
      createBuffer:(c,n)=>({getChannelData:()=>new Float32Array(n)}),
      createBufferSource:()=>({connect(){},start(){}}) }; },
    Binjgb: opts.noBinjgb ? undefined : (async()=>({})),
    FileReader:function(){ this.readAsArrayBuffer=()=>{ this.onloadend({target:{result:new ArrayBuffer(0x8000)}}); }; },
    indexedDB: undefined,          /* 저장소 막힌 상태로 (기본 게임만 보임) */
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
  return { sandbox, els, err, read };
}

const wait = () => new Promise(r => setImmediate(() => setImmediate(r)));

(async () => {

console.log("\n[1] 화면이 뜨는가");
{ const r=run();
  ok("코드가 끝까지 돔", !r.err, r.err && r.err.message);
  ok("ui 가 만들어짐", !!r.read("ui"));
  ok("십자키가 붙음", !!r.read("pad"));
  ok("첫 화면이 그려짐", /SELECT SYSTEM/.test(r.els.page.innerHTML), r.els.page.innerHTML.slice(0,40));
  ok("오른쪽 안내글도 그려짐", /FIELD UNIT/.test(r.els.info.innerHTML));
  ok("탈출구에 갈 곳이 적힘", r.els.btnUp.textContent==="TEMPAD", r.els.btnUp.textContent);
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
  for(const id of ["btnA","btnB","btnSel","btnSta","btnUp","fsUp","fsDn","padArea","back","file"])
    ok(id+" 에 손이 붙어 있음", Object.keys(r.els[id].listeners).length>0,
       Object.keys(r.els[id].listeners).join(","));
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

console.log("\n[7] binjgb 가 없을 때");
{ const r=run({noBinjgb:true});
  ok("그래도 화면은 뜸", !r.err && /SELECT SYSTEM/.test(r.els.page.innerHTML), r.err && r.err.message);
  ok("안내가 나옴", /EMULATOR/.test(r.els.note.textContent), r.els.note.textContent);
}

console.log(`\n${"=".repeat(46)}\n통과 ${pass}  실패 ${fail}\n`);
process.exit(fail?1:0);
})();
