# 기본으로 들어있는 게임

전부 **재배포가 허용된** 것만 넣었습니다. 라이선스 파일 원문을 직접 확인했습니다.
게임 목록 화면에도 이 표기가 나오게 되어 있습니다.

| 파일 | 제목 | 만든 사람 | 라이선스 | 크기 | 저장 |
|---|---|---|---|---|---|
| `2048.gb` | 2048-gb | Sanqui | **zlib** | 32KB | 배터리 있음 |
| `libbet.gb` | LIBBET | Damian Yerrick (pinobatch) | **zlib** | 32KB | 없음 |
| `WORDLE.gb` | WORDLE | stacksmashing | **GPL-3.0** | 32KB | 없음 |
| `tobu.gb` | TOBU | Tangram Games | **코드 MIT / 그림 CC BY 4.0** | 256KB | 배터리 있음 |
| `tobudx.gb` | TOBUDX | Tangram Games | **코드 MIT / 그림 CC BY 4.0** | 256KB | 배터리 있음 |

## 출처 표기 (CC BY 4.0 이라 필요합니다)

> Tobu Tobu Girl and Tobu Tobu Girl Deluxe © 2017–2019 Tangram Games.
> Code licensed under the MIT License. Assets licensed under CC BY 4.0.
> https://github.com/SimonLarsen/tobutobugirl
> https://github.com/SimonLarsen/tobutobugirl-dx

> 2048-gb © Sanqui. zlib License. https://github.com/Sanqui/2048-gb
> Libbet and the Magic Floor © Damian Yerrick. zlib License. https://github.com/pinobatch/libbet
> GB-Wordle © stacksmashing. GPL-3.0. https://github.com/stacksmashing/gb-wordle

## 어떤 게임인가

**2048-gb** — 숫자 타일을 밀어서 합치는 퍼즐. 폰에서 하던 그 2048입니다.

**Libbet and the Magic Floor** — 바닥 타일을 밟아 지우는 퍼즐. 32KB인데 잘 만들었습니다.

**GB-Wordle** — 게임보이판 워들. 다섯 글자 단어 맞히기.

**Tobu Tobu Girl** — 계속 위로 튀어오르는 아케이드 게임. **원래 흑백 4단계로 그려진 게임**이라
우리 주황 4단계 화면에 가장 잘 맞습니다.

**Tobu Tobu Girl Deluxe** — 위 게임의 게임보이 컬러판. 컬러라서 우리 화면에서는
색을 4단계로 줄여야 합니다. 원작과 비교해보세요.

## 확인한 것

다섯 개 모두 진짜 게임보이 롬인지 검사했습니다.

- **닌텐도 로고 바이트**(0x104~0x133) — 전부 일치
- **헤더 체크섬**(0x14D) — 전부 일치
- 롬 구분 열쇠가 서로 겹치지 않음

`2048.gb`, `tobu.gb`, `tobudx.gb` 는 **배터리 저장이 있는 카트리지**입니다.
게임 안에서 저장하면 우리 앱이 자동으로 받아 보관합니다. 아드님이 따로 할 일은 없습니다.

## 주의

- **`tobutobugirl.zip` 은 지워주세요.** 안에 든 롬(`tobu.gb`)은 이미 꺼내놨습니다.
  나머지는 설명서·상자그림 PDF 라 4MB나 되는데 앱에는 필요 없습니다.
- 여기 없는 롬을 넣고 싶으면 저장소에 커밋하지 말고,
  앱에서 **`[+ ADD ROM]`** 으로 폰에 직접 넣으세요.
  대부분의 홈브루는 "무료로 받아라"이지 "네 저장소에 올려라"가 아닙니다.
- **깃허브에 표시된 라이선스 배지를 믿지 마세요.** `Petris` 라는 게임은
  배지에 MIT 라고 나오는데 실제 LICENSE 파일은 CC BY-NC-SA(비영리)였습니다.
  저장소에 같이 든 남의 라이브러리 라이선스를 깃허브가 잘못 읽은 것입니다.
