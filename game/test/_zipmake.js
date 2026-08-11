/* ============================================================================
   검사용 zip 공장 — 헤더를 손으로 조립합니다

   ★ 왜 손으로 만드나
     남의 압축 라이브러리를 못 씁니다(저장소 접근 금지선). 그리고 더 중요한
     이유가 있습니다 — **일부러 망가진 zip 을 만들 수 있어야** 합니다.
     정상 zip 만으로는 "깨진 것을 제대로 거절하는가" 를 검사할 수 없습니다.

   ★★ 이 공장과 unzip.js 가 **같은 착각을 공유하면** 검사가 통째로 가짜입니다.
      그래서 test/zip.js 는 윈도 내장 압축(PowerShell)과 **양방향으로**
      대조합니다. 이 파일만 믿으면 안 됩니다.
   ========================================================================== */
"use strict";
const zlib = require("node:zlib");

/* CRC32 — zip 이 쓰는 것과 같은 다항식 */
let T = null;
function crc32(buf) {
  if (!T) {
    T = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      T[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xFFFF, 0); return b; };
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; };

/* 항목 하나 —
     name    zip 안의 이름 (폴더 경로를 넣어도 됩니다)
     data    내용 (Buffer/Uint8Array)
     method  0 = 무압축, 8 = deflate (기본 8)
     flags   플래그 (0x1 암호, 0x8 data descriptor, 0x800 UTF-8 이름)
     ★ 일부러 망가뜨리기
     badCrc      crc 를 틀리게 적음
     lieSize     적힌 원본 크기를 이 값으로 (압축폭탄 흉내)
     localZero   로컬 헤더의 크기를 0 으로 (data descriptor 방식 흉내)
     extraLocal  로컬 헤더에만 extra 를 더 붙임 (중앙 것과 길이가 다르게)
     rawName     이름 바이트를 직접 지정 (CP949 시험용)
     zip64Size   크기 자리에 0xFFFFFFFF (ZIP64 감시값)
*/
function makeZip(items, opts) {
  const o = opts || {};
  const locals = [], centrals = [];
  let off = 0;
  if (o.prepend) { locals.push(Buffer.from(o.prepend)); off += o.prepend.length; }

  for (const it of items) {
    const data = Buffer.from(it.data || []);
    const method = it.method === undefined ? 8 : it.method;
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const nameBuf = it.rawName ? Buffer.from(it.rawName) : Buffer.from(it.name, "utf8");
    const flags = (it.flags || 0) | (it.rawName ? 0 : 0x800);
    const crc = it.badCrc !== undefined ? it.badCrc : crc32(data);
    const usize = it.zip64Size ? 0xFFFFFFFF : (it.lieSize !== undefined ? it.lieSize : data.length);
    const csize = comp.length;
    const extraL = it.extraLocal ? Buffer.alloc(it.extraLocal) : Buffer.alloc(0);
    /* ★ 중앙 디렉터리에도 extra 를 넣을 수 있어야 합니다. 진짜 압축 도구는
         거의 항상 시각(UT/UX) 확장을 넣는데, 공장이 늘 0 이라 "중앙 extra 를
         제대로 건너뛰는가" 를 한 번도 안 시험하고 있었습니다. */
    const extraC = it.extraCentral ? Buffer.alloc(it.extraCentral, 0x55) : Buffer.alloc(0);
    /* ★ 진짜 data descriptor. 흘려보내며 압축한 zip 은 자료 뒤에 12~16바이트가
         더 붙습니다. 공장이 flags 0x8 만 세우고 이 꼬리를 안 붙여서,
         "그 꼬리를 자료로 착각하지 않는가" 를 시험한 적이 없었습니다. */
    const desc = it.dataDesc
      ? Buffer.concat([u32(0x08074b50), u32(crc), u32(csize), u32(data.length)])
      : Buffer.alloc(0);

    /* ★ 앞에 쓰레기가 붙은 zip 은 **안에 적힌 위치가 전부** 원래 zip 시작
         기준입니다. 그러니 중앙 디렉터리에 적을 때도 붙인 만큼 빼야 합니다.
         (한쪽만 빼면 진짜로는 존재하지 않는 zip 이 되어, 읽는 쪽을
          엉뚱하게 시험하게 됩니다 — 실제로 그래서 검사가 틀렸습니다.) */
    const lho = off - (o.prepend ? o.prepend.length : 0);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0),
      u32(it.localZero ? 0 : crc),
      u32(it.localZero ? 0 : csize),
      u32(it.localZero ? 0 : usize),
      u16(nameBuf.length), u16(extraL.length), nameBuf, extraL, comp, desc,
    ]);
    locals.push(local); off += local.length;

    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u16(0), u16(0),
      u32(crc), u32(csize), u32(usize),
      u16(nameBuf.length), u16(extraC.length), u16(0), u16(0), u16(0), u32(0), u32(lho),
      nameBuf, extraC,
    ]));
  }

  const cd = Buffer.concat(centrals);
  const cdOff = off;
  /* ★ 중앙 디렉터리와 EOCD **사이에 다른 기록이 끼는** zip 이 실제로 있습니다
       (zip64 EOCD 기록 + locator, archive digital signature 등).
       32비트 값은 전부 정상이라 제대로 된 리더는 그냥 읽습니다.
       공장이 이걸 못 만들어서, 그 zip 을 통째로 "깨졌다" 고 하던 버그를
       검사가 못 봤습니다. */
  const gap = Buffer.from(o.gap || []);
  const comment = Buffer.from(o.comment || "");
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(o.lieCount !== undefined ? o.lieCount : items.length),
    u16(o.lieCount !== undefined ? o.lieCount : items.length),
    u32(o.zip64Cd ? 0xFFFFFFFF : cd.length),
    u32(o.zip64Off ? 0xFFFFFFFF : (o.prepend ? cdOff - o.prepend.length : cdOff)),
    u16(comment.length), comment,
  ]);
  return Buffer.concat([...locals, cd, gap, eocd]);
}

/* 진짜처럼 생긴 게임보이 롬 */
const LOGO = [0xCE,0xED,0x66,0x66,0xCC,0x0D,0x00,0x0B,0x03,0x73,0x00,0x83,0x00,0x0C,0x00,0x0D];
function gbRom(title, opt) {
  const o = opt || {};
  const b = Buffer.alloc(o.size || 0x8000);
  LOGO.forEach((v, i) => b[0x104 + i] = v);
  for (let i = 0; i < (title || "").length && i < 11; i++) b[0x134 + i] = title.charCodeAt(i);
  b[0x143] = o.cgb || 0x00;
  if (o.tag) b[0x200] = o.tag;
  return b;
}
/* 진짜처럼 생긴 GBA 롬 (닌텐도 로고 앞 32바이트 + 0xB2 의 0x96) */
const GBA_LOGO = [
  0x24,0xFF,0xAE,0x51,0x69,0x9A,0xA2,0x21,0x3D,0x84,0x82,0x0A,0x84,0xE4,0x09,0xAD,
  0x11,0x24,0x8B,0x98,0xC0,0x81,0x7F,0x21,0xA3,0x52,0xBE,0x19,0x93,0x09,0xCE,0x20];
function gbaRom(title, opt) {
  const o = opt || {};
  const b = Buffer.alloc(o.size || 0x1000);
  b[0xB2] = 0x96;
  GBA_LOGO.forEach((v, i) => b[0x04 + i] = v);
  for (let i = 0; i < (title || "").length && i < 12; i++) b[0xA0 + i] = title.charCodeAt(i);
  if (o.tag) b[0x200] = o.tag;
  return b;
}

module.exports = { makeZip, crc32, gbRom, gbaRom, GBA_LOGO };
