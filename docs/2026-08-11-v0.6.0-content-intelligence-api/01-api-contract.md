# v0.6.0 — API 계약

> 설계서 §12 필수 산출물 2번. 엔드포인트·요청/응답 스키마·에러 코드 체계.
> 선행: v0.5.0(`docs/2026-08-11-v0.5.0-content-intelligence-schema/`)

---

## 0. 공통 규약

- 위치: `apps/web/app/api/ci/**/route.ts` (Next 14 App Router 라우트 핸들러)
- 인증: 세션 쿠키(`@supabase/ssr`). 미인증은 미들웨어가 `/login`으로 처리하므로
  API는 `401 UNAUTHORIZED`만 방어적으로 반환한다.
- 권한: 모든 핸들러 첫 줄에서 `requireCiMemberApi(workspaceId, minRole)`.
  `viewer`는 전 쓰기 엔드포인트에서 `403 FORBIDDEN`.
- 워크스페이스: 헤더 `X-CI-Workspace: <uuid>` 필수(쿼리 파라미터 병행 허용).
  누락 시 `400 WORKSPACE_REQUIRED`.
- 검증: 요청 바디는 Zod 스키마로 파싱. 실패 시 `422 VALIDATION_FAILED` + `details[]`.
- 날짜: 요청·응답 모두 ISO8601 with offset. 서버는 `lib/datetime/kst.ts` 경유.
  naive 문자열 수신 시 `normalizeKstWallString`로 수문.
- 멱등: 쓰기 중 잡을 유발하는 엔드포인트는 `Idempotency-Key` 헤더를 받아
  `ci_jobs.idempotency_key`로 전달한다.

### 응답 봉투 (전 엔드포인트 공통)

```ts
type ApiResponse<T> =
  | { success: true;  data: T;   meta?: { total: number; cursor: string | null } }
  | { success: false; error: { code: string; message: string; details?: unknown } }
```

기존 저장소 관례(`rules/common/patterns.md` API Response Format)와 일치시킨다.

### 에러 코드 체계

| 코드 | HTTP | 의미 |
|---|---|---|
| `UNAUTHORIZED` | 401 | 세션 없음 |
| `FORBIDDEN` | 403 | 워크스페이스 비멤버 또는 역할 미달 |
| `WORKSPACE_REQUIRED` | 400 | 워크스페이스 헤더 누락 |
| `VALIDATION_FAILED` | 422 | Zod 검증 실패 |
| `NOT_FOUND` | 404 | 대상 없음 또는 소프트 삭제됨 |
| `CONFLICT` | 409 | 유니크 위반·낙관적 잠금 버전 불일치 |
| `PLAN_LIMIT_EXCEEDED` | 402 | 플랜 한도 초과(`limit`, `current` 동봉) |
| `QUOTA_EXHAUSTED` | 429 | 플랫폼 쿼터·AI 일 한도 소진 |
| `CONNECTOR_FAILED` | 502 | 커넥터 체인 전 단계 실패(`platform`, `attempted[]` 동봉) |
| `AI_BUDGET_EXCEEDED` | 402 | LLM 예산 상한 도달 |
| `SETTING_ENCRYPTION_UNAVAILABLE` | 500 | 마스터 키 부재 — 평문 저장 거부 |
| `INTERNAL` | 500 | 그 외 |

**침묵 실패 금지:** 에러는 항상 코드와 사람이 읽을 메시지를 함께 반환하고,
화면은 재시도 경로를 제시한다(설계서 §6.6).

### 페이지네이션

커서 기반. `?cursor=<opaque>&limit=<1..100>`. 응답 `meta.cursor`가 null이면 끝.
정렬 키가 시각인 목록은 `(published_at, id)` 복합 커서로 안정 정렬.

---

## 1. 워크스페이스 · 멤버

| 메서드 | 경로 | 역할 | 설명 |
|---|---|---|---|
| GET | `/api/ci/workspaces` | 인증 | 내가 속한 워크스페이스 목록 |
| POST | `/api/ci/workspaces` | 인증 | 생성(생성자가 owner). 콜드 스타트 진입 |
| PATCH | `/api/ci/workspaces/:id` | admin+ | 이름·로고·기본값 |
| DELETE | `/api/ci/workspaces/:id` | owner | 유예 삭제(`purge_after` 설정). 즉시 파기 아님 |
| GET | `/api/ci/members` | member+ | 멤버 목록 |
| POST | `/api/ci/members/invite` | admin+ | 초대 발송 |
| PATCH | `/api/ci/members/:userId` | admin+ | 역할 변경. owner 이양은 owner만 |
| DELETE | `/api/ci/members/:userId` | admin+ | 제거. owner 행 제거 불가 |

```ts
// POST /api/ci/workspaces
{ name: string; slug: string; defaultTopicName?: string }
→ { id, name, slug, role: 'owner' }
```

---

## 2. 설정

| 메서드 | 경로 | 역할 | 설명 |
|---|---|---|---|
| GET | `/api/ci/settings?scope=user\|workspace\|system` | 스코프별 | 해석 전 원시값 + 스키마 메타 |
| GET | `/api/ci/settings/resolved` | member+ | user→workspace→system→기본값 병합 결과 (화면이 실제로 쓰는 것) |
| PUT | `/api/ci/settings/:key` | 스코프별 | 단건 갱신. `version` 동봉 시 낙관적 잠금 |
| DELETE | `/api/ci/settings/:key` | 스코프별 | 상위 스코프로 되돌리기 |
| GET | `/api/ci/settings/audits?key=&limit=` | member+ | 변경 이력 |

```ts
// PUT /api/ci/settings/alert.outlier.threshold
{ scope: 'workspace', value: 3.5, version: 4 }
→ { key, value, version: 5, updatedAt }
// version 불일치 → 409 CONFLICT { current: {...} }
```

규칙
- 값 검증은 `lib/ci/settings/registry.ts`의 키별 Zod 스키마. 미등록 키는 `422`.
- 시크릿 키(`is_encrypted`)는 응답에서 항상 마스킹(`{"masked":true}`). 복호 값을 API로 내보내지 않는다.
- 마스터 키 부재 시 시크릿 저장은 `500 SETTING_ENCRYPTION_UNAVAILABLE` — 평문 폴백 금지.

---

## 3. 수집 (R01)

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/ci/ingest` | 링크 투입. 전역 추가·모바일 공유 시트의 단일 입구 |
| GET | `/api/ci/contents` | 수집함/코퍼스 목록 |
| GET | `/api/ci/contents/:id` | 상세(DetailSheet 원천) |
| POST | `/api/ci/contents/:id/retry` | 실패 재시도 |
| POST | `/api/ci/contents/:id/topic` | 주제 확정(검토 큐 처리) |
| POST | `/api/ci/contents/:id/exclude` | 통계 제외 토글 |
| GET | `/api/ci/contents/:id/evidence` | EvidenceSheet — 포함 표본·제외 사유·수집 방법 |

```ts
// POST /api/ci/ingest      (Idempotency-Key 권장)
{ urls: string[]; source?: 'inbox' | 'monitoring'; topicId?: string }
→ { accepted: [{ url, contentId, jobId, status: 'queued' }],
    rejected: [{ url, code: 'UNSUPPORTED_PLATFORM' | 'DUPLICATE', message }] }
```
- 동기 처리 금지. 항상 `ci_jobs(stage='ingest')` 생성 후 즉시 반환한다
  (설계서 §11.1이 지목한 1차 실패 원인의 차단 장치).
- `source` 기본값은 `inbox`. **`inbox`는 통계 모집단에 들어가지 않는다.**

```ts
// GET /api/ci/contents?tab=all|review|failed&topicId=&platform=&format=&cursor=
→ { items: ContentListItem[], meta: { total, cursor } }

interface ContentListItem {
  id, platform, title, thumbnailUrl, channelName,
  ingestStatus: 'queued'|'running'|'done'|'partial'|'failed',
  completeness: number, missingFields: string[],
  topic: { id, name } | null, topicConfidence: number | null,
  outlierText: string | null,      // '평소 대비 8.4배' — 서버가 문장으로 완성
  percentileText: string | null,   // '같은 주제 상위 3%'
  comparabilityText: string,       // '조회수 비교 가능'
  confidence: 'high'|'medium'|'insufficient',
  firstSeenAt: string
}
```
**문장형 지표는 서버가 완성해 내려보낸다.** 클라이언트가 배수를 다시 계산하거나 포맷하지 않는다
(설계서 §4.3 규격을 한 곳에서만 강제하기 위함). 산출은 `lib/ci/format/metrics.ts` 공유 모듈.

---

## 4. 모니터링 (R02/R03)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/ci/channels` | 관심 채널·내 채널 목록 |
| POST | `/api/ci/channels` | 관심 채널 추가(URL 또는 핸들). 플랜 한도 검사 |
| PATCH | `/api/ci/channels/:id` | 모니터링 on/off, 주제 지정 |
| DELETE | `/api/ci/channels/:id` | 소프트 삭제 |
| GET | `/api/ci/channels/:id` | 채널 상세(프로필·지표 추이·같은 소재 묶음) |
| GET | `/api/ci/channels/:id/contents` | 채널 게시물 |
| POST | `/api/ci/channels/:id/refresh` | 수동 갱신 잡 |
| GET | `/api/ci/channel-links` | 플랫폼 간 동일 채널 제안 |
| POST | `/api/ci/channel-links/:id/decide` | 확정/거절 — **자동 확정 없음** |

```ts
// POST /api/ci/channels
{ input: string; topicId?: string; monitor?: boolean }
→ { id, platform, displayName, subscriberCount, isMonitored }
// 한도 초과 → 402 PLAN_LIMIT_EXCEEDED { limit: 3, current: 3, metric: 'tracked_channels' }
```

---

## 5. 트렌드 (R04)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/ci/trends/market` | 시장 개요 |
| GET | `/api/ci/trends/outliers` | 떡상 목록 |
| GET | `/api/ci/trends/patterns` | 성공 공식 |
| GET | `/api/ci/trends/signals` | 이슈 |

```ts
// GET /api/ci/trends/outliers
//   ?topicId=&platform=&format=&windowDays=28&sizeBand=&sort=outlier|recent|velocity&cursor=
→ { items: ContentListItem[],
    meta: { total, cursor, population: number, windowDays: number,
            insufficient: boolean } }   // population < 30이면 insufficient=true
```
- 모집단은 `source='monitoring' and is_stat_excluded=false and deleted_at is null` 고정.
  이 조건은 `lib/ci/corpus.ts` `CORPUS_FILTER` 단일 상수에서만 온다.
- `insufficient=true`면 화면은 카드 대신 `데이터 부족` + 관심 채널 추가 유도를 렌더한다.

---

## 6. 보드

| 메서드 | 경로 |
|---|---|
| GET/POST | `/api/ci/boards` |
| PATCH/DELETE | `/api/ci/boards/:id` |
| GET | `/api/ci/boards/:id/items` |
| POST | `/api/ci/boards/:id/items` — `{ itemType:'content'\|'pattern'\|'signal', itemId, note? }` |
| DELETE | `/api/ci/boards/:id/items/:itemId` |

---

## 7. 제작 (P01~P04)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/ci/ideas?stage=` | 파이프라인 보드 데이터 |
| POST | `/api/ci/ideas` | 아이디어 생성. `evidence[]`로 근거 계승(빵부스러기) |
| PATCH | `/api/ci/ideas/:id/stage` | 드래그 = 상태 전이 |
| PATCH/DELETE | `/api/ci/ideas/:id` | 수정·보관 |
| POST | `/api/ci/briefs` | 기획안 생성(AI). SSE 스트리밍 |
| GET | `/api/ci/briefs/:id` | 조회 |
| POST | `/api/ci/briefs/:id/regenerate` | **부분** 재생성 — `{ fields:['title','hook'] }` |
| GET | `/api/ci/briefs/:id/versions` | 버전 비교 |
| POST | `/api/ci/edit-plans` · PATCH `:id` · POST `:id/export` | 편집안 |
| POST | `/api/ci/assets/upload-url` | Storage 서명 URL 발급 |

```ts
// POST /api/ci/ideas
{ title: string; topicId?: string; targetPlatforms?: Platform[];
  evidence?: { sourceType:'content'|'pattern'|'signal', sourceId: string }[] }
→ { id, stage: 'idea', evidenceBadge: '떡상 3건, 공식 1건' }
```
AI 생성 엔드포인트는 전부 SSE(`text/event-stream`)이며 이벤트는
`{type:'delta'|'done'|'error', ...}`. 완료 이벤트에만 저장이 일어난다.
**생성형 패턴 준수:** AI 결과는 미리보기/편집 후 저장 — 자동 확정 저장 금지(CLAUDE.md §5-3).

---

## 8. 게시 (B01/B02)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/ci/publications?from=&to=` | 캘린더·대기열 |
| POST | `/api/ci/publications` | 게시 항목 생성 |
| POST | `/api/ci/publications/:id/spec-check` | 규격 검사(차단 아님, 경고) |
| POST | `/api/ci/publications/:id/export` | 수동 경로 산출물 |
| POST | `/api/ci/publications/:id/publish` | API 경로 즉시/예약 |
| POST | `/api/ci/publications/:id/url` | **게시 URL 입력 → 추적 시작** |
| GET/POST/DELETE | `/api/ci/connections` | 내 채널 OAuth |

```ts
// POST /api/ci/publications/:id/url
{ url: string }
→ { publicationId, trackedContentId, jobId, message: '추적을 시작했습니다' }
```
과거 게시물도 동일 엔드포인트로 소급 추적된다.

---

## 9. 성과 (A01)

| 메서드 | 경로 |
|---|---|
| GET | `/api/ci/performance/mine?topicId=&platform=&windowDays=&cursor=` |
| GET | `/api/ci/performance/market?...` |
| GET | `/api/ci/performance/learning` |
| GET | `/api/ci/performance/export` (CSV) |

```ts
// GET /api/ci/performance/learning
→ { patterns: { id, statement, liftText, evidenceCount, channelCount, confidence }[],
    corrections: { kind, count, promotedRuleId | null }[],
    promotionSuggestions: { id, kind, pattern, occurrences }[],
    slo: { autoConfirmRate: number, reviewQueueRate: number } }
```

---

## 10. 홈 (H01) · 알림

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/ci/home` | 루프 미니맵 건수 + 브리핑 피드 + 갱신 상태 (단일 왕복) |
| GET | `/api/ci/notifications?unread=` | 알림 목록 |
| POST | `/api/ci/notifications/:id/read` | 읽음 |
| GET/PUT | `/api/ci/alert-rules` | 떡상 알림 규칙 |

```ts
// GET /api/ci/home
→ { minimap: { review: 4, newOutliers: 12, producing: 3, ready: 2, tracking: 5 },
    briefing: ContentListItem[],
    refresh: { status:'idle'|'running'|'failed', progress: number,
               newCount: number, failedCount: number, lastRunAt: string },
    coldStart: { needed: boolean, step: 'topic'|'samples'|'channels'|'schedule' | null } }
```
`coldStart.needed=true`면 홈 대신 온보딩 흐름을 렌더한다 —
**데이터 없는 빈 대시보드 노출은 설계상 금지**(설계서 §8.6).

---

## 11. 운영자 콘솔 (앱 admin 전용, `/api/ci/admin/*`)

| 경로 | 설명 |
|---|---|
| `GET /api/ci/admin/jobs` | 단계별 성공률·지연·대기 길이·실패 사유 상위 |
| `POST /api/ci/admin/jobs/:id/requeue` | DLQ 재투입 |
| `GET/PUT /api/ci/admin/platform-profiles` | PlatformProfile 편집 |
| `POST /api/ci/admin/connectors/:platform/regression` | 회귀 URL 세트 실행 |
| `GET /api/ci/admin/llm-usage` | 깔때기 단계별 통과율·단가 |
| `GET/PUT /api/ci/admin/plans` · `/flags` | 플랜 정의·feature flag |

전부 `requireAdminApi()`(기존 SSOT) 통과 후 실행한다. 일반 사용자 API와 물리적으로 분리된 경로다.

---

## 12. 잡 워커 계약

워커는 HTTP API가 아니라 큐 소비자다. 트리거는 두 가지뿐이다.

1. **이벤트 구동**: 쓰기 엔드포인트가 `ci_jobs`에 행을 넣고, 워커가 `for update skip locked`로 클레임.
2. **예약**: 스냅샷 스케줄(`ci_snapshot_schedules.next_capture_at`)만 시간 기반.

```
POST /api/ci/internal/worker/tick     (service_role 토큰 필요, 외부 노출 금지)
→ { claimed: n, succeeded: n, failed: n, dead: n }
```
- 재시도: 지수 백오프 3회 → `status='dead'`(DLQ) + `error_code` 기록.
- 각 시도는 `ci_job_runs`에 1행. 성공·실패 전부 기록한다.
- 잡 실패는 **사용자 저장을 막지 않는다**. 실패는 화면에 상태로 노출될 뿐이다.
