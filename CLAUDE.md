# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

pnpm workspace monorepo. Root scripts proxy into `apps/web` (`pnpm --filter web`).

```bash
# Dev / build (run from repo root)
pnpm dev                # next dev on :3000
pnpm build              # next build
pnpm start              # next start

# Lint / typecheck (run from apps/web)
cd apps/web && pnpm lint            # next lint (eslint)
cd apps/web && pnpm exec tsc --noEmit   # typecheck (no dedicated script)

# Tests — node:test runner, no jest/vitest (run from apps/web)
cd apps/web && pnpm test            # runs the explicit test file list in apps/web/package.json
# single test file:
cd apps/web && node --test --experimental-strip-types "lib/gpu/pricing.test.ts"

# E2E — Playwright (config at repo root: playwright.config.ts, tests in apps/web/e2e)
pnpm exec playwright test

# Design token guard (required before commit/PR; also enforced by .githooks/pre-commit + CI)
pnpm design:check       # = scripts/check-design-tokens.mjs

# DB migrations — raw psql, applied + tracked atomically (NOT supabase CLI)
PGPASSWORD='...' ./scripts/migrate.sh <NNN_name.sql>
PGPASSWORD='...' ./scripts/migrate.sh --status

# Ralph autonomous loop (Codex-driven)
pnpm ralph:once         # one iteration   |   pnpm ralph:status
```

Note: `pnpm test` only runs a hand-maintained file list (see `apps/web/package.json` `test` script). Adding a `*.test.ts` does not auto-include it — append it to that list. `tsconfig.json` excludes `**/*.test.ts` from the build.

## Architecture

Single Next.js 14 App Router app under `apps/web` (the only workspace package). Supabase (Postgres + Auth) is the backend; there is no separate API server.

**Version is injected, not hardcoded.** `apps/web/next.config.js` reads the **root** `package.json` `version` at build time → `NEXT_PUBLIC_APP_VERSION` → shown in `MobileShell.tsx`. Root `package.json` is the single version source; bump root + `apps/web/package.json` together (see version checklist below).

**Auth & route protection** flow through `apps/web/middleware.ts` (runs on every non-static request):
- Unauthenticated → redirect `/login`. `/api/public/*`, `/develop`, `/api-access` are open.
- Role is read from `profiles.role`. Three roles: `admin`, `member`, and `api_user` (external API consumers, locked to `/api-keys` + `/change-password`).
- Server-side admin gating: `lib/auth/requireAdmin.ts` (pages) and `requireAdminApi.ts` (API routes). Don't gate admin access in the client alone.

**Route groups** (`apps/web/app`): `(auth)` login, `(member)` the main app (home, daily, weekly-report, dept-tasks, calendar, org, contacts, deals, pricing, kpi, work…), `admin/*` admin console, `api/*` route handlers, plus public `develop`/`api-access` for the external API program. URL state (filters, tab, sort, pagination) is the convention for shareable views.

**Supabase clients** — always go through `lib/supabase/`: `client.ts` (browser) and `server.ts` (server components / route handlers, cookie-aware via `@supabase/ssr`). RLS is mandatory on every table.

**SSOT / shared-logic rule is load-bearing here.** Domain logic lives in `lib/` and is imported, never copy-pasted (see "재사용·단일구현 정책" below). The largest domain is GPU pricing in `lib/gpu/` — dedup (`dedup.ts`), tier judgment (`tier-dict.ts`), memory normalization (`normalize.ts`), config ladders, pricing/parity math, and a golden-set eval. These are the canonical implementations; new pricing routes/screens call them. The pricing "cockpit" is `/pricing/gpu?tab=cockpit`.

**AI integration** is Gemini-based, isolated in `lib/gemini-*.ts` (daily→weekly summarization, lead extraction, business-card OCR, content edit, task suggestion, embeddings). All token usage is logged via `lib/token-logger.ts`. AI result UX follows two fixed patterns — extract/suggest = candidate checklist the user confirms (never auto-commit); generate = preview/edit/save (see §5-3 below).

**Rich text:** plain text is the default for user content (`daily_logs.content`); HTML rich text (Tiptap) is limited to weekly reports. Any HTML crossing into AI input or another screen must go through `lib/html-to-plain.ts`; HTML rendering must go through the shared `RichText` component (never raw `dangerouslySetInnerHTML`).

**DB migrations:** sequential numbered SQL in `supabase/migrations/` (`NNN_name.sql`, currently up to 082+). Applied via `scripts/migrate.sh` against the pooler with atomic tracking in `supabase_migrations.schema_migrations` — **not** the Supabase CLI. Never blindly overwrite state flags (e.g. `must_change_password`) in a migration over existing rows.

**Path alias:** `@/*` → `apps/web/*`.

---

# newAX 프로젝트 코딩 정책

## 반응형 디자인 정책 (필수)

**모든 UI 구현은 반드시 반응형 기반으로 작성한다.**

### 브레이크포인트
| 이름 | 조건 | 설명 |
|------|------|------|
| mobile | < 768px | 스마트폰 세로 |
| tablet | 768px ~ 1023px | 태블릿, 스마트폰 가로 |
| desktop | ≥ 1024px | PC |

### 규칙
1. **신규 레이아웃**: 모바일 우선(mobile-first) 작성 원칙
2. **그리드**: 고정 `gridTemplateColumns` 금지 → `responsive-grid-*` 클래스 사용
3. **테이블**: `.table-card` 클래스 사용 — 모바일에서 카드 레이아웃으로 자동 변환 (가로 스크롤 금지)
4. **레이아웃 컨테이너**: `MobileShell` 컴포넌트 사용 (사이드바 자동 처리)
5. **페이지 패딩**: `page-inner` 클래스 사용 (모바일 자동 축소)
6. **터치 영역**: 버튼/링크 최소 높이 44px
7. **디자인의 필수조건** : 각 페이지에서 CSS 셋팅하는 하드코딩 방식은 용납하지 않는다. 재사용 및 모듈화 , 토큰화 필수

### 테이블 모바일 카드 패턴 (필수)
가로 스크롤 테이블은 **절대 금지**. 반드시 카드 레이아웃으로 변환한다.

```tsx
// ✅ 올바른 방법
<table className="table-base table-card">
  <thead>...</thead>ss
  <tbody>
    <tr>
      <td className="card-header">   {/* 카드 제목 행 — 레이블 없음 */}
        <span>이름 / 핵심 정보</span>
      </td>
      <td data-label="역할">         {/* 레이블 자동 표시 */}
        <span>member</span>
      </td>
      <td className="card-hide">     {/* 모바일에서 숨길 td */}
        ...
      </td>
    </tr>
  </tbody>
</table>

// ❌ 금지 — 가로 스크롤 테이블
<div className="table-responsive">
  <table style={{ minWidth: '600px' }}>...</table>
</div>
```

**카드 패턴 보조 클래스:**
- `card-header` — 카드 상단 헤더 행 (회색 배경, `data-label` 무시)
- `data-label="..."` — 모바일에서 레이블로 표시됨 (`::before` CSS)
- `card-hide` — 모바일에서 숨김 (카드 헤더에 이미 표시된 중복 정보)
- `card-actions` — 액션 버튼들 모음 행

### 인라인 `<style>` 금지
클라이언트 컴포넌트에서 `<style>` 태그 사용 금지 → hydration 오류 발생.  
CSS는 반드시 `globals.css` 또는 CSS 모듈에 작성한다.

### 사용 가능한 유틸 클래스 (globals.css)
```
.app-shell              — 전체 앱 레이아웃 컨테이너
.app-sidebar            — 사이드바 (모바일 자동 드로어)
.app-content            — 메인 콘텐츠 영역
.page-inner             — 페이지 내부 패딩 (desktop: 2rem, mobile: 1rem)
.responsive-grid-2      — 2컬럼 레이아웃 (desktop: 1fr 352px, mobile: 1fr)
.responsive-grid-cols-2 — 2컬럼 그리드 (mobile: 1col)
.responsive-grid-cols-3 — 3컬럼 그리드 (mobile: 1col, tablet: 2col)
.responsive-grid-cols-4 — 4컬럼 그리드 (mobile: 2col)
.table-card             — 테이블 → 모바일 카드 변환 (가로 스크롤 대체)
.mobile-only            — 모바일에서만 표시
.desktop-only           — 데스크탑에서만 표시
.mobile-menu-btn        — 햄버거 버튼 (모바일에서만 표시)
```

### 금지 사항
- `style={{ display: 'grid', gridTemplateColumns: 'repeat(N, 1fr)' }}` → className 사용
- 반응형 없는 고정 width 레이아웃 (사이드바 등 예외)
- `overflow: hidden` 단독 사용 (모바일 콘텐츠 잘림 유발)
- `.table-responsive` 래퍼 + `minWidth` 조합 (가로 스크롤 유발) → `.table-card` 사용
- 클라이언트 컴포넌트 내 `<style>` 태그 (hydration 오류 유발)

## 다중 세션 동시 작업 정책 (필수 — 세션 N개가 같은 작업 트리를 공유한다)

> **전문: [`docs/policy/multi-session.md`](docs/policy/multi-session.md)** (SSOT — 근거·표·예외). 아래는 **안 읽고 어기면 남의 작업이 깨지는 것만** 뽑은 카드다.
>
> **왜**: Claude Code 창 여러 개·Codex·Ralph 루프가 **동시에** 같은 작업 트리(`main` 단일 worktree)·dev 서버(:3000)·운영 DB를 쓴다. 세션은 서로를 볼 수 없다.
> **실측**: A가 `git add a.txt`만 해 둔 상태에서 B가 `git add b.txt && git commit` 하면 **커밋에 `a.txt`가 함께 들어간다**(인덱스는 작업 트리당 하나 → 세션 공유). "경로 지정 스테이징"만으로는 **못 막는다.**

### M-1. 커밋은 pathspec 커밋으로만 (위반 시 남의 작업이 내 커밋에 실린다)

```bash
git commit -m "v0.7.x: 내용 claude" -- <파일경로> [<파일경로>…]   # ✅ 유일 허용 — 인덱스 우회
git add <신규파일> && git commit -m "..." -- <신규파일>            # ✅ 신규(untracked)는 add 선행
git add <경로> && git commit  /  git add -A  /  git commit -a      # ❌ 인덱스 전체를 커밋한다
```

- 확인: `git status --short -- <경로>` + `git diff HEAD -- <경로>` (**`--cached` 아님**) · 커밋 후 `git show --stat --name-only HEAD`
- 경로는 **파일 단위** (디렉터리 지정은 남의 새 파일을 삼킨다) · **route group은 따옴표 필수** (`-- "apps/web/app/(member)/foo/page.tsx"` — zsh가 괄호를 glob으로 읽어 죽고, 거기서 `add -A`로 되돌아가는 것이 사고의 시작)
- 남의 파일이 섞였으면 **되돌리지 말고 사용자에게 보고** — 그 사이 남이 내 커밋 위에 커밋했으면 `reset`·`amend`가 남의 커밋을 날린다

### M-2. 트리 전체를 건드리는 명령 — 금지

- **절대 금지**: `git stash`/`stash pop` · `checkout <브랜치>`/`switch`/`restore .` · `reset --hard`/`clean -fd`/`rebase`/`merge` · `push` · `pkill`/dev 서버 재시작 · `pnpm build`(dev 가동 중 — `.next` 충돌)
- **절대 금지(DB)**: `prisma migrate dev` · `prisma db push` · `prisma migrate reset` — 운영 DB에 **비-Prisma 테이블 205개**가 함께 있어 Prisma가 드리프트로 보고 **리셋을 제안**한다. 마이그레이션은 `prisma migrate diff`로 **SQL만 뽑아** `scripts/migrate.sh`로 적용한다
- **단독 창구 + 보드 공지**: `pnpm install`·lockfile 변경 · `scripts/migrate.sh`(운영 DB 공유, 되돌릴 수 없음 — **사용자 승인** 필요)
- formatter·linter `--fix`는 **내 파일 경로만** 인자로 넘긴다

### M-9. 지시받지 않은 발견 — 넘어가지 않는다

> dev 서버는 **모든 세션이 공유**한다. 내가 보는 화면에 남의 중간 저장 상태가 섞여 있을 수 있다.

| ① 내 변경이 만든 회귀 | ② 내 범위 안의 기존 결함 | ③ 범위 밖 | ④ 남의 세션 중간 상태 |
|---|---|---|---|
| **즉시 수정**(같은 커밋). 단 남이 claim 중이면 **보드 확인 선행** | **같이 수정** — 커밋은 **분리**하고 지시 외 발견임을 명시 | **고치지 않는다** — `finding --scope outside` + **사용자 보고** | **내 결함으로 오진 금지** — 소유 세션 확인 후 기록만 |

- **③④는 보고 의무.** 종료 보고에 **"발견 N건"을 반드시 포함**한다(0건이면 0건이라고 말한다). 침묵은 "없었다"가 아니라 **규칙 위반**이다. 애매하면 ③.
- 기록 형식: **무엇 / 어디서(`파일:줄`·URL) / 재현 / 심각도 / 제안**
- **가드도 같은 원칙으로 판정한다.** pre-commit의 `design:check`는 `--commit-scope`로 **커밋된 상태 + 이번 커밋의 파일**만 본다 — 남의 미커밋 파일이 내 커밋을 막지도, ratchet baseline을 조이지도 않는다(v0.7.495). 수동 `pnpm design:check`는 종전대로 **트리 전체**를 보므로 둘의 결과가 다를 수 있다. **다르면 훅 쪽이 내 범위 판정이다.**

### M-11. 세션 완결 책임 — 시작한 세션이 끝까지 맡는다

> **왜**: 다른 세션은 **내 작업의 존재조차 모른다.** 반쯤 된 코드를 트리에 남기면 남이 자기 결함으로 오진하거나(M-9 ④) 그 위에 쌓아 되돌리기 어려워진다. 세션 경계는 작업 경계가 아니다.

**완료 = 아래 7개 전부. 하나라도 빠지면 미완이다.**

① 지시 범위 **전부** 구현 → ② 검증(`tsc`·`lint`·관련 테스트·`design:check`) → ③ **실제 렌더 경로**에서 화면 확인 → ④ 발견 처리(①②는 수정 / ③④는 기록) → ⑤ **정리** — 커밋 권한이 있으면 pathspec 커밋(M-1), 없으면 **트리를 빌드되는 상태로 남기고 미커밋 목록을 보고**. 어느 쪽이든 **반쯤 된 상태로 방치하지 않는다** → ⑥ 사용자 보고(한 것 · 못 한 것 · 발견 N건) + **전부 됐으면 `완벽히 끝냈습니다`**(M-13) → ⑦ `session.mjs release`

- **"다음 세션이 하겠지" 금지.** 반대로 **남의 미완 작업을 대신 끝내지도 않는다** — 의도를 모른 채 손대면 그 세션의 설계를 망친다(보이면 M-9 ③으로 기록).
- **못 끝낼 때 침묵 종료 금지**: 보드 `progress` 갱신 + 남은 일·막힌 지점·다음 단계 보고 + **빌드 깨진 채 두지 않기**(되면 커밋, 안 되면 원상 복구).
- 판단 기준: **"지금 내가 사라져도 다른 사람이 이 상태에서 이어받을 수 있는가?"** 아니면 아직 끝난 게 아니다.

### M-12. "남은 것"은 없다 — 지시 범위를 스스로 줄이지 않는다 (필수)

> **왜**: 일을 단계로 쪼개는 것은 **내가 순서를 잡기 위한 도구**다. 그런데 앞 단계만 하고
> 뒤를 "남은 것"이라 부르며 보고를 끝내면, 도구였던 단계가 **지시 범위를 자르는 선**이 된다.
> 사용자는 6단계를 나눠 시킨 적이 없다. (실제 지적: **"남은 것이라는 것은 없어 방법을 찾아서 진행해"**)
> M-11이 "세션 경계로 자르지 말라"였다면, M-12는 **"내가 만든 단계로도 자르지 말라"**다.

- **지시 범위 = 완료 범위.** 내가 세운 단계·우선순위·P0/P1은 **순서**이지 "여기까지가 이번 몫"이 아니다.
- **막히면 먼저 방법을 찾는다.** "승인이 필요해서" · "다음 단계라서" · "범위 밖이라서"로 멈추기 전에
  **되돌릴 수 있는 형태로 바꿀 수 없는지**를 본다.
  예: 물리 삭제 → **소프트 삭제 + 복구 경로** · 전면 교체 → **플래그 뒤 신규 경로** · 파괴적 마이그 → **expand→backfill**(contract는 나중).
  형태를 바꾸면 승인 없이 갈 수 있는 일이 대부분이다.
- **진짜 멈춰야 하는 것은 셋뿐이다.** ⓐ 되돌릴 수 없는 운영 데이터 변경 ⓑ 외부로 나가는 것(`push`·배포·발송·외부 API 쓰기) ⓒ **사용자만 아는 사실**이 있어야 정해지는 결정.
  이 셋이 아니면 **진행한다.** 셋에 걸리면 그 하나만 멈추고 **나머지는 끝까지 간다.**
- **보고에 "남은 것"이라 쓰지 않는다.** 정말 못 한 것이 있으면 그건 **"못 한 것"**이고,
  ① 무엇을 ② 왜 못 했고 ③ 무엇이 있으면 되는지를 함께 적는다. 이유 없는 이월은 미완이다.
- **한 번에 다 못 끝낼 분량이면 쪼개서 계속한다.** 분량은 멈출 이유가 아니라 **커밋을 나눌 이유**다(M-7).

### M-13. 끝냈으면 **"완벽히 끝냈습니다"**라고 말한다 (필수 — 이 문구가 없으면 사용자는 기다린다)

> **왜**: 사용자는 보고를 읽고 **"이제 손 떼도 되나"**를 판단한다. 그런데 보고가 한 일만
> 나열하고 끝나면, 다 끝난 것인지 여기까지만 한 것인지 읽는 쪽에서 구분할 수 없다.
> 그래서 사용자는 안전한 쪽으로 가정한다 — **아직 남았다**고.
> (실제 지적: **"완전히 끝난건 완벽히 끝냈다는 멘트 무조건 하라고, 그게 안나오면 계속 잡이 남은걸로 판단할테니깐"**)
>
> 즉 이 문구의 유무가 **사용자의 다음 행동을 바꾼다.**
> 그리고 없을 때 사용자가 하는 행동은 기다리는 것만이 아니다 — **같은 일을 다시 시킨다.**
> (실제 지적: **"계속 남은 일이 있다고 생각해서 동일한 업무를 계속 해야 하니깐"**)
> 끝난 일을 또 하는 것은 시간만 버리는 게 아니라, 이미 맞는 코드를 다시 건드려 **회귀를 만든다.**
> 완료 선언은 예의가 아니라 **중복 작업을 끊는 장치**다.
>
> M-11이 "끝까지 맡아라", M-12가 "범위를 자르지 마라"였다면, M-13은 **"끝났으면 끝났다고 말하라"**다.

**규칙은 둘뿐이다. 둘 다 어기면 안 된다.**

| | 규칙 |
|---|---|
| **1** | 완료 조건을 **전부** 채웠으면 보고 끝에 **`완벽히 끝냈습니다`**를 그대로 쓴다. 돌려 말하지 않는다 |
| **2** | 하나라도 못 채웠으면 **절대 쓰지 않는다.** 대신 못 한 것을 M-12 형식으로 적는다 |
| **3** | 문구와 함께 **무엇이 닫혔는지** 한 줄로 밝힌다 — 사용자가 "그 일은 다시 안 시켜도 되는구나"를 알 수 있게 |

**완료 조건** = M-11 ①~⑦(구현·검증·실화면·발견처리·정리·보고·release) **전부** + M-12의 지시 범위 **전부**.
하나라도 빠지면 미완이다. "거의 다"는 미완이다.

- **돌려 말하지 않는다.** "마무리했습니다" · "정리됐습니다" · "이상입니다"는 완료 선언이 아니다.
  사용자가 찾는 것은 **그 문구**다. 비슷한 말로 대체하면 없는 것과 같다.
- **부분에 붙이지 않는다.** "①은 완벽히 끝냈습니다"처럼 조각에 달면 문구의 뜻이 흐려진다.
  기준은 **지시 전체**다. 일부만 됐으면 그냥 쓰지 않는다.
- **막혔으면 미완이다.** M-12의 멈출 세 가지(되돌릴 수 없는 데이터 변경 · 외부 발신 · 사용자만 아는 결정)에
  걸려 승인을 기다리는 중이면 **끝난 게 아니다.** 승인 요청과 함께 문구는 생략한다.
- **이 문구는 신뢰의 근거다.** 안 끝난 상태에서 한 번이라도 쓰면 그 뒤로는 아무 의미가 없어지고,
  사용자는 매번 직접 확인해야 한다. **틀리게 쓰는 것이 안 쓰는 것보다 훨씬 나쁘다.**

**안 끝났을 때의 보고 형식**(문구 없이, 이 셋을 반드시 적는다)

1. **무엇을** 못 했는지 — 기능 이름이 아니라 사용자가 겪는 말로
2. **왜** 못 했는지 — 막힌 지점(승인 대기 · 외부 의존 · 분량)
3. **무엇이 있으면** 되는지 — 다음에 무엇이 주어지면 끝나는지

### 완료 조건 — "동작한다"는 **실사용으로만** 증명된다

> **왜**: tsc·단위테스트·정적 가드가 전부 초록인데 화면은 안 되는 일이 이 저장소에서 반복됐다.
> (실측: v0.7.367 목록 심층분석 — **브라우저가 결함 7건을 적발**했는데 tsc·단위·리뷰는 전부 초록이었다.
>  v0.7.438 `/ci` — 테이블·설정은 만들었는데 소비 코드가 0이라 화면에선 아무 일도 안 일어났다.
>  이번 판 — 화면을 **읽기만** 하고 "완벽히 끝냈다"고 보고했다가 정정했다.)
>
> 코드가 맞는 것과 **사용자가 쓸 수 있는 것**은 다른 명제다. 후자는 후자로만 증명된다.
> (실제 지적: **"완벽히 끝났다는건 브라우저에서 열고 데이터를 넣고 테스트 해서 사용자의 실동작과
> 동일한 테스트를 하고 예외나 버그상황까지 테스트하고 문제 없는 경우를 뜻하는거야"**)

**`완벽히 끝냈습니다`를 쓰려면 아래 5개를 **전부** 통과해야 한다. 하나라도 안 했으면 쓰지 않는다.**

| | 무엇을 | 왜 |
|---|---|---|
| **E-1** | **브라우저에서 실제로 연다** — 기본 플래그 상태의 실제 렌더 경로 | 죽은 경로를 고치고 통과했다고 착각하는 사고가 반복됐다(§실제 렌더 경로 정책) |
| **E-2** | **사용자가 하는 그대로 데이터를 넣는다** — 폼에 입력하고 버튼을 누른다 | API가 되는 것과 화면에서 되는 것은 다르다. 배선·상태·권한이 그 사이에 있다 |
| **E-3** | **결과가 화면에 실제로 나타나는지 본다** — 응답 200이 아니라 **눈에 보이는 변화** | 저장은 됐는데 목록이 갱신 안 되는 결함이 200으로는 안 잡힌다 |
| **E-4** | **예외·오류·경계를 밟는다** — 아래 목록 | 정상 경로만 보면 사용자가 처음 마주치는 실패를 개발자가 마지막에 안다 |
| **E-5** | **콘솔 오류가 없다** — 실행 중 에러·예외 0 | 화면은 멀쩡한데 콘솔에서 터지는 것은 다음 사람이 밟는다 |

**E-4에서 반드시 밟는 것** (해당되는 것 전부)

- **잘못된 입력** — 형식이 틀린 값 · 지원하지 않는 값 · 쓰레기 문자열
- **빈 입력** — 아무것도 안 넣고 실행
- **중복** — 이미 있는 것을 또 넣기
- **빈 상태** — 데이터가 0건일 때 화면이 뭐라고 하는지
- **근거 부족** — 표본이 임계 미만일 때 "모른다"고 말하는지 (숫자를 지어내지 않는지)
- **없는 대상** — 존재하지 않는 id로 상세 열기
- **권한 없음** — 남의 워크스페이스·비인증 접근
- **실패 표시** — 오류가 났을 때 사용자가 **읽을 수 있는 말**로 뜨는지 (조용히 삼키지 않는지)

**E-6. 화면으로 못 밟는 상태는 계산으로 밟되, 계산이 화면과 같다는 증거를 함께 박는다**

> **왜**: E-1~E-5는 "브라우저에서 밟아라"인데, 실제로 **밟을 수 없는 상태**가 있다.
> (실측 v0.7.550: Dock 스택이 '수집 중 N건' 칩 때문에 250px로 자란 순간이 정확히 사고 지점인데,
>  수집이 돌지 않으면 그 화면이 재현되지 않는다. QA가 나머지 셋은 통과시키고 그 한 지점을 미검증으로 남겼다.)
> 그럴 때 계산으로 밟는 것은 맞다 — 단, **그것만 하면 화면과 무관한 가드**가 된다.
> 자기 상수로 자기를 검사하는 가드는 통과해도 현실을 보증하지 않는다.
> (실제 지적 · crm-qa-g3: "계산으로 밟는다는 접근에 동의한다. 다만 그게 성립하려면
>  **계산이 화면과 일치한다는 증거**가 먼저 있어야 한다.")

- **순서가 규칙이다.** ① 실브라우저에서 입력값과 결과값을 **한 쌍** 잰다 → ② 그 입력을 계산 함수에 넣어 **같은 값이 나오는지** 확인한다 → ③ 그 위에서 못 밟는 상태를 숫자로 검증한다. ②를 건너뛰면 ③은 아무것도 증명하지 않는다.
- **앵커를 가드 안에 박는다.** 실측 한 쌍(입력·기대값)을 단정으로 남기고 **어디서 잰 값인지**를 주석에 적는다.
  예: `dockSafeAreaPx(813, 621) === 192  // 실측 /ci/inbox v0.7.552 · 화면의 --dock-height 와 같은 값`
  앵커가 깨지면 계산이 화면에서 떠난 것이므로, 그 가드는 **틀린 것을 통과시키는 상태**다.
- **계산을 컴포넌트 밖으로 뺀다.** 검증할 수 있게 만드는 것이 먼저다 — `useEffect` 안의 식은 실브라우저 외에 검증 수단이 없다.
- **보고에 무엇을 계산으로 대체했는지 밝힌다.** "실화면 대용"이라고 적고 앵커 값을 함께 적는다. 밝히지 않으면 읽는 쪽은 **화면에서 밟은 것으로 읽는다**.
- **대체할 수 없는 것**: 사용자가 실제로 누르는 경로(E-1~E-3)와 콘솔 오류(E-5)는 계산으로 대체하지 않는다. E-6은 **재현 자체가 불가능한 상태**에만 쓴다 — 귀찮아서·시간이 없어서는 사유가 아니다.

**⚠️ E-1 을 막는 함정: 공유 dev 서버(:3000)는 옛 Prisma 클라이언트를 물고 있다.**
`prisma generate` 로 새 모델을 만들어도 **이미 떠 있는 서버는 영원히 모르고 500 을 낸다.**
`lib/crm/db/client.ts` 의 `globalThis.crmPrisma` 싱글턴 + `node_modules` 가 Next dev 의 HMR 대상이
아니라는 것, 둘 다가 원인이다. (실측 v0.7.541: 서버가 **28패치 뒤처진** v0.7.512 시점에 떠 있어
`crm_quote` 조회가 전부 500 이었다 — 코드·DB·생성된 클라이언트는 **전부 정상**이었다.
서비스 로직을 의심하다 별도 프로세스 스모크로 정상을 확인하고서야 원인을 찾았다.)

**재시작하지 않는다(M-2). 격리된 두 번째 서버를 띄운다** — `next.config.js:17` 이 `NEXT_DIST_DIR` 을 이미 읽는다:

```bash
NEXT_DIST_DIR=.next-<이름> node ./node_modules/next/dist/bin/next dev -p 3100   # .next 를 공유하지 않아 :3000 무영향
# 끝나면: 프로세스 종료 + rm -rf .next-<이름> + tsconfig.json 에 자동 추가된 include 줄 제거
```

**테스트 데이터는 원상 복구한다.** 실사용 검증은 운영 데이터에 흔적을 남기는 행위다 —
넣은 것은 검증 후 지운다(M-12 "형태를 바꾼다": 투입 → 검증 → 복구). 못 지우면 무엇을 남겼는지 보고한다.

**보고에는 밟은 경로를 적는다.** "테스트했습니다"는 검증이 아니다.
무엇을 넣어서 무엇이 나왔는지 — 정상 몇 개, 예외 몇 개, 발견 몇 건을 숫자로 적는다.

### M-14. 지시는 세션 하나에만 도착한다 — 받은 세션이 옮긴다 (+@ 전파) (필수)

> **왜**: 사용자는 **창 하나**에 대고 말한다. 그 창만 새 기준을 안다. 나머지 N−1개는 옛 기준으로
> 계속 가고, **자기가 뒤처졌다는 사실조차 모른다.** 결과물은 각자 성실한데 합치면 다른 제품이 된다.
> M-1~M-8이 막은 것은 파일이 겹칠 때의 **충돌**이다. M-14가 막는 것은 **드리프트** —
> **파일이 안 겹쳐도 생긴다.** 보드는 앞의 것만 봤다.
> **실측(2026-08-16, v0.7.492)**: 피어 세션 **6개** 동시 가동 · 보드 claim **1개** · 지시를 옮길 통로 **0개**.
> M-9 "본 것을 말하라" · M-11 "끝까지 맡아라" · M-12 "범위를 자르지 마라" · M-13 "끝났으면 말하라"에 이어
> M-14는 **"받은 것을 옮겨라"**다.

| | 규칙 |
|---|---|
| **1** | **전파 의무** — 지시를 받으면 **착수 전에** 전파 여부를 판정한다. 대상이면 `broadcast` **먼저**, 작업은 그 다음 |
| **2** | **원문으로 옮긴다** — 요약하면 내 기준으로 잘리고, **남에게 필요한 조각이 하필 그 잘린 자리에 있다** |
| **3** | **수신 의무** — `inbox`를 **착수 전 · 노드 완료마다 · 커밋 전 · 종료 전** 읽는다 |
| **4** | **`ack`에는 반영 방법**을 쓴다. "읽었다"는 ack가 아니다. 해당 없으면 **"해당없음 + 이유"** |
| **5** | **애매하면 전파한다** — 전파 비용은 한 줄, 누락 비용은 **N개 세션의 재작업**이다 |

**전파한다(+@)**: 규칙·표준·금지("앞으로 X는 반드시 Y") · **완료 판정 기준의 변경** · 공유 핫스팟(M-5)을 건드리는 결정 ·
**우선순위 변경**("이거부터") · 승인·금지("마이그 승인함"·"push 하지 마") · 용어·명명 결정 · **사용자가 지적한 실패 패턴**
**전파 안 한다(로컬)**: 화면 하나의 버그 수정 · 내 담당 파일 안의 구현 선택 · 내 노드의 분해·순서 · 단순 사실 확인 문답

**경계 — 전파는 "같이 하자"가 아니라 "같은 기준으로 하자"다.** 이 한 줄이 M-11을 무너뜨리지 않는 선이다.

| 받은 것 | 한다 | 하지 않는다 |
|---|---|---|
| 기준·규칙 | **내 남은 작업 전부에 적용** — 이미 한 것도 그 기준으로 다시 본다 | — |
| 우선순위 | 내 노드 **순서**를 바꾼다 | 남의 노드를 가져오지 않는다 |
| 남의 작업 내용 | **안다** — 남의 중간 상태를 내 결함으로 오진하지 않는다(M-9 ④) | **대신 끝내지 않는다**(M-11) |
| 해당 없음 | `ack --note "해당없음 — 이유"` | 침묵 |

```bash
node scripts/session.mjs broadcast <이름> --what "지시 원문" --why "..." --files "..."   # 착수 전
node scripts/session.mjs inbox <이름>                                                    # 4개 지점에서
node scripts/session.mjs ack <이름> --note "내 목록 화면 3개에 같은 기준 적용함"          # 반영 방법 필수
```

- `board`가 세션별 **📬 미확인 N건**과 "아직 확인하지 않은 세션"을 표시한다 — **뒤처진 세션이 보드의 최우선 신호**다.
- `release`는 미확인 지시를 남기고 끝내면 경고한다. 그 경고는 **사용자 보고에 포함**한다(M-9와 같은 성격).
- **직접 메시지는 전달이 보장되지 않는다 — 버스가 정본이다.** 세션 간 직접 메시지는 **수신 쪽 사용자 승인**을 거치고 승인이 없으면 **만료돼 사라진다**(실측 2026-08-16: 6건 중 **3건 미전달**). "보냈으니 알 것"으로 끝내지 않는다 — 도달의 근거는 **보드의 📬 미확인 0**, 즉 **상대의 `ack`뿐**이다.
- 버스(`.sessions/_bus.jsonl`)는 **커밋되지 않고**, `broadcast`는 **지금 도는 세션**에만 닿는다.
  반복 적용될 규칙이면 전파에서 끝내지 말고 **정책 파일에 올린다** — 전파는 **지금**을, 정책은 **다음**을 맞춘다.

### M-15. 역할 세션 3관문 — 구현은 혼자 시작하고 혼자 끝낼 수 없다 (필수)

> **왜**: 2026-08-17 사용자가 같은 지적을 세 번 했다 — "UI/UX가 망가졌잖아" · "깨진 화면이 다수인데 왜 반응이 없어?" ·
> "완벽히 끝났다는 건 브라우저에서 열고 데이터를 넣고 예외까지 테스트해서 문제 없는 경우를 뜻한다".
> 원인은 하나다: **만든 세션이 유일한 판정자였다.** M-8은 "만든 사람이 유일한 검토자가 될 수 없다"를
> **기획 단계에만** 걸어 놓았고, 구현과 완료 판정에는 관문이 없었다.
> **실측(2026-08-17)**: 역할 세션 셋이 **이미 돌고 있었다**(`crm-ui-watch` 발견 78건 · `policy-audit` · `crm-qa`).
> 그런데 버스 54건이 오가는 동안 구현 세션의 `ack`는 **0건**이고, 그 셋에게 **먼저 요청한 기록은 0건**이었다.
> 감시자는 사후에 결함을 세고 구현자는 그 집계를 읽지 않았다 — 발견 78건은 그 구조의 산출물이다.
> 사용자 지시(원문): "구현할때 UI/UX 세션을 통해서 어떻게 구현하는지 확인하고 구현하고 그다음에 정책감사하는
> 세션에게 정책으로 이상없는지 확인받고, qa 세션에게 브라우저와 실데이터로 확인해달라고 하고 마무리 하는
> 구조야 **정책으로 못박아서 무조건 그렇게 시행해**"
> M-14가 "받은 것을 옮겨라"였다면, M-15는 **"혼자 판정하지 마라"**다.

**순서는 고정이다 — 건너뛰기도, 순서 바꾸기도 없다.**

| 관문 | 언제 | 자리(현재 세션) | 무엇을 받는가 |
|---|---|---|---|
| **G1 설계 협의** | **코드 쓰기 전** | UI/UX 감시 (`crm-ui-watch`) | 어떤 부품·토큰·표준으로 그릴지 · INVENTORY에 이미 있는 부품 · 같은 성격의 알려진 결함 |
| **G2 정책 감사** | 구현 직후 · 커밋 전후 | 정책 감사 (`policy-audit`) | M-1~M-15 · 디자인시스템 · 버전/changelog 5곳 · 마이그 적용 · 새 테스트 등재 |
| **G3 실사용 QA** | **완료 선언 전** | 실사용 QA (`crm-qa`) | 브라우저 + **실데이터**로 E-1~E-5(열고 · 넣고 · 보이고 · 예외 밟고 · 콘솔 0) |

- **브라우저 화면 테스트는 무조건 `crm-qa`에 요청한다.** 세션마다 각자 열면 ⓐ 같은 화면을 중복으로 재고
  ⓑ 결과가 서로 다르게 보고되며 ⓒ 공유 dev 서버(:3000)에 부하가 겹친다.
  구현 세션이 화면을 여는 것은 **내가 만든 것이 그려지는지 보는 것까지**이고, **판정은 G3가 한다.**
- **G3 근거 없이 `완벽히 끝냈습니다`를 쓰지 않는다**(M-13). 완료 조건 = M-11 ①~⑦ **+ G1·G2·G3 통과 근거**.
- **E-1~E-5의 실행 주체는 G3다.** 관문은 검증을 **면제**하는 장치가 아니라 **전담**시키는 장치다.

**부르는 법 — 버스가 정본이다**(직접 메시지는 전달이 보장되지 않는다, M-14)

```bash
node scripts/session.mjs broadcast <내이름> --kind ask \
  --what "[G1 crm-ui-watch 앞] 할 일 목록을 ListToolbar+useListQuery로 이관 예정 — ①§2-6에 맞나 ②쓸 부품이 INVENTORY에 있나" \
  --files "apps/web/app/(crm)/crm/tasks/TasksClient.tsx"
```

- 요청에는 **넷**을 적는다 — ① 화면 URL ② 파일 경로 ③ **하려는 것**(G1은 착수 전이다) ④ 무엇을 판정받고 싶은지(질문 형태).
  "봐 주세요"는 요청이 아니다. 기준이 없으면 상대는 무엇을 찾을지 모른 채 훑고, **검토받았다는 착각**만 남는다.
- 받은 쪽은 `ack --note`에 **판정**을 적는다(맞다/틀렸다 + 이유). 보고에는 **근거를 번호로** 적는다 — `G1 #60 / G2 #63 / G3 #64`.
- G1은 착수 전이라 **답을 기다리는 동안 놀지 않는다** — 화면에 닿지 않는 부분(도메인 로직·`lib/` SSOT·가드·테스트)부터 만든다.

**자리는 이름이 아니다.** 세션 이름은 바뀐다 — 실제로 `crm-qa`→`policy-audit` 개명 중
**화면 검증 요청의 수신자가 사라져** 결함 6건이 갈 곳을 잃었다(버스 #51·#52·#53).
`board`에서 그 자리를 맡은 세션을 찾아 **그때의 이름으로** 부른다. 확인 없이 예전 이름으로 보내면 요청은
아무도 없는 주소로 가고, **보낸 쪽은 보냈다고 믿는다.**

**빈 자리 · 무응답 — 멈추지 않고, 대신 흔적을 남긴다**

- 자리를 맡은 세션이 있으면 **반드시 그 세션에 요청한다.** 내가 대신 판정하지 않는다.
- 보드에 없거나 💤(30분 무갱신)이거나 무응답이면, 요청을 **버스에 남긴 뒤** 직접 수행하고
  보고에 **"G1 자가수행 — 이유"**를 적는다. 밝히지 않으면 사용자는 **검토받은 것으로 읽는다** — 그게 이 규칙이 막으려는 상태다.
- 대행도 **기준은 같다** — G1은 INVENTORY + §0~§2-6, G2는 정책 체크리스트, G3는 **실브라우저 E-1~E-5**.
  "tsc 돌려봤다"로 대체 금지. 대행은 **역할을 바꿔서** 한다 — 구현자의 눈으로 한 번 더 보는 것은 대행이 아니다.
- 자가수행이 연속으로 나오면 그 자리가 비었다는 신호이므로 **사용자에게 올린다.**

**적용 범위 — "무조건"의 뜻**: 화면·컴포넌트·CSS = G1·G2·G3 **전부** / API·서비스·DB = 화면 영향 있으면 G1, G2·G3 필수 /
마이그레이션 = G2(적용 여부까지)·G3 / 정책·문서만 = G2 / 테스트·가드만 = G2(등재 여부).
**"해당없음"은 판단이 아니라 사실이다** — 대상이 없을 때만 쓰고 보고에 **"해당없음 + 이유"**를 적는다.
분량이 적어서 · 급해서 · 자신 있어서는 생략 사유가 아니다.
감시·감사·QA 세션은 **코드를 고치지 않는다.** 판정과 근거만 준다. 고치는 것은 구현 세션이다(M-11).

### 나머지 규칙 요약 (상세는 전문)

| 규칙 | 요지 |
|---|---|
| **M-3** 번호 선점 | 버전 = 커밋 **직전** 번프 + **직후 재확인**, 중복이면 나중 커밋한 쪽이 양보(HEAD가 내 것이면 `--amend`, 아니면 후속 커밋) · 마이그 = **즉시 파일 생성으로 번호 선점**(같은 번호를 다른 내용으로 쓰면 `migrate.sh`가 **조용히 스킵**) · changelog = 맨 위에 **내 블록만** |
| **M-4** 같은 소스 동시 수정 | **추가 전용**만 — optional 인자·필드·prop · API 필드 추가 · flag 기본 OFF · DB는 expand→backfill→contract. **삭제·이름변경·시그니처 변경은 단독 창구.** 하위 호환 = 기존 함수를 **새 함수로 위임**, 상위 호환 = `switch`에 `default:` + 객체는 **spread 보존** |
| **M-5** 충돌 핫스팟 | `package.json`×2 · 정책 3파일(`CLAUDE.md`·`AGENTS.md`·`GEMINI.md`) · `migrations/NNN_*` · `entries.ts` · `apps/web/package.json`의 `test` 목록 · `globals.css` · `INVENTORY.md` · `.gitignore` → **끝에만 append**, 커밋 전 **남의 미커밋 줄이 섞였는지 확인** |
| **M-6** 세션 보드 | `node scripts/session.mjs board \| claim \| progress \| finding \| broadcast \| inbox \| ack \| release` — **착수 전 `board`+`inbox` 필독**, 겹치면 병렬 금지, 30분 무갱신 = 죽은 세션(💤) |
| **M-7** 그래프 분해 | 병렬의 단위는 **파일 소유권**. 겹치면 병렬이 아니다 → 직렬화하거나 겹치는 부분을 `lib/` SSOT로 먼저 분리. 노드가 끝나면 **바로 커밋** |
| **M-8** Codex 협업 | 구현 아닌 **기획 단계 검토**에 쓴다(`codex exec -s read-only`). 채택/**반려도 이유와 함께 기록**. **만든 사람이 유일한 검토자가 될 수 없다** |
| **M-10** 체크리스트 | 착수 6개(보드·**inbox**·claim·**broadcast**·추가전용·검토) · 종료 8개(**inbox 재확인**·pathspec·버전·범위검증·발견보고·완료정의·**정책 승격**·release) — 전문 참조 |

## Git 커밋 규칙

### 커밋 범위 정책 (필수 — 작업 공간은 항상 공유된다고 가정한다)

> **왜**: 같은 저장소에서 여러 작업이 동시에 진행된다(다른 도구·다른 창·자동 루프). 작업 트리에 내가 만들지 않은 변경이 섞여 있는 건 **정상 상태**다. 그걸 사고로 취급해 보고하거나, 통째로 커밋에 쓸어 담으면 남의 작업을 망친다.

- **커밋은 pathspec 커밋으로 한다** — `git commit -m "..." -- <파일경로>`. `git add -A` · `git add .` · `git commit -a` **금지**. ⚠️ 경로 지정 스테이징(`git add <경로> && git commit`)**만으로는 부족하다** — 인덱스는 세션 간 공유라 남이 스테이징한 파일이 딸려 온다(실측 확인). 상세는 **§다중 세션 동시 작업 정책 M-1**.
- 커밋 전 `git status`로 **내 변경과 아닌 것을 구분**한다. 내 것이 아닌 변경은 **건드리지도, 되돌리지도, 보고하지도 않는다.**
- **주제가 다르면 커밋을 나눈다.** (예: 문서·정책 / 기능 코드 / 마이그레이션)
- **검증 판정은 내 변경 범위로 한다.** `tsc`·`lint`·`test`가 내 변경 밖 파일에서 오류를 내면, 그 파일은 손대지 않고 **내 범위가 깨끗한지로 판단**한다. 남의 진행 중 코드를 고치지 않는다.
- 커밋 후에도 남는 다른 변경은 **그대로 둔다.** 정리하려 들지 않는다.

### 커밋 메시지 형식 (필수)

```
v{버전}: {변경 내용} claude
```

**규칙:**
- 커밋 메시지 **제목줄 맨 마지막**에 반드시 소문자 `claude` 추가 (공백 1칸 후)
- 버전은 `package.json`의 현재 버전 사용
- `Co-Authored-By` 트레일러는 커밋 본문 영역에 별도 유지 (본 규칙과 무관)

**예외:** merge / revert 커밋은 Git 자동 생성 메시지 사용 — `claude` 불요

**예시:**
```bash
# ✅ 올바른 예
git commit -m "v0.4.6: 거래처 목록 검색 필터 추가 claude"
git commit -m "v0.4.6: 모바일 카드 레이아웃 버그 수정 claude"

# ❌ 금지
git commit -m "v0.4.6: 거래처 목록 검색 필터 추가"        # claude 누락
git commit -m "v0.4.6: 거래처 목록 검색 필터 추가 Claude"  # 대문자 금지
git commit -m "claude v0.4.6: 거래처 목록 검색 필터 추가"  # 위치 오류
```

## 재사용·단일구현 정책 (필수 — 위반 시 회귀/정합성 오염)

**같은 처리가 여러 곳에 필요하면 새로 짜지 말고 단일 구현(SSOT)을 만들어 import해 재사용한다.**

- **설계부터 재사용 우선**: 새 기능 구현 전, 유관 시스템에 동일/유사 처리가 이미 있는지 먼저 확인하고 있으면 그 모듈을 재사용한다. 없으면 `lib/`에 공용 모듈로 만들고 모든 호출처가 import한다.
- **한 곳 수정 = 전체 반영**: 로직(중복제거·정규화·tier판정·매핑·환산 등)은 반드시 한 파일에 두고, 각 라우트/컴포넌트는 그 함수를 호출만 한다. 같은 로직을 복붙하지 않는다.
- **신규 라우트/화면 추가 시 점검 필수**: "이 처리, 다른 곳에도 동일하게 들어가야 하나?" → 예면 공용 모듈로 적용. 놓치지 말 것.
- **현재 공용 모듈(예시)**: `lib/gpu/dedup.ts`(추출 중복제거 — 추출·저장 전 경로), `lib/gpu/tier-dict.ts`(tier 판정), `lib/gpu/normalize.ts`(메모리 정규화), `lib/gpu/extract-helpers.ts`(스키마/스펙/스트리밍), `lib/datetime/kst.ts`(날짜·시간 KST↔UTC SSOT — 아래 정책), `lib/nav/return-to.ts`(복귀 경로 SSOT — 아래 정책), DB `infer_tier()`·`get_schema_digest()`. 동일 성격 작업은 여기에 추가하거나 재사용한다.

## 복귀 경로 정책 (필수 — "설정을 마치면 원래 있던 화면으로 돌아온다")

> **왜**: 외부로 나갔다 돌아오는 흐름(OAuth 동의·외부 인증·결제)이 끝났을 때, 사용자는 **떠났던 그 화면**으로 돌아와야 한다. 각 라우트가 복귀 주소를 직접 적으면 쿼리(탭·필터·정렬)가 통째로 날아간다.
> (실제 사고: v0.7.438 Google Drive 콜백이 `/admin/settings?drive=connected`로 **고정**돼 있어 `?tab=integrations`가 사라졌고, 연동을 마치면 엉뚱하게 '브랜딩' 탭이 열렸다)

**모든 왕복 흐름은 `lib/nav/return-to.ts`(SSOT)를 쓴다. 복귀 주소를 라우트에 적지 않는다.**

- **떠날 때**: 시작 링크를 `withReturnTo(href, currentReturnTo())`로 만든다. `currentReturnTo()`가 **경로+쿼리**를 담으므로 탭·필터가 유지된다.
- **보관**: 시작 라우트가 `sanitizeReturnTo()`로 검증해 **httpOnly 쿠키**에 넣는다(CSRF state와 같은 수명). 쿼리로 왕복시키지 않는다.
- **돌아올 때**: 콜백이 쿠키를 읽어 `appendParams(returnTo, { 결과: '...' })`로 **기존 쿼리를 보존한 채** 결과만 얹어 리다이렉트한다.
- **보안**: `sanitizeReturnTo()`가 절대 URL·`//`·`/\`·CR/LF를 전부 차단한다(열린 리다이렉트 방어). 외부에서 들어온 복귀 주소를 **검증 없이 리다이렉트하지 않는다.**
- **결과 표시 필수**: 콜백이 붙인 `?xxx=error&reason=…`을 화면이 **반드시 표시**한다. 붙여만 놓고 안 보여주면 실패가 조용히 묻힌다(실제로 Drive가 그랬다).
- **가드**: `lib/nav/return-to.test.ts`(단위 + open-redirect 방어).

## 관계·삭제 계약 정책 (필수 — 위반 시 "지웠는데 남아 있다" 사고)

> **왜**: 채널을 지웠더니 그 채널의 게시물 55건이 "채널 미확인"으로 수집함에 남았다(2026-08-18 실측).
> 남은 게시물은 비교군이 사라져 배수가 영원히 안 나오고(실측 0/55건), 목록을 어지럽히고,
> 촬영 예약 20건이 살아남아 비용만 계속 썼다 — **남겨서 얻는 것이 하나도 없었다.**
> 게다가 손으로 치운 고아 작업 20건이 **하루 만에 다시 20건** 생겼다. 한 번 치우는 것으로는 안 끝난다.
> (사용자 지시 원문: "채널이 삭제되면 수집함의 컨텐츠 당연히 삭제 되야 하고 이런식의 구현에
>  **CRUD와 릴레이션은 FK나 PK를 통해서 정확하게 관리 되어야 해**")
>
> **진짜 원인**: "부모를 지우면 자식은 어떻게 되나"를 정하는 자리가 **세 곳으로 흩어져 있고
> 셋이 서로 다른 답을 갖고 있었다** — ①DB의 FK 규칙 ②삭제 코드의 수동 정리 ③아무도 안 보는 곳
> (`ci_jobs.target_id`처럼 FK도 코드도 없는 자리). 삭제 코드는 스스로를 SSOT라 선언했지만
> 실제로는 **DB가 절반을 결정했고 그 절반은 검증되지 않았다.**

### R-1. 새 참조를 만들 때 관계 종류를 **먼저** 정한다 (미분류 금지)

모든 참조는 셋 중 하나다. 애매한 채로 두지 않는다 — 애매한 것이 곧 고아가 된다.

| 종류 | 뜻 | 구현 | 예 |
|---|---|---|---|
| **소유(owns)** | 자식은 부모 없이 존재 이유가 없다 | FK `ON DELETE CASCADE` | 채널→게시물 · 게시물→지표 · 기획→편집안 |
| **참조(refs)** | 자식은 독립적이고 부모를 가리킬 뿐 | FK `ON DELETE SET NULL` | 게시물→주제(라벨) · 기획→게시 실적 · 기획→자산 |
| **작업(work)** | 대기열·예약·기록. 폴리모픽이라 FK를 못 건다 | **DB 트리거**로 정리 | `ci_jobs` · `ci_board_items` · `ci_corrections` |

**판정 기준은 "남겨서 사용자가 얻는 것이 있는가"다.** 없으면 소유다.
"게시물은 독립 자산"처럼 그럴듯한 말로 남기지 않는다 — 남은 55건이 그 말의 결과였다.

### R-2. 계약은 **데이터로 선언한다** — 코드에 흩어 쓰지 않는다

`apps/web/lib/ci/relation-contract.ts`(SSOT)가 유일한 자리다. 이 선언 하나가 셋을 동시에 지배한다:
- **마이그레이션**이 이 표대로 FK와 트리거를 건다
- **`previewDelete`**가 이 표를 읽어 확인창 문구를 만든다 → **화면이 계약과 다른 말을 할 수 없다**
  (예전엔 화면이 "게시물은 남습니다"라고 안내했는데 그게 사실이자 문제였다)
- **가드**가 이 표와 실제 SQL을 대조한다 → 선언만 하고 안 거는 것을 막는다

**종류를 손으로 나열하지 않는다.** `if (kind === 'content' || kind === 'idea' || kind === 'brief')`
같은 코드가 **채널을 통째로 빠뜨린 원인**이다. `polymorphicRefs(kind)`처럼 계약에서 뽑는다.

### R-3. FK를 걸 수 없는 자리는 **DB 트리거**가 맡는다 — 코드만 믿지 않는다

폴리모픽 컬럼(`target_type`+`target_id`, `item_type`+`item_id`)은 단일 FK가 불가능하다.
그 자리를 코드에만 맡긴 결과가 **매일 다시 생기는 고아**였다.

> **코드는 잊을 수 있고 DB는 잊지 않는다.** 그래서 DB로 내린다(마이그 208의 `ci_purge_refs_of_*`).
> 코드(`delete.ts`)의 정리는 **두 번째 방어선**으로 남긴다 — 마이그레이션이 아직 안 간 환경에서도
> 고아를 만들지 않기 위해서다. 지우는 순서는 **폴리모픽 먼저, 본체 나중**이다
> (본체를 먼저 지우면 어떤 항목이 고아인지 알 방법이 사라진다).

### R-4. 가드는 **두 겹**이다 — 정적 검사 하나로는 못 막는다

| 가드 | 무엇을 보나 | 언제 깨지나 |
|---|---|---|
| `lib/ci/relation-contract.test.ts` | 계약 선언 ↔ 마이그레이션 SQL 일치 (CASCADE·트리거·계측 커버리지) | 선언해 놓고 안 걸었을 때 |
| `pnpm ci:orphans` (운영 DB 접속) | **실제 고아 행 수**. 하나라도 0이 아니면 exit 1 | 이미 새고 있을 때 |

정적 가드가 전부 초록인 동안 데이터는 조용히 오염돼 있었다 — **둘 다 필요하다.**
새 참조를 계약에 추가하면 계측 쿼리는 자동으로 늘어난다(손으로 SQL을 적지 않는다).

### R-5. 지우기 전에 **무엇이 함께 사라지는지** 보여준다

되돌릴 수 없는 일이므로 확인창이 유일한 안전장치다(`useCiDelete` → `previewDelete`).
목록은 계약에서 뽑으므로 FK를 바꾸면 문구가 저절로 따라온다.
`countForUser: false`인 관계(작업 대기열 등)는 세지 않는다 — 사용자에게 보고할 대상이 아니다.

### R-6. 기획·설계 단계에서 정한다 (사고 뒤가 아니라)

새 표를 만들 때 **마이그레이션과 같은 커밋에서** 계약에 추가한다.
"나중에 정리"는 없다 — 표가 하나 늘 때마다 구멍이 하나 늘어난 것이 지금까지의 구조다.

## 날짜·시간(datetime) 정합성 정책 (필수 — 위반 시 ±9시간 사고)

> **왜**: Supabase(UTC) timestamptz에 **오프셋 없는 naive 문자열**(`${date}T${time}:00`)을 저장하면 UTC로 적재되고, 표시 때 KST(+9) 변환으로 9시간 부풀려진다. (실제 사고: v0.7.273 이전 캘린더 13:00 입력→22:00 표시. v0.7.274에서 SSOT로 구조화)

**모든 datetime 처리는 `apps/web/lib/datetime/kst.ts`(SSOT)를 거친다.**
- **저장(WRITE)**: 폼의 KST 벽시계는 반드시 `kstWallToIso(date,time)`·`kstDateOnlyToIso(date)`로 **+09:00 앵커 ISO**를 만들어 저장(timestamptz가 UTC로 정확 적재). 외부(AI 등)가 만든 naive 문자열은 `normalizeKstWallString`로 수문.
- **표시·그룹핑·범위필터(READ)**: 항상 KST 변환 — `formatKstTime`·`kstDateKey`(달력 그룹핑)·`kstParts`·`kstTodayKey`("오늘")·`kstRangeToUtc`(범위 쿼리 경계)·`formatKstDateTimeShort`.
- **금지**: `${date}T${time}:00`(naive) DB 저장 / `iso.slice(11,16)` raw 시각 / `new Date(iso).getHours()·getDate()` 서버 산출 / `new Date().toISOString().slice(0,10)` "오늘" 산출.
- **가드**: `lib/datetime/kst.test.ts`(단위) + `lib/datetime/kst-guard.test.ts`(정적 스캔 — 우회 패턴 재유입 차단). 정말 필요한 예외만 같은 줄에 `// kst-ok`.

## 실제 렌더 경로 우선 수정 정책 (필수 — 위반 시 "고쳤는데 화면 그대로" 사고)

> **왜**: GPU 화면처럼 **구 컴포넌트와 신 컴포넌트가 공존**(feature flag·뷰스위처·`?tab=` 분기)하는 곳이 있다. 실제 사용자가 보는 건 **기본값 경로 하나뿐**인데, 다른(죽은) 경로를 고치면 검증은 통과해도 화면은 그대로다. (실제 사고: v0.7.173 GPU 장수 표기를 구 탭뷰 `PriceTableTab`에 적용 → 정작 기본 렌더는 `unified` 플래그 ON의 `UnifiedTableConnected`라 누락. v0.7.174에서 재수정)

**UI/표시 수정 착수 전, 코드를 손대기 전에 반드시:**
1. **실제 렌더 경로부터 확정**한다. 화면이 어느 컴포넌트로 그려지는지 분기 코드를 직접 읽어 확인 — feature flag 기본값(`feature-flags.ts`의 `DEFAULT_ON` 등), `?tab=`/라우트 분기, `dynamic()` 조건, 뷰스위처. **파일명이 "그럴듯하다"는 이유로 추정 금지.**
2. **현재 활성(기본값 ON) 경로를 먼저 고친다.** 그 다음, 같은 표시가 **플래그·분기로 도달 가능한 모든 공존 경로**(롤백용 구뷰 포함)에 동일 SSOT를 적용해 일관성을 맞춘다. 활성 경로만 고치고 구뷰를 방치해도 안 되고(롤백 시 회귀), 구뷰만 고쳐도 안 된다(사고 그 자체).
3. **검증은 실제 렌더 경로에서 한다.** 단위·tsc·design 통과만으로 "됐다" 금지 — 기본 플래그 상태의 실제 화면(브라우저 또는 활성 컴포넌트 기준)에서 변경이 보이는지 확인한다.
4. **표시 로직도 SSOT.** 같은 값을 여러 뷰가 렌더하면 표시 변환을 `lib/`의 공용 함수로 두고 모든 뷰가 import한다(예: `lib/gpu/card-memory.ts`). 뷰마다 인라인 포맷 복붙 금지 — 이게 "한 곳만 고쳐 누락"의 근본 원인.

## 디자인 시스템 정책 (필수 — 신규 화면/컴포넌트 작성 시 절대 준수)

**모든 디자인 값은 토큰을 거치고, 공용 컴포넌트를 우선 사용한다. 인라인 하드코딩 금지.**

### 0. 시스템 참조 순서 (필수 — 코드를 쓰기 전에 먼저 한다)

> **왜**: 이 정책이 "카드 → `NbCard`"라고 못 박아 놨는데 **`NbCard` 실사용은 0건**이고, 실제 그 일은 `.card` 클래스(196건)가 하고 있었다.
> 정책이 가리키는 목록과 현실이 달라서, 만드는 사람은 매번 **새로 만드는 쪽**을 택했다.
> 그 결과 v0.7.438 실측 기준 **로딩 부품 6종·탭 5종·표 4방식·빈상태 2벌·페이지헤더 2벌·정렬아이콘 2벌**이 동시에 살아 있었다.
> (v0.7.445에서 빈상태·오류·페이지헤더·정렬아이콘·탭은 1벌로 통일했다.
> **v0.7.477에서 표를 1벌로 모았다** — `NbTable`·`BulkActionBar`를 삭제하고 `ListSurface`가 전체선택까지 흡수했다.
> 페이지 헤더도 raw `<h1>` 0건으로 완전 통일했다. **로딩은 아직 혼재 5곳이 남아 있다.**)
> (전수 근거: `docs/2026-08-12-v0.7.438-ui-system-audit/01-AUDIT.md`)

**무엇을 만들지 정해지면, 코드를 쓰기 전에 반드시 이 순서를 따른다.**

1. **`docs/ui-system/INVENTORY.md`(부품)와 `docs/ui-system/GLOSSARY.md`(말)를 함께 연다**
   — 앞은 **무엇으로 그리는가**, 뒤는 **무엇이라고 부르는가**. 둘이 짝이어야 같은 제품이 된다(§0-2).
2. **동일 성격 부품이 있으면 그대로 쓴다.** 비슷한데 부족하면 **그 부품을 고쳐서** 쓴다. 새로 만들지 않는다.
3. **INVENTORY §1 "중복 경보"에 해당하는 성격이면**(로딩·탭·표·빈상태·헤더·상세표면·셸) **새로 만드는 것을 금지한다.** 통일 대상이 무엇인지 확인하고 그것을 쓴다.
4. **없으면 시스템에 먼저 정의한다** — 부품을 `components/ui/`에 만들고 → **INVENTORY.md에 등재**하고 → 그 다음 화면에서 쓴다.
5. **화면에만 존재하는 UI를 만들지 않는다.** 두 번째 사용처가 생기는 순간 이미 늦다.

**부품 실사용 확인은 반드시 export 이름 기준으로 한다:**
```bash
node docs/ui-system/scan-inventory.mjs          # 전체 사용량
node docs/ui-system/scan-inventory.mjs --dupes  # 같은 이름 2곳 export = 중복 구현
node docs/ui-system/scan-inventory.mjs --dead   # 사용 0건
```
> 파일명으로 세면 안 된다. `LoadingSkeleton.tsx`는 `SkelPage/SkelCard/SkelList`를 export하므로 `<LoadingSkeleton`으로 세면 **27건 쓰이는 부품이 0건으로 보인다.** 실제로 1차 조사가 이 오판을 했다.

### 0-1. 클래스 축과 컴포넌트 축 — 어느 쪽을 쓸지

newAX의 UI는 **두 축**이다. 둘 다 정상이며, **섞어서 재구현하지 않는다.**

| 축 | 무엇 | 규모/채택 | 언제 |
|---|---|---|---|
| **클래스** (`globals.css`) | `input-field` 247 · `label` 185 · `tape-title` 118 · `.card` 196 · `table-card` 70 · `responsive-grid-*` 61 | 9,710줄 / 규칙 1,550 / 토큰 123 | **순수 스타일(모양만)** |
| **컴포넌트** (`components/`) | `NbButton` 85 · `EmptyState` · `SkelPage` · `PageHeader` | 97파일 / 121심볼 | **상태·이벤트·조합이 붙을 때** |

1. 모양만이면 → **클래스.** 컴포넌트를 새로 만들지 않는다.
2. 상태·이벤트가 붙으면 → **컴포넌트.** 컴포넌트 **내부가** 클래스를 쓴다. 화면은 클래스를 직접 안 쓴다.
3. **화면 전용 스타일을 `globals.css`에 추가하지 않는다.** globals.css의 94%(약 1,350규칙)가 이미 화면 전용(`gpu-*` 505 · `ai-*` 142 · `cockpit-*` 116 · `ci-*` 112 …)이라 더 넣으면 계속 비대해진다. 새 도메인 스타일은 해당 폴더의 CSS Module.

### 0-2. 말의 축 — 용어집 (필수 — 화면에 한글 문자열을 직접 적지 않는다)

> **왜**: 부품을 통일해도 **말이 갈리면 다른 제품이다.**
> 실측(v0.7.597) — 같은 "데이터를 없앤다"를 `(member)`·`admin`·`(crm)`은 「삭제」 **16곳**,
> `(ci)`는 「지우기」 **5곳**으로 부른다. 사용자는 `(ci)`에서 「지우기」를 배우고 `(crm)`에서
> 「삭제」를 만나 **같은 일인지 확신하지 못해 손이 멈춘다.** 그런데 우리는 이걸 버그로 안 봐서
> **영원히 안 고쳐진다.** 회의노트 `STATUS_META`는 **세 화면이 글자까지 똑같이 복붙**돼 있고
> 오탈자(`작성중` — 공백 누락)까지 복제됐다. 라벨맵이 `app/**` 안에 **37개** 흩어져 있다.
>
> `INVENTORY.md`가 **무엇으로 그리는가**를 정한다면, 용어집은 **무엇이라고 부르는가**를 정한다.
> **둘이 짝이어야 같은 제품이 된다.**

| 층 | 어디 | 누가 보나 |
|---|---|---|
| **1층 사전** | `docs/ui-system/GLOSSARY.md` | **사람이 읽는다.** 화면 만들기 전에 여는 곳 |
| **2층 상수** | `apps/web/lib/terms/` — `action`·`entity`·`sentence`·`index` | **화면이 import한다** |
| **3층 가드** | `lib/ui/glossary.test.ts` + `scripts/.glossary-baseline.json` | 기계가 막는다 |

**규칙은 넷이다.**

1. **화면은 `@/lib/terms` 하나만 import한다.** 버튼·라벨·빈 상태·오류·확인 문구에
   **한글 문자열을 직접 적지 않는다.** 어느 파일에 무엇이 있는지 외울 필요 없다.
   ```ts
   import { ACTION, ENTITY, count, createLabel, progress, emptyTitle, failedTo, confirmDelete } from '@/lib/terms'
   ACTION.save            // '저장'   — 폼·모달 확정은 언제나 「저장」
   ACTION.disconnect      // '연결 해제' — 연동 끊기는 「삭제」가 아니다(데이터는 남는다)
   createLabel('딜')      // '새 딜'  — 「딜 만들기」·「추가」 금지
   progress('삭제')       // '삭제 중…' — 공백 + 말줄임표 둘 다 필수
   count('company', 372)  // '회사 372곳' — 조수사를 화면이 고르지 않는다
   ```
2. **없는 말이 필요하면 `lib/terms`에 먼저 추가하고 화면이 쓴다.** 화면에 먼저 적고 나중에
   올리는 순서는 없다 — 두 번째 화면이 쓰는 순간 복붙된다.
3. **조수사는 넷뿐** — **건**(사건·기록·문서) · **곳**(장소성) · **명**(사람) · **개**(설정·구조물).
   `ENTITY[key].counter`가 정한다. **받침은 여기 안 적는다** — `lib/ui/josa.ts`가 유니코드로 계산하므로
   표에 또 두면 두 벌이 되고 어긋난다(조사 `이/가`를 화면이 고르지 않게 —
   실제로 화면이 **21번 "API이(가)"**라고 말한 적이 있다).
4. **상태 라벨은 반드시 `StatusKey`에 매핑**한다(`lib/tokens/status-colors.ts`).
   그래야 **색이 자동으로 따라오고** 화면이 색을 정하지 않는다.
   표준 모양은 `lib/crm/ui/meeting-status.ts` — `Record<Key, { label, status }>` + `_ORDER`.

**금지어 — 새로 들여오지 않는다** (`BANNED_TERMS`에 이유와 함께 있다)

| 쓰지 않는 말 | 표준 | 왜 |
|---|---|---|
| ~~지우기~~ ~~제거~~ | **삭제** | 코드 식별자가 전부 `delete`다 |
| ~~등록~~ ~~적용~~(확정 버튼) | **저장** | 카드별 변형 금지(§2-5 (4)) |
| ~~추가~~ ~~{개체} 만들기~~ | **새 {개체}** | 「추가」는 무엇을 추가하는지 안 밝힌다 |
| ~~담당자~~ ~~연락처~~ | **인물** | 구 화면(`/contacts`) 잔재 |
| ~~영업기회~~ | **딜** | 구 화면(`/deals`) 잔재 |
| ~~업무~~(개체로) | **할 일** | 「업무」는 `(member)` **표면 이름**이라 충돌 |
| ~~콘텐츠~~(개체로) | **게시물** | 표면 이름(콘텐츠 인텔리전스)과 충돌 |
| ~~삭제중~~ ~~작성중~~ | **삭제 중…** | 공백·말줄임표 누락은 복붙이 복제한 오탈자 |
| ~~복구~~ ~~복원~~ | **되돌리기** | |
| ~~재시도~~ | **다시 시도** | |

**예외는 이유와 함께 적는다.** 미팅은 「새 미팅」이 아니라 **「미팅 기록」**이다(`MEETING_CAPTURE_LABEL`) —
만드는 행위가 아니라 **이미 일어나는 일을 받아적는 행위**라 뜻이 다르다.
적어 두지 않으면 다음 사람이 "일관성 없다"며 바꾼다.

**문형도 정해져 있다** (`sentence.ts`)

| 자리 | 문형 | 함수 |
|---|---|---|
| 빈 상태 | `{개체}가 아직 없어요` + **다음 행동 한 줄** | `emptyTitle(key)` |
| 오류 | `{무엇}을 하지 못했습니다.` + 다음 조치. **사과하지 않는다** | `failedTo(...)` |
| 삭제 확인 | `{개체} {N}{조수사}를 삭제할까요?` + **함께 사라지는 것** + **남는 것** | `confirmDelete(...)` |
| 근거 부족 | `아직 {무엇}이 부족해 말씀드리기 어려워요` — **숫자를 지어내지 않는다** | `notEnough(...)` |
| 섹션 제목 | **명사구.** 대화체·의문형 금지(~~「이 날 할 수 있는 것」~~ → 「미팅 기록」) | — |

**시각 포맷도 자리마다 정해져 있다** — 목록·카드 `formatKstDateTimeShort` / 같은 날 안 `formatKstTime` /
로그·감사 `formatKstDateTimeExact`(초까지) / 방금 `formatKstAgo`(24시간 이내만) / 그룹키·URL `kstDateKey`.

**이관은 점진적으로.** 비표준어 21곳을 한 커밋에 고치지 않는다 — 리뷰가 불가능하고 다중 세션과 충돌한다.
**상수를 쓰는 것이 먼저**이고, 기존 화면은 **다른 일로 그 화면을 건드릴 때 함께 이관**한다
(목록 표준 §2-6 (5)과 같은 방식). 새로 만드는 화면은 **처음부터 `@/lib/terms`만 쓴다 — 예외 없다.**

### 1. 디자인 토큰 사용 (globals.css `:root` 단일 소스 — SSOT)
신규 코드는 hex/치수 리터럴 대신 반드시 토큰 사용:
- 색: `var(--text|--text-muted|--text-faint|--brand|--accent|--surface-bg|--border-color|--border-light)`, 상태색 `var(--success|--danger|--warning|--info)`(+ `-bg`/`-border`)
- 보더 두께: `var(--border-w|--border-w-2|--hairline)` · 모서리: `var(--radius|--radius-lg)` · 그림자: `var(--shadow-sm|--shadow-md|--shadow-lg)`
- 간격: `var(--space-1..12)` · 폰트 크기: `var(--fs-xs..3xl)` · z-index: `var(--z-*)`
- 상태 색 객체는 `lib/tokens/status-colors.ts`(SSOT) import — 화면마다 색맵 복붙 금지
- **예외**: 차트 데이터 팔레트(api/), 원형(50%)·pill(9999px), 의도적 이질 액센트만

### 2. 공용 부품 우선 (재구현 금지) — **실사용 기준으로 정정됨(v0.7.439)**

> 아래 지정은 **실측 사용량 기준**이다. 예전 판은 `NbCard`(0건)·`NbField`(0건)를 지정해 현실과 어긋났고, 그게 "정책을 봐도 뭘 써야 할지 모르겠다"의 원인이었다.

| 무엇 | 쓸 것 | 실사용 | 쓰지 말 것 |
|---|---|---|---|
| 버튼 | `components/ui/nb/NbButton` | 85 | `<button style={{…}}` 자작(352건) |
| 카드 | **`className="card"`** (클래스) | 196 | ~~`NbCard`~~ (v0.7.445 삭제 — 0건이었다), 자작 박스(476건) |
| 입력·레이블 | **`input-field` / `label`** (클래스, §2-1) | 247 / 185 | ~~`NbField`/`NbInput`/`NbSelect`/`NbTextarea`~~ (v0.7.445 삭제 — 0건이었다) |
| 뱃지 | `NbBadge` | 10 | 인라인 pill 자작 |
| 표 | **`ListSurface`**(표/카드/조밀 한 벌 + 전체선택, 내부에서 `.table-card` 사용) | 28 | 화면에서 `<table>` 직접 작성(가드가 차단), 새 표 컴포넌트. ~~`NbTable`·`BulkActionBar`~~ (v0.7.477 삭제 — 이 둘은 화면 2개만을 위한 병렬 소계통이었다) |
| 목록 도구 | **`ListToolbar`**(검색·필터·정렬·보기·선택) + **`ListPager`** | 신설 | 화면마다 필터바·페이지네이션 자작 |
| 목록 상태 | **`useListQuery`** (URL이 진실) | 신설 | 로컬 `useState`로 검색·정렬 보관 |
| 빈 상태 | `components/ui/EmptyState` | 19 (v0.7.445 1벌 통합) | "없습니다" 문구 직접 렌더(188건) |
| 오류 | `components/ui/ErrorState` (v0.7.445 공용 승격) | 11 | 자작 오류 박스 |
| 로딩(골격) | `SkelPage` / `SkelCard` / `SkelList` (`components/ui/LoadingSkeleton.tsx`) | 11/9/7 | "불러오는 중" 문구 직접 렌더(37건) |
| 로딩(인라인 소형) | `AXDotLoader` | 35 | 자작 스피너 |
| 탭 | `components/ui/SegmentedTabs` (유일 렌더러) | 16 | 탭 마크업 자작. `WorkSubTabs`·`ProjectTabs`·`WorkTabBar`·`StageNav`는 v0.7.445부터 **데이터만 넘기는 어댑터** |
| 페이지 헤더 | `components/ui/PageHeader` | 29 (v0.7.445 CiPageHeader 흡수) | raw `<h1>` |
| 정렬 아이콘 | `components/ui/SortIcon` | 7화면 (v0.7.445 1벌 통합) | 화면마다 SortIcon 자작 |
| 모달 | `NbModal` + §2-2 체크리스트 | 5 | 처음부터 자작 |
| 리치텍스트 | `components/ui/RichText` | 11 | `dangerouslySetInnerHTML` 직접 |
| 레이아웃 | `MobileShell` (member/admin layout 자동 상속) | 3 | 새 셸 신설 |
| 페이지 패딩 | `page-inner` | — | 페이지별 폭 래퍼 |

- 같은 UI를 인라인으로 다시 만들지 말 것. 없으면 공용 부품으로 만들고 **INVENTORY.md에 등재**해 재사용.
- 목록 툴바·페이지네이션·표/카드는 v0.7.448에 **신설**했다 → `components/ui/list/*` + `lib/ui/use-list-query`. 목록 화면은 §2-6을 따른다.

### 2-1. 폼 입력·레이블 표준 클래스 강제 (필수 — 누락 시 브라우저 기본 렌더로 디자인 깨짐)
> **왜**: globals.css에는 `input/select/textarea` **전역 스타일이 없다.** 클래스 없는 날 태그는 100% 브라우저 UA 스타일로 렌더되어 통합 디자인에서 이탈한다. (실제 사고: v0.7.49 부서업무 모달이 `input-field` 누락으로 밋밋하게 렌더됨)
- 모든 `<input>`·`<select>`·`<textarea>` → 반드시 `className="input-field"` (정의: `globals.css:411`). raw 태그 금지.
- 모든 폼 `<label>` → 반드시 `className="label"` (정의: `globals.css:438`). `<span>` 날 라벨 금지.
- 레퍼런스(이 패턴 복사): `app/(member)/contacts/ContactForm.tsx`, `components/ui/PasswordChangeModal.tsx`.

### 2-2. 모달 작성 표준 (필수 체크리스트 — 기존 모달과 질감 통일)
신규 모달은 아래 5개 모두 충족 (레퍼런스: `app/(member)/calendar/EventModal.tsx`):
- (a) `useEscClose(onClose)` 임포트 (`lib/use-esc-close.ts`) — ESC 닫기
- (b) 헤더 우측 X 닫기 버튼 (`<X size={18}/>`)
- (c) 제목에 `className="tape-title"` (`globals.css:315`)
- (d) 카드 그림자 = inline `boxShadow: '0 20px 60px rgba(0,0,0,0.2)'` — **`.card` 클래스 단독 사용 금지**(`.card`의 `var(--shadow-md)`는 모달용 광원형 그림자와 다름)
- (e) backdrop = `rgba(15,23,42,0.5)` (기존 모달 통일값, `rgba(0,0,0,..)` 금지)

### 2-3-1. 상호작용 표준 (필수 — 모양이 같아도 **누르는 방식**이 다르면 다른 제품이다)

> **왜**: 지금까지 표준은 전부 "모양"만 봤다(색·부품·클래스). 그런데 사용자가 실제로 겪은 불일치는 행동이었다.
> (실제 지적: "행을 누르면 동작하는 게 왜 없지?" `/ci/inbox` · "상세를 눌러야 상세가 보이는 것도 이상한데?" `/ci/monitoring` ·
> "뒤로가기 버튼도 없고" `/ci/channels/[id]`. 실측 결과 상세 라우트 11곳이 **자작 ArrowLeft 5 · 우측 '목록으로' 1 · 아예 없음 5**로 갈려 있었다.)

**(1) 목록 행은 살아 있어야 한다.** 상세가 있는 목록에서 행 클릭은 상세를 연다.
- 라우트로 이동 → `ListSurface`의 `rowHref={(row) => '/경로'}` (제목 칸이 진짜 `<a>`가 되어 새 탭·우클릭·키보드가 전부 된다)
- 그 자리에서 열기(시트·드로어) → `onRowClick`
- **행이 열리면 '상세' 버튼을 따로 두지 않는다.** 두면 "행은 죽고 버튼만 사는" 상태로 되돌아간다.
- 행 안의 액션 칸(재시도·지켜보기·삭제)은 `onClick={(e) => e.stopPropagation()}`로 감싼다. 안 그러면 버튼을 눌렀는데 상세가 열린다.

**(2) 상세 화면에는 상위로 돌아갈 길이 항상 같은 자리에 있다.** `PageHeader`(또는 `WorkPageShell`)의 `back={{ href, label }}`.
- 제목 **왼쪽 위**가 유일한 자리다. 우측 상단 버튼·본문 안 링크로 만들지 않는다.
- 편집 화면도 상세로 돌아갈 `back`을 갖는다.
- 되돌아갈 목록이 없는 화면(공개 공유 링크 등)만 예외이며, 가드의 `NO_PARENT_LIST`에 **이유와 함께** 적는다.

**(3) 치수도 표준이다 — "같은 값인데 화면이 달라 보인다"의 실제 원인**
- **입력과 버튼은 같은 높이다.** `--control-h`(44px, 터치 최소치)를 `.input-field`·`.btn-primary`·`.btn-ghost`가 함께 쓴다.
  화면에서 `min-height: 44px`를 손으로 붙이지 않는다 — 안 붙인 화면만 어긋난다(실측: 입력 41 vs 버튼 39, 10px 밀림).
- **라벨이 붙은 컨트롤과 안 붙은 버튼이 한 줄에 서면 `align-items: flex-end`**. center면 라벨 높이만큼 밀린다.
- **표 행 안의 컨트롤 묶음은 접지 않는다**(`flexWrap: nowrap`). 접히면 **그 행만 커져** 목록 리듬이 깨진다
  (실측 /ci/inbox: 주제 칸이 접혀 79→87px, 작업 칸이 접혀 121px). 행 높이는 **콘텐츠**가 정하지 컨트롤이 정하지 않는다.
  — 긴 제목이 두 줄이 되는 건 정상이다. 컨트롤이 원인일 때만 문제다.
- 이 치수들은 정적 분석으로 안 보인다 → **`apps/web/e2e/ui-consistency.spec.ts`**(실제 렌더 치수)로 잡는다.

**(4) 가드**: `lib/ui/interaction-standard.test.ts` — ①상세의 back 누락 ②자작 뒤로가기(`ArrowLeft` 직접 렌더) ③행이 죽은 목록 ④액션 칸 전파 미차단.
전부 **위반 0에서 잠갔다**. 규칙은 부품이 이미 지원하는 것만 요구한다 — 화면은 상속만 하면 된다.

### 2-3-2. 자리의 축 — 무엇을 어느 쪽에 두는가 (필수)

> **왜**: 부품(§0)·말(§0-2)을 통일해도 **자리가 갈리면 다른 제품이다.**
> 실측(v0.7.599) — 같은 "회사에 속한 사람" 목록이 거래처 상세는 **왼쪽 넓은 칸**(`1fr`),
> CRM 회사 상세는 **오른쪽 좁은 칸**(`300px`)에 있었다. 둘 다 우리가 만든 화면인데
> **어느 쪽이 표준인지 정한 적이 없다.** 3열의 뜻은 `RecordLayout.tsx` **주석에만** 있었고,
> 주석은 새 화면을 만드는 사람이 열지 않는다 — 그래서 미팅 상세는 슬롯 뜻을 **정반대로** 채웠다.
> (사용자 지적: "속성이나 정보는 다 왼쪽으로, 해야 할거나 액션이 오른쪽으로 배치 되는 이런 기준이나
> 표준 정도는 따라야 하는거 아닌가? 회사에 속한 인물이 우측에 저렇게 배치하는게 맞아?")
>
> `INVENTORY`가 **무엇으로 그리는가**, `GLOSSARY`가 **무엇이라고 부르는가**를 정한다면
> 이 절은 **어디에 두는가**를 정한다. 셋이 모여야 한 제품이 된다.

| | 규칙 |
|---|---|
| **L-1** | **읽는 것은 왼쪽, 하는 것은 오른쪽.** 속성·관계·이력은 **정보 영역**, 입력 폼·생성 진입·상태 변경은 **행동 레일**. 한 열에 섞지 않는다 |
| **L-2** | **정보 영역 안의 순서는 고정** — 속성(무엇인가) → 관계(무엇과 이어졌나) → 이력(무슨 일이 있었나). 화면마다 바꾸지 않는다 |
| **L-3** | **사람은 관계가 아니라 연락 수단이다.** 회사 화면에 오는 이유의 대부분은 "누구에게 연락하지?"다. 인물은 속성 **바로 다음**, 스크롤 없이 보이게 |
| **L-4** | **폰에서는 행동이 먼저 온다.** 좁은 화면에서 행동 레일은 정보 **위**로 올라간다. 좌우를 그대로 상하로 접으면 제일 급한 것이 제일 아래로 간다 |
| **L-5** | **빈 칸은 자리를 차지하지 않는다.** 값이 전부 `—`인 패널이 고정 폭을 먹지 않게 한다 |
| **L-6** | **확정은 오른쪽 끝, 취소는 그 왼쪽.** 모달·폼 버튼 줄은 `justify-content: flex-end` + **취소 → 확정** 순 |
| **L-7** | **상세 화면의 뼈대는 하나다.** 표면(crm·member·ci)이 달라도 상세는 `RecordLayout` 한 벌을 쓴다 |

**부품이 강제한다 — 화면이 기억하지 않는다**

```tsx
<RecordLayout
  info={<>  {/* 왼쪽 · 넓음 — L-2 순서대로 */}
    <RecordPanel title="속성">…</RecordPanel>
    <RecordPanel title="인물 3명"><RelatedList … /></RecordPanel>   {/* L-3 */}
    <RecordPanel title="타임라인"><Timeline … /></RecordPanel>
  </>}
  actions={<>  {/* 오른쪽 · 좁음 — 할 수 있는 것만 */}
    <RecordPanel title="다음 할 일"><TaskPanel … /></RecordPanel>
  </>}
/>
```

- 폰에서 행동을 위로 올리는 것(L-4)은 **부품이 한다.** 화면은 순서를 신경 쓰지 않는다.
- **`fields`/`timeline`/`related` 3슬롯은 레거시**다. 새 화면은 쓰지 않는다.
  기존 화면은 **다른 일로 그 화면을 건드릴 때 함께 이관**한다(목록 표준 §2-6 (5)과 같은 방식).
- **행동이 서는 자리는 넷이고 뜻이 다르다** — 섞지 않는다:
  **행동 레일**(이 레코드에 대해 지금 할 일) · **제목 우측**(이 레코드 자체를 수정·삭제) ·
  **FAB**(어디서든 새로 만들기) · **Dock**(진행 중인 작업).

**가드**: `lib/ui/layout-standard.test.ts` — ①상세가 `RecordLayout` 외 뼈대 사용 ②정보 슬롯에 입력 폼·생성 버튼
③`max-width` 폭 클램프(§2-4) ④모달 버튼 줄이 `flex-end`가 아닌 것. **만든 뒤 일부러 깨서 확인한다.**

### 2-3. 페이지 헤더 표준 (필수 — 페이지마다 헤더 인라인 자작 시 갈라짐)
> **왜**: 공용 *페이지헤더* 컴포넌트가 없어 각 페이지가 헤더를 인라인 작성 → 토큰을 빠뜨리면 브라우저 기본 h1로 밋밋. (실제 사고: v0.7.52 부서업무 리스트 h1이 `style={{margin:0}}`만 있어 일일/주간과 달라 보임)
- 페이지 제목 `<h1>` raw 금지. 최소 `fontSize: var(--fs-2xl)` + `fontWeight: 700` + `letterSpacing: -0.03em` + `color: var(--text)` (기준: `weekly-report/page.tsx` 헤더).
- 권장: 공용 `components/ui/PageHeader.tsx`(title·desc·actions) 신설 → 모든 (member) 페이지 동일 사용. 만들면 §2 목록에 추가.
- 동일 성격 화면(일일/부서/주간)은 **반드시 동일 헤더·컨테이너 패턴 공유**.

### 2-3-3. 길의 축 — 어디로 들어가고 어디로 나가는가 (필수)

> **왜**: 부품(§0)·말(§0-2)·자리(§2-3-2)를 정해도 **길이 갈리면 다른 제품이다.**
> 실측(v0.7.609) — 서비스가 넷인데 들어가는 문이 **넷 다 달랐고** 나가는 문이 **셋 달랐다**:
> `영업 CRM`은 메인 메뉴에 있는데 `콘텐츠 인텔리전스`는 **없었고**(전체 메뉴로만 들어감),
> 나가는 문은 CI 만 사이드바 하단에 「사내 업무로」가 있고 계정 메뉴엔 「홈으로 나가기」가 **또** 있었다
> (둘 다 `/home` 으로 간다). 문구는 「사내 업무로」·「홈으로 나가기」·「멤버 화면으로」 **셋**이었다.
> 게다가 `/lead-intake` 가 사이드바에선 「프로젝트관리」, 전체 메뉴에선 「리드 인테이크」였다 —
> **같은 경로가 두 이름.** (사용자 지적 2026-08-27: "CRM은 메뉴에 배치하고 콘텐츠인텔리전스는
> 메뉴에만 있네? … 할려면 다 동일하게 표준화 해서 해야 한다고 했자나")

| | 규칙 |
|---|---|
| **N-1** | **서비스는 한 자리에서 들어간다.** 메인 사이드바 **「서비스」 그룹**에 하위 서비스를 전부 넣는다. 전체 메뉴는 **보조**이지 유일한 입구가 아니다 |
| **N-2** | **나가는 문은 한 벌, 한 문구.** 하위 서비스는 **사이드바 하단**에 나가는 문 하나. 문구는 `SERVICE_LABEL` 로 만든다. **계정 메뉴는 «내 계정»만** 다룬다 — 같은 곳으로 가는 문이 둘이면 다른 곳으로 읽힌다 |
| **N-3** | **그룹은 항목 2개 이상일 때만.** 하나짜리 그룹은 최상위로 올린다. 그룹 이름과 항목 이름이 같으면 그 그룹은 없앤다 |
| **N-4** | **같은 경로는 어디서든 같은 이름.** 사이드바와 전체 메뉴가 **같은 상수**(`lib/nav/menu.ts`)를 읽는다 |
| **N-5** | **워크스페이스 이름은 넷 다 보이거나 넷 다 안 보인다.** 한 서비스만 보여 주면 사용자는 그 서비스만 특별하다고 읽는다 |

**메뉴는 한 표에서 나온다** — `apps/web/lib/nav/menu.ts`

```ts
import { NAV_LABEL, SERVICE_NAV } from '@/lib/nav/menu'
NAV_LABEL['/lead-intake']   // '리드 인테이크' — 사이드바도 전체 메뉴도 이걸 읽는다
SERVICE_NAV                  // 「서비스」 그룹에 들어갈 하위 서비스 목록
```

- **경로 표는 `lib/nav/surface.ts` 하나뿐이다**(`serviceOf`). 화면이 `startsWith('/crm')` 같은 판정을 다시 하지 않는다.
- **그룹 필터가 권한을 겸하지 않는다.** 권한은 항목의 `adminOnly` 로 표시한다 —
  묶음과 권한을 같은 장치로 처리하면 **그룹을 풀 때 권한이 바뀐다**(실제로 그랬다).
- **가드**: `lib/ui/nav-standard.test.ts` — ①하위 서비스가 메인 메뉴에 없음 ②나가는 문 2벌
  ③1개짜리 그룹 ④같은 경로 다른 라벨. **만든 뒤 일부러 깨서 확인한다.**

### 2-4. 페이지 폭/컨테이너 표준 (필수 — 페이지마다 폭이 튀면 안 됨)
> **왜**: 일부 페이지만 `.daily-page`(max-width 1200)로 좁고 나머지(부서·주간)는 전체폭 → 탭/페이지 전환 시 콘텐츠 폭이 제각각. (실제 사고: v0.7.x 일일=1200폭, 부서·주간=전체폭)
- **전 페이지 full-width 반응형이 표준** — 폭 제한(max-width 클램프) 금지. 콘텐츠는 화면을 꽉 채우고 반응형으로 동작한다.
- 콘텐츠 폭·패딩은 **`MobileShell <main className="page-inner">` 한 곳에서만** 제어한다(SSOT). `page-content` 같은 폭 래퍼나 `daily-page` 같은 페이지전용 폭 클래스 금지.
- 폰트 크기는 `--fs-xs|sm|base|md|lg|xl|2xl|3xl`만. `--text-sm`·`--text-lg` 등 **미정의 토큰 금지**(폴백으로 우연히 작동해도 체계 이탈).

### 2-5. 동종 UI 통일 정책 (필수 — 위반 시 "만들 때마다 제각각"이 구조로 굳는다)
> **왜**: 같은 성격의 화면 요소를 매번 새로 그리면, 만드는 사람마다 용어·버튼·기능 구성이 달라진다.
> (실제 사고: v0.7.438 시스템 설정 — 같은 "외부 연동" 카드인데 **용어**가 삭제/연결 해제·헬스체크/연결 테스트·저장/테마 적용으로 갈리고, **버튼**이 파란 큰 버튼/텍스트 버튼/작은 아웃라인으로 갈리고, **기능**은 Claude·OpenAI에 `deleteClaudeKey`·`deleteOpenAiKey` 서버액션이 **있는데 UI가 호출을 안 해** 없는 기능처럼 보였다. 사용자 지적: "이런식으로 통일성이 없다면 우리 시스템은 뭘 만들 때마다 이럴 것".)

**원칙: 같은 종류의 UI는 골격·용어·기능 구성이 같아야 한다. 셋 중 하나라도 갈리면 사용자는 다른 기능이라고 읽는다.**

**(1) 새 화면 요소를 만들기 전 — 동종이 이미 있는지 먼저 본다**
- 있으면 그 공용 부품을 **쓴다**. 없으면 공용 부품으로 **만들고** 기존 것도 함께 이관한다. 한 화면에만 쓰는 인라인 복붙 금지.
- 현재 공용 부품: 연동/자격증명 카드 `app/admin/settings/integration-ui.tsx`(`IntegrationCard`·`IntegrationStatus`·`IntegrationTest`·`LABEL`) · 탭 `components/ui/SegmentedTabs` · 페이지 헤더 `components/ui/PageHeader` · 버튼/카드/뱃지 `components/ui/nb/*`.

**(2) 용어는 상수로 고정한다 — 화면에 문자열을 직접 적지 않는다**
- 같은 행위는 같은 말로. 연동 카드는 `LABEL` 상수만 쓴다: `연결됨` / `연결 안 됨` / `변경` / `연결 해제` / `연결 테스트` / `저장`.
- "삭제"는 **데이터를 지우는 행위**에만 쓴다. 연동 끊기는 `연결 해제`다(키만 지우는 것이지 수집한 데이터가 사라지지 않는다).

**(3) 기능 구성을 동종끼리 맞춘다 — "있고 없고"가 갈리면 안 된다**
- 연동 카드는 **연결 상태 · 변경 · 연결 해제 · 연결 테스트**를 전부 갖춘다.
- 서버액션이 이미 있는데 UI가 안 부르는 상태를 방치하지 않는다. 새 연동을 붙일 때 넷 중 빠진 게 있으면 **만들어서** 채운다.
- 정말 불가능한 것만 뺀다. 뺐으면 왜 없는지 화면에 밝힌다(없는 걸 있는 척도, 있는 걸 숨기지도 않는다).

**(4) 저장 방식 — 카드 단위 저장이 표준**
- 설정은 **카드마다 저장**한다. 탭 하단 일괄 저장 바를 두지 않는다. (각 카드가 독립된 외부 시스템이고, 저장 직후 연결 테스트로 검증해야 하며, 하나가 실패해도 나머지는 저장돼야 한다.)
- 저장 버튼 라벨은 언제나 `저장`. "테마 적용" 같은 카드별 변형 금지.

**(5) 배치 — 나란한 카드는 행 단위로 높이를 맞춘다**
- 카드 그리드는 `align-items: stretch`(`.settings-grid`). 열 균형(masonry)은 빈 공간이 적지만 카드 시작점이 어긋나 "사이즈가 안 맞는" 것처럼 보인다 — **정렬이 빈 공간보다 우선**이다.
- 늘어난 카드의 여백은 마지막 블록(연결 테스트·액션 줄)을 `margin-top:auto`로 바닥에 붙여 흡수한다.

**(6) 가드**: `lib/ui/integration-consistency.test.ts`가 정적 스캔으로 (2)(3) 위반을 차단한다. `pnpm design:check`는 hex/치수만 보므로 이 가드가 별도로 필요하다.

### 2-6. 목록 화면 표준 (필수 — 목록을 새로 그리지 않는다)

> **왜**: 목록 화면 40여 개가 검색·정렬·보기·페이지를 각자 `useState`로 들고 있었다.
> 그래서 **새로고침하면 조건이 날아가고**, 링크를 공유하면 받는 사람이 다른 화면을 봤다.
> 전수 검색 결과 `ListToolbar|Pagination|FilterBar|SortControl` **0건** — 여기만 신설이 정당했다(v0.7.448).

**(1) URL이 진실이다.** 검색어·정렬·필터·보기·페이지는 `useListQuery(defaults)`가 URL과 동기화한다.
화면은 값을 읽고 `set(patch)`만 부른다. 로컬 `useState`로 목록 조건을 들지 않는다.

**(2) 부품 3개 + 컬럼 1벌**
| 무엇 | 부품 |
|---|---|
| 상단 도구(검색·필터·정렬·보기전환·개수·선택 작업) | `components/ui/list/ListToolbar` |
| 본문(표/카드/조밀) | `components/ui/list/ListSurface` + `ColumnDef<T>` |
| 페이지 이동(`pages` 기본 / 피드형만 `more`) | `components/ui/list/ListPager` |

- 컬럼은 `ColumnDef` **한 벌**로 선언한다 — 표와 카드를 같은 정의로 그린다.
- 빈·오류·로딩 3상태는 `ListSurface`가 강제한다(EmptyState/ErrorState/SkelList). 화면이 다시 만들지 않는다.

**(3) 저장 범위**: `view`·`size`·`sort`만 `ui_preferences`(마이그 197)에 저장한다.
**필터·검색어는 저장하지 않는다** — 다음 방문에 조건이 살아 있으면 "왜 데이터가 없지?"가 된다.
우선순위는 **URL > 저장된 설정 > 화면 기본값**(공유 링크가 남의 설정에 덮이면 안 된다).

**(4) 성능 규약**: 기본 `size=20`·상한 100, 목록 조회는 **반드시 limit 포함**,
정렬·필터 변경은 **서버 재조회**(클라 재정렬 금지 — 페이지네이션과 어긋난다).

**(5) 가드**: `lib/ui/list-standard.test.ts`가 화면의 `<table>` 자작을 차단한다(ratchet).
표준 이전 화면은 PENDING에 있고, **그 화면을 기능 수정으로 건드리면 함께 이관하고 목록에서 지운다.**

---

## 디자인 시스템 정책 — AI 결과 표시 표준 (필수)
### 5-1. 텍스트 데이터 SSOT
- 사용자에게 보이는 본문은 **plain text가 기본**(daily_logs.content). 리치텍스트(HTML)는 Tiptap 쓰는 주간보고 등 한정.
- **HTML 텍스트를 AI 입력이나 다른 화면 인용으로 넘길 때는 반드시 `html→plain` 변환**. (사고: 주간보고 HTML이 AI 후보 source_quote로 그대로 흘러 `<br/>`가 글자로 노출됨)

### 5-2. 리치텍스트 렌더 공용화
- HTML 렌더는 공용 `RichText`(sanitize+렌더) 컴포넌트로 통일. 화면마다 `dangerouslySetInnerHTML` 직접 사용 금지(OrgWeeklyView/TeamReportView/WeeklyReportForm/ReportAccordion/AdminReports/DiffConfirmModal 모두 RichText 경유 — 신규 화면도 동일).
- 인용/요약 표시는 plain text(PlainQuote)로.

### 5-3. AI 결과 UI 패턴 표준
- **추출/제안형**(일일·부서 AI 후보): 후보를 "제목 + 신뢰도 + 근거(plain) + 체크박스" 리스트로 제시 → 사용자가 선택 → 일괄 반영. (자동 등록 금지)
- **생성형**(주간보고): AI 생성 → 미리보기/편집 → 저장.
- 신규 AI 기능은 위 두 패턴 중 하나를 **반드시 재사용**(제각각 UI 금지).

### 3. 테마 대응
- 색·치수를 토큰으로 쓰면 `[data-theme]` 전환에 자동 대응됨. 하드코딩하면 테마 전환에서 누락됨.
- 새 테마 추가: `globals.css [data-theme="id"]` 블록 1개 + `lib/themes.ts` 1줄. (테마별 필수 오버라이드 토큰 누락 주의)

### 3-1. 가격 콕핏·가독성 표준 (필수)
- **금액 폰트**: 콕핏/가격표의 모든 금액 표시는 `--fs-price`(≥18px, clamp 토큰) 사용. `--fs-sm` 이하로 금액 렌더 금지.
- **10px 미만 폰트 금지**: 어떤 요소도 10px 미만의 font-size 사용 금지 (읽기 불능). `--fs-2xs`(11px)가 최소.
- **설명문 → 툴팁·드로어**: 안내 문장은 ❓ 툴팁 또는 행 펼침 드로어에 넣고 테이블 상단·하단 설명 블록 금지.
- **콕핏 공용 클래스 사용**: `price-cockpit-*`, `cockpit-*` 클래스(globals.css SSOT)를 사용. 인라인 style로 재구현 금지.
- **가격 시그널 색**: `lib/tokens/status-colors.ts`의 `PRICE_SIGNAL_CLASS`/`DEVIATION_SIGNAL_CLASS` import — 컴포넌트 내 색맵 복붙 금지.

### 4. 강제 검증
- 커밋/PR 전 `pnpm design:check`(=`scripts/check-design-tokens.mjs`) 통과 필수. CI(`.github/workflows/design-guard.yml`)가 PR에서 자동 차단.
- **현재 design:check가 잡는 것**(v0.7.441 확장): ① hex 색 **즉시 차단** ② swr 모듈레벨 `mutate` **즉시 차단** ③ `rgba()` ④ 미정의 토큰(`var(--text-sm)` 등) ⑤ **raw `<input/select/textarea>`의 `input-field` 누락** ⑥ **z-index 하드코딩** ⑦ **이름색/3자리 hex** ⑧ **자작 버튼(`<button style={{`)·자작 카드 박스** ⑨ **자작 로딩·빈상태 문구** ⑩ **`globals.css`의 10px 미만 폰트** ⑪ **`globals.css`에 화면 전용 CSS 신규 추가** — ③~⑪은 ratchet.
- **ratchet은 v0.7.477부터 "개수" 기준이다.** 예전엔 `파일::유형` **키의 존재 여부**만 봐서, 이미 baseline에 있는 파일에는 같은 유형을 몇 개든 더 넣어도 통과했다(실측: `LoginForm.tsx`에 자작 버튼을 새로 넣었는데 초록). 기존 화면을 고칠 때가 실제로 코드가 늘어나는 자리라, **그 구멍이 곧 "표준이 안 지켜지는" 이유**였다. 지금은 `{키: 개수}`를 기록하고 **지금보다 늘면 차단**한다. 줄이면 baseline이 **자동으로 하향**되어(되돌리기 차단) 잔여는 단조 감소한다 — 줄어든 날엔 `scripts/.design-guard-baseline.json`도 함께 커밋한다.
- **상태 문구·이름색 판정은 `scripts/ui-phrases.mjs`(SSOT)** 를 화면 스캐너와 공유한다. 빈/로딩 문구는 **JSX 텍스트 노드일 때만** 자작으로 센다 — 줄 단위로 문구만 찾으면 `<EmptyState title="…없어요">` 같은 정상 사용까지 세어 숫자가 부풀고 완료 판정이 불가능해진다(실제로 4곳 → 22곳 오보고 사고).
- **스캔 루트**: `apps/web/app` + `apps/web/components`(.tsx) + **`apps/web/app/globals.css`**. 예전 판의 "globals.css를 안 본다"는 v0.7.441에서 해소됐다.
- **기존 UI 정적 가드**: `lib/ui/integration-consistency.test.ts`(연동 카드 일관성 §2-5) · `lib/ui/shell-contract.test.ts`(셸 계약·PublicSurface 면제) · `lib/ui/dock-exclusive.test.ts`(우측하단 Dock 독점) · `lib/ui/duplicate-component.test.ts`(같은 이름 2곳 export 차단) · `lib/ui/list-standard.test.ts`(목록 표준 + raw `<table>` — app·components 모두 스캔) · **`lib/ui/screen-standard.test.ts`(v0.7.477 신설: raw `<h1>` 금지 §2-3 · `role="tab"` 자작 금지 · 대화상자 ESC 닫기 §2-2)** · `lib/work/mobile-layout-guard.test.ts`(업무 화면 모바일). 스캔 공용 모듈은 `lib/ui/component-scan.ts`. 새 가드는 **이것들 옆에 추가**하고 `design:check`를 확장한다. 병렬 시스템을 새로 만들지 않는다.
- **⚠️ 새 `*.test.ts`는 `apps/web/package.json`의 `test` 목록(수기, 현재 175개)에 반드시 등재**한다. 등재 안 하면 `pnpm test`가 그 가드를 돌리지 않는다.
- **가드는 만든 뒤 일부러 깨서 실패를 확인**한다. (v0.7.438에서 1차 가드가 부분문자열 매칭이라 위반을 통과시킨 전례)

### 4-1. 신규 화면 착수 체크리스트 (전부 충족해야 코드 시작)

- [ ] `docs/ui-system/INVENTORY.md`를 열어 **동일 성격 부품이 없음을 확인**했는가 (§0)
- [ ] 중복 경보 성격(로딩·탭·표·빈상태·헤더·상세표면·셸)이면 **통일 대상을 썼는가**
- [ ] 레이아웃은 `MobileShell`을 상속받는가 (새 셸 신설 금지)
- [ ] 페이지 제목은 `PageHeader`인가 (raw `<h1>` 금지, §2-3)
- [ ] 폼은 `input-field`·`label`인가 (§2-1) · 모달은 `useEscClose`·`tape-title`인가 (§2-2)
- [ ] 목록형이면 `ListToolbar`/`ListSurface`/`ListPager` + `useListQuery`인가 (§2-6)
- [ ] 표는 `.table-card`인가 (가로 스크롤 금지) — `ListSurface`가 내부에서 쓴다
- [ ] 빈·로딩·오류 3상태를 **기존 부품**(`EmptyState`/`SkelList`/`AXDotLoader`/`ErrorState`)으로 처리했는가
- [ ] 색·폰트·z-index를 **토큰으로만** 썼는가 (10px 미만 폰트 금지)
- [ ] 화면 전용 CSS를 `globals.css`에 추가하지 **않았는가** (§0-1)
- [ ] 하위 서비스면 메인 사이드바 **「서비스」 그룹**에 등재했는가 · 나가는 문이 **한 벌**인가 (§2-3-3 N-1·N-2)
- [ ] 메뉴 라벨을 **`lib/nav/menu.ts`**에서 가져왔는가 (사이드바·전체메뉴 같은 이름, N-4)
- [ ] 상세면 `RecordLayout`의 **`info`/`actions`** 슬롯인가 — 읽는 것 왼쪽·하는 것 오른쪽 (§2-3-2 L-1)
- [ ] 정보 순서가 **속성 → 관계 → 이력**인가 · 인물이 속성 바로 다음인가 (L-2·L-3)
- [ ] 모달 버튼 줄이 `flex-end` + **취소 → 확정** 순인가 (L-6)
- [ ] 버튼·라벨·빈상태·오류 문구를 **`@/lib/terms`에서 가져왔는가** (화면에 한글 문자열 직접 금지, §0-2)
- [ ] 개수 표기를 `count(entity, n)`으로 했는가 (조수사를 화면이 고르지 않는다)
- [ ] 새 말을 만들었다면 **`lib/terms`에 먼저 추가**하고 용어집에 등재했는가
- [ ] 새 부품을 만들었다면 **INVENTORY.md에 등재**했는가

> **면제**: 셸 밖 공개·인증 화면 4개(`/login` · `/change-password` · `/develop` · `/api-access`)는 **사이드바·전역검색·계정메뉴 계약만 면제**된다. 토큰·폼 클래스·프리미티브·모달 표준은 **동일하게 적용**된다. 특히 `/develop`·`/api-access`는 **로그인 없이 외부인이 보는 화면**이라 예외를 주지 않는다.

## 기술 스택
- Next.js 14+ (App Router)
- Tailwind CSS + globals.css 유틸 + 디자인 토큰(SSOT)
- Supabase (Auth + DB)
- TypeScript

## 버전
v0.7.623

## 버전 업데이트 체크리스트 (필수 — 누락 시 UI 버전 불일치 발생)

### 0. 커밋 전 버전 확정 (꼬임 방지 — 절대 생략 불가)

```bash
# 반드시 이 명령으로 최근 커밋의 버전을 확인 후 결정
git log --oneline -5
```

- 최근 커밋 메시지의 `v{X}.{Y}.{Z}` 중 **가장 높은 버전**을 찾는다
- 다음 버전 = max(package.json 버전, 최근 커밋 버전) + PATCH 1
- 예: 최근 커밋이 `v0.4.9`이고 package.json도 `0.4.9`라면 → 다음은 `v0.4.10`
- **절대 금지**: git log 확인 없이 package.json만 보고 버전 결정 (버전 충돌 원인)

### 1. 파일 업데이트 (순서대로)

1. `/package.json` — `"version"` 필드 ← **단일 소스 (next.config.js가 여기서 자동 주입)**
2. `/apps/web/package.json` — `"version"` 필드 (monorepo 동기화)
3. `CLAUDE.md` (이 파일) — `## 버전` 라인
4. `AGENTS.md` — `## 버전` 라인 (Codex 정책 파일 동기화)
5. `GEMINI.md` — `## 버전` 라인 (Gemini 정책 파일 동기화)
6. `apps/web/lib/changelog/entries.ts` — **사용자 체감 변경이 있으면** `CHANGELOG` 맨 위에 이번 버전 블록 추가 (§2 참조. 어드민/내부 전용 변경만이면 생략).

> ⚠️ **정책 파일 3개를 전부 올린다.** 예전에는 파일마다 목록이 서로 달라(`CLAUDE.md`는 자기+AGENTS를, `AGENTS.md`·`GEMINI.md`는 GEMINI+AGENTS를 지목) **아무도 3개를 다 올리지 않았다.** 그 결과 `GEMINI.md`가 **53패치 뒤처졌다**(v0.7.423 vs 실제 v0.7.476).

> **왜 중요한가**: `apps/web/next.config.js:2`가 `require('../../package.json').version`을 읽어
> 빌드 타임에 `NEXT_PUBLIC_APP_VERSION`으로 주입한다.
> 사이드바(`MobileShell.tsx:261`)는 이 env var를 표시한다.
> **루트 `package.json`이 단일 소스** — `.env.local`로 재정의하지 말 것.

패치 버전(3rd)은 `0`부터 `999`까지 입력 가능하다. 999 초과 시 MINOR(2nd)를 1 올리고 PATCH는 0으로 리셋한다.

### 2. 사용자향 업데이트 내역 (changelog) — 버전 올릴 때 **직접 기록** (주 경로)

`apps/web/lib/changelog/entries.ts` = "사용자에게 보내는 친절한 편지"(개발자 git log와 분리). **버전을 올리는 커밋에 사용자 체감 변경이 있으면, 작업자(Claude/Codex/Gemini)가 그 자리에서 `CHANGELOG` 배열 맨 위에 해당 버전 블록 1개를 직접 추가한다.** 외부 LLM 호출·CI·시크릿 불필요 — 작업자 본인이 무엇을 바꿨는지 알고 직접 친절어로 쓴다.

- **형식**: `{ version: '0.7.x', date: 'YYYY-MM-DD', title, items: [{ kind: 'feature'|'fix'|'improve', emoji, headline, detail }] }`. 최신이 위. `LATEST_CHANGELOG_VERSION`이 배열에서 파생되므로 **새 블록만 넣으면 사용자 "새로운 소식" 알림**(`MobileShell`→`ChangelogModal`)이 자동으로 뜬다(별도 배선 불필요).
- **판정**: "로그인한 일반 사용자가 화면에서 직접 체감하나?" 예=포함(친절어), 아니오=제외. 포함 ✅ 새 기능·사용자 겪던 버그·눈에 보이는 개선 / 제외 ❌ **어드민 전용**·백엔드/DB/인프라·리팩터/테스트/CI·버전범프.
- **보조(폴백, 없어도 됨)**: `.github/workflows/changelog-gen.yml`이 main push 시 Gemini 자동 생성도 시도(키: DB `org_content` META `gemini_api_key` 또는 `GEMINI_API_KEY`/Supabase 시크릿). **주 기록은 버전업 커밋에서 직접 하는 것** — CI는 있으면 보강, 없거나 실패해도 changelog는 유지된다. 수동 백필/미리보기: `pnpm changelog:gen [--dry-run]`.
