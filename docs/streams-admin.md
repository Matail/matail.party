# 관리자 페이지 (`streams-admin`)

게임별 비공개 통계 · 설정 · 내보내기를 보는 관리자 전용 페이지. 공개 사이트와 **따로 배포하는 Worker** 이고,
`workers.dev` 주소 전체를 **Cloudflare Access** 로 막는다. 코드는 `admin/`.

## 페이지

위쪽 탭에서 게임을 고르고(지금은 The STREAMS+ 하나), 아래 셋 중 하나를 본다.

- **통계** — 조건: 기간(7 · 30 · 90일 · 전체 · 직접) · 난이도 · 클라이언트. 클라이언트를 고르지 않으면 에디터 판은 뺀다.
  **PDF 리포트**(지금 보이는 블록을 흰 종이로, 브라우저에서 만든다) · **요약 JSON**.
- **내보내기** — 같은 조건으로 CSV(엑셀용 BOM, 수식 막기) · JSON. 판 · 턴 · 행동 기록 · 학습용 판 · 학습용 턴, 한 번에 최대 10만 줄.
  내보내기에는 익명 `player_id` 가 들어간다 (분석용).
- **설정** (`site_settings`, migration 0006)
  - 데이터 수집 켜기/끄기 — 끄면 게임은 되지만 판 · 턴 · 행동 기록 · 실시간 집계를 남기지 않는다. 게임 서버가 30초마다 다시 읽는다.
    판 단위로 따른다 (시작할 때의 설정이 토큰에 들어간다).
  - 공개 통계 카드 — `/stats/streams/` 에 보일 카드. 끈 카드의 숫자는 `/api/streams/stats` · 웹소켓 응답에서도 빠진다.
    저장하면 실시간 통계 DO 에 바로 알린다 (`STATS` 바인딩, `script_name: my-site`).
  - 에디터 테스트 기록 정리 — 개수를 먼저 보고, CSV 로 받아 둔 뒤 지운다 (되살릴 수 없음).

게임을 추가하려면 `admin/games/types.ts` 의 `GameAdmin` 모양으로 모듈을 만들어 `admin/games/index.ts` 에 넣는다.
화면은 게임을 모르고, 모듈이 돌려주는 블록(타일 · 막대 · 표)을 그대로 그린다.

## 무엇이 공개이고 무엇이 관리자 전용인가

STREAMS 기준. 공개 쪽은 관리자 설정에서 카드별로 끌 수 있다.

| 공개 (`/stats/streams/`, `/api/streams/stats`) | 관리자 전용 (`streams-admin`) |
|---|---|
| 지금 두는 중 · 오늘 끝난 판 · 오늘 최고 · 지금까지 끝난 판 | 최근 끝난 판 30개 (시각 · 걸린 시간 · 클라이언트) |
| 판 흐름 (시작 → 끝까지 → AI 를 이김) | 클라이언트별 판 수 · 평균 점수 · 사람 승률 |
| 사람 점수 분포 | 행동 기록: 망설임 · 포기율 · 재대전율 · 세션 수와 길이 |
| 난이도별 사람 vs AI 평균 · 승률 | 생각 시간 분포 (학습용 턴) |
| 승 · 무 · 패 | 데이터 품질: 학습용 판 수와 규칙으로 빠진 판 (에디터 · 다시 둔 턴 · 20턴 미만 · pvp) |
| 첫 카드 자리 히트맵 | 원본 내보내기 (CSV · JSON), PDF 리포트 |

기준: **합계와 분포는 공개**, 판 하나하나를 가리킬 수 있는 것(시각이 붙은 최근 판)과 운영 정보(클라이언트, 행동, 품질)는 관리자 전용.
`player_id` 는 공개 쪽과 관리자 화면엔 나오지 않고, 관리자 내보내기에만 들어간다.

## 처음 설정 (한 번)

1. **배포** — my-site 폴더에서

   ```sh
   npx wrangler deploy -c admin/wrangler.jsonc
   ```

   `ACCESS_TEAM_DOMAIN` · `ACCESS_AUD` 가 비어 있어서 이 상태로는 **모든 요청이 403** 이다 (닫힌 채로 시작).

2. **Access 켜기** — Cloudflare 대시보드 → Workers & Pages → `streams-admin` → Settings → Domains & Routes →
   `workers.dev` 줄의 **Cloudflare Access** 를 켠다. 만들어진 Access 앱의 정책에 볼 사람 이메일을 넣는다.

3. **두 값 확인**
   - 팀 도메인: Zero Trust → Settings → Custom Pages 의 `<팀>.cloudflareaccess.com`
   - AUD 태그: Zero Trust → Access → Applications → 방금 생긴 앱 → **Application Audience (AUD) Tag**

4. **값 넣고 다시 배포** — `admin/wrangler.jsonc` 의 `vars` 에 채우고 1번을 다시 실행
   (둘 다 비밀값이 아니다 — 서명 확인에 쓰는 공개 정보라 커밋해도 된다).

5. `https://streams-admin.<계정>.workers.dev` 를 열면 Access 로그인 → 관리자 페이지.

## 막는 방식

- 1차: Access 가 로그인하지 않은 요청을 Worker 앞에서 막는다.
- 2차: Worker 도 `Cf-Access-Jwt-Assertion` 토큰을 직접 확인한다 (`admin/access.ts` — 팀 공개 키로 RS256 서명, `aud`, `iss`, 만료).
  Access 설정이 빠지거나 풀려도 열리지 않고 403 이 된다. 확인: `node admin/access.test.ts`.
- 바꾸는 요청(설정 저장 · 기록 정리)은 `x-admin-action` 헤더가 있어야 한다 — 다른 사이트의 폼이 로그인 쿠키로 보내는 요청을 막는다.
- 기록 DB(D1)는 설정 쓰기와 테스트 기록 정리만 쓴다. 페이지에는 `noindex`, 응답은 캐시하지 않는다.
- 확인: `node admin/files.test.ts` (CSV · JSON · 조건 · 설정 값).

## 배포 순서 (설정 기능을 처음 올릴 때)

1. `npx wrangler d1 migrations apply streams-records --remote` — 0006 (`site_settings`). 없어도 게임은 기본값(수집 켬 · 전부 공개)으로 돈다.
2. my-site 머지 → 자동 배포 (게임 서버 · 실시간 통계가 설정을 읽는다).
3. `npx wrangler deploy -c admin/wrangler.jsonc` — 관리자 Worker (my-site 의 `StatsHub` 를 가리키므로 2번 다음에).
