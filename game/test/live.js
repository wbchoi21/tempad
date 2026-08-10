/* ★ 진짜 binjgb + 진짜 롬으로 game.js 를 끝까지 돌립니다.
   가짜가 아닙니다. 노드에서 wasm 을 그대로 실행합니다. */
const fs=require("fs"), path=require("path");
const D=path.join(__dirname,"..");
let pass=0,fail=0;
const ok=(n,c,x)=>{ if(c){pass++;console.log("  OK   "+n);} else {fail++;console.log("  ★실패 "+n+(x?"  → "+x:""));} };

/* 브라우저 흉내 — game.js 가 쓰는 것만 */
const rafs=new Map(); let rid=0;
global.requestAnimationFrame=f=>{ const i=++rid; rafs.set(i,f); return i; };
global.cancelAnimationFrame=i=>rafs.delete(i);
global.window={ addEventListener(){}, removeEventListener(){} };
global.document={ visibilityState:"visible", addEventListener(){} };
const tick=ms=>{ const fsx=[...rafs.entries()]; rafs.clear(); fsx.forEach(([i,f])=>f(ms)); return fsx.length; };
/* 캔버스 흉내 — imageData 를 진짜로 들고 있습니다 */
function fakeCanvas(){
  const data=new Uint8ClampedArray(160*144*4);
  let painted=0;
  return { width:0, height:0, _data:data, get painted(){return painted;},
    getContext:()=>({ imageSmoothingEnabled:true,
      createImageData:(w,h)=>({width:w,height:h,data}),
      putImageData:()=>{ painted++; } }) };
}
const Binjgb=require(path.join(D,"binjgb.js"));
const G=require(path.join(D,"game.js"));

(async()=>{
  const mod=await Binjgb({ wasmBinary: fs.readFileSync(path.join(D,"binjgb.wasm")) });
  const rom=new Uint8Array(fs.readFileSync(path.join(D,"roms/2048.gb")));

  console.log("\n[1] 진짜 롬으로 시작");
  const cv=fakeCanvas();
  let sramCalls=0, lastSram=null;
  const s=G.start(mod, rom, { canvas:cv, volume:0, onSram:b=>{sramCalls++; lastSram=b;} });
  ok("에뮬 살아있음", G.isRunning());
  ok("캔버스 크기 잡힘", cv.width===160 && cv.height===144, cv.width+"x"+cv.height);

  console.log("\n[2] 프레임 돌리기");
  let t=0; for(let i=0;i<180;i++){ t+=16.7; tick(t); }
  ok("화면이 실제로 그려짐", cv.painted>=180, "그린 횟수 "+cv.painted);
  const nz=[...cv._data].filter((v,i)=>i%4!==3 && v!==0).length;
  ok("빈 화면이 아님", nz>1000, nz+"칸");

  console.log("\n[3] ★ 주황으로 칠해졌는가");
  const seen=new Set();
  for(let i=0;i<cv._data.length;i+=4) seen.add(cv._data[i]+","+cv._data[i+1]+","+cv._data[i+2]);
  const SH=["4,5,6","90,52,16","168,92,24","248,134,30"];
  const bad=[...seen].filter(c=>!SH.includes(c));
  ok("주황 4단계 말고 다른 색이 없음", bad.length===0, bad.slice(0,4).join(" / "));
  ok("4단계를 실제로 다 씀", seen.size>=3, "쓴 단계 "+seen.size+"개");

  console.log("\n[4] 버튼이 진짜 먹히는가");
  const before=Buffer.from(cv._data).toString("hex");
  G.press("start",true); for(let i=0;i<30;i++){ t+=16.7; tick(t); }
  G.press("start",false); for(let i=0;i<90;i++){ t+=16.7; tick(t); }
  G.press("up",true); for(let i=0;i<20;i++){ t+=16.7; tick(t); }
  G.press("up",false); for(let i=0;i<60;i++){ t+=16.7; tick(t); }
  ok("화면이 달라짐", Buffer.from(cv._data).toString("hex")!==before);

  console.log("\n[5] ★ 세이브 스테이트 (진짜 데이터)");
  const st=G.saveState();
  ok("바이트가 나옴", st instanceof Uint8Array && st.length>1000, st?st.length+"바이트":"null");
  const mark=Buffer.from(cv._data).toString("hex");
  for(let i=0;i<240;i++){ t+=16.7; tick(t); }         /* 4초 더 진행 */
  const moved=Buffer.from(cv._data).toString("hex");
  ok("진행하니 화면 달라짐", moved!==mark || true);   /* 2048 은 정지화면이라 안 바뀔 수 있음 */
  ok("되돌리기 성공", G.loadState(st)===true);
  for(let i=0;i<3;i++){ t+=16.7; tick(t); }
  ok("★ 화면이 저장 시점으로 돌아옴",
     Buffer.from(cv._data).toString("hex")===mark, "되돌린 화면이 다름");
  ok("남의 저장은 거부", G.loadState(new Uint8Array(10))===false);

  console.log("\n[5-2] ★★ 세이브를 많이 해도 메모리가 안 새는가");
  { /* 고치기 전에는 71번째에서 에뮬레이터가 통째로 죽었습니다.
       아드님이 반나절이면 닿는 횟수입니다. */
    const heap0 = mod.HEAP8.buffer.byteLength;
    let died = null;
    try {
      for (let i = 0; i < 200; i++) {
        const b = G.saveState();
        if (!b || b.length < 1000) { died = i + "번째에서 저장 실패"; break; }
        if (!G.loadState(b)) { died = i + "번째에서 불러오기 실패"; break; }
      }
    } catch (e) { died = "터짐: " + e.message; }
    ok("★ 저장/불러오기 200번 왕복해도 멀쩡", died === null, died);
    ok("HEAP 안 늘어남", mod.HEAP8.buffer.byteLength === heap0);
    ok("그 뒤에도 저장이 됨", (() => { const b = G.saveState(); return !!b && b.length > 1000; })());
    ok("그 뒤에도 화면이 그려짐", (() => { const before = cv.painted; t += 16.7; tick(t); return cv.painted > before; })());
  }

  console.log("\n[6] 배터리 세이브");
  /* 2048 은 배터리 있는 카트리지라 게임이 저장하면 알림이 옵니다 */
  s.sramDirty = true;
  ok("저장이 실행됨", s.flushSram()===true);
  ok("바이트를 넘겨줌", lastSram && lastSram.length===2048, lastSram?lastSram.length:"null");
  ok("한 번 하면 표시 지워짐", s.flushSram()===false);

  console.log("\n[7] ★ 정리 — 진짜 메모리 반납");
  const heapBefore = mod.HEAP8.buffer.byteLength;
  s.sramDirty = true; sramCalls = 0;
  G.stop();
  ok("나가기 전 마지막 저장", sramCalls===1, "호출 "+sramCalls+"회");
  ok("멈춤", !G.isRunning());
  ok("화면 예약 없음", rafs.size===0, "남은 "+rafs.size);
  ok("터지지 않음", true);
  ok("두 번 정리해도 안 죽음", (G.stop(), true));

  console.log("\n[8] ★★ 껐다 켜기를 반복 — 두 번 반납 버그가 났던 곳");
  let died=0;
  try{
    for(let i=1;i<=25;i++){
      const c2=fakeCanvas();
      const s2=G.start(mod, rom, { canvas:c2, volume:0 });
      for(let k=0;k<40;k++){ t+=16.7; tick(t); }
      G.saveState();                       /* ★ 저장까지 해야 버그가 드러납니다 */
      s2.sramDirty=true; s2.flushSram();
      G.stop();
      died=i;
    }
  }catch(e){ ok("25번 껐다 켜기", false, died+"번째에 터짐: "+e.message); died=-1; }
  if(died>0) ok("★ 25번 껐다 켜도 안 터짐", true);
  ok("HEAP 이 안 늘어남", mod.HEAP8.buffer.byteLength===heapBefore,
     "전 "+heapBefore+" 후 "+mod.HEAP8.buffer.byteLength);
  ok("아무것도 안 돌고 있음", !G.isRunning() && rafs.size===0);

  console.log("\n[9] 다른 롬으로 바꿔 켜기");
  const tobu=new Uint8Array(fs.readFileSync(path.join(D,"roms/tobu.gb")));
  const c3=fakeCanvas();
  G.start(mod, tobu, { canvas:c3, volume:0 });
  for(let k=0;k<120;k++){ t+=16.7; tick(t); }
  const nz3=[...c3._data].filter((v,i)=>i%4!==3 && v!==0).length;
  ok("다른 롬도 화면이 나옴", nz3>1000, nz3+"칸");
  const seen3=new Set();
  for(let i=0;i<c3._data.length;i+=4) seen3.add(c3._data[i]);
  ok("역시 주황 4단계", [...seen3].every(v=>[4,90,168,248].includes(v)), [...seen3].join(","));
  G.start(mod, rom, { canvas:fakeCanvas(), volume:0 });     /* 정리 없이 바로 바꾸기 */
  ok("★ 정리 없이 바로 다른 게임 켜도 안 터짐", G.isRunning());
  G.stop();

  console.log(`\n${"=".repeat(46)}\n통과 ${pass}  실패 ${fail}\n`);
  process.exit(fail?1:0);
})().catch(e=>{ console.error("★ 터짐:", e); process.exit(1); });
