/* ============================================================================
   zip 읽기 — 브라우저에 원래 있는 것만 씁니다

   왜 직접 만들었나 — 남의 압축 라이브러리를 받아올 수 없기 때문입니다
   (사장님 지시: tempad 외 저장소 접근 금지). 그런데 마침 브라우저에
   `DecompressionStream` 이 들어 있어서 받아올 필요가 없습니다.

   [ 무엇을 하나 ]
   카톡으로 받은 `games.zip` 을 열어 **롬만 골라냅니다.**
   압축을 미리 풀지 않고 **목록만** 먼저 만들어 돌려줍니다.
   실제로 푸는 것은 넣는 쪽(ui.addRoms)이 그 항목을 읽을 때입니다.

   [ ★ 왜 미리 안 푸나 ]
   GBA 롬은 하나가 32MB 입니다. 20개짜리 zip 을 통째로 펼치면 640MB 가
   한꺼번에 메모리에 뜹니다. 폰에서는 그대로 죽습니다.
   목록만 먼저 만들면 —
     · 이름·크기로 거르는 일이 **압축을 풀기 전에** 끝납니다
     · 한 번에 메모리에 사는 것은 **항목 하나분**뿐입니다
   그래서 `read()` 를 나중에 부르는 모양으로 돌려줍니다.

   [ zip 구조 — 이것만 알면 됩니다 ]
   파일 **끝**에 EOCD 라는 표지가 있고, 거기에 "중앙 디렉터리"의 위치가
   적혀 있습니다. 중앙 디렉터리에는 항목마다 이름·크기·자료 위치가 있습니다.
   그래서 **파일 앞부터 읽을 필요가 없습니다.** 꼬리와 목록만 봅니다.
   ========================================================================== */

"use strict";

(function () {

/* zip 이 어디까지 크면 손대지 않을 것인가 (항목 하나가 아니라 목록 자체) */
const MAX_ENTRIES = 20000;      /* 이름만 훑는 단계의 폭주 방지 */
const EOCD_SIG = 0x06054b50, CEN_SIG = 0x02014b50, LOC_SIG = 0x04034b50;
const ZIP64_EOCD_SIG = 0x06064b50;
/* 압축을 얼마나 부풀릴 수 있는가 — 이보다 심하면 압축폭탄으로 봅니다.
   ★ 1000 으로 뒀다가 **멀쩡한 롬을 거절했습니다.**
     deflate 의 이론상 최대는 1032 인데, 카트리지 크기에 맞춰 0xFF 로 크게
     패딩된 덤프는 실제로 그 근처까지 갑니다(실측: 4MB 롬 1022, 32MB 1028).
     즉 잘 눌리는 진짜 롬일수록 걸렸습니다. 이유도 안 나오고 그냥 사라집니다.
     이 사전 검사는 "말이 안 되는 것" 만 쳐내면 됩니다 —
     진짜 상한은 read() 안에서 **실제로 읽은 양**으로 지킵니다. */
const MAX_RATIO = 1100;

/* ── deflate 를 풀 수 있는 브라우저인가 ──────────────────────────────────
   ★ `typeof DecompressionStream === "function"` 만으로는 부족합니다.
     옛 크롬은 "deflate"/"gzip" 만 있고 **"deflate-raw" 가 없습니다.**
     zip 이 쓰는 것은 raw 쪽입니다. 그래서 실제로 한 번 만들어 봅니다.
     (사파리는 16.4 부터 됩니다.)                                        */
let _rawOk = null;
function canInflate() {
  if (_rawOk !== null) return _rawOk;
  try { new DecompressionStream("deflate-raw"); _rawOk = true; }
  catch (e) { _rawOk = false; }
  return _rawOk;
}

/* ── CRC32 — 깨진 롬을 조용히 들여보내지 않으려고 ──────────────────────
   이게 없으면 전송 중 깨진 롬이 그대로 등록되고, 게임을 켜는 순간
   까만 화면이 됩니다. 그때는 원인을 찾을 방법이 없습니다.              */
let _crcTable = null;
function crc32(buf) {
  if (!_crcTable) {
    _crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = _crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const readSlice = (blob, a, b) =>
  blob.slice(a, b).arrayBuffer().then(ab => new Uint8Array(ab));

/* ── 이 파일이 zip 인가 ────────────────────────────────────────────────
   ★ 이름(.zip)이 아니라 **앞 4바이트**로 봅니다.
     안드로이드의 어떤 앱은 확장자를 안 주고 MIME 만 줍니다.
     반대로 이름만 .zip 인 엉뚱한 파일도 있습니다.                       */
async function looksLikeZip(blob) {
  if (!blob || blob.size < 22) return false;
  try {
    const h = await readSlice(blob, 0, 4);
    /* PK\3\4 (보통) · PK\5\6 (빈 zip) · PK\7\8 (쪼갠 zip) */
    if (h[0] === 0x50 && h[1] === 0x4B &&
        ((h[2] === 3 && h[3] === 4) || (h[2] === 5 && h[3] === 6) || (h[2] === 7 && h[3] === 8)))
      return true;

    /* ★★ 앞에 쓰레기가 붙은 zip 은 0번 바이트가 PK 가 아닙니다. ★★
         자기압축해제 파일, 다른 파일 뒤에 zip 을 이어붙인 것 등이 그렇습니다.
         여기서 막아버리면 안쪽의 보정 코드(delta)에 **영영 도달하지 못합니다** —
         단위검사에서만 통과하는 죽은 방어가 됩니다. 실제로 그 상태였습니다.
         꼬리에 제대로 된 EOCD 가 있으면 zip 으로 봅니다.
       ★ 다만 이름이 .zip 일 때만 꼬리를 훑습니다. 그렇게 안 하면 폴더째
         골랐을 때 **롬 하나하나마다 64KB 를 읽어** 한참 멈춰 섭니다. */
    if (!/\.zip$/i.test(String(blob.name || ""))) return false;
    const tailLen = Math.min(blob.size, 65557);
    const t = await readSlice(blob, blob.size - tailLen, blob.size);
    const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
    for (let i = t.length - 22; i >= 0; i--)
      if (dv.getUint32(i, true) === EOCD_SIG &&
          i + 22 + dv.getUint16(i + 20, true) === t.length) return true;
    return false;
  } catch (e) { return false; }
}

/* 그 자리에 중앙 디렉터리 기록이 진짜로 있는가 (보정값이 맞는지 확인용) */
async function cenAt(blob, off) {
  if (off < 0 || off + 4 > blob.size) return false;
  try {
    const b = await readSlice(blob, off, off + 4);
    return b[0] === 0x50 && b[1] === 0x4B && b[2] === 1 && b[3] === 2;
  } catch (e) { return false; }
}

/* ── 이름 다듬기 ────────────────────────────────────────────────────────
   ★ zip 안의 이름은 **남이 정한 것**입니다. 이 앱에서 처음으로
     바깥사람이 글자를 정하는 입구입니다. 폴더 경로를 떼고,
     이상한 글자가 든 것은 버립니다.
     (화면에 나갈 때 한 번 더 esc() 를 거치지만, 여기서도 잘라둡니다.) */
function cleanName(raw) {
  let n = String(raw || "");
  n = n.replace(/^.*[\\\/]/, "");          /* 폴더 경로 떼기 (역슬래시도) */
  if (!n || n === "." || n === "..") return "";
  if (/[\x00-\x1F\x7F]/.test(n)) return "";
  return n;
}

/* 맥에서 압축하면 딸려오는 껍데기. 이름이 .gb 로 끝나서 롬인 척합니다. */
function isJunk(fullName, base) {
  if (/(^|\/)__MACOSX\//.test(fullName)) return true;
  if (/^\._/.test(base)) return true;
  if (base === ".DS_Store" || base === "Thumbs.db") return true;
  return false;
}

/* ── 목록 만들기 ─────────────────────────────────────────────────────── */
async function listEntries(blob, opts) {
  const o = opts || {};
  const maxBytes = o.maxBytes || (32 * 1024 * 1024);
  const skipped = { folder:0, encrypted:0, method:0, junk:0, big:0, broken:0, nested:0 };

  if (!blob || blob.size < 22) throw new Error("BROKEN ZIP");

  /* 1) 꼬리에서 EOCD 찾기.
        ★ zip 주석이 최대 65535바이트라 뒤 65557바이트를 훑어야 합니다.
        ★ 주석 안에 우연히 같은 표식이 들어갈 수 있어서, 찾은 것 중
          **뒤쪽 것부터** 써보고 앞뒤가 맞는 것을 고릅니다. */
  const tailLen = Math.min(blob.size, 65557);
  const tail = await readSlice(blob, blob.size - tailLen, blob.size);
  const tdv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  /* ★★ 후보를 고를 때 **주석 길이가 꼬리 끝과 맞는지** 봐야 합니다. ★★
       이걸 안 보면, 주석 안에 `PK\5\6` 뒤로 0 이 18바이트만 이어져 있어도
       c=0 · sz=0 · of=0 으로 통과해서 **"항목 0개인 정상 zip"** 이 됩니다.
       그러면 멀쩡한 zip 이 "NO GAME FILES IN THERE" 로 둔갑하고,
       버린 개수도 0 이라 이유조차 안 뜹니다.
       (전에는 `d >= 0` 하나만 봤습니다. 검사가 통과했던 것은 채움 바이트가
        우연히 0x42 여서 합이 22억이 된 덕이었습니다 — 0 이면 그대로 뚫립니다.) */
  const strict = [], loose = [];
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tdv.getUint32(i, true) !== EOCD_SIG) continue;
    if (i + 22 + tdv.getUint16(i + 20, true) === tail.length) strict.push(i);
    else loose.push(i);
  }

  const cands = strict.concat(loose);
  const at = i => ({ c: tdv.getUint16(i + 10, true),
                     sz: tdv.getUint32(i + 12, true),
                     of: tdv.getUint32(i + 16, true),
                     abs: blob.size - tailLen + i });

  let eocd = -1, count = 0, cdSize = 0, cdOff = 0, delta = 0, rawOff = 0, rawCount = 0;
  /* ★★ 1차 — **진짜 중앙 디렉터리가 있는** 후보만 받습니다. ★★
       "항목 0개" 후보를 여기서 받으면 안 됩니다. 주석 안에 0 이 이어진
       가짜 표식이 딱 그 모양(c=0·sz=0·of=0)이라, 뒤에서부터 훑는 순서상
       **가짜가 먼저 걸려서** 멀쩡한 zip 이 "빈 zip" 이 됩니다.
       (주석 길이 검사만으로는 못 막습니다 — 가짜가 파일 맨 끝에 오면
        그 검사도 우연히 통과합니다. 실측으로 확인했습니다.) */
  outer:
  for (const i of cands) {
    const { c, sz, of, abs } = at(i);
    if (c === 0 && sz === 0) continue;
    /* ★★ 보정값은 **0 을 먼저** 시도합니다. ★★
         전에는 `abs-(of+sz)` 하나만 썼습니다. 그건 "중앙 디렉터리 바로 뒤가
         EOCD" 를 전제한 값인데, 그 사이에 zip64 기록이나 서명 기록이
         끼어 있는 zip 이 실제로 있습니다. 그러면 그 길이만큼 전부 밀려서
         중앙 디렉터리 한가운데를 파고, **멀쩡한 zip 이 깨진 것**이 됩니다.
         두 값을 다 시도하고, 그 자리에 진짜 CEN 표식이 있는 쪽을 씁니다. */
    const tries = [0];
    const d2 = abs - (of + sz);
    if (d2 !== 0) tries.push(d2);
    for (const d of tries) {
      if (of + d < 0 || of + d + sz > blob.size) continue;
      if (!(await cenAt(blob, of + d))) continue;
      eocd = abs; count = c; cdSize = sz; cdOff = of + d; delta = d;
      rawOff = of; rawCount = c;
      break outer;
    }
  }
  /* 2차 — 그래도 하나도 없으면 그때 "빈 zip" 을 인정합니다 */
  if (eocd < 0) for (const i of cands) {
    const { c, sz, abs } = at(i);
    if (c === 0 && sz === 0) { eocd = abs; count = 0; break; }
  }
  if (eocd < 0) throw new Error("BROKEN ZIP");

  /* 2) ZIP64 는 안 다룹니다. 감시값을 만나면 **크게 실패**합니다.
        조용히 넘기면 4294967295 같은 자리를 파게 되어 엉뚱한 결과가 납니다.
        ★ 고른 뒤에 봅니다 — 후보를 훑는 도중에 보면, 주석 속 쓰레기 값
          하나 때문에 멀쩡한 zip 을 거절하게 됩니다. */
  if (rawCount === 0xFFFF || cdSize === 0xFFFFFFFF || rawOff === 0xFFFFFFFF)
    throw new Error("UNSUPPORTED ZIP");
  if (count > MAX_ENTRIES) throw new Error("UNSUPPORTED ZIP");
  if (count === 0) return { entries: [], skipped };

  /* 3) 중앙 디렉터리를 통째로 읽습니다 (이름 목록이라 작습니다) */
  const cd = await readSlice(blob, cdOff, cdOff + cdSize);
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  /* zip64 확장 헤더가 섞여 있으면 역시 안 다룹니다 */
  if (cdSize >= 4 && dv.getUint32(0, true) === ZIP64_EOCD_SIG) throw new Error("UNSUPPORTED ZIP");

  const entries = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || dv.getUint32(p, true) !== CEN_SIG) { skipped.broken++; break; }
    const flag   = dv.getUint16(p + 8,  true);
    const method = dv.getUint16(p + 10, true);
    const crc    = dv.getUint32(p + 16, true);
    const csize  = dv.getUint32(p + 20, true);
    /* ★ 크기는 **중앙 디렉터리 것만** 씁니다.
         로컬 헤더 쪽은 0 인 경우가 있습니다(data descriptor 방식).
         그걸 쓰면 파일이 통째로 빈 것으로 보입니다. */
    const usize  = dv.getUint32(p + 24, true);
    const nlen   = dv.getUint16(p + 28, true);
    const elen   = dv.getUint16(p + 30, true);
    const clen   = dv.getUint16(p + 32, true);
    const lho    = dv.getUint32(p + 42, true) + delta;
    const rawName = cd.subarray(p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;

    /* 이름 글자표 — 플래그 11번 비트가 서면 UTF-8.
       아니면 옛 윈도(한국은 CP949)입니다. 못 읽어도 **버리지 않습니다** —
       확장자만 알아보면 되고, 진짜 판별은 롬 속 바이트로 합니다. */
    let full = "";
    try {
      full = new TextDecoder((flag & 0x800) ? "utf-8" : "euc-kr", { fatal:false }).decode(rawName);
    } catch (e) {
      try { full = new TextDecoder("utf-8", { fatal:false }).decode(rawName); } catch (e2) { full = ""; }
    }
    const base = cleanName(full);

    if (!base || full.endsWith("/") || full.endsWith("\\")) { skipped.folder++; continue; }
    if (isJunk(full, base)) { skipped.junk++; continue; }
    /* ★ zip 안의 zip 은 풀지 않습니다(재귀 금지). 다만 **따로 세어둡니다** —
         그냥 버리면 "NO GAME FILES IN THERE" 만 뜨는데, 정작 그 안쪽 zip 에는
         게임이 잔뜩 들어 있습니다. 무엇을 해야 하는지 말해줘야 합니다. */
    if (/\.zip$/i.test(base)) { skipped.nested++; continue; }
    /* 암호 걸린 항목 (0번=암호, 6번=강한암호, 13번=이름까지 가림) */
    if (flag & 0x0001 || flag & 0x0040 || flag & 0x2000) { skipped.encrypted++; continue; }
    if (method !== 0 && method !== 8) { skipped.method++; continue; }
    if (method === 8 && !canInflate()) { skipped.method++; continue; }
    if (usize === 0xFFFFFFFF || csize === 0xFFFFFFFF) { skipped.broken++; continue; }
    if (usize > maxBytes) { skipped.big++; continue; }
    /* 압축폭탄 — 적힌 것만 봐도 말이 안 되는 비율 */
    if (csize > 0 && usize / csize > MAX_RATIO) { skipped.big++; continue; }
    if (lho + 30 > blob.size) { skipped.broken++; continue; }

    entries.push(makeEntry(blob, base, usize, csize, method, crc, lho, maxBytes));
  }

  return { entries, skipped };
}

/* 항목 하나. read() 를 부를 때 비로소 압축을 풉니다. */
function makeEntry(blob, name, size, csize, method, crc, lho, maxBytes) {
  return {
    name, size,
    /* ui.addRoms 가 크기로 미리 거를 수 있게 File 처럼 보이게 둡니다 */
    async read() {
      /* ★ 자료가 시작되는 자리는 **로컬 헤더를 다시 읽어** 구합니다.
           중앙 디렉터리의 extra 길이와 로컬 헤더의 extra 길이가 **다릅니다.**
           이걸 헷갈리는 것이 zip 을 잘못 읽는 가장 흔한 원인입니다. */
      const head = await readSlice(blob, lho, lho + 30);
      const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
      if (hv.getUint32(0, true) !== LOC_SIG) throw new Error("BROKEN ENTRY");
      const start = lho + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
      const end = start + csize;
      if (end > blob.size) throw new Error("BROKEN ENTRY");

      let out;
      if (method === 0) {
        /* ★★ 무압축 쪽에도 상한과 길이 확인이 있어야 합니다. ★★
             중앙 디렉터리가 "푼 크기 1KB, 압축 크기 40MB" 라고 적으면
             위쪽의 `usize > maxBytes` 도 비율 검사도 **하나도 안 걸립니다**
             (둘 다 usize 만 봅니다). 그대로 읽으면 폰 메모리에 40MB 를
             통째로 올립니다. 손상된 zip 하나로 폰을 밀어버릴 수 있었습니다.
             압축 쪽에는 있던 두 가지가 여기만 빠져 있었습니다. */
        if (end - start > maxBytes) throw new Error("ZIP BOMB");
        out = await readSlice(blob, start, end);
        if (out.length !== size) throw new Error("BROKEN ENTRY");
      } else {
        /* ★ Response.arrayBuffer() 로 한 번에 받지 않습니다.
             적힌 크기가 거짓말일 수 있어서(압축폭탄), 읽으면서 셉니다.
             그리고 조각을 모았다 합치면 순간 두 배가 되므로,
             적힌 크기만큼 미리 잡아두고 그 자리에 채웁니다. */
        const cap = Math.min(size, maxBytes);
        out = new Uint8Array(cap);
        const rd = blob.slice(start, end).stream()
                     .pipeThrough(new DecompressionStream("deflate-raw"))
                     .getReader();
        let n = 0;
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          if (n + value.length > cap) { try { await rd.cancel(); } catch (e) {} throw new Error("ZIP BOMB"); }
          out.set(value, n); n += value.length;
        }
        if (n !== size) throw new Error("BROKEN ENTRY");
      }
      /* ★ 깨진 롬을 조용히 들여보내지 않습니다 */
      if (crc !== 0 && crc32(out) !== crc) throw new Error("BROKEN ENTRY");
      return out;
    },
  };
}

const Api = { looksLikeZip, listEntries, canInflate, crc32, cleanName, isJunk,
              MAX_ENTRIES, MAX_RATIO };
if (typeof window !== "undefined") window.GameZip = Api;
if (typeof module !== "undefined" && module.exports) module.exports = Api;

})();
