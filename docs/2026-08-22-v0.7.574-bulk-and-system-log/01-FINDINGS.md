# 발견 — 회사 목록 · AI 보강 실패 · 시스템 관측

> 2026-08-22 · 기준 v0.7.573 · **분석 전용(구현 없음)**
> 검증: 실브라우저(:3000, `/crm/companies`, 회사 372곳) + 코드 전수

전부 **재현 또는 코드로 확인한 것만** 적는다. 추정은 "추정"이라고 밝힌다.

---

## A. 목록 (지적 ①②)

### A-1 [높음·재현됨] `더 보기`로 쌓은 뒤 "20개씩"을 고르면 **아무 일도 안 일어난다**

실측 로그:

| 단계 | URL | 화면 행 수 |
|---|---|---|
| 시작(`더 보기` 2회) | `/crm/companies` | 60 |
| **"20개씩" 선택** | `/crm/companies` | **60 (그대로)** |
| "100개씩" 선택 | `/crm/companies?size=100` | 100 |
| 다시 "20개씩" | `/crm/companies` | 20 |

**원인은 회사 목록이 아니라 목록 표준(SSOT)에 있다.**

`lib/ui/list-query.ts:listQueryToParams` 는 **기본값과 같은 값을 URL에 쓰지 않는다**(주소를 짧게 유지하려는 의도된 설계).
회사 목록의 기본 size 는 20 이다. 그래서 "20개씩"을 고르면

```
set({size:20}) → listQueryToParams → size 생략 → URL 그대로
  → router.replace(같은 주소) → searchParams 불변
  → query useMemo 불변 → load useCallback 불변 → useEffect 미발화 → 재조회 없음
```

즉 **"기본값으로 되돌리는 조작"은 표준 전체에서 무효다.** 대부분의 목록이 이 사실을 모르고 사는 이유는
`mode:'pages'` 라 `shouldResetPage` 가 `page` 를 함께 바꿔 URL 이 우연히 달라지기 때문이다.
`mode:'more'` + 누적 상태에서만 맨살이 드러난다 — 지금 회사 목록이 그 조건이다.

- 파일: `apps/web/lib/ui/list-query.ts:118-127`, `apps/web/lib/ui/use-list-query.ts:81-96`
- 영향: `useListQuery` 를 쓰는 목록 전체(40여 개). `mode:'more'` 목록에서 즉시 발현.

### A-2 [높음·재현됨] 선택했을 때 일괄작업이 **"AI로 채우기" 하나뿐**

실측(2건 선택): 선택 도구줄 버튼 = `["AI로 채우기", "선택 해제"]`.

더 넓게 보면 **CRM 목록 4개 중 선택 기능이 있는 것은 회사 하나뿐**이다.

| 화면 | 선택(체크박스) | 일괄작업 |
|---|---|---|
| `/crm/companies` | 있음 | AI로 채우기 **1개** |
| `/crm/people` | **없음** | — |
| `/crm/deals` | **없음** | — |
| `/crm/quotes` | **없음** | — |

한편 호스트에는 **이미 표준 패턴이 있다** — `app/(member)/ai-chat/analyze/SessionListClient.tsx:208-218`
가 `선택 삭제`(`NbButton variant="danger"`) / 휴지통이면 `선택 되돌리기`를 같은 자리에 낸다.
CRM 은 그 패턴을 안 쓴 것이지, 부품이 없는 게 아니다.

삭제 자체도 이미 있다 — `DeleteRecordModal` + `DELETE /api/crm/companies/[id]` + `POST .../restore`(소프트 삭제).
**없는 것은 "여러 건을 한 번에" 뿐이다.**

- 파일: `apps/web/app/(crm)/crm/companies/CompanyListView.tsx:183-205`
- §2-5(동종 UI 통일) 위반: 같은 성격의 목록 4개가 기능 구성이 서로 다르다.

### A-3 [중간] `더 보기`가 URL을 안 바꿔 **새로고침하면 되돌아간다**

`ListPager` 는 `onChange({page: query.page + 1})` 을 주는데, `CompanyListView:281` 이 그 patch 를 **버리고**
`load(true, cursor)` 만 부른다. 그래서 60행을 쌓아 놓고 새로고침하면 20행으로 돌아간다.
§2-6 "URL 이 진실이다"의 예외가 되어 있는데, **커서를 URL 에 못 싣는다는 것과 페이지 수를 못 싣는다는 것은 다른 이야기다.**

- 파일: `apps/web/app/(crm)/crm/companies/CompanyListView.tsx:275-283`

---

## B. AI 보강 실행·실패 (지적 ③④)

### B-1 [높음] 진행 표시가 **없다** — 최장 수 분을 점 세 개로 버틴다

`runEnrich` 는 회사 N곳(최대 20)을 **한 번의 POST** 로 보내고, 서버는 `for` 루프로 **순차** 처리한다.
그 사이 화면에 있는 것은 `<AXDotLoader/>` + "AI가 찾는 중…" 뿐이다. 몇 번째인지·무엇이 됐는지 알 수 없다.

회사당 웹검색 AI 호출은 실측 15~30초다(`lib/ai/gemini-call.ts` 주석의 자체 실측 15~25초 + 웹검색).
**20곳 = 5~10분.** 그 시간 동안 사용자는 멈춘 것과 구분할 수 없다.

저장소에는 **SSE 진행 표시 선례가 8개** 있다(`text/event-stream`) — 새 계통이 아니다.

- 파일: `apps/web/app/(crm)/crm/companies/CompanyListView.tsx:137-166`, `apps/web/lib/crm/services/enrich-web.ts:222-244`

### B-2 [높음] `/api/crm/companies/enrich` 에 **`maxDuration` 선언이 없다** → 프로덕션에서 끊긴다

같은 저장소의 형제 AI 라우트는 전부 선언한다:

| 라우트 | maxDuration |
|---|---|
| `/api/admin/ai-chat/analyze/stream` | 300 |
| `/api/cron/analyze-drain` | 300 |
| `/api/leads/parse` | 300 |
| `/api/crm/today` | 60 |
| `/api/crm/jobs/*` | 60 |
| **`/api/crm/companies/enrich`** | **없음** |
| **`/api/crm/companies/[id]/enrich`** | **없음** |

로컬 dev 에는 함수 시간 상한이 없어 **이 결함은 개발 중에 절대 안 보인다.** 프로덕션에서만 터진다.
B-1(수 분 소요)과 곱해지면 결과는 하나다 — **응답이 오기 전에 함수가 죽고, 사용자는 이유를 모른다.**

- 파일: `apps/web/app/api/crm/companies/enrich/route.ts` (선언 0줄)

### B-3 [높음] AI 한도(429)가 **중단 조건이 아니다** → 20곳이 전부 헛돌고 같은 문구 20줄

`lib/crm/ai/runner.ts:218` — 프로바이더 429 는 `CrmError('VALIDATION_FAILED', …)` 로 던져진다.
그런데 `enrich-web.ts:241` 의 중단 조건은 **`BUDGET_BLOCKED` 하나뿐**이다.

```ts
if (e instanceof CrmError && e.code === 'BUDGET_BLOCKED') break   // 429 는 여기 안 걸린다
```

결과: 한도가 이미 소진됐는데도 **20곳을 끝까지 돌고**, 회사당 `MAX_ATTEMPTS = 2` 라 **최대 40번의 실패 호출**을 낸다.
화면에는 회사 이름 없는 **똑같은 문장 20줄**이 쌓인다. 이것이 지적하신 이미지 #5 의 모습으로 보인다(추정).

곁가지로 **HTTP 코드도 틀렸다** — 429(한도)가 `VALIDATION_FAILED` → **HTTP 400 "입력값을 확인해 주세요"** 계열로 나간다.
`BUDGET_BLOCKED` 는 429 로 매핑돼 있으니 자리는 이미 있다.

- 파일: `apps/web/lib/crm/ai/runner.ts:200-222`, `apps/web/lib/crm/services/enrich-web.ts:229-243`, `apps/web/lib/crm/domain/errors.ts:30-40`

### B-4 [중간] 실패 줄에 **회사 이름이 없다**

```tsx
{enrichResult.failed.map((f) => <li key={f.companyId} …>{f.message}</li>)}
```

서버는 `{companyId, message}` 를 주는데 화면이 **id 를 이름으로 바꾸지 않는다.**
성공 줄(`results`)에는 `r.name` 이 있는데 실패 줄에만 없다 — 정작 이름이 필요한 쪽은 실패다.
(화면은 이미 `rows` 를 들고 있으므로 조회 없이 해결된다.)

### B-5 [중간] 예산 차단으로 멈추면 **남은 회사가 조용히 사라진다**

`break` 로 중단하면 아직 시작도 안 한 회사들은 `results` 에도 `failed` 에도 없다.
20곳을 골랐는데 3번째에서 멈추면 요약은 **17곳에 대해 아무 말도 하지 않는다.**
사용자는 "성공 2건" 만 보고 나머지가 됐는지 안 됐는지 모른다.

- 파일: `apps/web/lib/crm/services/enrich-web.ts:245-252`

### B-6 [중간] 결과·실패 카드가 **자작**이다 — §2 위반

`CompanyListView.tsx:207-256` 이 `<div className="card">` 안에 raw `<p>` · `<ul>` · `<li>` 를 인라인 style 로 직접 그린다.
공용 부품(`ErrorState` · `InlineError` · `ListSurface`)을 쓰지 않는다.
"실패 하더라도 이렇게 표현하는건 우리 규정에 안 맞는다"는 지적이 정확하다.

> `pnpm design:check` 는 이 위반을 **못 잡는다** — 가드는 hex·치수·자작 버튼/카드/빈상태 문구를 보지만
> "자작 오류 목록"은 규칙에 없다. `CompanyListView` 는 baseline 에도 없다(= 위반 0으로 기록돼 있다).

---

## C. 시스템 오류 로그 · 알림 (지적 ⑤ — 신규 요구)

> "관리자쪽에 이런 로그들이 표현되는 곳이 필요할것 같은데 … AI 한도가 없으면 그런걸 체크 할 수 있을텐데 알림도 표시 되야 하고"

### C-1 [높음] `ai_token_logs.success` 는 **한 번도 `false` 로 써진 적이 없다**

마이그 `011_ai_token_logs.sql` 이 만든 컬럼:

```sql
success       boolean NOT NULL DEFAULT true,
error_message text
```

그런데 유일한 기록자 `lib/token-logger.ts:24` 는 **항상 `success: true`** 를 넣고 `error_message` 는 건드리지 않는다.
실패를 넣는 코드는 저장소 전체에 **0곳**이다.

→ **자리는 2026년 초부터 있었는데 아무것도 안 들어갔다.** 관리자 화면이 실패를 못 보는 근본 이유다.

- 파일: `apps/web/lib/token-logger.ts:14-31`, `supabase/migrations/011_ai_token_logs.sql:15-16`

### C-2 [높음] **CRM AI 는 `logTokenUsage` 를 아예 안 부른다**

`grep -rn "logTokenUsage" lib/crm/` → **0건**.
호출처 29개 중 CRM 은 하나도 없다. CRM 러너는 `crm_ai_run` 에만 쓴다.

→ `/admin/ai-usage` 에 **CRM 의 사용량도 실패도 통째로 없다.** 지금 지적하신 회사 보강이 정확히 그 경로다.

### C-3 [높음] `crm_ai_run` 은 실패를 **제대로 쌓는데 읽는 화면이 0개**다

`runner.ts:120-130` 의 `recordFailure()` 는 `status:'FAILED'` + `error`(500자) + 지연시간 + 토큰까지 남긴다. 잘 만들어져 있다.
그런데 `crmAiRun` 을 **읽는** 코드는 `lib/crm/services/{meeting,activity,activity-extract}.ts` 뿐이고
**화면·API 는 하나도 없다.**

> CLAUDE.md 가 경고한 그 패턴이다 — "테이블·설정은 만들었는데 소비 코드가 0이라 화면에선 아무 일도 안 일어났다"(v0.7.438).

### C-4 [중간] 토큰 임계 **알림 코드가 죽어 있다**

`lib/token-logger.ts:37-62` `checkThreshold()`:

```ts
// 어드민들에게 알림 (notifications 테이블이 없을 수 있으므로 META에만 기록)
await adminClient.from('org_content').update({ value: { ...meta, ai_token_alert_sent_month: currentMonth } })
```

`ai_token_alert_sent_month` 를 **쓰는 곳은 자기 자신뿐**이고 읽는 화면은 없다.
즉 **"보냈다"는 중복방지 표시만 남기고 알림은 보내지 않는다.**
그리고 주석의 전제("notifications 테이블이 없을 수 있으므로")는 **지금은 사실이 아니다** — `ci_notifications` 가 마이그 190 에 있다.

참고: 임계치 **경고 배너 자체**는 살아 있다(`/admin/ai-usage` 가 summary API 에서 매번 계산). 죽은 것은 **알림 발송**이다.

### C-5 [중간] 종이 **두 개**인데 **시스템 실패를 보는 종은 없다**

| 부품 | 붙은 곳 | 철학 | 무엇을 보나 |
|---|---|---|---|
| `components/ci/NotificationBell` | `(ci)` 레이아웃만 | **사건을 쌓는다**(읽음/안읽음) | 떡상 알림 |
| `components/crm/AttentionBell` | `(crm)` 레이아웃만 | **지금 상태를 본다**(끝나면 사라짐) | 지연·오늘마감·제안·정체 |
| — | `(member)`·`admin` | — | **없음** |

시스템 실패(AI 한도·잡 실패)를 알리는 자리는 **어디에도 없다.**
그리고 같은 성격 부품이 두 벌인 것 자체가 §2-5 위반이다 — **세 번째를 만들면 안 된다.**

### C-6 [참고] Vercel 로그 연동은 **지금 붙일 근거가 약하다**

- `apps/web/.env.example`(v0.7.572 신설) 에 `VERCEL_*` 항목 **없음** — 토큰이 없다.
- 실측(v0.7.572 작업): Vercel 로그 API 는 `page=` 커서가 안 먹어 **같은 50건이 반복** 조회된다(오탐 유발).
- 그리고 지금 필요한 신호(AI 한도·잡 실패)는 **전부 우리 DB 에 이미 있다.** Vercel 로그는 그 아래 인프라 계층(콜드스타트·504·빌드)이라 성격이 다르다.

→ 상세 판단은 `02-PLAN.md` §3-4.

---

## 발견 요약

| # | 심각도 | 무엇 | 근거 |
|---|---|---|---|
| A-1 | 높음 | 기본값으로 되돌리는 목록 조작이 전부 무효 | 실브라우저 재현 |
| A-2 | 높음 | 일괄작업 1개(AI만) · CRM 목록 3개는 선택 자체가 없음 | 실브라우저 + 전수 |
| A-3 | 중간 | `더 보기` 결과가 새로고침에 안 남음 | 코드 |
| B-1 | 높음 | 최장 수 분 작업에 진행 표시 0 | 코드 |
| B-2 | 높음 | enrich 라우트 `maxDuration` 미선언 → 프로덕션 절단 | 코드(형제 라우트 대조) |
| B-3 | 높음 | 429가 중단조건이 아님 → 최대 40회 헛호출 + 동일 문구 20줄 | 코드 |
| B-4 | 중간 | 실패 줄에 회사 이름 없음 | 코드 |
| B-5 | 중간 | 중단 시 남은 회사가 보고에서 사라짐 | 코드 |
| B-6 | 중간 | 결과·실패 카드 자작(§2 위반), design:check 사각 | 코드 |
| C-1 | 높음 | `success=false` 를 쓰는 코드 0곳 | 전수 grep |
| C-2 | 높음 | CRM AI 가 토큰 로거를 안 부름 | 전수 grep |
| C-3 | 높음 | `crm_ai_run` 실패를 읽는 화면 0곳 | 전수 grep |
| C-4 | 중간 | 임계 알림이 중복방지 표시만 남기고 발송 안 함 | 코드 |
| C-5 | 중간 | 종 2벌 · 시스템 실패용 종 0벌 | 전수 |

**지시 범위 밖 발견(M-9 ③) — 고치지 않고 보고만 한다**

- `pnpm design:check` 가 "자작 오류 목록"을 규칙으로 갖고 있지 않다(B-6 이 통과한 이유).
- 종 2벌 병존(C-5)은 CRM/CI 양쪽 설계 결정이라 이번 범위에서 통합을 결정하지 않는다 — `02-PLAN.md` 는 **세 번째를 만들지 않는 선**만 지킨다.

---

## C-추가 — "모든 로그"의 실제 범위 (2차 조사 · 2026-08-22)

> 지시가 **"관리자페이지에 시스템로그 메뉴 하나 두고 거기에 모든 로그"** 로 확장돼
> 실패가 발생하는 자리를 전수로 다시 셌다. 결과는 처음 판(2곳)보다 훨씬 넓다.

### C-7 [높음] 실패 출처 **8개 중 7개가 화면에서 안 보인다**

| # | 출처 | 지금 남는 곳 | 읽는 화면 |
|---|---|---|---|
| 1 | AI 호출 실패(호스트) | `ai_token_logs.success=false` — **쓰는 코드 0곳**(C-1) | ✗ |
| 2 | AI 런 실패(CRM) | `crm_ai_run` FAILED + error(500자) | ✗ (C-3) |
| 3 | CI 잡 실패 | `ci_jobs.error_code`·`error_message` | △ `/api/ci/queue/progress` 가 **워크스페이스 단위 집계로만** |
| 4 | CRM API 예외 | `console.error('[crm/api]', msg)` — **단일 통로 1곳** | ✗ |
| 5 | 호스트 API 예외 | `console.error` **186곳**, 공용 통로 **없음** | ✗ |
| 6 | 크론 실패 | `console.error('[cron/analyze-drain] …')` | ✗ |
| 7 | CRM 잡 실패 | `console.error('[crm/stalled-deals] …')` + 응답 본문에만 | ✗ |
| 8 | 클라이언트 렌더 오류 | **아무 데도 안 남는다** | ✗ |

- 실측: `grep -rn "console.error" app/api lib` → **186건**
- 실측: `error.tsx` / `global-error.tsx` → **`app/admin/daily-logs/error.tsx` 1개뿐**
- 실측: 호스트 공용 API 핸들러(`withApi`·`apiHandler` 등) → **0건**. 201개 라우트가 각자 try/catch.

**뜻**: 서버에서 무슨 일이 나면 **Vercel 콘솔로만 샌다.** 우리 화면에는 아무 흔적이 없다.
그래서 "AI 한도가 없으면 그런 걸 체크"할 자리가 지금은 존재하지 않는다 — 지적이 정확했다.

### C-8 [중간] `withCrmApi` 는 **이미 단일 통로다** — 훅을 걸 자리가 이미 있다

`apps/web/lib/crm/api/handler.ts:47-60` 이 CRM API 전체의 예외를 한 곳에서 받는다.
지금은 `console.error` 로 흘리고 500 을 돌려주고 끝이지만, **그 자리에 한 줄만 더하면 CRM API 전체가 덮인다.**
반대로 호스트 201개 라우트에는 그런 자리가 없다(C-7 #5) — 이 비대칭이 설계를 가른다.

### C-9 [중간] CI 잡 실패 화면이 **워크스페이스 단위로만** 있다

`app/api/ci/queue/progress/route.ts:43-81` 이 `stage/status/error_message` 를 읽지만
`(ci)` 워크스페이스 안에서만 보이고, **관리자가 전체를 보는 자리는 없다.**
CI 를 안 쓰는 관리자는 잡이 죽고 있다는 사실 자체를 모른다.
