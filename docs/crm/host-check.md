# dacrm T0-01 호스트 정합 확인

| 항목 | 내용 |
|---|---|
| 태스크 | T0-01 (dacrm_TASKS_v0.1.0.md, Phase 0) |
| dacrm 버전 | v0.5.0 |
| 호스트 앱 버전 | v0.7.491 |
| 확인일 | 2026-08-16 |
| 확인 방법 | 코드 실측(package.json·설치된 node_modules) + 운영 DB 직접 조회(psql, 읽기 전용) |

이 문서는 dacrm 구현명세서 v0.1.0이 **전제한 호스트**와 **실제 호스트**가 얼마나 맞는지 확인한 결과다.
결론부터: **모델명 충돌은 0건**이지만, **데이터 계층 전제(Prisma)가 호스트에 존재하지 않는다.**

---

## 1. 호스트 스택 버전 (실측)

명세서가 전제한 값과 실제 값을 나란히 둔다. 설치된 `node_modules`의 `package.json`에서 읽은 실제 해석 버전이다.

| 구성요소 | 명세서 전제 | 실제 호스트 | 판정 |
|---|---|---|---|
| Next.js | 15 App Router | **14.2.29** App Router | ⚠️ 메이저 1단계 낮음 |
| React | (미명시) | 18.3.1 | — |
| TypeScript | strict | 5.9.3 (strict) | ✅ |
| **Prisma** | **필수 전제** | **없음 — 의존성·`schema.prisma`·`prisma/` 디렉터리 전부 부재** | ❌ **부재** |
| Supabase (클라이언트) | 전제 | `@supabase/supabase-js` 2.106.2, `@supabase/ssr` 0.5.2 | ✅ |
| Supabase (서버) | 전제 | PostgreSQL 17.6 (pooler, ap-northeast-2) | ✅ |
| Tailwind | 전제 | 3.4.19 | ✅ |
| zod | 전제 | 3.25.76 | ✅ |
| Upstash Redis + QStash | 전제 | **없음** — 잡 큐는 자체 구현(`lib/ci/jobs/*` + `ci_jobs` 테이블 + 워커 tick 라우트) | ❌ 부재(대체 존재) |
| LiteLLM 프록시 | 전제 | **없음** — LLM은 벤더 SDK 직접 호출(`@anthropic-ai/sdk` 0.111, `openai` 6.46, `googleapis`) | ❌ 부재(대체 존재) |
| vitest | 전제 | **없음** — 테스트 러너는 `node --test --experimental-strip-types` | ❌ 부재(대체 존재) |
| Playwright | 전제 | `@playwright/test` 1.60.0 (루트 `playwright.config.ts`, `apps/web/e2e/`) | ✅ |
| @xyflow/react, dagre | 전제(1.3) | 없음 — 신규 설치 필요 | ⚠️ 추가 필요 |

### 마이그레이션 방식 (명세서 2.3의 전제와 다름)

- 명세서: `prisma/migrations/xxxx_crm_raw/migration.sql` + `pnpm prisma migrate dev`
- 실제: **번호순 raw SQL** `supabase/migrations/NNN_name.sql`, 적용은 `PGPASSWORD='...' ./scripts/migrate.sh <NNN_name.sql>`
  - 추적 테이블: `supabase_migrations.schema_migrations` (원자적 적용+등록)
  - 현재 파일 201개, 최신 번호 `197_ui_preferences.sql`
  - Supabase CLI도 Prisma도 쓰지 않는다

### 완료 정의 명령의 정합 (CLAUDE_dacrm.md "완료 정의")

| 명세 명령 | 호스트에서 | 대체 |
|---|---|---|
| `pnpm typecheck` | **스크립트 없음** | `cd apps/web && pnpm exec tsc --noEmit` |
| `pnpm lint` | 루트에 없음 | `cd apps/web && pnpm lint` (next lint) |
| `pnpm test` | 루트는 `echo "No tests configured"` | `cd apps/web && pnpm test` (수기 파일 목록 195개) |
| `pnpm build` | ✅ 존재 (루트 → `--filter web`) | 그대로 |
| — | 호스트 추가 필수 | `pnpm design:check` (커밋 전 필수, CI 차단) |

> ⚠️ 신규 `*.test.ts`는 `apps/web/package.json`의 `test` 목록에 **수기 등재**해야 실행된다. 자동 수집이 아니다.

---

## 2. 인증·세션 구조

Supabase Auth 쿠키 세션 기반이며, **Prisma도 NextAuth도 아니다.**

### 흐름

```
요청
 └─ apps/web/middleware.ts                        모든 비정적 요청
      ├─ 공개 경로(/api/public/*, /api/ci/internal/*, /develop, /api-access)는 통과
      ├─ createServerClient(@supabase/ssr) → auth.getUser()
      ├─ 비로그인 → /login 리다이렉트
      └─ 로그인 상태로 /login 접근 → /dashboard
 └─ 라우트 그룹 레이아웃                            (member) | admin | (ci)
      ├─ getRequestUser()                        lib/supabase/server.ts, React cache() = 요청당 1회
      ├─ createAdminClient().from('profiles')     서비스롤, role·name·theme 한 번에
      └─ redirectApiUser(profile.role)           api_user 차단은 레이아웃이 한다(미들웨어 아님)
```

### 핵심 파일

| 무엇 | 경로 |
|---|---|
| 미들웨어(세션 게이트) | `apps/web/middleware.ts` |
| 서버 클라이언트 SSOT | `apps/web/lib/supabase/server.ts` — `createClient()`(쿠키), `createAdminClient()`(서비스롤), `getRequestUser()`(요청 스코프 캐시) |
| 브라우저 클라이언트 | `apps/web/lib/supabase/client.ts` |
| 화면 admin 게이트 | `apps/web/lib/auth/requireAdmin.ts` |
| API admin 게이트 | `apps/web/lib/auth/requireAdminApi.ts` |
| api_user 게이트 | `apps/web/lib/auth/api-user-gate.ts` |

### 세션이 담고 있는 것

- `user`: Supabase `auth.users` (id uuid, email, user_metadata)
- 역할: **`public.profiles.role`** — `admin` | `member` | `api_user` 세 가지 (텍스트 컬럼, enum 아님)
- `profiles` 컬럼: `id uuid, name, role, must_change_password, created_at, updated_at, deleted_at, rank, position, theme_preference, onboarding_completed_at, onboarding_step, onboarding_skipped_at`
- **워크스페이스 개념이 세션에 없다.** 호스트 전역은 단일 조직이며, 계층은 `org_nodes` + closure로 표현한다.

### CRM이 요구하는 워크스페이스와의 간극 — 선례 있음

dacrm은 전 테이블 `workspaceId` 필수이고 `CrmMember`로 역할을 판정한다. 호스트 세션엔 그 개념이 없지만,
**같은 저장소의 CI 모듈이 이미 동일한 구조를 raw SQL + Supabase 클라이언트로 구현해 두었다.**

| CRM 명세 | CI 모듈의 대응 구현 |
|---|---|
| `CrmWorkspace` | `ci_workspaces` (id, name, slug, owner_id, deleted_at, purge_after …) |
| `CrmMember` + 역할 | `ci_workspace_members` + `lib/ci/auth/requireCiMember.ts` |
| `getCrmDb(workspaceId)` | `lib/ci/workspace.ts` + 각 쿼리의 workspace 필터 |
| RLS + `current_setting('app.workspace_id')` | CI 테이블 RLS 정책 (raw SQL 마이그레이션) |
| QStash 잡 | `ci_jobs` + `lib/ci/jobs/*` + `/api/ci/internal/worker/tick` (`CI_WORKER_TOKEN`) |

→ **CRM은 CI 모듈을 선례로 이식하면 명세의 10대 절대 규칙을 의미 그대로 지킬 수 있다.** (아래 5절)

---

## 3. 사이드바 메뉴 정의 파일 위치

명세서 1.2가 허용한 호스트 수정 지점 ①(사이드바 메뉴)의 **정확한 위치**다.

| 계층 | 파일 | 역할 |
|---|---|---|
| **메뉴 데이터 정의** | **`apps/web/app/(member)/layout.tsx`** | `NAV_ITEMS`(34–40행) · `NAV_GROUPS`(42–63행) — **여기에 CRM 섹션을 추가한다** |
| 셸 조립 | `apps/web/components/ui/shell/AppShell.tsx` | `items`·`groups`·`branding`·`session`·`extras` 계약 |
| 렌더 | `apps/web/components/ui/MobileShell.tsx` (410행) | 실제 사이드바/드로어 렌더, `NbNavItem` 사용 |
| 항목 부품 | `apps/web/components/ui/nb/NbNavItem.tsx` | 링크·아이콘·배지 |

### 타입 계약

```ts
// AppShell.tsx / MobileShell.tsx
interface NavItem  { href: string; label: string; icon: ReactNode; match?: string[]; badge?: number; exact?: boolean }
interface NavGroup { label: string; items: NavItem[] }
```

### 현재 `NAV_GROUPS` (member 레이아웃)

```
AI          → /ai-chat                         (admin 전용)
프로젝트관리 → /lead-intake                      ← 명세서 1.2가 "CRM 섹션 자리"로 지목한 곳
가격정책     → /pricing/gpu, /pricing/catalog
```

- 권한 필터는 `layout.tsx:137` 한 줄: `profile?.role === 'admin' ? NAV_GROUPS : NAV_GROUPS.filter(g => g.label === '가격정책')`
- **모듈 전용 하위 메뉴 선례**: `apps/web/app/(ci)/layout.tsx`가 자체 `NAV_ITEMS`/`NAV_GROUPS`(리서치·제작·게시 3그룹)로 같은 `AppShell`을 감싼다. CRM의 하위 8개 항목도 **`app/(crm)/layout.tsx`에서 자체 그룹을 선언**하는 이 방식이 정석이며, 이 경우 호스트 수정은 member 레이아웃에 CRM 진입점 1개 추가로 줄어든다.

### 나머지 두 허용 지점의 실제 위치

| 명세 1.2 | 호스트 실제 |
|---|---|
| ② 홈 대시보드 부서 업무 위젯 | `apps/web/app/(member)/home/` + 집계 서버액션 `app/(member)/dept-tasks/actions.ts` (`countMyOpenDeptTasks`) |
| ③ `prisma/schema.prisma`와 시드 | **해당 없음** — Prisma 부재. 대응물은 `supabase/migrations/NNN_*.sql` + 시드 SQL |

---

## 4. 모델명 충돌 목록 — **충돌 0건**

### 검사 방법

운영 DB(`postgres`, schema `public`)에 직접 질의했다.

```sql
-- 테이블
SELECT count(*) FROM information_schema.tables
 WHERE table_schema='public' AND table_type='BASE TABLE';                       -- 205
SELECT table_name FROM information_schema.tables
 WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name LIKE 'crm%';  -- 0행

-- enum 타입
SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
 WHERE n.nspname='public' AND t.typtype='e';                                    -- 17개, 전부 ci_*
```

### 결과

| 대상 | dacrm이 만드는 것 | 호스트 기존 | 충돌 |
|---|---|---|---|
| 테이블 | `crm_*` 26개 | `public` 205개 중 `crm` 시작 **0개** | **0건** |
| enum 타입 | `Crm*` 16개 | 17개 전부 `ci_*` (`ci_job_status`, `ci_platform` …) | **0건** |
| Prisma 모델명 | `Crm*` 26개 | Prisma 자체가 없음 | **0건**(해당 없음) |

### 프리픽스가 실제로 막아 준 근접 충돌 (프리픽스가 없었다면 전부 충돌)

호스트에 이미 있는 동명·유사명 테이블이다. `crm_` 프리픽스는 **장식이 아니라 실제로 작동하는 방어**임이 확인됐다.

| dacrm 테이블 | 프리픽스 없을 때 충돌했을 호스트 테이블 |
|---|---|
| `crm_deal` | **`deals`** (기존 영업 딜) |
| `crm_person` / `crm_deal_contact` | **`contacts`**, `deal_activities` |
| `crm_meeting` | **`meeting_notes`** |
| `crm_audit_log` | **`audit_log`**, `audit_fallback`, `content_intelligence_audit_log`, `gpu_audit_logs` |
| `crm_activity` | **`activity_log`**, `project_activity`, `weekly_report_activity` |
| `crm_task` | `content_refresh_tasks`, `owned_performance_tasks` |

→ **명세서 2.1의 "프리픽스 변경 금지"는 근거가 확인되었다. 절대 변경하지 않는다.**

### 확인된 26개 CRM 테이블

`crm_workspace, crm_member, crm_company, crm_person, crm_pipeline, crm_stage, crm_deal, crm_deal_contact, crm_stage_history, crm_activity, crm_task, crm_meeting, crm_meeting_recording, crm_transcript_segment, crm_ai_run, crm_ai_suggestion, crm_ai_field_config, crm_duplicate_candidate, crm_merge_log, crm_app_setting, crm_ai_budget, crm_audit_log, crm_integration_connection, crm_exchange_rate`
(+ `crm_*` 나머지 2개 포함 총 26개 `@@map` 확인)

---

## 5. 판정과 다음 태스크에 미치는 영향

### 통과

- ✅ **모델·테이블·enum 충돌 0건** — T0-01 완료 기준 충족
- ✅ Supabase(Postgres 17.6), TypeScript strict, Tailwind, zod, Playwright는 명세 전제와 일치
- ✅ 워크스페이스 격리·잡 큐·RLS는 **CI 모듈이라는 동작하는 선례**가 같은 저장소에 있다

### 막히는 것 — T0-02·T0-03이 현재 형태로는 실행 불가

| 태스크 | 완료 기준 | 왜 안 되는가 |
|---|---|---|
| T0-02 스키마 병합 | `pnpm prisma migrate dev`, `pnpm prisma validate` | **Prisma가 없다.** 병합 대상 `schema.prisma`도 없다 |
| T0-03 raw SQL 마이그레이션 | `prisma/migrations/` 에 배치 | 마이그레이션 체계가 `supabase/migrations/NNN_*.sql` + `scripts/migrate.sh` |
| T0-04 workspace guard | `prisma.$extends` Client Extension | Prisma Client가 없어 확장 지점이 없다 |
| T0-05 `withCrmTx` | Prisma `$transaction` + `SET LOCAL` | Supabase JS 클라이언트에는 트랜잭션 API가 없다 (`pg` 8.21은 설치돼 있음) |

### 추가로 잡아 둘 위험 (T0-02 착수 전 반드시 결정)

1. **`prisma migrate dev`를 운영 DB에 실행하면 안 된다.** 이 저장소의 DB는 **운영 DB이며 전 세션이 공유**한다. `migrate dev`는 드리프트 감지 시 리셋을 제안하는 파괴적 경로다. 205개 기존 테이블을 Prisma가 모르는 상태에서 실행하는 것은 사고다.
2. **마이그레이션 적용은 사용자 승인 사항**이다 (호스트 CLAUDE.md M-2 — 운영 DB 공유, 되돌릴 수 없음).
3. **버전 체계 충돌.** dacrm은 v0.5.x를 쓰지만 호스트 루트 `package.json`은 v0.7.491이고 이 값이 빌드타임에 UI 사이드바로 주입된다. 호스트 버전을 0.5.0으로 내리면 화면 표기가 퇴행한다 → **커밋 버전은 호스트 체계를 따르고, dacrm 태스크 버전은 메시지 본문에 병기**한다.

### 권고 — 명세를 버리지 않고 호스트에 이식하는 경로

명세서의 **10대 절대 규칙은 전부 Prisma 없이도 의미 그대로 성립**한다. 규칙이 요구하는 것은 "Prisma"가 아니라 *단일 접근 통로·강제 필터·트랜잭션+감사 동시성·상태 전이 단일 판정*이기 때문이다.

| 절대 규칙 | Prisma 전제 | 호스트 이식형 |
|---|---|---|
| 4. `getCrmDb(workspaceId)`로만 접근 | `prisma.$extends` | `lib/crm/db/client.ts` — Supabase 클라이언트를 감싼 래퍼가 모든 쿼리에 `workspace_id` 주입/검증. 정적 가드로 우회 차단(호스트에 이미 `lib/ui/*.test.ts` 정적 스캔 선례 다수) |
| 6. `withCrmTx` + 같은 트랜잭션 audit | Prisma `$transaction` | `pg` 풀 기반 트랜잭션 래퍼 + `SET LOCAL app.workspace_id` (RLS 정책 문구 그대로 사용 가능) |
| 10. 스키마 변경 = 마이그레이션 + DI 테스트 동일 커밋 | `prisma/migrations/` | `supabase/migrations/198_crm_*.sql` + `lib/crm/**/*.test.ts`(+ `package.json` test 목록 등재) |
| 1·2·3·5·7·8·9 | 스택 무관 | 그대로 적용 |

`crm_schema_v0.1.0.prisma`는 **DDL 생성의 원본 명세**로 계속 쓰고(모델·필드·인덱스·관계의 SSOT), 산출물만 raw SQL로 낸다.

---

## 6. T0-01 완료 기준 대조

| 완료 기준 | 결과 |
|---|---|
| Next 버전 기재 | ✅ 14.2.29 (명세 전제 15와 불일치 — 명시) |
| Prisma 버전 기재 | ✅ **부재** — 근거(의존성·디렉터리·schema 파일 전무) 기재 |
| Supabase 버전 기재 | ✅ 클라이언트 2.106.2 / ssr 0.5.2 / 서버 PostgreSQL 17.6 |
| 인증 세션 구조 기재 | ✅ 2절 (미들웨어 → 레이아웃 → profiles.role 3역할, 워크스페이스 부재와 CI 선례) |
| 사이드바 메뉴 정의 파일 위치 기재 | ✅ 3절 (`apps/web/app/(member)/layout.tsx` NAV_ITEMS 34–40행 / NAV_GROUPS 42–63행) |
| 모델명 충돌 목록 | ✅ 4절 — **충돌 0건** (운영 DB 실조회 근거 포함) |

**T0-01 판정: 완료 기준 충족.**
단, 4절의 "충돌 0건"과 별개로 **1절의 Prisma 부재는 T0-02 이후를 그대로 진행할 수 없게 만드는 사실**이므로, 다음 태스크 착수 전 데이터 계층 방침 결정이 필요하다.

문서 끝
