/* ============================================================================
   가짜 IndexedDB

   ★ 이게 없어서 RomStore 가 검사에서 한 줄도 실행되지 않았습니다.
     그 안에 심각한 버그가 셋이나 숨어 있었습니다
     (같은 롬을 다시 넣으면 저장이 지워지는 것 등).

   진짜와 똑같이 흉내낼 필요는 없고, 우리가 쓰는 것만 맞춥니다.
     open / createObjectStore / transaction / get / getAll / put / delete
   중요한 것은 **없는 것을 찾으면 result 가 undefined** 라는 규약입니다.
   그 규약을 잘못 다뤄서 버그가 났었습니다.
   ========================================================================== */
"use strict";

function makeIDB(opts) {
  opts = opts || {};
  const dbs = new Map();          /* 이름 → { ver, stores: Map(name → Map(key→값)) } */
  /* ★ 진짜 IndexedDB 는 같은 저장소를 건드리는 **쓰기 트랜잭션을 줄 세웁니다.**
       (명세: 먼저 만들어진 것이 먼저 접근) 이걸 안 흉내내면
       "동시에 저장하면 한쪽이 사라진다" 같은 문제를 잘못 판정합니다.
       실제로 이것 때문에 멀쩡한 코드를 버그로 오해할 뻔했습니다. */
  const queues = new Map();       /* 저장소 이름 → 지금 도는 쓰기 트랜잭션의 약속 */

  const later = fn => setTimeout(fn, 0);

  function makeRequest() {
    return { result: undefined, error: null, onsuccess: null, onerror: null,
             onupgradeneeded: null };
  }

  function makeStore(map, keyPath, tx) {
    const run = (fn) => {
      const req = makeRequest();
      tx._pending++;
      /* ★ 앞의 쓰기 트랜잭션이 끝나기를 기다립니다 (진짜와 같게) */
      (tx._gate || Promise.resolve()).then(() => later(() => {
        try { req.result = fn(); }
        catch (e) { req.error = e; tx._fail(e); tx._pending--; tx._maybeDone(); return; }
        if (req.onsuccess) req.onsuccess({ target: req });
        tx._pending--; tx._maybeDone();
      }));
      return req;
    };
    return {
      get:    k => run(() => map.has(k) ? clone(map.get(k)) : undefined),
      getAll: () => run(() => [...map.values()].map(clone)),
      /* ★ 커서. RomStore.list 가 이걸로 한 개씩 훑습니다
           (한 번에 다 읽으면 폰 메모리가 터지기 때문에).
           진짜와 같게 **한 칸씩 나아가고, 끝나면 undefined** 를 줍니다. */
      openCursor: () => {
        const keys = [...map.keys()];
        const req = makeRequest();
        let at = 0;
        const step = () => {
          tx._pending++;
          (tx._gate || Promise.resolve()).then(() => later(() => {
            if (at >= keys.length) req.result = undefined;
            else {
              const k = keys[at++];
              req.result = {
                key: k, value: clone(map.get(k)),
                continue: () => step(),
              };
            }
            if (req.onsuccess) req.onsuccess({ target: req });
            tx._pending--; tx._maybeDone();
          }));
        };
        step();
        return req;
      },
      put:    v => run(() => {
        if (opts.putFails) throw new Error("QuotaExceededError");
        const k = v[keyPath];
        if (k === undefined) throw new Error("DataError: no key");
        map.set(k, clone(v));
        return k;
      }),
      delete: k => run(() => { map.delete(k); return undefined; }),
    };
  }

  /* 저장된 값은 복사해서 주고받습니다 (진짜 IndexedDB 도 그렇습니다).
     이걸 안 하면 "저장 안 했는데 바뀌어 있는" 가짜 통과가 생깁니다. */
  function clone(v) {
    if (v === undefined || v === null) return v;
    if (v instanceof Uint8Array) return new Uint8Array(v);
    if (Array.isArray(v)) return v.map(clone);
    if (typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v)) o[k] = clone(v[k]);
      return o;
    }
    return v;
  }

  return {
    open(name, ver) {
      const req = makeRequest();
      later(() => {
        if (opts.openFails) {
          req.error = new Error("open failed");
          if (req.onerror) req.onerror({ target: req });
          return;
        }
        let db = dbs.get(name);
        const fresh = !db;
        if (fresh) { db = { ver: 0, stores: new Map() }; dbs.set(name, db); }
        const handle = {
          objectStoreNames: { contains: n => db.stores.has(n) },
          createObjectStore(n, o) {
            db.stores.set(n, new Map());
            db.stores.get(n)._keyPath = (o && o.keyPath) || "id";
            return makeStore(db.stores.get(n), db.stores.get(n)._keyPath, dummyTx());
          },
          transaction(n, mode) {
            const map = db.stores.get(n);
            if (!map) throw new Error("NotFoundError: " + n);
            const rw = mode === "readwrite";
            const tx = {
              _mode: mode || "readonly",
              _pending: 0, _done: false, _err: null,
              oncomplete: null, onerror: null, onabort: null,
              _fail(e) { tx._err = e; },
              _maybeDone() {
                if (tx._done || tx._pending > 0) return;
                tx._done = true;
                later(() => {
                  if (tx._err) { tx.error = tx._err; if (tx.onerror) tx.onerror(); }
                  else if (tx.oncomplete) tx.oncomplete();
                });
              },
              objectStore() { return makeStore(map, map._keyPath || "id", tx); },
            };
            /* ★ 쓰기 트랜잭션은 앞의 것이 끝나야 시작합니다 */
            const prev = rw ? (queues.get(n) || Promise.resolve()) : Promise.resolve();
            let release;
            if (rw) queues.set(n, new Promise(r => { release = r; }));
            tx._gate = prev;
            tx._release = release || (() => {});
            const origDone = tx._maybeDone;
            tx._maybeDone = function(){
              if (tx._done || tx._pending > 0) return;
              tx._done = true;
              later(() => {
                if (tx._err) { tx.error = tx._err; if (tx.onerror) tx.onerror(); }
                else if (tx.oncomplete) tx.oncomplete();
                tx._release();
              });
            };
            /* 요청이 하나도 없어도 끝나야 합니다 */
            prev.then(() => later(() => tx._maybeDone()));
            return tx;
          },
          close() {},
        };
        req.result = handle;
        if (fresh || (ver && ver > db.ver)) {
          db.ver = ver || 1;
          if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        }
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
    _dbs: dbs,
  };

  function dummyTx() {
    return { _pending: 0, _fail() {}, _maybeDone() {} };
  }
}

module.exports = { makeIDB };
