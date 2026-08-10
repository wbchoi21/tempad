/* ============================================================================
   가짜 IndexedDB — 명세에 가깝게 (감사용)

   test/idb.js 와 같은 자리에 끼워 쓸 수 있습니다. 다른 점은 전부
   W3C IndexedDB 명세 / MDN 에 맞춘 것입니다:

   · transaction 은 만든 task 가 끝나면(마이크로태스크 체크포인트) 비활성.
     비활성 트랜잭션에 요청을 걸면 TransactionInactiveError (동기 throw)
   · readonly 트랜잭션에 put/delete → ReadOnlyError (동기 throw)
   · db.close() 뒤 transaction() → InvalidStateError (동기 throw)
   · keyPath 값이 없는 put → DataError (동기 throw)
   · 요청 실패 → request error 이벤트(버블) → 막지 않으면 트랜잭션 abort
     → **롤백** → abort 이벤트. oncomplete 는 절대 안 불림
   · get 이 없는 키를 만나면 success + result === undefined
   · getAll 은 **키 오름차순**
   · 값은 structured clone. ArrayBufferView 는 **본 버퍼 전체**를 복사
     (HTML 명세: ArrayBufferView 직렬화 = [[ViewedArrayBuffer]] 직렬화)
   · onupgradeneeded 의 versionchange 트랜잭션이 **끝난 뒤에** onsuccess
   · 같은 이름의 다른 연결이 열려 있으면 versionchange → 안 닫으면 blocked
   · 이벤트는 전부 매크로태스크(task)에서
   ========================================================================== */
"use strict";

function ex(name, msg) { const e = new Error(msg || name); e.name = name; return e; }

const STAT = { cloneBytes: 0, clones: 0, txs: 0, puts: 0, gets: 0, opens: 0 };

/* ── structured clone ─────────────────────────────────────────────────── */
function sclone(v) {
  if (v === null || typeof v !== "object") {
    if (typeof v === "function") throw ex("DataCloneError", "function not cloneable");
    return v;
  }
  if (v instanceof Date) return new Date(v.getTime());
  if (v instanceof RegExp) return new RegExp(v.source, v.flags);
  if (ArrayBuffer.isView(v)) {
    /* ★ 명세대로: 뷰가 아니라 **버퍼 전체**를 복사합니다.
         wasm 힙 위의 32바이트 뷰를 넣으면 힙 전체가 복사됩니다. */
    const whole = v.buffer.slice(0);
    STAT.cloneBytes += whole.byteLength; STAT.clones++;
    return new v.constructor(whole, v.byteOffset, v.length);
  }
  if (v instanceof ArrayBuffer) { STAT.cloneBytes += v.byteLength; STAT.clones++; return v.slice(0); }
  if (Array.isArray(v)) return v.map(sclone);
  if (v instanceof Map) { const m = new Map(); for (const [k, x] of v) m.set(sclone(k), sclone(x)); return m; }
  if (v instanceof Set) { const s = new Set(); for (const x of v) s.add(sclone(x)); return s; }
  const p = Object.getPrototypeOf(v);
  if (p !== Object.prototype && p !== null) throw ex("DataCloneError", "not a plain object");
  const o = {};
  for (const k of Object.keys(v)) o[k] = sclone(v[k]);
  return o;
}

/* IDB 키 순서: number < Date < string < binary < Array */
function keyRank(k) {
  if (typeof k === "number") return 0;
  if (k instanceof Date) return 1;
  if (typeof k === "string") return 2;
  if (ArrayBuffer.isView(k) || k instanceof ArrayBuffer) return 3;
  return 4;
}
function keyCmp(a, b) {
  const ra = keyRank(a), rb = keyRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return a - b;
  if (ra === 1) return a.getTime() - b.getTime();
  if (ra === 2) return a < b ? -1 : a > b ? 1 : 0;
  return 0;
}

function makeIDB(opts) {
  opts = opts || {};
  const dbs = new Map();          /* name → { ver, stores: Map(name → {keyPath, data:Map}) } */
  const conns = new Map();        /* name → Set(handle) */
  const task = fn => setTimeout(fn, 0);

  /* ── 요청 ─────────────────────────────────────────────────────────── */
  function makeReq(tx) {
    const r = {
      readyState: "pending", _result: undefined, _error: null,
      transaction: tx || null, onsuccess: null, onerror: null,
      onupgradeneeded: null, onblocked: null,
    };
    Object.defineProperty(r, "result", {
      get() {
        if (r.readyState !== "done") throw ex("InvalidStateError", "result not ready");
        if (r._error) throw ex("InvalidStateError", "request failed");
        return r._result;
      }, configurable: true, enumerable: true,
    });
    Object.defineProperty(r, "error", {
      get() {
        if (r.readyState !== "done") throw ex("InvalidStateError", "error not ready");
        return r._error;
      }, configurable: true, enumerable: true,
    });
    return r;
  }

  /* ── 트랜잭션 ─────────────────────────────────────────────────────── */
  function makeTx(handle, names, mode) {
    STAT.txs++;
    const tx = {
      mode, db: handle, error: null, objectStoreNames: names.slice(),
      _state: "active", _pending: 0, _q: [], _draining: false,
      _finished: false, _undo: [],
      oncomplete: null, onerror: null, onabort: null,
      objectStore(n) {
        if (tx._finished) throw ex("InvalidStateError", "transaction finished");
        if (!tx.objectStoreNames.includes(n)) throw ex("NotFoundError", n);
        return makeStore(tx, n);
      },
      abort() { doAbort(tx, ex("AbortError", "aborted")); },
    };
    /* ★ 만든 task 가 끝나면(마이크로태스크 체크포인트) 비활성이 됩니다 */
    queueMicrotask(() => {
      if (tx._state === "active") tx._state = "inactive";
      maybeCommit(tx);
    });
    return tx;
  }

  function maybeCommit(tx) {
    if (tx._finished || tx._state === "active" || tx._pending > 0 || tx._q.length) return;
    tx._finished = true;
    task(() => { if (tx.oncomplete) tx.oncomplete({ target: tx }); });
  }

  function doAbort(tx, err) {
    if (tx._finished) return;
    tx._finished = true;
    /* ★ 롤백 */
    for (let i = tx._undo.length - 1; i >= 0; i--) {
      const u = tx._undo[i];
      if (u.had) u.map.set(u.key, u.prev); else u.map.delete(u.key);
    }
    tx._undo.length = 0;
    tx._q.length = 0; tx._pending = 0;
    tx.error = err || null;
    task(() => { if (tx.onabort) tx.onabort({ target: tx }); });
  }

  function drain(tx) {
    if (tx._draining) return;
    tx._draining = true;
    const step = () => {
      if (tx._finished || !tx._q.length) { tx._draining = false; maybeCommit(tx); return; }
      const it = tx._q.shift();
      const req = it.req;
      let val, failed = null;
      try { val = it.op(); } catch (e) { failed = e; }
      tx._state = "active";
      if (failed) {
        req.readyState = "done"; req._error = failed;
        let prevented = false;
        const ev = { target: req, preventDefault() { prevented = true; }, type: "error" };
        try { if (req.onerror) req.onerror(ev); } catch (e) {}
        /* 버블링: request → transaction → database */
        try { if (tx.onerror) tx.onerror(ev); } catch (e) {}
        queueMicrotask(() => {
          tx._state = "inactive"; tx._pending--;
          tx._draining = false;
          if (!prevented) doAbort(tx, failed);
          else drain(tx);
        });
      } else {
        req.readyState = "done"; req._result = val;
        try { if (req.onsuccess) req.onsuccess({ target: req, type: "success" }); } catch (e) {}
        queueMicrotask(() => {
          tx._state = "inactive"; tx._pending--;
          tx._draining = false;
          if (tx._q.length) drain(tx); else maybeCommit(tx);
        });
      }
    };
    task(step);
  }

  function makeStore(tx, name) {
    const dbrec = tx.db._db;
    const st = dbrec.stores.get(name);
    const map = st.data, keyPath = st.keyPath;

    const enqueue = (op) => {
      if (tx._finished) throw ex("TransactionInactiveError", "transaction finished");
      if (tx._state !== "active") throw ex("TransactionInactiveError",
        "transaction is not active (control returned to the event loop)");
      const req = makeReq(tx);
      tx._pending++;
      tx._q.push({ req, op });
      drain(tx);
      return req;
    };
    const needWrite = () => {
      if (tx.mode === "readonly") throw ex("ReadOnlyError", "transaction is readonly");
    };
    const note = (k) => tx._undo.push({ map, key: k, had: map.has(k), prev: map.get(k) });

    return {
      name, keyPath, transaction: tx,
      get(k) { STAT.gets++; return enqueue(() => map.has(k) ? sclone(map.get(k)) : undefined); },
      getAll() {
        return enqueue(() => [...map.keys()].sort(keyCmp).map(k => sclone(map.get(k))));
      },
      count() { return enqueue(() => map.size); },
      put(v, key) {
        needWrite();
        /* ★ 키 뽑기와 clone 은 **동기**입니다 */
        const k = key !== undefined ? key : (v == null ? undefined : v[keyPath]);
        if (k === undefined || k === null)
          throw ex("DataError", "evaluating the object store's key path did not yield a value");
        const copy = sclone(v);                    /* DataCloneError 도 여기서 동기 */
        STAT.puts++;
        return enqueue(() => {
          if (opts.putFails) throw ex("QuotaExceededError", "quota exceeded");
          note(k); map.set(k, copy); return k;
        });
      },
      add(v, key) { return this.put(v, key); },
      delete(k) {
        needWrite();
        return enqueue(() => { note(k); map.delete(k); return undefined; });
      },
      clear() {
        needWrite();
        return enqueue(() => { for (const k of [...map.keys()]) note(k); map.clear(); });
      },
    };
  }

  /* ── open ─────────────────────────────────────────────────────────── */
  function makeHandle(name, dbrec) {
    const h = {
      name, _db: dbrec, _closePending: false, _vtx: null, onversionchange: null,
      get version() { return dbrec.ver; },
      objectStoreNames: {
        contains: n => dbrec.stores.has(n),
        get length() { return dbrec.stores.size; },
      },
      createObjectStore(n, o) {
        if (!h._vtx || h._vtx._finished)
          throw ex("InvalidStateError", "createObjectStore outside a versionchange transaction");
        if (dbrec.stores.has(n)) throw ex("ConstraintError", n + " exists");
        dbrec.stores.set(n, { keyPath: (o && o.keyPath) || null, data: new Map() });
        h._vtx.objectStoreNames.push(n);
        return h._vtx.objectStore(n);
      },
      deleteObjectStore(n) {
        if (!h._vtx || h._vtx._finished) throw ex("InvalidStateError", "not in versionchange");
        dbrec.stores.delete(n);
      },
      transaction(n, mode) {
        if (h._closePending) throw ex("InvalidStateError", "the database connection is closing");
        const names = Array.isArray(n) ? n.slice() : [n];
        for (const x of names) if (!dbrec.stores.has(x)) throw ex("NotFoundError", x);
        return makeTx(h, names, mode || "readonly");
      },
      close() {
        h._closePending = true;
        const s = conns.get(name); if (s) s.delete(h);
      },
    };
    return h;
  }

  return {
    _stat: STAT, _dbs: dbs, _conns: conns,
    open(name, ver) {
      STAT.opens++;
      const req = makeReq(null);
      task(() => {
        if (opts.openFails) {
          req.readyState = "done"; req._error = ex("UnknownError", "open failed");
          if (req.onerror) req.onerror({ target: req });
          return;
        }
        let dbrec = dbs.get(name);
        if (!dbrec) { dbrec = { ver: 0, stores: new Map() }; dbs.set(name, dbrec); }
        const want = ver === undefined ? Math.max(1, dbrec.ver) : ver;
        if (want < dbrec.ver) {
          req.readyState = "done"; req._error = ex("VersionError", "requested version < current");
          if (req.onerror) req.onerror({ target: req });
          return;
        }
        const h = makeHandle(name, dbrec);
        if (!conns.has(name)) conns.set(name, new Set());

        const finish = () => {
          conns.get(name).add(h);
          req.readyState = "done"; req._result = h;
          if (req.onsuccess) req.onsuccess({ target: req });
        };

        if (want > dbrec.ver) {
          /* 다른 연결이 열려 있으면 versionchange → 안 닫으면 blocked */
          const others = [...conns.get(name)].filter(o => !o._closePending);
          for (const o of others) {
            try { if (o.onversionchange) o.onversionchange({ oldVersion: dbrec.ver, newVersion: want }); }
            catch (e) {}
          }
          const still = others.filter(o => !o._closePending);
          if (still.length) {
            /* ★ blocked: onblocked 를 안 달아두면 이 요청은 **영원히 안 끝납니다** */
            if (req.onblocked) req.onblocked({ target: req });
            return;
          }
          const oldVer = dbrec.ver;
          dbrec.ver = want;
          const vtx = makeTx(h, [...dbrec.stores.keys()], "versionchange");
          h._vtx = vtx;
          req.transaction = vtx;
          req.readyState = "done"; req._result = h;
          vtx.oncomplete = () => { h._vtx = null; task(finish); };
          vtx.onabort = () => {
            dbrec.ver = oldVer; h._vtx = null;
            req.readyState = "done"; req._error = ex("AbortError", "upgrade aborted");
            if (req.onerror) req.onerror({ target: req });
          };
          if (req.onupgradeneeded)
            req.onupgradeneeded({ target: req, oldVersion: oldVer, newVersion: want });
          /* upgradeneeded 안에서 아무 요청도 안 걸었으면 vtx 는 그대로 커밋됩니다 */
        } else {
          finish();
        }
      });
      return req;
    },
    deleteDatabase(name) {
      const req = makeReq(null);
      task(() => { dbs.delete(name); req.readyState = "done"; if (req.onsuccess) req.onsuccess({ target: req }); });
      return req;
    },
  };
}

module.exports = { makeIDB, sclone, STAT };
