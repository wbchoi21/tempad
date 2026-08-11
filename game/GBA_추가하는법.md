# GBA 를 실제로 돌아가게 하려면

**지금 상태** — GBA 는 화면·목록·롬 판별·저장·조작·배치가 전부 준비되어 있습니다.
없는 것은 **에뮬레이터 알맹이 파일 하나**뿐입니다.
지금 GBA 게임을 고르면 검은 화면이 아니라 `GBA EMULATOR NOT AVAILABLE` 이 뜹니다.

왜 안 넣었나 — **진짜 브라우저에서 확인할 방법이 없었습니다.**
이 컴퓨터의 크롬 확장이 localhost 에 접근하지 못해서(권한 문제), 넣어봤자
"되는지 안 되는지 모르는 2MB" 를 올리는 셈이었습니다.
안 되는 걸 올리는 것보다 안 올리고 이유를 적어두는 편이 낫다고 판단했습니다.

---

## 1. 어떤 파일을 구해야 하나 (조사 끝났습니다)

**`@thenick775/mgba-wasm` 의 1.x 계열** 을 쓰세요. 2.x 는 안 됩니다.

| | 1.0.21 / 1.1.1 | 2.x |
|---|---|---|
| 스레드(pthread) | **안 씀** ✓ | 씀 |
| SharedArrayBuffer | **안 씀** ✓ | 씀 |
| COOP/COEP 헤더 | **필요 없음** ✓ | 필요함 |
| 깃허브 페이지 | **그냥 됨** ✓ | **안 됨** (헤더를 못 넣습니다) |

★ 이게 핵심입니다. 깃허브 페이지는 응답 헤더를 설정할 수 없어서,
2.x 를 올리면 아무리 해도 안 돕니다. 1.x 는 그 제약이 없습니다.
(둘 다 실제로 받아서 `SharedArrayBuffer` / `new Worker` 문자열이 있는지
확인했고, 1.1.1 은 Node 에서 로드까지 되는 것을 봤습니다.)

받는 곳:
```
https://registry.npmjs.org/@thenick775/mgba-wasm/-/mgba-wasm-1.1.1.tgz
```
압축을 풀면 `package/dist/mgba.js` 와 `mgba.wasm` 이 있습니다. 라이선스는 MPL-2.0.

---

## 2. 어디에 넣나

```
web/game/mgba.js      ← 위에서 받은 것
web/game/mgba.wasm    ← 위에서 받은 것
web/game/mgba-glue.js ← 아래 3번. 우리가 쓰기 편하게 감싸는 얇은 껍데기
```

`index.html` 은 **GBA 를 고른 순간에만** `mgba.js` 를 부릅니다
(`loadMgba()`). 그래서 파일이 없어도 게임보이는 아무 손해가 없습니다.

---

## 3. 껍데기가 해야 할 일 — 딱 두 가지

`mgba.js` 는 `window.MgbaCore = { load() }` 를 내놓아야 합니다.
`load()` 는 두 가지만 하면 됩니다.

```js
window.MgbaCore = {
  async load() {
    /* 1) 코어를 준비하고 */
    const mod = await mGBA({ canvas: /* GBA 전용 캔버스 */ });
    /* 2) 우리 규약에 맞는 Session 클래스를 등록한다 */
    GameMode.registerCore("gba", MgbaSession);
    return mod;                 /* start() 에 넘어갈 module */
  }
};
```

`MgbaSession` 은 binjgb 쪽 `Session`(game.js)과 **같은 모양**이면 됩니다.
필요한 것은 이만큼입니다.

| 메서드 | 하는 일 |
|---|---|
| `constructor(module, romBytes, opts)` | 롬을 넣고 시작. `opts.canvas` `opts.sram` `opts.colorReal` `opts.onSram` |
| `press(name, down)` | `up/down/left/right/A/B/select/start/L/R` |
| `pause(byUser)` / `resume()` | 멈춤·재개. `byUser` 면 `this.userPaused = true` |
| `getState()` / `loadState(bytes)` | 슬롯 세이브 |
| `flushSram()` | 배터리 세이브를 `opts.onSram(bytes)` 로 |
| `loadSram(bytes)` | 배터리 세이브 불러오기 |
| `destroy()` | 전부 정리. **여기가 제일 중요합니다 (아래 4번)** |
| `setColorMode(real)` | 화면 색 |
| `get running()` | 지금 돌고 있는가 |

---

## 4. ★★ 반드시 확인할 것 — 이 프로젝트가 두 번 데인 곳

### 4-1. 껐다 켜기를 반복해도 메모리가 안 새는가

binjgb 에서 **똑같은 사고가 두 번** 났습니다.
한 번은 세이브할 때마다 195KB 가 새서 **71번째 저장에서 죽었고**,
한 번은 메모리를 두 번 반납해서 **세 번째 게임 시작에서 터졌습니다.**

`test/run.js` 의 `[8]`(25회 껐다 켜기)과 `[11]`(저장 300회)이 그걸 봅니다.
**mGBA 용으로 같은 검사를 만들어서 통과시키기 전에는 올리지 마세요.**
mgba 1.1.1 은 Node 에서 로드되므로 `test/run_gba.js` 를 만들 수 있습니다.

### 4-2. 화면 색 (주황 만들기)

mGBA 는 **픽셀 배열을 안 내줍니다.** 제 캔버스에 직접 그립니다.
(export 목록을 덤프해서 확인했습니다. `screenshot()` 으로 PNG 를 거치는
길은 있지만 매 프레임 쓰기엔 너무 느립니다.)

그래서 게임보이처럼 `tintOrange` 로 칠할 수 없습니다. 대신 **CSS 필터**를
캔버스에 걸면 됩니다. 공짜이고(GPU) 매 프레임 비용이 0 입니다.

```css
/* 템패드 주황 모드일 때만 */
#screenGba.amber{ filter: grayscale(1) sepia(1) saturate(4) hue-rotate(-12deg) contrast(1.15); }
```

★ GBA 를 게임보이처럼 **4단계**로 뭉개면 안 됩니다. 글자가 안 보입니다.
GBA 는 색이 수천 가지라, 앰버 모니터처럼 **연속된 주황**이 맞습니다.

### 4-3. 캔버스는 따로 써야 합니다

캔버스 하나에는 2D 든 WebGL 이든 **한 종류만** 붙일 수 있습니다.
binjgb 는 2D 를 쓰므로, mGBA 용 캔버스를 하나 더 만들어서
시스템에 따라 보였다 숨겼다 하세요.

### 4-4. 파일을 넣은 뒤 할 일

- `web/sw.js` 의 `KEEP` 목록에 `./game/mgba.js` `./game/mgba.wasm` 두 줄 추가
  (안 넣어도 돌아갑니다. 미리 받아두느냐 차이뿐입니다.)
- `web/sw.js` 의 `VERSION` 을 올리기 (`tempad-v12`)
- `web/index.html` 의 `BUILD` 를 올리기
- `node test/all.js` 전부 통과 확인

---

## 5. 이미 확인해둔 것 (다시 안 해도 됩니다)

- GBA 롬 판별식이 맞습니다. 진짜 롬 2개(jsmolka/gba-tests, MIT)로
  `rom[0xB2]===0x96` 과 헤더 체크섬을 확인했습니다. 닌텐도 로고 32바이트도
  그 롬에서 떠와 `game.js` 에 박아뒀습니다.
- GBA 롬 제목은 `0xA0~0xAB` 에서 읽습니다 (게임보이와 자리가 다릅니다).
- 32MB 롬의 지문 계산은 PC 37ms, 폰 150ms 쯤입니다 — 문제없습니다.
- 화면 배치(240×160, L·R 버튼 자리)는 이미 다 잡혀 있고 기기 5종에서
  겹침·이탈이 없는 것을 좌표로 확인했습니다.
