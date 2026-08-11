/* 브라우저와 binjgb 를 흉내내는 가짜 환경 */
let log = [];
const rec = (n, ...a) => log.push(n);

/* ── 가짜 DOM ──────────────────────────────────────────────────────── */
function makeDom(){
  const listeners = {};
  let rafId = 0; const rafs = new Map();
  const audio = { state:"running", currentTime:0, sampleRate:48000,
    resume(){ this.state="running"; rec("audio.resume"); },
    suspend(){ this.state="suspended"; rec("audio.suspend"); },
    createBuffer:(c,n,r)=>({ getChannelData:()=>new Float32Array(n) }),
    createBufferSource:()=>({ connect(){}, start(){}, buffer:null }) };
  global.AudioContext = function(){ return audio; };
  global.window = { addEventListener:(t,f)=>{ (listeners[t]=listeners[t]||[]).push(f); },
                    removeEventListener(){}, };
  global.document = { visibilityState:"visible",
    addEventListener:(t,f)=>{ (listeners[t]=listeners[t]||[]).push(f); } };
  global.requestAnimationFrame = f => { const id=++rafId; rafs.set(id,f); return id; };
  global.cancelAnimationFrame = id => { rafs.delete(id); rec("raf.cancel"); };
  const timers = new Map(); let tid=0;
  global.setInterval = (f,ms) => { const id=++tid; timers.set(id,f); return id; };
  global.clearInterval = id => { if(timers.has(id)) rec("interval.clear"); timers.delete(id); };
  global.indexedDB = undefined;
  return { listeners, rafs, timers, audio,
           fire:(t,ev)=>(listeners[t]||[]).forEach(f=>f(ev||{})),
           tick:(ms)=>{ const fs=[...rafs.entries()]; rafs.clear(); fs.forEach(([id,f])=>f(ms)); return fs.length; },
           /* ★ 예전에는 인터벌 콜백을 **저장만 하고 아무도 안 불렀습니다.**
                그래서 3초마다 도는 자동저장이 검사에서 한 줄도 안 돌았습니다.
                이제 검사가 직접 터뜨릴 수 있습니다. */
           tickTimers:(n=1)=>{ let ran=0;
             for(let k=0;k<n;k++) for(const f of [...timers.values()]) { try{ f(); }catch(e){} ran++; }
             return ran; } };
}

/* ── 가짜 binjgb ───────────────────────────────────────────────────── */
function makeModule(opt={}){
  const HEAP = new ArrayBuffer(1<<20);
  let next = 1024;
  const alloc = n => { const p=next; next+=n+16; return p; };
  const alive = new Set();
  let ticks = 0, sramDirty = false;
  const fdSize = new Map();
  const ownedRom = new Map();
  const m = {
    HEAP8: { buffer: HEAP },
    _malloc: n => { const p=alloc(n); alive.add("mem"+p); return p; },
    /* _free 는 어느 쪽 껍데기든 돌려줍니다 (진짜와 같게) */
    _free: p => { alive.delete("mem"+p); alive.delete("fd"+p); rec("free"); },
    /* ★ 진짜 binjgb 는 emulator_delete 가 롬 메모리까지 반납합니다.
         그래서 여기서도 롬을 같이 지웁니다.
         (이걸 안 맞춰두면 "롬을 따로 free 해야 한다"는 잘못된 코드가 통과합니다) */
    _emulator_new_simple: (romPtr) => { if(opt.badRom) return 0;
        const p=alloc(64); alive.add("emu"+p); ownedRom.set(p, romPtr); return p; },
    _emulator_delete: p => { alive.delete("emu"+p);
        const r=ownedRom.get(p); if(r!==undefined){ alive.delete("mem"+r); ownedRom.delete(p); }
        rec("emu.delete"); },
    _joypad_new: () => { const p=alloc(8); alive.add("joy"+p); return p; },
    _joypad_delete: p => { alive.delete("joy"+p); rec("joy.delete"); },
    _rewind_new_simple: () => { const p=alloc(8); alive.add("rew"+p); return p; },
    _rewind_delete: p => { if(opt.throwOnRewindDelete) throw new Error("boom");
                           alive.delete("rew"+p); rec("rew.delete"); },
    _rewind_append: () => {},
    _emulator_set_default_joypad_callback: () => rec("joypad.bind"),
    _get_frame_buffer_ptr: () => alloc(160*144*4),
    _get_frame_buffer_size: () => 160*144*4,
    _get_audio_buffer_ptr: () => alloc(4096*4),
    _get_audio_buffer_capacity: () => 4096*4,
    _emulator_get_ticks_f64: () => ticks,
    _emulator_run_until_f64: (e,u) => { ticks = u; return 1|4; },
    _emulator_was_ext_ram_updated: () => { const d=sramDirty; sramDirty=false; return d?1:0; },
    /* ★★★ 여기가 이 프로젝트 최악의 버그가 살던 자리입니다. ★★★

       진짜 binjgb 의 FileData 는 **두 조각**입니다.
         · 껍데기 16바이트 (포인터와 크기를 담은 구조체)
         · 그 안에 든 자료 (세이브는 32KB, 스테이트는 195KB)

       `_file_data_delete(ptr)` 는 **속에 든 자료만** 돌려줍니다.
       껍데기는 그대로 남습니다. 그래서 `_free(ptr)` 를 따로 불러야 합니다.
       안 부르면 한 번 저장할 때마다 껍데기가 쌓이고, 그 껍데기가 돌려준
       195KB 자리를 가로막아 못 쓰게 만듭니다.
       **실제로 저장 71번째에 에뮬레이터가 영구히 멈췄습니다.**

       ★ 그런데 예전 가짜는 이 둘을 구분하지 않았습니다.
         alive 에 아무것도 안 넣어서, `_free` 를 통째로 빼도 검사가
         전부 통과했습니다. 방해검사로 이걸 잡았습니다(2026-08-11).
         이제 껍데기를 alive 로 추적합니다 — 진짜와 같은 규약으로. */
    _ext_ram_file_data_new: () => { const p=alloc(32); fdSize.set(p,32);
                                    alive.add("fd"+p); return p; },
    _state_file_data_new:   () => { const p=alloc(64); fdSize.set(p,64);
                                    alive.add("fd"+p); return p; },
    /* ★★★ 껍데기와 속은 **다른 주소**입니다. ★★★
         진짜 binjgb 에서 `_get_file_data_ptr(ptr)` 는 껍데기 안에 든
         **자료의 주소**를 돌려줍니다. 껍데기 주소(ptr)와 다릅니다.
         예전 가짜는 둘을 같은 값으로 줬습니다. 그래서
         `_free(_get_file_data_ptr(ptr))` 처럼 **엉뚱한 주소를 반납하는**
         코드를 써도 검사가 전부 통과했습니다.
         (진짜로 그러면 wasm 이 OOM 으로 죽습니다 — live.js 로 확인했습니다.)
         이 프로젝트가 제일 비싸게 배운 버그가 바로 이 혼동입니다.
         2026-08-11 교차검사에서 잡아 진짜와 같게 고쳤습니다.            */
    _get_file_data_ptr: p => p + 16,
    _get_file_data_size: p => fdSize.get(p) || 0,
    /* 속만 비웁니다. 껍데기(alive 의 "fd"+p)는 _free 가 와야 사라집니다. */
    _file_data_delete: p => { fdSize.delete(p); rec("filedata.delete"); },
    _emulator_write_ext_ram: () => rec("sram.write"),
    _emulator_read_ext_ram:  () => rec("sram.read"),
    _emulator_write_state:   () => rec("state.write"),
    _emulator_read_state:    () => { rec("state.read"); return opt.badState ? 1 : 0; },
    _alive: alive,
    _setSramDirty: v => { sramDirty = v; },
  };
  for(const b of ["up","down","left","right","A","B","start","select"])
    m["_set_joyp_"+b] = (e,v) => rec("joyp."+b+"="+(v?1:0));
  return m;
}
/* ── 가짜 캔버스 ───────────────────────────────────────────────────────
   ★ 화면에 **무엇이 찍혔는지** 봐야 할 때 씁니다. putImageData 로 들어온
     바이트를 그대로 들고 있습니다. 이게 없으면 "칠하기" 를 검사할 수
     없습니다 — 실제로 색이 지직거리는 버그를 아무도 못 봤습니다. */
function makeCanvas(w, h){
  const shots = [];
  const ctx = {
    imageSmoothingEnabled: true,
    createImageData: (cw, ch) => ({ width:cw, height:ch,
                                    data:new Uint8ClampedArray(4*cw*ch) }),
    putImageData: img => { shots.push(Uint8Array.from(img.data)); },
  };
  return { width:w||160, height:h||144, style:{},
           getContext: () => ctx,
           /* 마지막으로 찍힌 화면 */
           get last(){ return shots.length ? shots[shots.length-1] : null; },
           get count(){ return shots.length; },
           shots };
}

module.exports = { makeDom, makeModule, makeCanvas, log, reset:()=>{log.length=0;} };
