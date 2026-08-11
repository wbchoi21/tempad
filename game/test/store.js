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

console.log("\n[9] ★★ 어느 기기 것인지(system)를 제대로 다루는가");
{ global.indexedDB = makeIDB();
  delete require.cache[require.resolve(path.join(__dirname,"..","game.js"))];
  const G = require(path.join(__dirname,"..","game.js"));

  const gb = gbRom(0x11, "MINE");
  const rec = await G.RomStore.add(gb, "MINE.gb", { system:"gb" });
  ok("게임보이로 들어감", rec.system==="gb", rec.system);

  /* ★★★ 같은 롬을 다시 넣어도 **기록이 딴 목록으로 이사 가면 안 됩니다.**
         이사 가면 목록에서 사라지고, 슬롯 세이브가 "다른 기기의 것" 이라며
         영영 안 읽힙니다. 실제로 LIBBET·TOBU DX 가 그렇게 사라졌습니다.
         (2026-08-11 교차검사에서 잡았습니다.) */
  const rec2 = await G.RomStore.add(gb, "MINE-again.gb", { system:"gbc" });
  ok("★★★ 넣는 쪽이 다른 시스템을 우겨도 처음 것을 지킴", rec2.system==="gb", rec2.system);
  const back = await G.RomStore.get(rec.id);
  ok("★★ 저장소에도 처음 것으로 남아 있음", back.system==="gb", back.system);
  ok("★ 이름도 처음 것", back.file==="MINE.gb", back.file);

  /* ★ 안 넘기면 롬을 보고 스스로 정합니다 */
  const cgb = gbRom(0x22, "COLOR"); cgb[0x143]=0x80;
  const rc = await G.RomStore.add(cgb, "C.gb");
  ok("★ 안 넘기면 롬을 보고 정함 (0x80 → gbc)", rc.system==="gbc", rc.system);

  /* ★ 옛 기록(system 없음)을 get 으로 읽으면 채워줘야 합니다.
       안 채우면 슬롯에 엉뚱한 시스템이 찍혀 세이브가 영구 손실됐습니다. */
  const old = await G.RomStore.get(rec.id);
  delete old.system;
  await G.RomStore.patch(rec.id, { system: undefined });
  const fixed = await G.RomStore.get(rec.id);
  ok("★★ 옛 기록도 읽을 때 시스템이 채워짐", fixed.system==="gb", String(fixed.system));
  const listed = await G.RomStore.list();
  ok("★ 목록에서도 채워짐", listed.every(r=>!!r.system),
     listed.map(r=>r.id+":"+r.system).join(","));

  /* ★★★ v1 때 넣은 기록(system 칸이 아예 없음)을 **다시 넣었을 때** —
         새 판별값으로 덮어쓰면 게임이 딴 목록으로 사라집니다.
         v1 에는 게임보이 목록 하나뿐이었으니 "gb" 로 남겨야 합니다.
         (2026-08-11 교차검사에서 잡았습니다.) */
  const oldCgb = gbRom(0x55, "POKEGOLD"); oldCgb[0x143]=0x80;   /* 내용은 gbc */
  const made = await G.RomStore.add(oldCgb, "GOLD.gb", { system:"gb" });
  ok("(준비) v1 처럼 gb 로 들어감", made.system==="gb", made.system);
  await G.RomStore.patch(made.id, { system: undefined });        /* v1 기록 흉내 */
  const raw = await G.RomStore.get(made.id);
  ok("(준비) get 은 채워서 줌", raw.system==="gb", String(raw.system));
  /* 같은 파일을 다시 넣습니다 (롬 묶음 폴더를 통째로 다시 넣는 상황) */
  const again = await G.RomStore.add(oldCgb, "GOLD.gb");
  ok("★★★ 옛 기록이 딴 목록으로 안 옮겨감", again.system==="gb", again.system);
  const list2 = await G.RomStore.list();
  ok("★★ 목록에서도 게임보이 그대로",
     (list2.find(r=>r.id===made.id)||{}).system==="gb",
     (list2.find(r=>r.id===made.id)||{}).system);
}

console.log("\n[10] ★★★ 넣기와 배터리 세이브가 겹쳐도 한쪽이 사라지면 안 됨");
{ /* 기본 게임에 슬롯 저장을 누르면 add() 가 돕니다. 그때 3초마다 도는
     배터리 세이브(patch)가 겹칠 수 있습니다. 예전에는 add 가 읽기·쓰기를
     **서로 다른 트랜잭션**으로 해서, 그 사이에 쓴 배터리 세이브가
     조용히 사라졌습니다. (2026-08-11 교차검사에서 재현해서 잡았습니다.) */
  global.indexedDB = makeIDB();
  delete require.cache[require.resolve(path.join(__dirname,"..","game.js"))];
  const G = require(path.join(__dirname,"..","game.js"));

  const rom = gbRom(0x33, "RACE");
  const first = await G.RomStore.add(rom, "RACE.gb", { system:"gb" });
  await G.RomStore.patch(first.id, { sram: new Uint8Array([1,2,3,4]) });

  /* 겹쳐서 돌립니다 */
  const a = G.RomStore.add(rom, "RACE.gb", { system:"gb" });
  const b = G.RomStore.patch(first.id, { sram: new Uint8Array([9,9,9,9]) });
  await Promise.all([a, b]);

  const after = await G.RomStore.get(first.id);
  const s = Array.from(after.sram || []);
  ok("★★★ 나중에 쓴 배터리 세이브가 살아있음", s.join(",")==="9,9,9,9", s.join(","));

  /* 슬롯 저장도 마찬가지로 안 날아가야 합니다 */
  await G.RomStore.patch(first.id, { states:[{rom:first.id,bytes:new Uint8Array([7])},null,null] });
  await G.RomStore.add(rom, "RACE.gb", { system:"gb" });
  const after2 = await G.RomStore.get(first.id);
  ok("★★ 다시 넣어도 슬롯 저장이 살아있음", !!(after2.states && after2.states[0]),
     JSON.stringify(after2.states));
}

console.log("\n[11] ★★★ 슬롯 두 칸을 연달아 저장해도 한쪽이 사라지면 안 됨");
{ /* 아이가 SLOT 1 에 저장하고 곧바로 SLOT 2 에 저장했는데, 나중에 SLOT 1 을
     불러오면 "EMPTY". 둘 다 "SAVED" 라고 말해놓고서요.
     읽고-쓰기가 두 트랜잭션에 걸쳐 있으면 나중 것이 앞의 배열을 통째로
     덮어씁니다. (2026-08-11 교차검사에서 재현해서 잡았습니다.) */
  global.indexedDB = makeIDB();
  delete require.cache[require.resolve(path.join(__dirname,"..","game.js"))];
  const G = require(path.join(__dirname,"..","game.js"));

  const rom = gbRom(0x44, "SLOTS");
  const rec = await G.RomStore.add(rom, "SLOTS.gb", { system:"gb" });

  /* 겹쳐서 — 진짜로 아이가 연달아 두드리는 상황 */
  const a = G.RomStore.putSlot(rec.id, 0, { rom:rec.id, system:"gb", bytes:new Uint8Array([1]) });
  const b = G.RomStore.putSlot(rec.id, 1, { rom:rec.id, system:"gb", bytes:new Uint8Array([2]) });
  ok("둘 다 저장됐다고 함", (await Promise.all([a,b])).every(Boolean));

  const after = await G.RomStore.get(rec.id);
  ok("★★★ SLOT 1 이 살아있음", !!(after.states && after.states[0]),
     JSON.stringify((after.states||[]).map(x=>!!x)));
  ok("★★★ SLOT 2 도 살아있음", !!(after.states && after.states[1]),
     JSON.stringify((after.states||[]).map(x=>!!x)));
  ok("★ 내용이 서로 안 섞임",
     after.states[0].bytes[0]===1 && after.states[1].bytes[0]===2,
     after.states[0].bytes[0]+"/"+after.states[1].bytes[0]);

  /* 세 칸을 한꺼번에 */
  await Promise.all([0,1,2].map(n =>
    G.RomStore.putSlot(rec.id, n, { rom:rec.id, system:"gb", bytes:new Uint8Array([n+10]) })));
  const all3 = await G.RomStore.get(rec.id);
  ok("★★ 세 칸 동시에 저장해도 다 살아있음",
     all3.states.every(s=>!!s), JSON.stringify(all3.states.map(x=>!!x)));

  /* 배터리 세이브와 겹쳐도 서로 안 지워야 합니다 */
  await G.RomStore.patch(rec.id, { sram:new Uint8Array([5,5]) });
  await Promise.all([
    G.RomStore.putSlot(rec.id, 0, { rom:rec.id, system:"gb", bytes:new Uint8Array([99]) }),
    G.RomStore.patch(rec.id, { sram:new Uint8Array([7,7]) }),
  ]);
  const mix = await G.RomStore.get(rec.id);
  ok("★★ 슬롯과 배터리 세이브가 서로 안 지움",
     !!mix.states[0] && !!mix.sram, JSON.stringify({s:!!mix.states[0], r:Array.from(mix.sram||[])}));

  /* 없는 기록에 저장하면 조용히 false */
  ok("★ 없는 기록이면 false", await G.RomStore.putSlot("없는것", 0, {x:1})===false);
}

console.log(`\n${"=".repeat(46)}\n통과 ${pass}  실패 ${fail}\n`);
process.exit(fail?1:0);
})();
