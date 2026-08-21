# 시스템 로그 — 메뉴 하나 · 자연어 · AI 해결책

> 2026-08-22 · 지시: **"관리자페이지에 시스템로그 메뉴 하나 두고 거기에 모든 로그를 남기자 …
> 로그방식은 시스템 로그보다는 어떤 관리자가 봐도 명확한 자연어 수준으로 …
> 그리고 해결 방법까지 AI 써서 알려주자"**
> 근거: `01-FINDINGS.md` C-1~C-9 · **구현 없음. 승인 대기.**

---

## 0. 이 설계를 지배하는 판단 하나

> **시스템 로그 화면이 AI 에 의존하면, AI 가 죽었을 때 그 사실을 볼 수 없다.**

이 화면을 원하신 이유가 정확히 **"AI 한도가 없으면 그런 걸 체크"** 다.
그런데 화면의 문장을 AI 가 만들면, 한도가 소진된 바로 그 순간 화면이 **통째로 비거나
"분석 실패"만** 뜬다. 관측 도구가 관측 대상과 함께 죽는 구조다.

그래서 자연어를 **두 층**으로 나눈다. 이것이 이 문서의 척추다.

| 층 | 무엇 | AI | 없으면 |
|---|---|---|---|
| **① 사실 문장** | 무슨 일이 · 왜 · 누가 · 언제 · 얼마나 · 어디서 | **안 씀** | — (항상 있다) |
| **② 해결 방법** | 원인 추정 · 확인할 것 · 조치 | 씀(요청형·지문당 1회) | ①은 그대로 읽힌다 |

**①은 AI 가 죽어도 완전하다.** ②는 있으면 좋은 것이지 없으면 화면이 무너지는 것이 아니다.

---

## 1. 무엇을 "모든 로그"로 볼 것인가

실패가 나는 자리는 **8개**고 그중 **7개가 화면에 안 보인다**(C-7).

| # | 출처 | 지금 | 시스템 로그로 |
|---|---|---|---|
| 1 | 호스트 AI 호출 | `ai_token_logs` — 실패 기록 코드 0곳 | ✅ |
| 2 | CRM AI 런 | `crm_ai_run` FAILED (읽는 화면 0) | ✅ |
| 3 | CI 잡 | `ci_jobs.error_*` (워크스페이스 안에서만) | ✅ |
| 4 | CRM API 예외 | `console.error` **단일 통로 1곳** | ✅ |
| 5 | 호스트 API 예외 | `console.error` **186곳**, 공용 통로 없음 | △ 점진(§5) |
| 6 | 크론 | `console.error` | ✅ |
| 7 | CRM 잡 | `console.error` + 응답 본문 | ✅ |
| 8 | 클라이언트 렌더 오류 | **아무 데도 안 남음** | ✅ |

**넣지 않는 것**(경계를 분명히 한다 — 안 그러면 로그가 소음이 된다)

- 사용자 입력 오류(400 계열: "이름을 입력해 주세요") — 시스템 문제가 아니다
- 정상적인 권한 거부(401/403) — 다만 **폭주하면**(1분 N건↑) 침입 신호로 1건 남긴다
- 감사 로그(`audit_log`·`project_activity`) — **누가 무엇을 바꿨나**는 성격이 다르다. 이미 자기 화면이 있다
- 접근 로그(모든 요청) — 그건 Vercel 이 한다. 우리는 **실패**만 본다

---

## 2. 저장 — 싱크 하나 (앞선 판단을 뒤집는다)

### 2-1. 판단이 바뀐 이유를 먼저 밝힌다

`02-PLAN.md` 초판은 **"새 테이블을 만들지 않는다"** 였다. AI 실패에 한정하면 그 판단이 맞았다 —
`ai_token_logs.success` 라는 빈 자리가 이미 있었기 때문이다.

그러나 지시가 **"모든 로그"** 로 넓어지면서 전제가 깨졌다:

> **8개 출처 중 5개는 테이블 자체가 없다**(전부 `console.error`). UNION 할 대상이 없다.

없는 것을 UNION 할 수는 없으므로 **싱크 하나를 만든다.** 판단을 바꾼 것이지 잊은 것이 아니다.

### 2-2. 기존 테이블을 **대체하지 않는다**

| | 무엇을 아는가 | 지우면 |
|---|---|---|
| `ai_token_logs` · `crm_ai_run` · `ci_jobs` | **도메인 진실** — 토큰 정산 · 잡 재시도 · AI 런 감사 | **시스템이 망가진다** |
| `system_events` (신설) | **사람이 읽는 사건** — 무슨 일이 있었나 | **아무것도 안 망가진다** |

이 한 줄이 경계 판정 기준이다. `system_events` 는 **90일 뒤 지워도 되는 층**이고,
그래서 도메인 테이블과 중복이 아니라 **역할이 다르다**(숫자 vs 문장).

### 2-3. 표 둘

```sql
-- 215_system_events.sql  (번호는 파일 생성으로 즉시 선점 — M-3)

create table if not exists system_events (
  id            uuid primary key default gen_random_uuid(),
  occurred_at   timestamptz not null default now(),

  -- 묶음의 열쇠. 같은 지문은 한 줄로 접힌다(§3-4)
  fingerprint   text not null,

  source        text not null,     -- 'host_ai'|'crm_ai'|'crm_api'|'host_api'|'ci_job'|'crm_job'|'cron'|'client'
  severity      text not null,     -- 'critical'|'error'|'warn'
  reason        text not null,     -- 'quota'|'auth'|'timeout'|'network'|'server'|'bad_json'|'db'|'config'|'unknown'

  feature       text,              -- 사용자가 부르는 이름으로 바꿔 보여준다(§3-2)
  route         text,              -- '/crm/companies'
  actor_id      uuid references auth.users(id) on delete set null,
  workspace_id  uuid,

  -- ① 사실 문장(결정론). 저장 시점에 확정한다 — 나중에 코드가 바뀌어도 그때의 말이 남는다
  headline      text not null,     -- "회사 정보 AI 보강이 실패했습니다"
  detail        text not null,     -- "AI 사용량 한도를 초과했습니다(Gemini)"

  raw           text,              -- 원문(2000자 절단). 접어서 보여준다 — 감추지 않는다
  context       jsonb not null default '{}',

  resolved_at   timestamptz,       -- 관리자가 "처리함"을 누른 시각
  resolved_by   uuid references auth.users(id) on delete set null
);

create index if not exists idx_system_events_recent      on system_events (occurred_at desc);
create index if not exists idx_system_events_fingerprint on system_events (fingerprint, occurred_at desc);
create index if not exists idx_system_events_open        on system_events (severity, occurred_at desc) where resolved_at is null;
alter table system_events enable row level security;
-- 읽기는 admin 만. 쓰기는 service role 만 (011_ai_token_logs 의 정책을 그대로 따른다)

-- ② AI 해결책 — **지문당 한 벌**. 사건마다가 아니다(§4-2)
create table if not exists system_event_remedies (
  fingerprint   text primary key,
  created_at    timestamptz not null default now(),
  model         text,
  confidence    text not null,     -- 'high'|'low'|'unknown' — 모르면 모른다고 한다
  body          jsonb not null,    -- { 진단, 확인할것[], 조치[], 파일[] }  (§4-3 계약)
  is_playbook   boolean not null default false   -- AI 없이 우리가 미리 쓴 답(§4-4)
);
```

**보존**: 90일. 크론이 지운다(`/api/cron/*` 선례). 로그가 무한 증식하면 DB 가 먼저 죽는다.

---

## 3. 자연어 ① — 사실 문장 (AI 없이, 항상)

### 3-1. 지금 vs 뒤

```
지금 (Vercel 콘솔에만)
  [crm/api] PrismaClientKnownRequestError: Invalid `prisma.crmCompany.findMany()`
  invocation: The table `public.crm_company` does not exist in the current database. (P2021)
```

```
뒤 (시스템 로그 화면)
  ⛔ 회사 목록을 불러오지 못했습니다
     데이터베이스에 'crm_company' 표가 없습니다 — 마이그레이션이 아직 적용되지 않은 것으로 보입니다.

     누가 겪었나   김도현 외 3명
     언제·얼마나   오늘 21:34부터 · 12번
     어디서        /crm/companies
                                          [해결 방법 보기]  [원문 보기]  [처리함]
```

### 3-2. 문장 조립 규칙 여섯 — `lib/system-log/narrate.ts` (순수 함수 SSOT · 테스트 대상)

1. **기능 이름은 사용자가 부르는 말로.** `enrich-web` ✗ → **회사 정보 AI 보강** ○
   라벨은 이미 있다(`app/api/admin/ai-usage/logs/route.ts` 의 `FEATURE_LABELS`) →
   `lib/system-log/labels.ts` 로 **승격해 공유**한다. 두 곳에 적지 않는다.
2. **한 줄은 "무엇이 안 됐나", 둘째 줄은 "왜".** 관리자는 첫 줄만 읽고 넘길 수 있어야 한다.
3. **원문은 감추지 않고 접는다.** 요약이 틀렸을 때 다음 사람이 확인할 유일한 단서다.
4. **숫자를 지어내지 않는다.** 영향 인원을 모르면 "모름"이라고 쓴다(E-4 근거부족 규칙).
5. **묶어서 센다.** 같은 지문 500건은 500줄이 아니라 **1줄 + "500번"**.
6. **영향받은 사람을 말한다.** 관리자가 "이거 심각한가"를 판단하는 유일한 근거다.

### 3-3. 사유 분류는 **기존 SSOT 재사용** — 새 체계 금지

| 재료 | 어디 |
|---|---|
| `GeminiFailureReason` (timeout·auth·quota·no_model·bad_json·truncated·network·server) | `lib/ai/gemini-call.ts` (v0.7.571) |
| `classifyProviderError().availability` (limited·unavailable) | `lib/ai-chat/provider-errors.ts` |
| Prisma 오류코드 → 사유 (P2021 표없음 · P2002 중복 · P1001 접속불가 …) | 신규 매핑(작다) |

이 셋을 `lib/system-log/reason.ts` 한 곳에서 합친다. **판정 규칙을 새로 쓰지 않는다.**

### 3-4. 지문(fingerprint) — 묶음의 열쇠

```
fingerprint = sha1( source + reason + normalize(message) )
normalize:  UUID → :id · 숫자 → :n · 따옴표 안 값 → :v · 경로 변수 → :seg
```

`crm_company` 표가 12번 없어도 **한 줄**이다. 안 묶으면 로그가 500줄이 되고, 500줄은 아무도 안 읽는다.

---

## 4. 자연어 ② — AI 해결책

### 4-1. 언제 부르나 — **요청형**

- 관리자가 **[해결 방법 보기]** 를 누를 때만.
- **화면을 열 때 자동 호출 금지.** 로그 100줄이 곧 AI 100회가 된다 — 관측이 한도를 태우는 자기모순.

### 4-2. 무엇 단위로 부르나 — **지문당 1회**

같은 오류 500건에 500번 부르지 않는다. `system_event_remedies.fingerprint` 가 PK 라
**새 지문이 나타날 때만** 호출되고, 그 뒤로는 캐시를 읽는다.

### 4-3. 출력 계약 — `lib/ai/gemini-call.ts`(SSOT) 로 JSON 강제

```jsonc
{
  "진단": "마이그레이션 215가 프로덕션 DB에 적용되지 않았습니다",
  "확신도": "high",                      // low면 화면이 "추정입니다"를 붙인다
  "확인할것": [
    "./scripts/migrate.sh --status 로 215가 적용됐는지 본다",
    "Vercel 환경변수에 DATABASE_URL 이 있는지 본다"
  ],
  "조치": [
    { "무엇": "215 마이그레이션을 적용한다",
      "되돌릴수있나": false, "위험도": "높음",
      "주의": "운영 DB 공유 — 사용자 승인 필요(M-2)" }
  ],
  "파일": ["supabase/migrations/215_system_events.sql", "scripts/migrate.sh"]
}
```

- **근거가 없으면 "모르겠다"고 답하게 한다.** 지어낸 조치가 운영에 들어가면 로그가 없느니만 못하다.
- **조치는 읽을거리다** — §5-3(AI 결과 UI 표준)에 따라 **자동 실행 버튼을 만들지 않는다.**
- **되돌릴 수 있나 · 위험도**를 반드시 붙인다. 관리자가 그 자리에서 판단해야 한다.

### 4-4. 프롬프트에 **우리 맥락**을 준다 — 안 주면 "일반적인 조언"이 나온다

- 스택: Next 14 App Router · Supabase(Postgres) · Prisma + **비-Prisma 테이블 205개 공존**
- 금지: `prisma migrate dev|db push|reset` — 드리프트로 **리셋을 제안**한다(CLAUDE.md M-2)
- 마이그는 `scripts/migrate.sh` 로만 · push/배포는 사용자가 한다
- 그 사건의 `source`·`route`·`feature` 와 관련 파일 경로

이 맥락이 없으면 AI 는 "Prisma 마이그레이션을 리셋하세요" 같은 **우리 저장소에서 사고를 내는 조언**을 한다.

### 4-5. **한도(quota) 사유에는 AI 를 부르지 않는다** — 자기 참조 차단

AI 한도가 소진돼서 난 오류에 AI 를 부르면 그 호출도 실패한다.
이 경우 **우리가 미리 쓴 정적 플레이북**(`is_playbook = true`)을 그대로 보여 준다:

```
AI 사용량 한도 초과
 ① /admin/settings 에서 지금 선택된 모델을 확인한다
 ② Google AI Studio 에서 그 키의 일일/분당 할당량을 본다
 ③ 급하면 다른 프로바이더(Claude·OpenAI)로 바꾼다 — /admin/settings
 ④ 한도는 보통 자정(태평양시)에 리셋된다
 ※ 이 안내는 AI 없이 표시됩니다 — 한도 문제일 때 AI 진단은 또 실패하기 때문입니다.
```

플레이북은 **`auth`·`config`·`db` 사유에도** 미리 써 둔다. 자주 나는 것부터 사람이 쓰는 게 정확하고 싸다.

### 4-6. 진단 비용도 **기록된다**

이 진단 호출 자체가 `feature: 'system-log-remedy'` 로 토큰 로거에 남는다.
**관측이 관측 비용을 숨기지 않는다.**

---

## 5. 쓰는 곳 — 길목 6개. `console.error` 186곳을 고치지 않는다

| 길목 | 파일 | 덮이는 범위 | 비고 |
|---|---|---|---|
| CRM API 예외 | `lib/crm/api/handler.ts:47-60` | **CRM API 전체** | 이미 단일 통로다(C-8) — 한 줄 추가 |
| 호스트 AI | `lib/ai/gemini-call.ts` (throw 직전) | 호스트 AI 대부분 | v0.7.571 에 26파일이 이 SSOT 로 이관됨 |
| CRM AI | `lib/crm/ai/runner.ts` `recordFailure()` | **CRM AI 전체** | C-2 도 함께 닫힌다 |
| CI 잡 | `lib/ci/jobs/queue.ts` 실패 전이 | CI 잡 전체 | `ci_jobs` 는 그대로 두고 투영만 |
| 크론·잡 | `withJobRun()` 신설 래퍼 | 크론 + CRM 잡 | `machine-auth.ts` 옆 |
| 클라이언트 | `app/global-error.tsx` + `POST /api/system-log/client` | 렌더 오류 | 지금 `error.tsx` 가 **1개뿐**(C-7 #8) |

**호스트 API 201개는 이번에 안 건드린다.** 공용 핸들러(`withApi`)가 없어서 201개 이관은 그 자체로 별건이다.
위 6개 길목으로 **AI·CRM·잡·크론·클라이언트가 이미 덮이고**, 남는 것은 호스트 API 의 순수 예외뿐이다(4차).

### 쓰기 규칙 셋 — 로그가 장애를 키우면 안 된다

1. **fire-and-forget.** 로그 쓰기 실패가 원래 요청을 절대 막지 않는다(`feedback_never_block_writes`).
2. **폭주 상한.** 같은 지문 분당 N건을 넘으면 행을 더 만들지 않고 **카운터만 올린다.**
   장애 때 로그가 초당 수천 건이면 DB 가 먼저 넘어간다.
3. **민감정보 차단.** 저장 전에 키·토큰·비밀번호 패턴을 마스킹한다.
   `opensource-sanitizer` 의 패턴을 재사용하고, **가드로 잠근다**(`system-log-redact.test.ts`).

---

## 6. 화면 — `/admin/system-log` 메뉴 하나

`app/admin/layout.tsx` 의 **`API · 시스템`** 그룹(이미 있음)에 한 줄:

```tsx
{ href: '/admin/system-log', label: '시스템 로그', icon: <ScrollText size={16} /> },
```

**목록 표준(§2-6) 그대로** — `ListToolbar` + `ListSurface` + `ListPager` + `useListQuery`.
새 표·새 필터바를 만들지 않는다. (2차의 `queryKey` 수정이 먼저 들어가 있어야 한다.)

```
┌──────────────────────────────────────────────────────────────┐
│ 지금 막혀 있는 것                            ← AI 안 씀       │
│ ⛔ AI 사용량 한도 초과 · 최근 15분 23번                        │
│    영향: 회사 정보 AI 보강 · 회의노트 요약 · CRM 활동 추출     │
│                                        [AI 사용량 →] [해결 →] │
└──────────────────────────────────────────────────────────────┘

 [검색]  [출처▾] [심각도▾] [사유▾] [기간▾] [처리됨 숨김]     42건

 ⛔ 회사 목록을 불러오지 못했습니다                    12번 · 21:34
    데이터베이스에 'crm_company' 표가 없습니다
    김도현 외 3명 · /crm/companies                        [펼치기]

 ⚠️ 콘텐츠 수집 잡이 3번 연속 실패했습니다              3번 · 20:10
    채널 페이지를 여는 데 30초를 넘겼습니다
    시스템 잡 · ci_jobs/collect                           [펼치기]
```

펼치면: 사실 문장 6줄 → 최근 사건 타임라인 → **[해결 방법 보기]** → 원문 접기 → **[처리함]**

**"처리함"은 사건이 아니라 상태다.** 누르면 그 지문이 목록에서 내려가고,
**다시 발생하면 되살아난다**(`AttentionBell` 철학과 같다 — 읽음 처리만 하고 아무것도 안 하는 목록을 만들지 않는다).

---

## 7. 알림 — 세 번째 종을 만들지 않는다 (초판 유지)

지금 종이 둘이고 철학이 다르다(C-5): `NotificationBell`(사건 축적) · `AttentionBell`(상태).
**AI 한도 소진은 "상태"** 이므로 `AttentionBell` 쪽이 맞지만, 종 통합은 CI·CRM 양쪽 설계 결정이라
**이 기획 단독으로 정하지 않는다**(M-8: 만든 사람이 유일한 검토자가 될 수 없다).

**이번에 하는 것**: ① 시스템 로그 상단 상태 카드 ② `/admin/ai-usage` 배너에
**월 토큰 총량 초과**와 **프로바이더 한도(429)** 를 구분해 표시(지금은 전자만 있다) ③ 죽은 `ai_token_alert_sent_month` 제거.

**미루는 것**: 종 통합 — `AttentionBell` 을 `AppShell` 공통으로 올리고 `attention.ts` 에 `system` kind 추가. 별도 기획.

---

## 8. 규모 · 순서 · 관문

기존 3차를 **3차(로그 골격) / 3.5차(AI 해결책)** 로 나눈다. 3차만으로도 화면은 완전히 쓸모 있다.

| 차수 | 내용 | 새 파일 | 마이그 |
|---|---|---|---|
| **3차** | `system_events` · 길목 6곳 · `narrate.ts`(사실 문장) · `/admin/system-log` · 상태 카드 · ai-usage 배너 구분 | ~11 | **215** |
| **3.5차** | `system_event_remedies` · 정적 플레이북 4종 · AI 진단(요청형·지문당 1회) · 펼침 UI | ~5 | (215에 포함) |

**마이그레이션 계획 변경**: 초판의 `ai_token_logs.failure_reason` 추가는 **철회한다.**
사유 필터는 `system_events.reason` 이 맡는다. `ai_token_logs` 는 `success=false` 기록만 켜서
사용량 대시보드의 **성공률**을 맞춘다(스키마 변경 불필요).

**관문(M-15)**: 3차·3.5차 모두 신규 화면이므로 **G1(UI/UX) · G2(정책) · G3(실사용 QA) 전부 필수.**
지금 보드는 활성 0이라 그대로면 자가수행이고, 보고에 **"자가수행 — 이유"** 를 밝힌다.

### 완료의 뜻 (E-1~E-6)

- 일부러 실패를 낸다(잘못된 모델명 저장 → AI 호출) → **시스템 로그에 자연어 한 줄로 뜬다**
- 같은 실패를 5번 낸다 → **5줄이 아니라 1줄 + "5번"**
- [해결 방법 보기] → 진단이 뜬다 → **같은 지문을 다시 눌러도 AI 호출이 안 나간다**(캐시 확인)
- **한도(429) 사유는 AI 를 안 부르고 플레이북이 뜬다** — 네트워크 탭으로 확인
- 로그에 키·토큰이 **안 남는다**
- 관리자가 아닌 계정으로 `/admin/system-log` → 막힌다
- 로그가 0건일 때 화면이 **"아무 문제 없습니다"** 라고 말한다(빈 화면 아님)
- 콘솔 오류 0 · **넣은 테스트 데이터는 지운다**
