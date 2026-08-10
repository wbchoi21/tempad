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
           tick:(ms)=>{ const fs=[...rafs.entries()]; rafs.clear(); fs.forEach(([id,f])=>f(ms)); return fs.length; } };
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
    _free: p => { alive.delete("mem"+p); rec("free"); },
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
    _ext_ram_file_data_new: () => { const p=alloc(32); fdSize.set(p,32); return p; },
    _state_file_data_new:   () => { const p=alloc(64); fdSize.set(p,64); return p; },
    _get_file_data_ptr: p => p,
    _get_file_data_size: p => fdSize.get(p) || 0,
    _file_data_delete: () => rec("filedata.delete"),
    _emulator_write_ext_ram: () => rec("sram.write"),
    _emulator_read_ext_ram:  () => rec("sram.read"),
    _emulator_write_state:   () => rec("state.write"),
    _emulator_read_state:    () => rec("state.read"),
    _alive: alive,
    _setSramDirty: v => { sramDirty = v; },
  };
  for(const b of ["up","down","left","right","A","B","start","select"])
    m["_set_joyp_"+b] = (e,v) => rec("joyp."+b+"="+(v?1:0));
  return m;
}
module.exports = { makeDom, makeModule, log, reset:()=>{log.length=0;} };
