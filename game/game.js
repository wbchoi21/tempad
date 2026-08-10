/* ============================================================================
   TVA FIELD UNIT — 게임 모드

   게임보이 에뮬레이터(binjgb, MIT, Copyright 2017 Ben Smith)를 TemPad 화면에
   얹습니다. binjgb 의 demo.js 를 읽고 필요한 부분만 옮겨 심었습니다.

   [ demo.js 에서 뺀 것 ]
   Vue, 게임패드(우리는 터치), VGM 녹음, 슈퍼게임보이 테두리, WebGL 렌더러.
   WebGL 대신 Canvas2D 만 씁니다 — 화면을 주황으로 칠하려면 픽셀에 손대야 하는데
   Canvas2D 가 그게 쉽습니다. 160x144 라 성능도 문제없습니다.

   [ 더한 것 ]
   · 주황 4단계로 칠하기
   · 비정상 종료 방어 (아래 4장) ★ 이게 이 파일의 핵심입니다
   · 롬을 브라우저 안에 보관 (IndexedDB)

   [ 시험 ]
   브라우저 없이 검사할 수 있게 만들었습니다. 맨 아래 module.exports 참고.
   ========================================================================== */

"use strict";

/* ── 새 상태값은 반드시 여기, 맨 위에 ────────────────────────────────────
   let 을 아래에 선언하고 위에서 쓰면 앱이 통째로 안 켜집니다.
   이 프로젝트에서 같은 실수를 세 번 했습니다.                            */
let session   = null;    /* 지금 돌고 있는 게임. 없으면 null */
let audioCtx  = null;    /* 소리. 처음 필요할 때 만듭니다 */
let guardOn   = false;   /* 안전장치를 걸어뒀는지 */
/* ★ 몇 번째 "세대" 인가. 정리할 때마다 하나씩 올라갑니다.
     롬 파일을 읽는 동안(수십~수백ms) 사용자가 나가버리면,
     읽기가 끝난 뒤에 게임이 켜져서 아무도 모르게 뒤에서 돕니다.
     시작할 때 세대를 대조해서 그런 유령을 막습니다. */
let epoch = 0;

const SCREEN_W = 160, SCREEN_H = 144;
const AUDIO_FRAMES = 4096;
const AUDIO_LATENCY_SEC = 0.1;
const MAX_UPDATE_SEC = 5 / 60;
const CPU_TICKS_PER_SECOND = 4194304;
const CPU_TICKS_PER_60HZ = Math.floor(CPU_TICKS_PER_SECOND / 60);
const CGB_COLOR_CURVE = 2;

/* binjgb 가 돌려주는 사건 표시 (demo.js 와 같은 값) */
const EVENT_NEW_FRAME = 1;
const EVENT_AUDIO_BUFFER_FULL = 2;
const EVENT_UNTIL_TICKS = 4;

/* 되감기 버퍼. demo.js 는 4MB 인데 폰이라 1MB 로 줄였습니다.
   되감기 기능 자체는 안 쓰지만, 조작 입력이 이 안의 joypad 를 거치므로
   통째로 빼면 버튼이 안 먹습니다.                                        */
const REWIND_FRAMES_PER_BASE_STATE = 45;
const REWIND_BUFFER_CAPACITY = 1024 * 1024;

/* 주황 4단계 */
const SHADES = [[4,5,6],[90,52,16],[168,92,24],[248,134,30]];


/* ==========================================================================
   1. 색 바꾸기
   ========================================================================== */

/* 밝기(0~255) → 주황. 미리 표를 만들어두면 매 프레임 계산이 필요 없습니다. */
const TINT = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) {
  const s = SHADES[i >> 6];               /* 0~63,64~127,128~191,192~255 */
  TINT[i*3] = s[0]; TINT[i*3+1] = s[1]; TINT[i*3+2] = s[2];
}

/* RGBA 배열을 그 자리에서 주황으로 바꿉니다.
   160x144 = 23,040 칸이라 폰에서도 부담 없습니다. */
function tintOrange(data) {
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] * 299 + data[i+1] * 587 + data[i+2] * 114) / 1000 | 0;
    const k = (lum > 255 ? 255 : lum) * 3;
    data[i] = TINT[k]; data[i+1] = TINT[k+1]; data[i+2] = TINT[k+2];
    data[i+3] = 255;              /* ★ 투명도를 못 박습니다.
       createImageData 는 전부 투명(0)으로 시작합니다. 에뮬레이터가 255 를
       채워주는 걸 확인했지만, 하나라도 어긋나면 화면이 통째로 안 보입니다. */
  }
  return data;
}


/* ==========================================================================
   2. 롬 보관소 (IndexedDB)

   ★ localStorage 를 쓰면 안 됩니다.
     롬이 32KB~8MB 인데 localStorage 는 약 5MB 가 한계이고,
     글자만 담기니 JSON 으로 바꿔야 해서 크기가 3배 이상 불어납니다.

   ★ IndexedDB 는 file:// 에서 막힙니다. https 주소로 열어야 합니다.
   ========================================================================== */

const DB_NAME = "tempad.games", DB_VER = 1, STORE = "roms";

function openDB() {
  return new Promise((ok, no) => {
    if (typeof indexedDB === "undefined") { no(new Error("no-indexeddb")); return; }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath:"id" });
    };
    req.onsuccess = () => {
      const db = req.result;
      /* ★ 나중에 판을 올릴 때, 다른 탭이 옛 판을 붙들고 있으면
           그쪽이 비켜줘야 합니다. 안 그러면 열기가 영영 안 끝나고
           목록 화면이 빈 채로 멈춥니다. */
      db.onversionchange = () => { try { db.close(); } catch (e) {} };
      ok(db);
    };
    req.onerror   = () => no(req.error);
    /* ★ 이미 막혀 있으면 알려주고 끝냅니다. 이게 없으면 영영 기다립니다. */
    req.onblocked = () => no(new Error("db-blocked"));
  });
}

/* ★ 결과는 **항상 같은 방식으로** 벗깁니다.
     전에는 "값이 있으면 벗기고 없으면 요청 객체를 그대로" 였습니다.
     그래서 없는 것을 찾으면 null 이 아니라 요청 객체가 나왔고,
     받는 쪽의 "없으면" 검사가 전부 무력해졌습니다.
     같은 롬을 다시 넣으면 저장이 통째로 지워지던 것도 이것 때문입니다. */
function tx(db, mode, fn) {
  return new Promise((ok, no) => {
    const t = db.transaction(STORE, mode);
    /* ★ 실패 사유는 **요청** 쪽에서 가져와야 합니다.
         t.error 는 onerror 가 불리는 시점엔 아직 비어 있습니다(명세).
         그래서 전에는 "용량이 꽉 찼다" 를 null 로 받아,
         무엇이 잘못됐는지 영영 알 수 없었습니다. */
    let why = null;
    const r = fn(t.objectStore(STORE));
    if (r) r.onerror = ev => { why = (ev && ev.target && ev.target.error) || why; };
    t.oncomplete = () => ok(r ? r.result : undefined);
    t.onerror    = () => no(why || t.error || new Error("db-error"));
    t.onabort    = () => no(why || t.error || new Error("db-abort"));
  });
}

/* 게임보이 롬 헤더에서 제목을 읽습니다.
   그래야 파일 이름이 rom1.gb 여도 목록에 제대로 된 이름이 뜹니다.

   [ 실제 롬으로 돌려보고 알게 된 것 ]
   · 0x143 은 게임보이 컬러 표시(0x80/0xC0)라 제목이 아닙니다.
     그냥 읽으면 이상한 글자가 붙습니다.
   · 0x13F~0x142 를 제조사 코드로 쓰는 롬이 있습니다.
     2048.gb 가 그래서 "2048-gb    XXXX" 로 읽혔습니다.
     제목에 빈칸이 두 개 이상 연달아 나오는 경우는 없으니 거기서 자릅니다.
   · 제목을 아예 안 넣은 롬도 있습니다 (WORDLE.gb).
     그때는 파일 이름을 씁니다. "UNTITLED" 보다 낫습니다.              */
function romTitle(bytes, fileName) {
  const cgb = bytes[0x143];
  const end = (cgb === 0x80 || cgb === 0xC0) ? 0x13E : 0x142;
  let s = "";
  for (let i = 0x134; i <= end && i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 0) break;
    s += (c >= 32 && c < 127) ? String.fromCharCode(c) : " ";
  }
  const cut = s.indexOf("  ");                 /* 빈칸 둘 = 제조사 코드 앞 */
  if (cut > 0) s = s.slice(0, cut);
  s = s.trim();
  if (s) return s;
  if (fileName) return String(fileName).replace(/\.[^.]*$/, "").trim().toUpperCase();
  return "UNTITLED";
}

/* 같은 롬을 두 번 넣지 않도록 간단한 지문을 만듭니다.
   암호용이 아니라 구분용이라 이 정도면 충분합니다. */
function romKey(bytes) {
  /* ★ Math.imul 을 씁니다. 그냥 * 를 쓰면 큰 수에서 아래 비트가 뭉개집니다. */
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 16777619) >>> 0;
    if ((i & 63) === 0) h2 = (h2 + h1) >>> 0;
  }
  return bytes.length.toString(36) + "-" + h1.toString(36) + h2.toString(36);
}

/* 진짜 게임보이 롬인지 봅니다.
   0x104~0x113 에 닌텐도 로고 바이트가 고정으로 들어 있습니다.
   이걸 안 보면 아무 파일이나 게임으로 등록됩니다 (실제로 .txt 가 들어갔습니다). */
const GB_LOGO = [0xCE,0xED,0x66,0x66,0xCC,0x0D,0x00,0x0B,0x03,0x73,0x00,0x83,0x00,0x0C,0x00,0x0D];
function looksLikeGb(bytes) {
  if (!bytes || bytes.length < 0x150) return false;
  for (let i = 0; i < GB_LOGO.length; i++) if (bytes[0x104 + i] !== GB_LOGO[i]) return false;
  return true;
}

/* 한 개씩 훑으면서 **목록에 필요한 것만** 뽑아옵니다.
   롬 내용(수 MB)은 뽑은 즉시 버려지므로 메모리에 쌓이지 않습니다. */
function listByCursor(db) {
  return new Promise((ok, no) => {
    const t = db.transaction(STORE, "readonly");
    const s = t.objectStore(STORE);
    if (!s.openCursor) {            /* 커서가 없으면 예전 방식으로 */
      const r = s.getAll();
      t.oncomplete = () => ok(r.result || []);
      t.onerror = t.onabort = () => no(t.error || new Error("db-error"));
      return;
    }
    const out = [];
    const r = s.openCursor();
    r.onsuccess = ev => {
      const c = ev.target.result;
      if (!c) return;
      const v = c.value || {};
      /* ★ 여기서 필요한 것만 베껴 담습니다. v(롬 포함)는 곧 버려집니다. */
      out.push({ id:v.id, title:v.title, file:v.file, fromBundled:v.fromBundled || null,
                 size:v.size, sram:!!v.sram,
                 states:(v.states || [null,null,null]).map(x => !!x),
                 added:v.added, played:v.played });
      c.continue();
    };
    let why = null;
    r.onerror = ev => { why = (ev && ev.target && ev.target.error) || why; };
    t.oncomplete = () => ok(out);
    t.onerror = t.onabort = () => no(why || t.error || new Error("db-error"));
  });
}

const RomStore = {
  /* extra 에 { fromBundled:"tobu.gb" } 를 넘기면 "기본 게임에서 나온 기록"
     이라고 표시해 둡니다. 목록에서 기본 게임과 짝을 맞출 때 씁니다.
     ★ 파일 이름으로 짝을 맞추면 안 됩니다 — 같은 이름의 남의 롬이
       기본 게임을 목록에서 밀어냅니다. */
  async add(bytes, fileName, extra) {
    /* ★ 아래 모든 함수는 실패해도 반드시 연결을 닫습니다 (finally).
         전에는 성공했을 때만 닫아서, 저장이 실패할 때마다 연결이 쌓였습니다. */
    const id = romKey(bytes);
    const rec = {
      id, title: romTitle(bytes, fileName), file: fileName || "",
      size: bytes.length, rom: bytes,
      sram: null, states: [null, null, null],
      added: Date.now(), played: 0,
      fromBundled: (extra && extra.fromBundled) || null,
    };
    const db = await openDB();
    try {
    const cur = await tx(db, "readonly", s => s.get(id));
    /* ★ 이미 있으면 저장해둔 것들을 반드시 지킵니다.
         전에는 이 검사가 항상 거짓이라, 같은 롬을 다시 넣거나
         게임이 배터리 세이브를 하는 순간 슬롯 저장이 통째로 날아갔습니다. */
    if (cur && cur.id) {
      rec.sram   = cur.sram;
      rec.states = cur.states || rec.states;
      rec.added  = cur.added;
      rec.played = cur.played || 0;
      /* ★ 파일 이름과 제목도 처음 것을 지킵니다.
           안 그러면 같은 롬을 다른 이름으로 넣었을 때 목록에 두 번 뜨고,
           기본 게임에 저장을 하는 순간 이름이 바뀌어 버립니다
           ("TOBU TOBU GIRL" → "TOBU"). */
      rec.file   = cur.file || rec.file;
      rec.title  = cur.title || rec.title;
      /* 기본 게임 표시도 지웁니다 — 한 번 붙으면 계속 붙어 있어야 합니다 */
      rec.fromBundled = cur.fromBundled || rec.fromBundled;
    }
    await tx(db, "readwrite", s => s.put(rec));
    return rec;
    } finally { db.close(); }
  },
  async list() {
    const db = await openDB();
    let all;
    try {
      /* ★★ 전에는 getAll() 이었습니다. 그게 **롬 내용까지 전부** 한 번에
             메모리로 끌어올립니다. 게임 20개면 괜찮지만 200개면 100MB 가
             넘어가고, 폰에서는 화면이 몇 초씩 멎거나 탭이 그냥 죽습니다.
             목록에 들어갈 때마다 매번 그럽니다.

             커서로 한 개씩 훑으면 **한 번에 한 개만** 메모리에 올라옵니다.
             (오래된 브라우저나 검사용 가짜에 커서가 없으면 예전 방식으로.) */
      all = await listByCursor(db);
    }
    finally { db.close(); }
    const arr = all || [];
    /* 목록에는 롬 내용을 빼고 줍니다 (몇 MB 를 들고 다닐 필요가 없습니다).
       ★ 기록 하나가 이상해도 목록 전체가 무너지면 안 됩니다.
         전에는 낡은 기록 하나 때문에 아드님이 넣은 롬이 전부 사라졌습니다. */
    const out = [];
    for (const r of arr) {
      try {
        out.push({ id:r.id, title:r.title || "UNTITLED", file:r.file || "",
                   fromBundled: r.fromBundled || null,
                   size:r.size || 0, hasSram: !!r.sram,
                   states: (r.states || [null,null,null]).map(x => !!x),
                   added:r.added || 0, played:r.played || 0 });
      } catch (e) { /* 못 읽는 기록은 건너뜁니다 */ }
    }
    return out.sort((a,b) => b.played - a.played || b.added - a.added);
  },
  async get(id) {
    const db = await openDB();
    try {
      const r = await tx(db, "readonly", s => s.get(id));
      return r || null;
    } finally { db.close(); }
  },
  /* ★★ 읽고-고치고-쓰기를 **하나의 트랜잭션 안에서** 합니다. ★★

     전에는 읽기와 쓰기가 서로 다른 트랜잭션이었습니다. 그 사이가 무방비라,
     아드님이 슬롯 저장을 누른 그 순간 게임이 배터리 세이브를 하면
     **둘 중 하나가 조용히 사라졌습니다.** 1초마다 도는 자동저장과
     겹치기 아주 쉬운 구조였습니다.

     한 트랜잭션 안에 넣으면 그 사이에 아무도 끼어들 수 없고,
     중간에 실패하면 되돌려집니다.                                      */
  patch(id, changes) {
    return openDB().then(db => new Promise((ok, no) => {
      let out = null, why = null;
      const t = db.transaction(STORE, "readwrite");
      const st = t.objectStore(STORE);
      const g = st.get(id);
      g.onerror = ev => { why = ev && ev.target && ev.target.error; };
      g.onsuccess = () => {
        const rec = g.result;
        if (!rec || !rec.id) return;              /* 없으면 아무것도 안 씁니다 */
        Object.assign(rec, changes);
        out = rec;
        const w = st.put(rec);
        w.onerror = ev => { why = ev && ev.target && ev.target.error; };
      };
      t.oncomplete = () => { db.close(); ok(out); };
      t.onerror = t.onabort = () => { db.close(); no(why || t.error || new Error("db-error")); };
    }));
  },
  async remove(id) {
    const db = await openDB();
    try { await tx(db, "readwrite", s => s.delete(id)); }
    finally { db.close(); }
  },
};

/* 파일 선택창에서 고른 파일 읽기 */
function readFile(file) {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onerror = e => no(e.error);
    r.onloadend = e => ok(new Uint8Array(e.target.result));
    r.readAsArrayBuffer(file);
  });
}


/* ==========================================================================
   3. 에뮬레이터

   binjgb 의 demo.js 를 옮겨 심은 부분입니다. 함수 이름은 전부 원본 그대로입니다.
   ========================================================================== */

function wasmBuf(module, ptr, size) {
  return new Uint8Array(module.HEAP8.buffer, ptr, size);
}

function getAudioCtx() {
  if (!audioCtx) {
    const AC = (typeof AudioContext !== "undefined") ? AudioContext
             : (typeof webkitAudioContext !== "undefined") ? webkitAudioContext : null;
    if (!AC) return null;
    audioCtx = new AC();
  }
  return audioCtx;
}

class Session {
  constructor(module, romBytes, opts) {
    this.module = module;
    this.opts   = opts || {};
    this.dead   = false;
    this.raf    = null;
    this.sramTimer = 0;
    this.sramDirty = false;
    this.lastRafSec = 0;
    this.leftoverTicks = 0;

    const ctx = getAudioCtx();
    const rate = ctx ? ctx.sampleRate : 48000;

    /* 롬을 wasm 메모리로 복사 (32KB 단위로 맞춤 — demo.js 와 같음) */
    const size = (romBytes.byteLength + 0x7fff) & ~0x7fff;
    this.romDataPtr = module._malloc(size);
    wasmBuf(module, this.romDataPtr, size).fill(0).set(romBytes);

    this.e = module._emulator_new_simple(
        this.romDataPtr, size, rate, AUDIO_FRAMES, CGB_COLOR_CURVE);
    if (this.e === 0) {
      module._free(this.romDataPtr);
      this.romDataPtr = 0;
      throw new Error("BAD ROM");
    }

    /* 조작 입력이 이 joypad 를 거칩니다. 빼면 버튼이 안 먹습니다. */
    this.joypadPtr = module._joypad_new();
    this.rewindPtr = module._rewind_new_simple(
        this.e, REWIND_FRAMES_PER_BASE_STATE, REWIND_BUFFER_CAPACITY);
    module._emulator_set_default_joypad_callback(this.e, this.joypadPtr);

    this.frameBuf = wasmBuf(module, module._get_frame_buffer_ptr(this.e),
                                    module._get_frame_buffer_size(this.e));
    this.audioBuf = wasmBuf(module, module._get_audio_buffer_ptr(this.e),
                                    module._get_audio_buffer_capacity(this.e));

    const cv = this.opts.canvas;
    if (cv) {
      cv.width = SCREEN_W; cv.height = SCREEN_H;
      this.ctx2d = cv.getContext("2d");
      this.ctx2d.imageSmoothingEnabled = false;
      this.imageData = this.ctx2d.createImageData(SCREEN_W, SCREEN_H);
    }
    this.audioStartSec = 0;
    this.volume = this.opts.volume === undefined ? 0.4 : this.opts.volume;
  }

  /* ── 버튼 ────────────────────────────────────────────────────────── */
  press(name, down) {
    if (this.dead) return;
    const f = this.module["_set_joyp_" + name];
    if (f) f(this.e, !!down);
  }

  get ticks() { return this.module._emulator_get_ticks_f64(this.e); }

  next60(cur) {
    const mod1 = cur - Math.floor(cur / CPU_TICKS_PER_SECOND) * CPU_TICKS_PER_SECOND;
    const nxt  = Math.ceil(Math.ceil((mod1 + 1) / CPU_TICKS_PER_60HZ) * CPU_TICKS_PER_60HZ);
    return cur + (nxt - mod1);
  }

  runUntil(untilTicks) {
    const m = this.module;
    let n60 = this.next60(this.ticks);
    for (;;) {
      const ev = m._emulator_run_until_f64(this.e, Math.min(untilTicks, n60));
      if (ev & EVENT_NEW_FRAME) {
        m._rewind_append(this.rewindPtr, this.e);
        if (this.imageData) this.imageData.data.set(this.frameBuf);
      }
      if (ev & EVENT_AUDIO_BUFFER_FULL) this.pushAudio();
      if (ev & EVENT_UNTIL_TICKS) {
        const cur = this.ticks;
        if (cur >= n60) n60 = this.next60(cur);
        else break;
      }
    }
    /* 게임이 스스로 저장했으면 표시만 해둡니다. 실제 저장은 1초마다 한 번. */
    if (m._emulator_was_ext_ram_updated(this.e)) this.sramDirty = true;
  }

  pushAudio() {
    const ctx = getAudioCtx();
    if (!ctx || this.volume <= 0) return;
    const now = ctx.currentTime, latest = now + AUDIO_LATENCY_SEC;
    this.audioStartSec = this.audioStartSec || latest;
    if (this.audioStartSec < now) { this.audioStartSec = latest; return; }
    const buf = ctx.createBuffer(2, AUDIO_FRAMES, ctx.sampleRate);
    const c0 = buf.getChannelData(0), c1 = buf.getChannelData(1);
    for (let i = 0; i < AUDIO_FRAMES; i++) {
      c0[i] = this.audioBuf[2*i]     * this.volume / 255;
      c1[i] = this.audioBuf[2*i + 1] * this.volume / 255;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination);
    src.start(this.audioStartSec);
    this.audioStartSec += AUDIO_FRAMES / ctx.sampleRate;
  }

  paint() {
    if (!this.ctx2d) return;
    tintOrange(this.imageData.data);          /* ★ 주황으로 */
    this.ctx2d.putImageData(this.imageData, 0, 0);
  }

  /* ── 한 프레임 ────────────────────────────────────────────────────── */
  frame(startMs) {
    /* ★ 좀비 방지: 내가 더 이상 현재 게임이 아니면 즉시 멈춥니다.
         이게 없으면 게임을 바꿨을 때 옛 게임이 뒤에서 계속 돕니다. */
    if (this.dead || session !== this) return;
    this.schedule();
    const startSec = startMs / 1000;
    const delta = Math.max(startSec - (this.lastRafSec || startSec), 0);
    const until = this.ticks + Math.min(delta, MAX_UPDATE_SEC) * CPU_TICKS_PER_SECOND
                  - this.leftoverTicks;
    this.runUntil(until);
    this.leftoverTicks = (this.ticks - until) | 0;
    this.lastRafSec = startSec;
    this.paint();
  }

  schedule() {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.frame.bind(this));
  }

  get running() { return this.raf !== null && !this.dead; }

  start() {
    if (this.dead) return;
    const ctx = getAudioCtx();
    if (ctx && ctx.resume) ctx.resume();
    this.lastRafSec = 0;
    this.schedule();
    /* ★ 두 번 불러도 타이머가 하나만 남게. 전에는 앞의 것이 영원히 새어나갔습니다. */
    if (this.sramTimer) clearInterval(this.sramTimer);
    /* ★ 3초로 늦췄습니다. 한 번 저장할 때 기록 전체(롬 포함)를 다시 쓰기 때문에
         1초마다 하면 폰이 뜨거워집니다. 바뀐 게 있을 때만 쓰고,
         멈추거나 나갈 때 반드시 한 번 더 하므로 잃는 것은 없습니다. */
    this.sramTimer = setInterval(() => this.flushSram(), 3000);
  }

  pause() {
    if (this.dead || this.raf === null) return;
    cancelAnimationFrame(this.raf);
    this.raf = null;
    /* ★ 멈추면 자동저장 타이머도 끕니다.
         안 그러면 다른 앱에 가 있는 동안에도 1초마다 깨어납니다. */
    if (this.sramTimer) { clearInterval(this.sramTimer); this.sramTimer = 0; }
    const ctx = getAudioCtx();
    if (ctx && ctx.suspend) ctx.suspend();
    this.flushSram();
  }

  resume() {
    if (this.dead || this.raf !== null) return;
    const ctx = getAudioCtx();
    if (ctx && ctx.resume) ctx.resume();
    this.lastRafSec = 0;
    this.schedule();
    if (!this.sramTimer) this.sramTimer = setInterval(() => this.flushSram(), 3000);
  }

  /* ── 저장 ─────────────────────────────────────────────────────────── */
  /* 배터리 세이브 — 게임 자체의 저장 기능 (포켓몬의 "리포트" 같은 것)
     읽어오는 것은 flushSram() 에 있습니다. */
/* ★★ _file_data_delete 뒤에 _free(ptr) 를 반드시 불러야 합니다. ★★

   _file_data_delete 는 **속에 든 자료만** 돌려주고 껍데기(16바이트)는 안 돌려줍니다.
   그런데 껍데기가 자료보다 먼저 잡히기 때문에, 돌려준 199,616바이트 자리를
   그 16바이트가 가로막아 못 쓰게 됩니다. **한 번 저장할 때마다 195KB 가 사라집니다.**

   게다가 binjgb 는 메모리를 늘릴 수 없게 지어져 있어서(늘리려 하면 그냥 죽습니다),
   16MB 를 다 쓰면 에뮬레이터가 영구히 멈춥니다.
   실제로 **저장/불러오기 70번이면 죽습니다.** 아이가 반나절이면 닿는 횟수입니다.
   그때부터는 LOAD FAILED 만 뜨고 원인도 알 수 없습니다.                    */
  loadSram(bytes) {
    const m = this.module;
    const ptr = m._ext_ram_file_data_new(this.e);
    const buf = wasmBuf(m, m._get_file_data_ptr(ptr), m._get_file_data_size(ptr));
    if (buf.byteLength === bytes.byteLength) {
      buf.set(bytes);
      m._emulator_read_ext_ram(this.e, ptr);
    }
    m._file_data_delete(ptr);
    m._free(ptr);            /* ★ 껍데기까지 반납 */
  }

  /* 세이브 스테이트 — 아무 때나 순간을 통째로 */
  /* 스테이트 안에는 어느 게임 것인지가 안 들어 있습니다.
     크기까지 같으면 남의 세이브가 그대로 들어가 화면이 깨집니다.
     그래서 슬롯에 넣을 때 롬 신원을 따로 붙여둡니다 (ui.js 참고). */
  getState() {
    const m = this.module;
    const ptr = m._state_file_data_new(this.e);
    const buf = wasmBuf(m, m._get_file_data_ptr(ptr), m._get_file_data_size(ptr));
    m._emulator_write_state(this.e, ptr);
    const out = buf.slice();
    m._file_data_delete(ptr);
    m._free(ptr);            /* ★ 껍데기까지 반납 */
    return out;
  }
  loadState(bytes) {
    const m = this.module;
    const ptr = m._state_file_data_new(this.e);
    const buf = wasmBuf(m, m._get_file_data_ptr(ptr), m._get_file_data_size(ptr));
    let ok = false;
    if (buf.byteLength === bytes.byteLength) {
      buf.set(bytes);
      /* ★ 반환값을 반드시 봐야 합니다. 0 이 성공, 1 이 실패입니다.
           전에는 버려서, 에뮬레이터가 "머리말이 안 맞다" 고 거절해도
           "불러왔다" 고 말하고 메뉴를 닫았습니다. 게임은 그대로인데요. */
      ok = (m._emulator_read_state(this.e, ptr) === 0);
    }
    m._file_data_delete(ptr);
    m._free(ptr);            /* ★ 껍데기까지 반납 */
    return ok;
  }

  flushSram() {
    if (this.dead || !this.sramDirty) return false;
    this.sramDirty = false;
    try {
      const m = this.module;
      const ptr = m._ext_ram_file_data_new(this.e);
      const buf = wasmBuf(m, m._get_file_data_ptr(ptr), m._get_file_data_size(ptr));
      m._emulator_write_ext_ram(this.e, ptr);
      const bytes = buf.slice();
      m._file_data_delete(ptr);
    m._free(ptr);            /* ★ 껍데기까지 반납 */
      if (this.opts.onSram) this.opts.onSram(bytes);
      return true;
    } catch (err) { return false; }
  }

  /* ── 정리 ─────────────────────────────────────────────────────────────
     ★ 한 단계가 실패해도 나머지는 반드시 돌아야 합니다.
       그래서 전부 따로 감쌌습니다. 순서도 중요합니다 —
       화면 도는 것을 제일 먼저 끕니다.                                  */
  destroy() {
    if (this.dead) return;
    this.dead = true;                                   /* 먼저 표시 */
    const safe = f => { try { f(); } catch (e) {} };

    safe(() => { if (this.raf !== null) cancelAnimationFrame(this.raf); });
    this.raf = null;
    safe(() => clearInterval(this.sramTimer));
    this.sramTimer = 0;
    safe(() => { this.dead = false; this.flushSram(); this.dead = true; });  /* 마지막 저장 */
    safe(() => { const c = getAudioCtx(); if (c && c.suspend) c.suspend(); });
    safe(() => this.module._rewind_delete(this.rewindPtr));
    safe(() => this.module._joypad_delete(this.joypadPtr));
    safe(() => this.module._emulator_delete(this.e));

    /* ★★ 여기서 _free(romDataPtr) 를 부르면 안 됩니다. ★★

       _emulator_delete 가 롬 메모리까지 반납합니다.
       뒤에서 또 _free 를 부르면 같은 것을 두 번 반납하게 되고,
       그러면 메모리 관리표가 망가져서 **다음에 게임을 켤 때 터집니다.**
       (바로 안 터지고 두세 번째에 터져서 원인을 찾기가 아주 어렵습니다.)

       binjgb 가 딸려 보낸 예제(demo.js)에도 이 _free 가 있습니다.
       예제는 게임을 껐다 켜는 일이 거의 없어서 안 드러난 것으로 보입니다.
       우리는 목록으로 나갔다 들어오는 걸 반복하므로 반드시 빼야 합니다.

       진짜 wasm 으로 60번 껐다 켜서 확인했습니다 —
       빼면 안 터지고, 롬 주소도 다시 쓰이고, 메모리도 안 늘어납니다.   */

    this.e = 0; this.romDataPtr = 0; this.rewindPtr = 0; this.joypadPtr = 0;
    this.frameBuf = null; this.audioBuf = null; this.imageData = null;
  }
}


/* ==========================================================================
   4. ★ 안전장치 — 비정상 종료 방어

   폰에서 게임이 뒤에서 계속 도는 경우가 이렇게 많습니다.
     · 홈 버튼을 눌러 다른 앱으로 감
     · 화면이 꺼짐
     · 전화가 옴
     · 브라우저 뒤로가기
     · 탭을 닫음
     · 알림을 내리다가 페이지가 얼어붙음(freeze)
     · 자바스크립트 오류가 나서 정리 코드까지 못 감

   그냥 두면 배터리가 닳고, 소리가 계속 나고, 저장이 날아갑니다.
   ========================================================================== */

function pauseForBackground() {
  if (session && session.running) session.pause();     /* pause 안에서 저장까지 함 */
}

let onGone = null;           /* 세션이 사라졌다고 화면에 알려줄 곳 */

function hardStop() {
  epoch++;                     /* ★ 먼저 세대를 올립니다 */
  if (!session) return;
  const s = session;
  session = null;            /* ★ 먼저 끊습니다. 그래야 남은 프레임이 스스로 멈춥니다 */
  try { s.destroy(); } catch (e) {}
  /* ★ 화면은 아직 "게임 중" 이라고 믿고 있습니다.
       알려주지 않으면 멈춘 화면에 갇힙니다 (RESUME 도 안 먹습니다). */
  try { if (onGone) onGone(); } catch (e) {}
}

function onVisibility() {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "hidden") { pauseForBackground(); return; }
  /* ★ 돌아왔으면 다시 돌립니다.
       전에는 멈춘 채로 있어서 "화면은 게임인데 아무 반응이 없는" 상태가 됐습니다. */
  if (session && !session.dead && !session.running) session.resume();
}

function installGuards() {
  if (guardOn || typeof window === "undefined") return;
  guardOn = true;

  /* 다른 앱으로 가거나 화면이 꺼지면 멈추고 저장 */
  document.addEventListener("visibilitychange", onVisibility);

  /* 페이지를 떠날 때. pagehide 가 폰에서 가장 믿을 만합니다.
     beforeunload 는 폰에서 아예 안 오는 경우가 많습니다. */
  window.addEventListener("pagehide", hardStop);

  /* 브라우저가 페이지를 얼려버리기 직전 (Page Lifecycle) */
  window.addEventListener("freeze", hardStop);

  /* ★ 오류가 나면 **멈추기만** 합니다 (없애지 않습니다).
       없애버리면 화면은 게임인데 되살릴 방법이 없어져서 갇힙니다.
       멈추면 저장도 되고 RESUME 으로 살아납니다. */
  window.addEventListener("error", pauseForBackground);
  window.addEventListener("unhandledrejection", pauseForBackground);
}


/* ==========================================================================
   5. 바깥에서 쓰는 것
   ========================================================================== */

const GameMode = {
  RomStore, readFile, romTitle, romKey, tintOrange, looksLikeGb,

  /* 게임 시작. ★ 무조건 앞의 게임을 먼저 정리합니다.
     이걸 안 하면 두 게임이 겹쳐 돌면서 소리가 두 겹으로 납니다. */
  /* born 을 주면 "그 세대가 아직 유효할 때만" 시작합니다.
     ui.play() 가 롬을 읽기 전에 epoch() 를 잡아 두고 넘깁니다. */
  start(module, romBytes, opts, born) {
    installGuards();
    /* ★ 읽는 사이에 나갔으면 아예 시작하지 않습니다 */
    if (born !== undefined && born !== epoch) return null;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return null;
    hardStop();
    const s = new Session(module, romBytes, opts);
    session = s;
    if (opts && opts.sram) { try { s.loadSram(opts.sram); } catch (e) {} }
    s.start();
    return s;
  },

  stop: hardStop,
  epoch: () => epoch,
  /* ★ 아이폰은 **손가락이 닿는 그 순간(동기 실행 구간)** 에 소리 장치를
       깨워야 소리가 납니다. 우리는 게임을 시작할 때 깨우는데,
       그때는 롬 읽기와 wasm 준비를 기다린 뒤라 이미 늦습니다.
       그래서 화면 어디든 처음 누를 때 미리 깨워둡니다.
       안드로이드는 상관없지만 아이폰에서는 이게 있어야 소리가 납니다. */
  wakeAudio() {
    try {
      const c = getAudioCtx();
      if (c && c.state === "suspended" && c.resume) c.resume();
    } catch (e) {}
  },
  /* 세션이 사라지면 불러줄 곳을 등록합니다 (화면이 목록으로 빠져나오게) */
  setOnGone(fn) { onGone = fn; },
  current: () => session,
  isRunning: () => !!(session && session.running),

  pause()  { if (session) session.pause(); },
  resume() { if (session) session.resume(); },
  press(name, down) { if (session) session.press(name, down); },

  saveState() { return session ? session.getState() : null; },
  loadState(bytes) { return session ? session.loadState(bytes) : false; },
  flushSram() { return session ? session.flushSram() : false; },

  /* 시험용 — 안전장치가 실제로 걸렸는지 확인할 때 */
  _guards: { onVisibility, hardStop, pauseForBackground },
};

/* ★ 안전장치는 **파일을 불러올 때 바로** 겁니다.
     전에는 게임을 처음 시작할 때 걸어서, 맨 처음 롬을 읽는 동안에는
     freeze / pagehide 를 아무도 안 듣고 있었습니다. */
if (typeof window !== "undefined") { installGuards(); window.GameMode = GameMode; }
if (typeof module !== "undefined" && module.exports) module.exports = GameMode;
