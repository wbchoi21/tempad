/* 진짜 fit() 을 돌려서 모든 요소의 자리를 뽑아낸다.
   그 좌표를 파이썬으로 그려서 눈으로 확인한다 (버튼이 겹치는지). */
const fs=require("fs"), path=require("path"), vm=require("vm");
const D=path.join(__dirname, "..");
const html=fs.readFileSync(D+"/index.html","utf8");
const pageJs=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join("\n");
const ids=[...new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m=>m[1]))];

/* ★ cssText 는 += 로 계속 이어붙습니다. CSS 는 **나중 것이 이깁니다.**
     그래서 마지막 값을 읽어야 합니다 (처음 것을 읽으면 옛 배치를 봅니다). */
function px(s,k){ const re=new RegExp("(?:^|;)\\s*"+k+"\\s*:\\s*(-?[\\d.]+)px","g");
  let m,last=null; while((m=re.exec(String(s||"")))) last=parseFloat(m[1]); return last; }

function mkCl(){return{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},
  contains(c){return this._s.has(c)},toggle(c,o){if(o===undefined)o=!this._s.has(c);if(o)this._s.add(c);else this._s.delete(c);return o}}}
function makeEl(id){return{id,style:{cssText:"",setProperty(){}},classList:mkCl(),dataset:{},_html:"",
  textContent:"",value:"",files:[],listeners:{},webkitdirectory:false,
  get innerHTML(){return this._html},set innerHTML(v){this._html=v},
  addEventListener(t,f){(this.listeners[t]=this.listeners[t]||[]).push(f)},removeEventListener(){},
  click(){},fire(t,ev){(this.listeners[t]||[]).forEach(f=>f(ev||{preventDefault(){},pointerId:1,clientX:0,clientY:0}))},
  querySelector(){return null},getContext(){return{imageSmoothingEnabled:true,
    createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData(){}}},
  remove(){},appendChild(){},setPointerCapture(){}}}

function layout(W,H,system,padOn,fs_){
  const els={}; ids.forEach(i=>els[i]=makeEl(i));
  const rafQ=[],winL={},docL={},store=new Map();
  if(fs_) store.set("tempad.fs",String(fs_));
  const sb={console:{log(){},warn(){},error(){}},
    document:{getElementById:i=>els[i]||null,createElement:()=>makeEl("t"),body:{appendChild(){}},
      documentElement:{clientWidth:W,clientHeight:H,style:{setProperty(){}}},
      addEventListener(t,f){(docL[t]=docL[t]||[]).push(f)},visibilityState:"visible",querySelectorAll:()=>[]},
    window:null,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))},
    matchMedia:()=>({matches:false}),navigator:{userAgent:"Android",standalone:false,getGamepads:()=>[],vibrate(){}},
    getComputedStyle:()=>({top:"0px",left:"0px",bottom:"0px",right:"0px"}),
    requestAnimationFrame:f=>{rafQ.push(f);return rafQ.length},cancelAnimationFrame(){},
    setInterval:()=>1,clearInterval(){},addEventListener:(t,f)=>{(winL[t]=winL[t]||[]).push(f)},
    setTimeout:()=>1,clearTimeout(){},
    fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0x8000)}),
    location:{href:"",replace(){}},
    AudioContext:function(){return{sampleRate:48000,resume(){},suspend(){},currentTime:0,
      createBuffer:(c,n)=>({getChannelData:()=>new Float32Array(n)}),createBufferSource:()=>({connect(){},start(){}})}},
    Binjgb:async()=>({}),FileReader:function(){this.readAsArrayBuffer=()=>{}},
    indexedDB:undefined,
    Uint8Array,Uint8ClampedArray,Math,JSON,Promise,Number,String,Object,Array,Date,Error,isFinite,Set,Map,RegExp,Boolean};
  sb.window=sb; sb.globalThis=sb; vm.createContext(sb);
  for(const f of ["game.js","ui.js","pad.js"]) vm.runInContext(fs.readFileSync(D+"/"+f,"utf8"),sb,{filename:f});
  vm.runInContext(pageJs,sb,{filename:"index.html"});
  /* 시스템·조작판 상태를 맞추고 다시 잽니다 */
  vm.runInContext(`ui._reset();`,sb);
  if(system!=="gb") vm.runInContext(`ui.pickSystem(${JSON.stringify(system)});`,sb);
  if(!padOn) vm.runInContext(`ui.togglePad();`,sb);
  vm.runInContext(`lastFitKey=""; fit(); draw();`,sb);

  const out={ W,H,system,padOn,
    dev:{x:px(els.dev.style.cssText,"left")||0,y:0,
         w:parseFloat(els.dev.style.width)||0,h:parseFloat(els.dev.style.height)||0},
    boxes:[] };
  out.dev.x=parseFloat(els.dev.style.left)||0; out.dev.y=parseFloat(els.dev.style.top)||0;
  const add=(id,label)=>{
    const e=els[id]; if(!e) return;
    if(e.style.display==="none") return;
    const c=e.style.cssText;
    let x=px(c,"left"), y=px(c,"top"), w=px(c,"width"), h=px(c,"height");
    if(x===null) x=parseFloat(e.style.left);
    if(y===null) y=parseFloat(e.style.top);
    if(w===null) w=parseFloat(e.style.width);
    if(h===null) h=parseFloat(e.style.height);
    if([x,y,w,h].some(v=>v===null||isNaN(v))) return;
    out.boxes.push({id,label,x,y,w,h});
  };
  /* stage 는 dev 기준 절대 좌표 */
  const st=els.stage;
  out.boxes.push({id:"stage",label:"GAME",x:parseFloat(st.style.left),y:parseFloat(st.style.top),
                  w:parseFloat(st.style.width),h:parseFloat(st.style.height)});
  /* 좌우 판 */
  for(const p of ["paneL","paneR"]){
    const e=els[p];
    out.boxes.push({id:p,label:"",x:parseFloat(e.style.left),y:0,
                    w:parseFloat(e.style.width),h:out.dev.h});
  }
  /* ★ 이제 place() 가 style.left/top 을 직접 넣습니다 (cssText 누적 폐지).
       cssText 를 읽으면 빈 문자열이라 **아무것도 못 재게 됩니다.**
       실제로 처음에 그렇게 재놓고 "겹침 없음"이라고 착각했습니다. */
  const num=(e,k)=>{ const v=parseFloat(e.style[k]); return isNaN(v)?null:v; };
  const rx=num(els.paneR,"left")||0;
  for(const [id,label] of [["btnA","A"],["btnB","B"],["btnSel","SEL"],["btnSta","STA"],
                            ["btnL","L"],["btnR","R"]]){
    const e=els[id]; if(!e||e.style.display==="none") continue;
    const x=num(e,"left"),y=num(e,"top"),w=num(e,"width"),h=num(e,"height");
    if([x,y,w,h].some(v=>v===null)) { console.log("!! 못 잼: "+id); continue; }
    out.boxes.push({id,label,x:x+rx,y,w,h});
  }
  /* info 는 left/top 을 직접 씀 */
  { const e=els.info;
    const x=parseFloat(e.style.left)+rx, y=parseFloat(e.style.top),
          w=parseFloat(e.style.width), h=parseFloat(e.style.height);
    if(!isNaN(x)&&!isNaN(y)) out.boxes.push({id:"info",label:"INFO",x,y,w,h}); }
  /* 왼쪽: 십자키 + 글자크기 버튼 */
  { const e=els.padHint;
    out.boxes.push({id:"padHint",label:"DPAD",x:parseFloat(e.style.left),y:parseFloat(e.style.top),
                    w:parseFloat(e.style.width),h:parseFloat(e.style.height)}); }
  for(const [id,label] of [["fsUp","A+"],["fsDn","A-"]]){
    const e=els[id];
    const x=num(e,"left"),y=num(e,"top"),w=num(e,"width"),h=num(e,"height");
    if([x,y,w,h].every(v=>v!==null)) out.boxes.push({id,label,x,y,w,h});
    else console.log("!! 못 잼: "+id);
  }
  /* ★ 재야 할 것을 하나라도 못 쟀으면 시끄럽게 알립니다.
       조용히 건너뛰면 "겹침 없음" 이 거짓말이 됩니다. */
  const must=["btnA","btnB","btnSel","btnSta","fsUp","fsDn","padHint","stage"]
    .concat(system==="gba"?["btnL","btnR"]:[]);
  const got=new Set(out.boxes.map(b=>b.id));
  const miss=must.filter(m=>!got.has(m));
  if(miss.length) throw new Error("측정 실패 — 못 잰 것: "+miss.join(","));
  /* 구석 존 — flex 라 정확한 폭은 CSS 가 정합니다. 대략값으로 표시만 */
  { const z=els.zone;
    const zx=parseFloat(z.style.left), zy=parseFloat(z.style.top), zw=parseFloat(z.style.width);
    if(isNaN(zx)||isNaN(zw)) throw new Error("측정 실패 — zone 자리를 못 쟀음");
    out.boxes.push({id:"zone",label:"MENU/CLR/PAD",x:zx,y:zy||6,w:zw,h:parseFloat(z.style.height)});
    out.zone={ main:els.zMain.textContent, clr:els.zClr.textContent,
               clrShown: els.zClr.style.display!=="none" }; }
  return out;
}

const CASES=[
  ["아이폰SE 가로 16:9",667,375],
  ["아이폰15 가로",852,393],
  ["갤럭시S 가로 20:9",900,411],
  ["아이패드 가로 4:3",1080,810],
  ["아주 좁음",568,320],
];
const results=[];
/* ★ 조작판을 끈 상태는 CSS(.hidepad)가 버튼을 전부 숨깁니다.
     이 스크립트는 CSS 를 안 보므로 그 상태의 버튼 좌표는 뜻이 없습니다.
     그래서 조작판이 켜진 경우만 잽니다. */
for(const [name,W,H] of CASES)
  for(const sys of ["gb","gbc","gba"])
    results.push({name:`${name} / ${sys.toUpperCase()}`, ...layout(W,H,sys,true)});
fs.writeFileSync(process.argv[2]||"layout.json", JSON.stringify(results,null,1));
console.log("케이스 "+results.length+"개 기록");

/* 겹침 검사 — 손가락으로 누르는 것끼리 겹치면 안 됩니다 */
const TOUCH=["btnA","btnB","btnSel","btnSta","btnL","btnR","fsUp","fsDn","padHint","stage","zone","info"];
let bad=0;
for(const r of results){
  const bs=r.boxes.filter(b=>TOUCH.includes(b.id));
  for(let i=0;i<bs.length;i++) for(let j=i+1;j<bs.length;j++){
    const a=bs[i],b=bs[j];
    const ox=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
    const oy=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
    if(ox>0&&oy>0){ console.log(`★겹침 ${r.name}: ${a.id} × ${b.id} (${ox.toFixed(0)}x${oy.toFixed(0)}px)`); bad++; }
  }
  /* 화면 밖으로 나가는 것 */
  for(const b of r.boxes){
    if(b.x<-1||b.y<-1||b.x+b.w>r.dev.w+1||b.y+b.h>r.dev.h+1)
      { console.log(`★밖으로 ${r.name}: ${b.id} (${b.x.toFixed(0)},${b.y.toFixed(0)} ${b.w.toFixed(0)}x${b.h.toFixed(0)}) 기기 ${r.dev.w}x${r.dev.h}`); bad++; }
    if((b.w<=0||b.h<=0) && b.id!=="info")   /* info 는 자리가 없으면 0 이 정상 (overflow:hidden) */
      { console.log(`★크기0 ${r.name}: ${b.id} ${b.w}x${b.h}`); bad++; }
  }
}
console.log(bad? `\n★ 문제 ${bad}건` : "\n겹침·이탈 없음");
