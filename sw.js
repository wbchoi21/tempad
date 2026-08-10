/* ============================================================================
   TEMPAD 오프라인 실행 도우미 (서비스 워커)

   [ 무엇을 하나요 ]
   한 번 열어본 화면을 폰에 저장해둬서, 인터넷이 없어도 앱이 켜지게 합니다.

   [ 고칠 때 중요한 점 ]
   화면(index.html)은 "인터넷 먼저" 방식입니다.
   즉 연결돼 있으면 항상 새 파일을 받아옵니다. 그래서 파일을 고쳐 다시 올리면
   폰에서도 바로 새 버전이 보입니다. 인터넷이 없을 때만 저장해둔 걸 씁니다.
   (아이콘 같은 건 잘 안 바뀌니 저장해둔 걸 먼저 씁니다.)
   ========================================================================== */

const VERSION = "tempad-v5";
const KEEP = [
  "./index.html",
  "./app.json",
  "./icon-192.png",
  "./icon-512.png",
  "./mask.png",
  "./game/index.html",
  "./game/game.js",
  "./game/ui.js",
  "./game/pad.js",
  "./game/binjgb.js",
  "./game/binjgb.wasm",
];

/* 설치될 때 기본 파일들을 저장해 둡니다.

   ★★ 한 개씩 따로 저장합니다. addAll 을 쓰면 안 됩니다. ★★

   addAll 은 목록 중 **하나라도 없으면 통째로 실패**합니다.
   그러면 새 일꾼이 자리를 못 잡고 옛 일꾼이 그대로 남아서,
   **고쳐 올린 게 아무리 해도 반영되지 않습니다.**

   실제로 이것 때문에 한참 헤맸습니다. game 폴더를 아직 안 올린 상태에서
   이 파일만 올렸더니, 화면이 통째로 옛날 것에서 멈췄습니다.
   원인이 "없는 파일 하나" 라는 걸 알아채기가 아주 어렵습니다.

   한 개씩 저장하면 없는 것만 건너뛰고 나머지는 정상으로 굴러갑니다.   */
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.all(
        KEEP.map(u => c.add(u).catch(() => {}))   /* 없는 건 조용히 건너뜀 */
      ))
      .then(() => self.skipWaiting())      /* 새 버전을 곧바로 적용 */
      .catch(() => self.skipWaiting())     /* 저장이 다 실패해도 일은 시작 */
  );
});

/* 예전 버전 저장분은 지웁니다 */
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;

  const url = new URL(req.url);
  const sameSite = url.origin === self.location.origin;

  /* 다른 사이트(지진 자료, 위키백과 등)는 손대지 않습니다.
     저장해두면 오래된 자료를 보여주게 되니까요.                              */
  if(!sameSite) return;

  const isPage = req.mode === "navigate" || url.pathname.endsWith(".html");

  if(isPage){
    /* 화면은 인터넷 먼저 → 고친 내용이 바로 반영됩니다.

       ★ 반드시 "주소별로" 저장해야 합니다.
         전에는 어떤 화면이든 ./index.html 이라는 한 칸에 덮어썼습니다.
         그러면 game/index.html 을 한 번 열자마자 본체 화면 자리에 게임이
         덮어써져서, 인터넷이 없을 때 본체를 열면 게임이 나옵니다.        */
    e.respondWith(
      fetch(req)
        .then(res => {
          /* ★ 성공한 것만 저장합니다.
               이걸 안 보면 404·500 화면을 정상인 줄 알고 저장해버립니다.
               저장소를 잠깐 비웠다가 다시 올리는 동안 404 가 나면,
               그 "없음" 화면이 저장돼서 인터넷을 끊었을 때 계속 나옵니다.
               한 번 그렇게 되면 원인을 찾기가 아주 어렵습니다.          */
          if(ok(res)) {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put(req, copy));
          }
          return res;
        })
        /* 인터넷이 없으면 그 주소의 저장분, 그것도 없으면 본체 화면 */
        .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }

  /* 아이콘 등은 저장분 먼저, 없으면 받아서 저장 */
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if(ok(res)) {                       /* 여기도 성공한 것만 */
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});

/* 저장해도 되는 응답인가.
   status 0 은 다른 사이트에서 온 것이라 내용을 볼 수 없습니다. */
function ok(res){
  return res && res.ok && res.status !== 0 && res.type !== "opaque";
}
