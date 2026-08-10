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

  const later = fn => setTimeout(fn, 0);

  function makeRequest() {
    return { result: undefined, error: null, onsuccess: null, onerror: null,
             onupgradeneeded: null };
  }

  function makeStore(map, keyPath, tx) {
    const run = (fn) => {
      const req = makeRequest();
      tx._pending++;
      later(() => {
        try { req.result = fn(); }
        catch (e) { req.error = e; tx._fail(e); tx._pending--; tx._maybeDone(); return; }
        if (req.onsuccess) req.onsuccess({ target: req });
        tx._pending--; tx._maybeDone();
      });
      return req;
    };
    return {
      get:    k => run(() => map.has(k) ? clone(map.get(k)) : undefined),
      getAll: () => run(() => [...map.values()].map(clone)),
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
          transaction(n) {
            const map = db.stores.get(n);
            if (!map) throw new Error("NotFoundError: " + n);
            const tx = {
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
            /* 요청이 하나도 없어도 끝나야 합니다 */
            later(() => tx._maybeDone());
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
