# 화면 전수 확인 — 진행 상황과 결함 목록

기준 v0.7.458 · 실브라우저(사용자 Chrome, 로그인 세션) 직접 확인 + 화면별 자동 점검 스크립트

> **이 문서는 진행 중이다.** 확인한 화면과 확인 못 한 화면을 구분해 적는다.
> "다 봤다"고 적지 않는다 — 앞서 네 화면만 보고 전수 확인이라 보고한 사고가 있었다.

## 점검 방법

화면마다 브라우저에서 스크립트를 주입해 아래를 **한 번에** 판정한다(성능 포함).
스크립트 원문은 세션 `sessionStorage.__a2`. 항목:

1. RSC 응답시간(ms) — 800ms 초과면 `느림`
2. 목록 표준 채택 — 데이터 3행 이상인데 `.list-toolbar` 없으면 `목록표준 미적용`
3. 보기전환 유무 — 도구줄은 있는데 `.list-views` 없으면 `보기전환 없음`
4. 검색 돋보기가 입력 밖에 있는지
5. 문서 가로 스크롤
6. 부모를 넘치는 요소
7. 세로로 깨진 짧은 텍스트(배지·라벨)
8. 10px 미만 폰트
9. `input-field` 없는 raw 입력

**눈으로도 본다.** 스크립트는 놓치는 게 있다 — 실제로 `/ci/inbox`의 "요리"·"원본"
세로 깨짐을 스크립트가 못 잡고 스크린샷에서 발견했다.

## 확인 완료 (눈 + 스크립트)

| 화면 | 성능 | 결함 |
|---|---|---|
| `/admin/members` | 284ms | **표가 부모를 169px 넘침** — "온보딩" 칸이 화면 밖으로 잘림 |
| `/admin/ai-usage` | 157ms | **목록표준 미적용**(25행) — 유저별 사용량 표에 검색·정렬·보기전환 없음 |
| `/work/projects` | 170ms | **보기전환 없음** — 카드 고정, 표로 못 봄 |
| `/org` | 166ms | 10px 미만 42개 → **줌 54% 때문일 가능성 큼(오탐 의심, 재확인 필요)** |
| `/ci/inbox` | 234ms | **목록표준 미적용**(21행) + **"요리"·"원본" 세로 깨짐**(스크립트 미검출) |
| `/ci/trends` | 232ms | 없음 |
| `/meeting-notes` | — | v0.7.457에서 크래시 복구 + 배지 세로깨짐 해소 확인 |
| `/admin/api` | — | 검색 돋보기 이탈 → v0.7.457 해소 확인 |

## 스크립트만 돌린 화면 (눈으로 안 봄 — 재확인 필요)

`/home` `/daily` `/weekly-report` `/dept-tasks` `/calendar` `/deals` `/lead-intake`
`/kpi` `/routine` `/operations` `/work/activity` `/contacts` `/accounts`
`/admin/daily-logs` `/admin/reports` `/admin/routine` `/admin/partner-tiers`
`/admin/kpi` `/admin/ai-prompts` `/ci/boards`

그중 스크립트가 잡은 것:
- `/weekly-report` — `input-field` 없는 raw INPUT 1
- `/lead-intake` — `input-field` 없는 raw TEXTAREA 1
- `/deals` — 부모 넘침 1
- `/daily` `/calendar` — 10px 미만 폰트 각 1

## 미확인 (착수 안 함)

- **세부 조회 화면 전부** — `/accounts/[id]` `/contacts/[id]` `/deals/[id]`
  `/meeting-notes/[id]` `/work/projects/[id]` `/ci/briefs/[id]` `/ci/channels/[id]` 등
- **모달 전부** — 각 화면의 생성·편집·확인 모달
- **CI 나머지** — `/ci` `/ci/assets` `/ci/publish` `/ci/performance` `/ci/pipeline`
  `/ci/settings` `/ci/studio` `/ci/monitoring` `/ci/my-channels`
- **설정 전체** — `/admin/settings` 각 탭
- **개발자센터 상세** — `/develop` 각 섹션, `/api-access`
- **"상세화면으로 보기"가 안 되는 곳** — 미조사
- `/pricing/gpu` 탭 15종, `/pricing/catalog`, `/api-keys`, `/admin/content`,
  `/admin/data-quality`, `/admin/org-chart`, `/admin/ai-chat`, `/ai-chat/*`

## 성능 — 결론

측정으로 갈렸다. **아키텍처가 원인의 전부는 아니다.**

| 측정 | 값 |
|---|---|
| Supabase auth 왕복 | 21ms |
| Supabase REST 쿼리 | 40ms |
| 레이아웃 8쿼리(병렬)+미들웨어 2회 = 실제 원격 비용 | 약 100~150ms |
| 수정 전 화면 응답 | 600~995ms |
| 수정 후(현재) | **157~284ms** |

차액의 상당 부분은 `next dev` 오버헤드였고, 나머지는 아래로 줄였다(v0.7.458):
- `myWeekCount`가 `Promise.all` 밖에 있어 매 전환마다 직렬 왕복 1회 추가되던 것 편입
- 라우트 그룹 `loading.tsx` 3개 — 그전엔 81화면 중 11곳만 있어 **70화면이 전환 중 무반응**
- 골격은 250ms 넘게 걸릴 때만 노출(`.skel-reveal`) — 빠른 전환에서 깜빡이지 않게

### 남은 병목 (승인 필요 — 인증 경계)
`auth.getUser()`가 요청당 2회다(미들웨어 → `(member)/layout`). 미들웨어가 원격
검증한 사용자를 레이아웃이 또 원격 검증한다. 미들웨어가 결과를 헤더로 넘기면
왕복 1회가 사라지지만 인증 경계를 건드리므로 임의로 하지 않았다.

### 별개 발견 — 프로덕션 빌드 실패
`next build`가 222/222 페이지까지 가서 **`/develop` export에서 실패**하고
`prerender-manifest.json`을 만들지 않는다. 그래서 prod 성능을 끝내 못 쟀다.
배포 파이프라인 영향 여부 확인 필요.

## 알려진 탐지기 구멍

- 세로 깨짐: `/ci/inbox`의 "요리"·"원본"을 못 잡았다. 정사각형 아바타를 거르려고
  넣은 `height > width*1.4` 조건이나 부모-자식 구조 때문으로 보인다. 규칙 보완 필요.
- 10px 미만: `transform: scale`로 축소된 영역(`/org` 조직도 54%)을 위반으로 센다.
