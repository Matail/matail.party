# STREAMS API 계약 (v1)

웹 클라이언트(`public/games/streams/script.js`)와 Unity 클라이언트(`streams-unity` 리포)가 같이 쓰는 서버 API.
구현은 `worker/streams/`. 이 문서와 구현이 다르면 버그다 — 둘을 같이 고친다.

## 공통

- 주소: `https://<사이트 도메인>/api/streams/…` (Unity WebGL 은 같은 도메인에 올리므로 상대 경로 `/api/streams/…`)
- 메서드: 모두 `POST`, 본문은 JSON (`content-type: application/json`)
- 응답: 모두 JSON. 실패하면 HTTP 상태 코드와 `{ "error": "<짧은 영문 사유>" }`

### 요청 헤더 `x-streams-client`

어떤 클라이언트로 둔 판인지 기록한다 (`streams_games.client`). **모든 클라이언트가 보내야 한다.**

```text
x-streams-client: <종류>/<버전>
```

| 종류 | 쓰는 곳 |
|---|---|
| `web` | 지금의 HTML 버전. 버전은 정수 (`web/1`) |
| `unity-webgl` | Unity WebGL 빌드 (`unity-webgl/0.1.0`) — 버전은 `Application.version` |
| `unity-editor` | Unity 에디터 플레이 모드. 분석에서 뺀다 |
| `unity-windows` · `unity-mac` · `unity-android` · `unity-ios` | 나중 빌드용으로 예약 |

- 형식: `^[a-z][a-z0-9-]{0,31}/[0-9A-Za-z.+-]{1,32}$`
- 없거나 형식이 틀리면 요청은 그대로 처리하고 기록만 `NULL` 로 남긴다 (옛 페이지 캐시 호환).

### CORS

같은 도메인에서 부르면 필요 없다. 테스트용으로 `http://localhost:<port>` · `http://127.0.0.1:<port>` 출처만 허용한다
(Unity "Build And Run" 이 띄우는 로컬 서버). 그 밖의 출처는 브라우저가 막는다.
에디터 플레이 모드와 네이티브 빌드는 브라우저가 아니라 CORS 와 상관없다.

## `POST /api/streams/start` — 새 판

요청

```json
{ "level": 3, "playerId": "0b6e…(선택, 최대 64자)" }
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `level` | 정수 1~5 | 1 입문 · 2 보통 · 3 숙련 · 4 고수 · 5 마스터 |
| `playerId` | 문자열, 선택 | 기기에 저장한 익명 id. 웹은 `localStorage['streams-player']`, Unity 는 `PlayerPrefs` 에 UUID |

응답 200

```json
{ "gameId": "a1b2…", "token": "<불투명 문자열>", "level": 3, "levelName": "숙련", "turn": 0, "card": 17 }
```

| 필드 | 설명 |
|---|---|
| `gameId` | 판 id (24자 hex). 표시·로그용 |
| `token` | 게임 상태를 서버가 암호화한 값. **클라이언트는 열어 보거나 고치지 않고 다음 요청에 그대로 돌려준다** |
| `turn` | 지금까지 놓은 카드 수 (0) |
| `card` | 이번에 놓을 카드 (1~30) |

오류: `400 level must be 1~5`

## `POST /api/streams/move` — 이번 카드 놓기

요청

```json
{ "token": "<직전 응답의 token>", "slot": 4, "thinkMs": 2310 }
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `token` | 문자열 | 가장 최근 응답의 `token` |
| `slot` | 정수 0~19 | 내 보드의 빈칸 (왼쪽이 0) |
| `thinkMs` | 정수, 선택 | 카드를 **화면에 보여 준 순간부터** 놓기까지 걸린 시간(ms). AI 학습 데이터라 꼭 보낸다 |

응답 200 (진행 중)

```json
{ "token": "<새 token>", "aiSlot": 11, "turn": 5, "playerScore": 12, "aiScore": 9, "nextCard": 22 }
```

응답 200 (마지막 20번째 수)

```json
{ "token": "<새 token>", "aiSlot": 0, "turn": 20, "playerScore": 41, "aiScore": 47, "finished": true }
```

| 필드 | 설명 |
|---|---|
| `aiSlot` | AI 가 **같은 카드**를 놓은 칸 |
| `turn` | 놓은 카드 수 (1~20) |
| `playerScore` · `aiScore` | 지금 보드의 점수. **화면에는 항상 이 값을 쓴다** (클라이언트 계산은 미리보기용) |
| `nextCard` / `finished` | 둘 중 하나만 온다 |

응답 헤더 `server-timing: model;dur=<ms>` — AI 모델을 불러오는 데 걸린 시간 (측정용).

오류

| 상태 | `error` | 뜻 · 클라이언트 처리 |
|---|---|---|
| 400 | `invalid slot` | 범위 밖이거나 이미 찬 칸. 클라이언트 보드가 틀어진 것 — 놓은 카드를 되돌린다 |
| 404 | `game not found` | 토큰이 위조·손상됨 (또는 서버 키 교체). 새 판을 시작한다 |
| 409 | `game finished` | 이미 끝난 판 |
| 500 | `server error` | 잠시 뒤 **같은 토큰으로** 다시 보낸다 |

### 토큰 규칙

- 토큰은 판의 전체 상태(덱 포함)를 담는다. 서버는 판을 따로 들고 있지 않다 → 토큰을 잃으면 판도 잃는다.
- 앱을 껐다 켜도 이어 두려면 토큰과 화면 상태(`card`, `turn`, 두 보드)를 같이 저장한다.
- 옛 토큰을 다시 보내면 그 시점부터 다시 둘 수 있지만, 서버는 처음 둔 수만 학습용으로 인정하고 다시 둔 턴은 `attempts` 를 올린다.
  → 네트워크 오류로 **재시도**할 때는 같은 토큰·같은 `slot` 으로 보낸다. 다른 칸으로 바꿔 보내지 않는다.

## `POST /api/streams/events` — 행동 기록 (묶음)

턴 기록으로 못 담는 행동을 모아 보낸다 (칸 위에서 망설임, 판 포기, 재대전, 세션). 테이블 `streams_events` (migration 0004).
**분석용이라 잃어도 되는 기록이다** — 실패해도 다시 보내지 않고, 게임 진행을 막지 않는다. 학습용 `streams_turns` 와 섞지 않는다.

요청

```json
{
  "sessionId": "0b6e…",
  "playerId": "0b6e…",
  "events": [
    { "seq": 0, "type": "session_start", "ts": 1790000000000 },
    { "gameId": "a1b2…", "seq": 1, "type": "hover", "ts": 1790000001000, "data": "{\"turn\":2,\"slot\":7,\"card\":15,\"ms\":640}" }
  ]
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `sessionId` | 문자열, 선택 | 앱을 켤 때마다 새로 만드는 id. `[0-9A-Za-z-]{1,64}` |
| `playerId` | 문자열, 선택 | `/start` 와 같은 익명 id |
| `events` | 배열, 최대 50개 | 아래 |
| `events[].seq` | 정수 ≥ 0 | 세션 안의 순번 |
| `events[].type` | 문자열 | `^[a-z][a-z_]{0,31}$` |
| `events[].gameId` | 문자열, 선택 | 판과 상관없으면 생략 |
| `events[].ts` | 정수, 선택 | 클라이언트 시각 (epoch ms) |
| `events[].data` | JSON 문자열 또는 객체, 선택 | 1KB 이하. Unity(JsonUtility)는 문자열로 보낸다 |

형식이 틀린 이벤트는 **그것만 버리고** 나머지를 받는다.

응답 `202 { "accepted": 2 }` (받은 개수) · 오류 `400 invalid body` / `events must be an array` / `at most 50 events`

### 이벤트 종류

| `type` | 언제 | `data` |
|---|---|---|
| `session_start` | 앱(페이지)을 켤 때 한 번 | — |
| `hover` | 빈칸 위에 커서가 머물다가 **놓지 않고** 떠날 때 (망설임, 0.1초 미만은 뺌) | `turn`, `slot`, `card`, `ms` (머문 시간) |
| `abandon` | 끝나지 않은 AI 대전을 두고 새 판(또는 튜토리얼)을 시작할 때. 페이지를 닫고 떠난 판은 `streams_games.status = 'playing'` 으로 남는다 | `turn` (놓은 카드 수), `level` |
| `rematch` | 결과 화면에서 "한 판 더" | `level` |

## 실시간 통계 — `GET /api/streams/stats` · `GET /api/streams/live`

공개 페이지 `/stats/streams/` 와 통계 탭 개요 `/stats/` 가 쓴다. 집계는 Durable Object `StatsHub` 하나에 있고(`worker/streams/statshub.ts`, 계산은 `stats.ts`),
`/start` · 첫 `/move` · 마지막 `/move` 때 갱신된다. **D1 을 실시간으로 조회하지 않는다** — DO 가 처음 뜰 때만 D1 에서 한 번 센다.

- `GET /api/streams/stats` → 지금 스냅숏 (5초 캐시)
- `GET /api/streams/live` → 웹소켓. 접속하면 스냅숏 한 번, 이후 바뀔 때마다 새 스냅숏 (초당 최대 1번)
- 세는 판: AI 대전, 에디터·로컬 테스트(`unity-editor/…`) 제외 — 품질 규칙(migration 0005)과 같다. 옛 토큰으로 다시 보낸 첫 수·결과는 판 id 로 한 번만 센다
- **공개 데이터만** 나간다: 합계와 분포. `player_id` · `game_id`, 판 하나하나(최근 판·시각), 클라이언트 비율은 없다 — 그건 관리자 전용 (`docs/streams-admin.md`)
- `cards` 는 관리자가 공개로 둔 카드(`tiles` · `funnel` · `bins` · `radar` · `gauge` · `heat`). **꺼진 카드만 쓰는 필드는 빠진다** (`stats.ts` 의 `PUBLIC_CARDS`)

```json
{
  "day": "2026-09-30", "cards": ["tiles", "funnel", "bins", "radar", "gauge", "heat"],
  "started": 81, "finished": 66, "won": 21, "drawn": 4,
  "todayFinished": 8, "todayBest": 49, "best": 61, "playing": 1,
  "levels": [{ "games": 15, "won": 3, "drawn": 1, "me": 221, "ai": 337 }, "… 5개 (입문 → 마스터)"],
  "bins": [4, 13, 17, 15, 13, 4, 0, 0, 0, 0, 0],
  "heat": ["600칸: (첫 카드 - 1) × 20 + 칸"],
  "updatedAt": 1790744220000
}
```

| 필드 | 뜻 |
|---|---|
| `won` · `drawn` | 사람 기준 승 · 무 (패 = `finished - won - drawn`) |
| `day` · `today*` | 한국 날짜 기준 오늘 |
| `playing` | 시작했지만 아직 끝나지 않은 판 (30분 넘으면 뺌) |
| `levels[i].me` · `.ai` | 그 난이도 끝난 판의 사람 · AI 점수 합 (평균 = 합 / `games`) |
| `bins` | 사람 점수 10점 단위 분포, 마지막은 100점 이상 |
| `heat` | 첫 수: 첫 카드 숫자별로 놓은 칸 |

## 멀티 (방) — 초안, 아직 구현 전

2~8명이 **같은 카드를 동시에** 받아 각자 놓는다. 계획은 `docs/streams-unity-plan.md` 5단계.

- 방 하나 = Durable Object `Room` 하나. 규칙은 순수 함수(`worker/streams/room.ts`), DO 는 저장·웹소켓·타이머만 (예정).
- 방 코드로만 들어간다. 빠른 매치는 나중.
- **상태는 DO 안에만** 있다. AI 대전의 암호화 토큰은 쓰지 않는다. 덱은 방 밖으로 나가지 않고, 클라이언트는 이번 카드만 본다.
- 방 만들기 · 들어가기는 HTTP, 판은 웹소켓.

```text
방장  POST /api/streams/rooms              → code, seatToken
친구  POST /api/streams/rooms/{code}/join  → seatToken
모두  GET  /api/streams/rooms/{code}/ws    → hello{seatToken} → state
방장  start                                → 모두에게 card(turn 0)
각자  place                                → 모두에게 placed (누가 놨는지만)
모두 놓음 또는 20초                          → reveal (모두의 칸·점수) → card(다음) … 20번째 reveal 뒤 finished
방장  start                                → 같은 방에서 한 판 더
```

### `POST /api/streams/rooms` — 방 만들기

요청 `{ "name": "철수", "playerId": "0b6e…(선택)" }` → 응답 201

```json
{ "code": "K7QM2X", "seat": 0, "seatToken": "<불투명 문자열>" }
```

| 필드 | 설명 |
|---|---|
| `name` | 닉네임. 앞뒤 공백·제어 문자를 지우고 1~12자 |
| `playerId` | AI 대전과 같은 익명 id. 기록용, 다른 사람에게 보내지 않는다 |
| `code` | 방 코드 6자. 글자는 `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (헷갈리는 0·O·1·I·L 뺌). 대소문자 구분 없이 받는다 |
| `seat` | 내 자리 번호 0~7. 방 안에서 바뀌지 않는다 |
| `seatToken` | 이 자리로 웹소켓에 들어갈 비밀값. Unity 는 방 코드와 함께 `PlayerPrefs` 에 둔다 (재접속용) |

오류: `400 invalid name`, `429 too many rooms` (IP 당 1분에 5개)

### `POST /api/streams/rooms/{code}/join` — 들어가기

요청은 방 만들기와 같다 → 응답 200 `{ "code", "seat", "seatToken" }`

| 상태 | `error` | 뜻 |
|---|---|---|
| 400 | `invalid name` | |
| 404 | `room not found` | 코드가 없거나 방이 지워짐 |
| 409 | `room full` | 8명 |
| 409 | `game in progress` | 판 도중에는 못 들어온다. 대기실(`lobby`)과 판이 끝난 뒤(`finished`)에만 |

### 웹소켓 `GET /api/streams/rooms/{code}/ws`

- 연결하면 **첫 메시지로 `hello`** 를 보낸다. 토큰은 URL 에 넣지 않는다 (로그에 남음). 5초 안에 안 오면 닫는다.
- 메시지는 JSON 텍스트 하나에 하나, 종류는 필드 `t`. 1KB 이하, 연결당 초당 10개 이하 — 넘으면 닫는다.
- **Unity `JsonUtility` 로 읽을 수 있게** 만든다: 객체를 사전(키가 바뀌는 맵)으로 쓰지 않고, 중첩 배열이 없고,
  필드는 빠뜨리지 않고 항상 보낸다 (없음 = `-1`). 클라이언트는 `t` 만 먼저 읽고 종류별 클래스로 다시 읽는다.
- 살아 있음 확인: 클라이언트가 25초마다 텍스트 `ping` 을 보내면 서버가 `pong` (DO 를 깨우지 않는 자동 응답).
- `Origin` 이 있으면 사이트 도메인과 `http://localhost`·`127.0.0.1` 만 받는다. 에디터·네이티브 빌드는 `Origin` 이 없어 그대로 받는다.

| 닫는 코드 | 뜻 · 클라이언트 처리 |
|---|---|
| 4000 | 같은 자리로 새 연결이 들어옴 (탭 두 개). 다시 붙지 않는다 |
| 4001 | `hello` 가 없거나 토큰이 틀림. 저장한 토큰을 지운다 |
| 4004 | 방이 지워짐. 저장한 토큰을 지운다 |
| 1008 | 메시지 크기·빈도 초과 |
| 그 밖 | 네트워크 끊김. 1·2·4·8초… (최대 15초) 간격으로 다시 붙어 `hello` |

### 클라이언트 → 서버

| `t` | 필드 | 뜻 |
|---|---|---|
| `hello` | `seatToken` | 연결 직후 한 번. 답으로 `state`. AI 가 대신 두던 자리면 다음 카드부터 돌려받는다 |
| `start` | — | 방장만, `lobby` 또는 `finished` 에서. 연결된 사람이 2명 이상이어야 한다 |
| `place` | `turn`, `slot`, `thinkMs` | 이번 카드를 내 보드 `slot`(0~19, 빈칸)에 놓는다. `thinkMs` = 카드를 **화면에 보여 준 순간부터** 걸린 시간 |
| `resume` | — | AI 가 대신 두는 중일 때 "돌아가기". 다음 카드부터 직접 둔다 |
| `leave` | — | 방을 나간다. 대기실이면 자리가 비고, 판 도중이면 그 판 끝까지 AI 가 대신 둔다 (`hello` 로 돌아올 수 있음) |

### 서버 → 클라이언트

| `t` | 언제 | 필드 |
|---|---|---|
| `state` | `hello` 직후, 그리고 자리 목록이 바뀔 때마다 (들어옴·나감·연결·끊김·AI 대신 둠·방장 바뀜) | 아래 |
| `card` | 판 시작과 매 턴 | `turn` (0~19), `card` (1~30), `timeLeftMs` |
| `placed` | 누가 이번 카드를 놓았을 때 — **칸은 알려 주지 않는다**. 내 `place` 의 확인이기도 하다 | `turn`, `seat` |
| `reveal` | 모두 놓았거나 시간이 다 됐을 때 | `turn`, `card`, `seats: [{ seat, slot, auto, score }]` |
| `finished` | 20번째 `reveal` 바로 뒤 | `seats: [{ seat, score, rank }]` — 같은 점수는 같은 등수 (1, 1, 3) |
| `error` | 요청을 못 받았을 때 | `code`, `message` |

`state`:

```json
{
  "t": "state", "code": "K7QM2X", "phase": "playing", "you": 2, "host": 0,
  "turn": 7, "card": 18, "timeLeftMs": 12400, "mySlot": -1,
  "seats": [
    { "seat": 0, "name": "철수", "online": true, "auto": false, "placed": true, "score": 9, "rank": 0, "board": [3, 0, 7, "… 20칸, 0 = 빈칸"] }
  ]
}
```

| 필드 | 설명 |
|---|---|
| `phase` | `lobby` (대기실) · `playing` · `finished` (판이 끝나고 다음 판을 기다림) |
| `turn` · `card` · `timeLeftMs` | `playing` 일 때 이번 카드. 아니면 `-1` · `0` · `0` |
| `mySlot` | 이번 카드를 내가 이미 놓았으면 그 칸, 아니면 `-1` (재접속 직후 화면 복구용) |
| `seats[].board` | **공개된** 카드만. 이번 턴에 놓은 칸은 `reveal` 전까지 0 (내 것은 `mySlot`) |
| `seats[].auto` | AI 가 이 자리를 대신 두는 중 |
| `seats[].placed` | 이번 카드를 놓았음 |
| `seats[].rank` | `finished` 일 때 등수, 아니면 0 |

`error.code`: `bad_message` · `not_host` · `need_players` (연결된 사람 2명 미만) · `bad_phase` · `wrong_turn` · `already_placed` · `invalid_slot`.
`place` 가 거절되면 클라이언트는 놓은 카드를 되돌린다.

### 턴 규칙

- 판 시작: 덱은 AI 대전과 같은 규칙(`newDeck`). **시작할 때 연결돼 있는 자리만** 참가한다.
- 카드마다 **20초**. `timeLeftMs` 는 서버가 보낸 순간 기준이다 — 클라이언트는 받은 순간부터 센다 (시계 차이를 맞추지 않는다).
- 모두 놓으면 기다리지 않고 바로 `reveal` 과 다음 `card` 를 보낸다. 클라이언트는 `reveal` 연출 중에 다음 카드를 받을 수 있다.
- 20초가 지나면 안 놓은 자리는 서버 AI(입문 정책)가 둔다 → `reveal` 에서 `auto: true`. **이 수는 학습 데이터에서 뺀다.**
- **두 턴 연속 시간 초과**면 그 자리는 AI 가 대신 둔다(`auto`) — 다음 카드부터 카드가 나오자마자 둔다. `hello` 나 `resume` 으로 돌려받는다.
  모두 나가면 AI 끼리 금방 끝까지 둔다.
- `place` 재전송: 같은 턴에 이미 놓았으면 같은 칸은 오류 없이 `placed` 를 다시 보내고, 다른 칸이면 `already_placed`.

### 방 수명

- 방장이 나가면(대기실에서 `leave`, 또는 연결이 끊긴 채 60초) 남은 사람 중 가장 낮은 `seat` 가 방장이 된다.
- 대기실·`finished` 에서 연결이 끊긴 자리는 60초 안에 안 돌아오면 비운다.
- 연결이 하나도 없이 10분이 지나면 방을 지운다 (그 뒤 코드는 `404`, 웹소켓은 4004).
- 판이 끝나면 D1 에 남긴다 (`mode = 'pvp'`, 좌석별 보드·턴, 테이블은 migration 0008 예정). 아래 **수집 끄기** 설정을 따른다.

### 예시 (자리 0 에서 본 한 턴)

```text
← {"t":"card","turn":7,"card":18,"timeLeftMs":20000}
→ {"t":"place","turn":7,"slot":9,"thinkMs":3120}
← {"t":"placed","turn":7,"seat":0}
← {"t":"placed","turn":7,"seat":1}
← {"t":"reveal","turn":7,"card":18,"seats":[{"seat":0,"slot":9,"auto":false,"score":12},{"seat":1,"slot":15,"auto":false,"score":9}]}
← {"t":"card","turn":8,"card":4,"timeLeftMs":20000}
```

## 데이터 수집 끄기

관리자 설정 `streams/collect` 가 `false` 면 (migration 0006 `site_settings`, 최대 30초 뒤 적용) 게임은 그대로 되지만
`/start` · `/move` 가 D1 · 실시간 집계에 남기지 않고, `/events` 는 `202 { "accepted": 0 }` 으로 버린다.
판 단위로 따른다 — 시작할 때 꺼져 있던 판은 토큰에 표시되어 끝까지 기록하지 않는다. 응답 모양은 바뀌지 않는다.

## 규칙 (클라이언트 이식용)

- 보드 20칸, 덱은 40장 풀(1~10 한 장씩, 11~20 두 장씩, 21~30 한 장씩)에서 무작위 20장.
- 점수: 빈칸을 건너뛰고 왼쪽부터 읽어 **작거나 같은** 숫자로 이어지는 구간마다 `scoreTable[구간 길이]` 를 더한다.
  `scoreTable = [0, 0, 1, 3, 5, 7, 9, 11, 15, 20, 25, 30, 35, 40, 50, 60, 70, 85, 100, 150, 300]`
- 정답지: `worker/streams/testdata/rules.json` (보드 → 구간 길이 → 점수, 600여 개).
  `node worker/streams/vectors.ts` 로 `game.ts` 에서 만들고, `--check` 로 맞는지 확인한다.
  Unity 리포는 이 파일을 복사해 C# 규칙 구현을 테스트한다. 규칙을 바꾸면 다시 뽑아 양쪽에 반영한다.

## 바뀐 기록

| 날짜 | 변경 |
|---|---|
| 2026-09-29 | v1 문서화. `x-streams-client` 헤더, localhost CORS, `streams_games.client` (migration 0003) |
| 2026-09-30 | `POST /api/streams/events`, `streams_events` 테이블과 `streams_games.mode` (migration 0004) |
| 2026-09-30 | `GET /api/streams/stats` · `/api/streams/live` (Durable Object `StatsHub`) |
| 2026-09-30 | 관리자 설정 (migration 0006): 수집 끄기, 공개 카드 선택 — 통계 응답에 `cards`, 꺼진 카드의 필드는 빠짐. `best` · `todayStarted` 는 쓰는 카드가 없어 빠짐 |
| 2026-10-13 | 멀티(방) 프로토콜 초안 — 아직 구현 전 |
