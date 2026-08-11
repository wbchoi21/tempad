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

const VERSION = "tempad-v14";
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
  "./game/unzip.js",
  "./game/binjgb.js",
  "./game/binjgb.wasm",
  "./game/mgba-glue.js",
  "./game/mgba.js",
  "./game/mgba.wasm",
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
      /* ★ 공유로 받아둔 상자(tempad-share)는 **지우면 안 됩니다.**
           파일을 올린 직후에 공유가 들어오면 새 일꾼이 자리를 잡으면서
           방금 넣어둔 zip 을 통째로 지워버립니다. */
      .then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== SHARE_BOX)
                                .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ★★ 안드로이드에서 "공유 → TEMPAD" 로 넘어온 파일 받기 ★★

   카톡에서 zip 을 길게 눌러 공유하면 안드로이드가 이 주소로 **POST** 를 보냅니다
   (app.json 의 share_target). 그러면 저장했다가 다시 찾아 고를 필요가 없습니다.

   ★ 아이폰 사파리는 이 기능이 없습니다. 그쪽은 그냥 무시되고 원래대로 돕니다.
   ★ 홈 화면에 추가(설치)해야만 공유 목록에 뜹니다.

   받은 파일은 잠깐 저장해두고 게임 화면으로 보냅니다. 화면이 열리면서
   그걸 꺼내 갑니다 (game/index.html 의 takeShared).
   ★ 이 분기는 **POST 이면서 정해진 주소일 때만** 탑니다. 나머지(GET)는
     한 줄도 안 건드립니다 — 이 파일은 손댈 때마다 사고가 났던 곳입니다. */
const SHARE_BOX = "tempad-share";
/* ★★ 열쇠는 **양쪽이 똑같이 만들어야** 합니다. ★★
     Cache API 는 "./shared" 같은 상대 주소를 **부르는 쪽 기준**으로 풉니다.
     그래서 sw.js 에서 넣으면 <뿌리>/shared 가 되고,
     game/index.html 에서 찾으면 <뿌리>/game/shared 가 됩니다 — 서로 다릅니다.
     그러면 넣어둔 것을 영영 못 찾습니다(공유가 통째로 안 됐습니다).
     origin 부터 붙여 **어디서 부르든 같은 글자**가 되게 합니다.
     ★ game/index.html 의 SHARE_KEY 와 반드시 같아야 합니다. */
const SHARE_KEY = self.location.origin + "/__tempad-shared";

self.addEventListener("fetch", e => {
  const req = e.request;
  const u = new URL(req.url);

  /* ★ index.html 까지 붙여 보내는 경우도 받습니다 (한 글자 값입니다) */
  if (req.method === "POST" && /\/game\/(index\.html)?$/.test(u.pathname)) {
    e.respondWith((async () => {
      let n = 0;
      try {
        const form = await req.formData();
        /* ★ get 이 아니라 getAll 입니다. 카톡에서 zip 을 여러 개 골라 공유하면
             전에는 **첫 개만** 들어가고 나머지는 말없이 사라졌습니다. */
        const fs = form.getAll("drop").filter(x => x && typeof x.slice === "function");
        const box = await caches.open(SHARE_BOX);
        for (const f of fs) {
          await box.put(SHARE_KEY + "-" + n,
            new Response(f, { headers: { "X-Name": encodeURIComponent(f.name || "shared.zip") } }));
          n++;
        }
      } catch (err) { /* 실패해도 화면은 열어줍니다 — 다만 아래에서 말해줍니다 */ }
      /* ★★ 목적지도 **요청 주소 기준**으로 풀어야 합니다.
           서비스워커 안에서 그냥 "./index.html" 을 쓰면 워커 스크립트 자리를
           기준으로 풀려서 **본체 화면**으로 갑니다. 거기엔 받아가는 코드가
           없어서 아무 일도 안 일어납니다. req.url(= .../game/) 기준으로 풉니다. */
      /* ★ **몇 개를 넣어뒀는지** 주소에 실어 보냅니다. 0 이면 화면이
           "공유가 안 됐다" 고 말해줄 수 있습니다. 전에는 실패해도 화면만
           열려서, 아무 일도 안 일어난 것과 구분이 안 됐습니다. */
      return Response.redirect(new URL("./index.html?shared=" + n, req.url).href, 303);
    })());
    return;
  }

  if(req.method !== "GET") return;

  const url = new URL(req.url);
  const sameSite = url.origin === self.location.origin;

  /* 다른 사이트(지진 자료, 위키백과 등)는 손대지 않습니다.
     저장해두면 오래된 자료를 보여주게 되니까요.                              */
  if(!sameSite) return;

  /* ★★★ 여기가 "올렸는데 안 바뀐다" 의 진짜 원인이었습니다. ★★★

     전에는 **.html 만** 인터넷 먼저였고, .js 는 아래쪽 "저장분 먼저" 로
     떨어졌습니다. 그런데 게임 기능은 전부 .js 안에 들어 있습니다
     (game.js / ui.js / pad.js). 즉 —

       · index.html 은 새것을 받아옵니다 (그래서 BUILD 글자는 바뀝니다)
       · 그런데 game/*.js 는 **폰에 저장해둔 옛날 것을 계속 씁니다**

     파일을 아무리 제대로 올려도, 저장분 번호(VERSION)를 바꾸기 전까지는
     게임 쪽이 통째로 옛날 그대로입니다. 올린 사람 잘못이 아닙니다.

     이제 **글자로 된 파일은 전부 인터넷 먼저**로 바꿉니다.
     그림과 wasm 만 저장분을 먼저 씁니다 — 그건 잘 안 바뀌고 무겁습니다. */
  const heavy = /\.(png|jpg|jpeg|gif|svg|ico|wasm|woff2?)$/i.test(url.pathname);
  const isPage = !heavy;

  if(isPage){
    /* 화면은 인터넷 먼저 → 고친 내용이 바로 반영됩니다.

       ★ 반드시 "주소별로" 저장해야 합니다.
         전에는 어떤 화면이든 ./index.html 이라는 한 칸에 덮어썼습니다.
         그러면 game/index.html 을 한 번 열자마자 본체 화면 자리에 게임이
         덮어써져서, 인터넷이 없을 때 본체를 열면 게임이 나옵니다.        */
    /* ★ no-cache 를 붙입니다.
         서비스워커를 지나도 그 뒤에 **브라우저 자체 저장분**이 또 있습니다.
         이걸 안 붙이면 거기서 옛날 파일이 나와서, 새로고침을 해도
         한동안 옛것이 보입니다. (지우는 게 아니라 "바뀌었나 물어보기" 라
         안 바뀌었으면 안 받아오므로 느려지지 않습니다.) */
    let fresh = req;
    try { fresh = new Request(req, { cache: "no-cache" }); } catch (err) {}
    e.respondWith(
      fetch(fresh)
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
      /* ★ 여기서 hit 을 다시 돌려주면 안 됩니다 — 이 자리의 hit 은 **반드시 없습니다**
           (있었으면 fetch 까지 안 왔습니다). undefined 를 돌려주면 respondWith 가
           TypeError 로 터져서, 진짜 원인(인터넷 없음)이 엉뚱한 오류로 덮입니다.
           이유가 적힌 응답을 만들어 돌려줍니다. */
    }).catch(() => new Response("", { status: 504, statusText: "offline, not cached" })))
  );
});

/* 저장해도 되는 응답인가.
   status 0 은 다른 사이트에서 온 것이라 내용을 볼 수 없습니다. */
function ok(res){
  return res && res.ok && res.status !== 0 && res.type !== "opaque";
}
