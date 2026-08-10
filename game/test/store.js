/* ============================================================================
   롬 보관소(RomStore) 검사 — ★ 여태 한 줄도 실행되지 않던 곳

   가짜 IndexedDB 를 끼워 진짜로 넣고 빼봅니다.
   여기서 심각한 버그 셋이 나왔습니다.
   ========================================================================== */
const path=require("path");
const { makeIDB } = require("./idb.js");
let pass=0,fail=0;
const ok=(n,c,x)=>{ if(c){pass++;console.log("  OK   "+n);} else {fail++;console.log("  ★실패 "+n+(x?"  → "+x:""));} };

const LOGO=[0xCE,0xED,0x66,0x66,0xCC,0x0D,0x00,0x0B,0x03,0x73,0x00,0x83,0x00,0x0C,0x00,0x0D];
function gbRom(fill, title){
  const b=new Uint8Array(0x8000); b.fill(fill);
  LOGO.forEach((v,i)=>b[0x104+i]=v);
  for(let i=0x134;i<=0x142;i++) b[i]=0;
  (title||"").split("").forEach((c,i)=>b[0x134+i]=c.charCodeAt(0));
  b[0x143]=0;
  return b;
}
function fresh(opts){
  global.indexedDB = makeIDB(opts||{});
  const P=path.join(__dirname,"..","game.js");
  delete require.cache[require.resolve(P)];
  return require(P);
}

(async()=>{
console.log("\n[1] 넣고 읽기");
{ const G=fresh();
  const rom=gbRom(7,"TESTGAME");
  const rec=await G.RomStore.add(rom,"my.gb");
  ok("들어감", !!rec && !!rec.id);
  ok("제목을 헤더에서 읽음", rec.title==="TESTGAME", rec.title);
  const got=await G.RomStore.get(rec.id);
  ok("다시 읽힘", !!got && got.id===rec.id);
  ok("롬 내용이 그대로", got.rom.length===rom.length && got.rom[0x104]===0xCE);
  const list=await G.RomStore.list();
  ok("목록에 하나", list.length===1, list.length+"개");
  ok("★ 목록에는 롬 내용을 안 담음", list[0].rom===undefined);
}

console.log("\n[2] ★★ 같은 롬을 다시 넣어도 저장이 지워지면 안 됨");
{ const G=fresh();
  const rom=gbRom(7,"KEEPME");
  const a=await G.RomStore.add(rom,"my.gb");
  await G.RomStore.patch(a.id,{ sram:new Uint8Array([1,2,3]),
                                states:[new Uint8Array([9]),null,null], played:12 });
  await G.RomStore.add(rom,"my.gb");                 /* 같은 롬을 또 */
  const after=await G.RomStore.get(a.id);
  ok("★ 배터리 세이브가 살아있음", after.sram && after.sram.length===3,
     after.sram?after.sram.length+"바이트":"날아감");
  ok("★ 슬롯 저장이 살아있음", !!(after.states && after.states[0]),
     JSON.stringify(after.states && after.states.map(x=>!!x)));
  ok("★ 플레이 횟수도 유지", after.played===12, after.played);
}

console.log("\n[2-2] ★ 다시 넣어도 이름·파일명이 안 바뀜");
{ const G=fresh();
  const rom=gbRom(7,"HDRNAME");
  const a=await G.RomStore.add(rom,"tobu.gb");
  const b=await G.RomStore.add(rom,"전혀다른이름.gb");
  ok("★ 파일 이름은 처음 것", b.file==="tobu.gb", b.file);
  ok("★ 제목도 처음 것", b.title==="HDRNAME", b.title);
  ok("기록이 하나뿐", (await G.RomStore.list()).length===1);
}

console.log("\n[3] ★ 없는 것을 찾으면 null 이어야 함");
{ const G=fresh();
  const r=await G.RomStore.get("없는-id");
  ok("★ get 이 null", r===null, JSON.stringify(r));
  const p=await G.RomStore.patch("없는-id",{played:1});
  ok("★ patch 도 null", p===null, JSON.stringify(p));
}

console.log("\n[4] ★ 낡은 기록 하나가 목록 전체를 망가뜨리면 안 됨");
{ const G=fresh();
  await G.RomStore.add(gbRom(1,"GOOD"),"good.gb");
  /* states 가 없는 옛 기록을 직접 밀어넣습니다 */
  const db=await new Promise(r=>{ const q=indexedDB.open("tempad.games",1); q.onsuccess=()=>r(q.result); });
  await new Promise(r=>{ const t=db.transaction("roms","readwrite");
    t.objectStore("roms").put({id:"old-1",title:"LEGACY",rom:new Uint8Array(4)});
    t.oncomplete=r; });
  db.close();
  const list=await G.RomStore.list();
  ok("★ 목록이 안 무너짐", Array.isArray(list) && list.length===2, list.length+"개");
  const legacy=list.find(x=>x.id==="old-1");
  ok("★ 낡은 기록도 읽힘", !!legacy && Array.isArray(legacy.states),
     legacy?JSON.stringify(legacy.states):"없음");
}

console.log("\n[4-2] ★★ 동시에 저장해도 한쪽이 사라지면 안 됨");
{ const G=fresh();
  const a=await G.RomStore.add(gbRom(9,"RACE"),"race.gb");
  /* 슬롯 저장과 배터리 세이브가 겹치는 상황.
     아드님이 저장을 누른 그 순간 게임이 스스로 저장하면 실제로 일어납니다. */
  await Promise.all([
    G.RomStore.patch(a.id,{ states:[new Uint8Array([1]),null,null] }),
    G.RomStore.patch(a.id,{ sram:new Uint8Array([2,2]) }),
  ]);
  const after=await G.RomStore.get(a.id);
  ok("★ 슬롯 저장이 살아있음", !!(after.states && after.states[0]),
     "슬롯 "+JSON.stringify(after.states && after.states.map(x=>!!x)));
  ok("★ 배터리 세이브도 살아있음", !!(after.sram && after.sram.length===2),
     "sram "+(after.sram?after.sram.length+"바이트":"null"));

  /* 세 개 동시 */
  const b=await G.RomStore.add(gbRom(10,"RACE3"),"r3.gb");
  await Promise.all([
    G.RomStore.patch(b.id,{ states:[new Uint8Array([1]),null,null] }),
    G.RomStore.patch(b.id,{ sram:new Uint8Array([2]) }),
    G.RomStore.patch(b.id,{ played:7 }),
  ]);
  const c=await G.RomStore.get(b.id);
  ok("★ 셋 다 살아있음", !!(c.states&&c.states[0]) && !!c.sram && c.played===7,
     `슬롯 ${!!(c.states&&c.states[0])} sram ${!!c.sram} 횟수 ${c.played}`);
}

console.log("\n[5] 지우기");
{ const G=fresh();
  const a=await G.RomStore.add(gbRom(3,"DEL"),"a.gb");
  await G.RomStore.remove(a.id);
  ok("지워짐", (await G.RomStore.get(a.id))===null);
  ok("목록도 비었음", (await G.RomStore.list()).length===0);
  ok("없는 걸 지워도 안 터짐", await G.RomStore.remove("없음")===undefined || true);
}

console.log("\n[6] 롬 구분");
{ const G=fresh();
  const a=gbRom(1,"A"), b=gbRom(2,"B");
  ok("다른 롬은 다른 열쇠", G.romKey(a)!==G.romKey(b));
  ok("같은 롬은 같은 열쇠", G.romKey(a)===G.romKey(gbRom(1,"A")));
  await G.RomStore.add(a,"a.gb"); await G.RomStore.add(b,"b.gb");
  ok("둘 다 목록에", (await G.RomStore.list()).length===2);
  const c=new Uint8Array(a); c[9999]^=0xFF;
  ok("한 바이트만 달라도 구분", G.romKey(a)!==G.romKey(c));
}

console.log("\n[7] 진짜 게임보이 롬인지 보기");
{ const G=fresh();
  ok("진짜 롬은 통과", G.looksLikeGb(gbRom(1,"X"))===true);
  const txt=new Uint8Array(0x8000); txt.fill(65);
  ok("★ 텍스트 파일은 거부", G.looksLikeGb(txt)===false);
  ok("너무 작으면 거부", G.looksLikeGb(new Uint8Array(10))===false);
  ok("빈 것도 거부", G.looksLikeGb(null)===false);
  const fs=require("fs");
  for(const f of ["2048.gb","tobu.gb","WORDLE.gb","libbet.gb","tobudx.gb"]){
    const b=new Uint8Array(fs.readFileSync(path.join(__dirname,"..","roms",f)));
    ok("진짜 롬 "+f+" 통과", G.looksLikeGb(b)===true);
  }
}

console.log("\n[7-2] ★ 실패해도 연결이 새면 안 됨");
{ let opened=0, closed=0;
  const base=makeIDB({putFails:true});
  global.indexedDB={ open:(...a)=>{ opened++; const r=base.open(...a);
      const s0=Object.getOwnPropertyDescriptor(r,"onsuccess");
      let f=null;
      Object.defineProperty(r,"onsuccess",{ get:()=>f, set:v=>{ f=e=>{ const h=r.result;
        if(h && !h.__w){ h.__w=1; const c=h.close.bind(h); h.close=()=>{ closed++; c(); }; }
        v(e); }; } });
      return r; } };
  const P=path.join(__dirname,"..","game.js");
  delete require.cache[require.resolve(P)];
  const G=require(P);
  for(let i=0;i<5;i++){ try{ await G.RomStore.add(gbRom(i,"X"),"x.gb"); }catch(e){} }
  ok("★ 저장이 실패해도 연결을 닫음", closed===opened, "연 "+opened+" 닫은 "+closed);
}

console.log("\n[8] 보관소가 말썽일 때");
{ const G=fresh({putFails:true});
  let threw=false;
  try{ await G.RomStore.add(gbRom(1,"X"),"x.gb"); }catch(e){ threw=true; }
  ok("저장 실패를 위로 알림", threw);
}
{ global.indexedDB=undefined;
  const P=path.join(__dirname,"..","game.js");
  delete require.cache[require.resolve(P)];
  const G=require(P);
  let msg=null;
  try{ await G.RomStore.list(); }catch(e){ msg=e.message; }
  ok("저장소가 아예 없으면 알림", msg==="no-indexeddb", msg);
}

console.log(`\n${"=".repeat(46)}\n통과 ${pass}  실패 ${fail}\n`);
process.exit(fail?1:0);
})();
