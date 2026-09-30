# STREAMS 관리자 통계 (`streams-admin`)

공개 통계(`/games/streams/live/`)에 없는 것을 보는 관리자 전용 페이지. 공개 사이트와 **따로 배포하는 Worker** 이고,
`workers.dev` 주소 전체를 **Cloudflare Access** 로 막는다. 코드는 `admin/`.

## 무엇이 공개이고 무엇이 관리자 전용인가

| 공개 (`/games/streams/live/`, `/api/streams/stats`) | 관리자 전용 (`streams-admin`) |
|---|---|
| 지금 두는 중 · 오늘 끝난 판 · 오늘 최고 · 지금까지 끝난 판 | 최근 끝난 판 30개 (시각 · 걸린 시간 · 클라이언트) |
| 판 흐름 (시작 → 끝까지 → AI 를 이김) | 클라이언트별 판 수 · 평균 점수 · 사람 승률 (30일) |
| 사람 점수 분포 | 행동 기록: 망설임 · 포기율 · 재대전율 · 세션 수와 길이 (7일) |
| 난이도별 사람 vs AI 평균 · 승률 | 생각 시간 분포 (학습용 턴) |
| 승 · 무 · 패 | 데이터 품질: 학습용 판 수와 규칙으로 빠진 판 (에디터 · 다시 둔 턴 · 20턴 미만 · pvp) |
| 첫 카드 자리 히트맵 | |

기준: **합계와 분포는 공개**, 판 하나하나를 가리킬 수 있는 것(시각이 붙은 최근 판)과 운영 정보(클라이언트, 행동, 품질)는 관리자 전용.
`player_id` 는 어느 쪽에도 나오지 않는다.

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
- 기록 DB(D1)는 읽기만 한다. 페이지에는 `noindex`, 응답은 캐시하지 않는다.
