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

## Git 커밋 규칙

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
- **현재 공용 모듈(예시)**: `lib/gpu/dedup.ts`(추출 중복제거 — 추출·저장 전 경로), `lib/gpu/tier-dict.ts`(tier 판정), `lib/gpu/normalize.ts`(메모리 정규화), `lib/gpu/extract-helpers.ts`(스키마/스펙/스트리밍), DB `infer_tier()`·`get_schema_digest()`. 동일 성격 작업은 여기에 추가하거나 재사용한다.

## 실제 렌더 경로 우선 수정 정책 (필수 — 위반 시 "고쳤는데 화면 그대로" 사고)

> **왜**: GPU 화면처럼 **구 컴포넌트와 신 컴포넌트가 공존**(feature flag·뷰스위처·`?tab=` 분기)하는 곳이 있다. 실제 사용자가 보는 건 **기본값 경로 하나뿐**인데, 다른(죽은) 경로를 고치면 검증은 통과해도 화면은 그대로다. (실제 사고: v0.7.173 GPU 장수 표기를 구 탭뷰 `PriceTableTab`에 적용 → 정작 기본 렌더는 `unified` 플래그 ON의 `UnifiedTableConnected`라 누락. v0.7.174에서 재수정)

**UI/표시 수정 착수 전, 코드를 손대기 전에 반드시:**
1. **실제 렌더 경로부터 확정**한다. 화면이 어느 컴포넌트로 그려지는지 분기 코드를 직접 읽어 확인 — feature flag 기본값(`feature-flags.ts`의 `DEFAULT_ON` 등), `?tab=`/라우트 분기, `dynamic()` 조건, 뷰스위처. **파일명이 "그럴듯하다"는 이유로 추정 금지.**
2. **현재 활성(기본값 ON) 경로를 먼저 고친다.** 그 다음, 같은 표시가 **플래그·분기로 도달 가능한 모든 공존 경로**(롤백용 구뷰 포함)에 동일 SSOT를 적용해 일관성을 맞춘다. 활성 경로만 고치고 구뷰를 방치해도 안 되고(롤백 시 회귀), 구뷰만 고쳐도 안 된다(사고 그 자체).
3. **검증은 실제 렌더 경로에서 한다.** 단위·tsc·design 통과만으로 "됐다" 금지 — 기본 플래그 상태의 실제 화면(브라우저 또는 활성 컴포넌트 기준)에서 변경이 보이는지 확인한다.
4. **표시 로직도 SSOT.** 같은 값을 여러 뷰가 렌더하면 표시 변환을 `lib/`의 공용 함수로 두고 모든 뷰가 import한다(예: `lib/gpu/card-memory.ts`). 뷰마다 인라인 포맷 복붙 금지 — 이게 "한 곳만 고쳐 누락"의 근본 원인.

## 디자인 시스템 정책 (필수 — 신규 화면/컴포넌트 작성 시 절대 준수)

**모든 디자인 값은 토큰을 거치고, 공용 컴포넌트를 우선 사용한다. 인라인 하드코딩 금지.**

### 1. 디자인 토큰 사용 (globals.css `:root` 단일 소스 — SSOT)
신규 코드는 hex/치수 리터럴 대신 반드시 토큰 사용:
- 색: `var(--text|--text-muted|--text-faint|--brand|--accent|--surface-bg|--border-color|--border-light)`, 상태색 `var(--success|--danger|--warning|--info)`(+ `-bg`/`-border`)
- 보더 두께: `var(--border-w|--border-w-2|--hairline)` · 모서리: `var(--radius|--radius-lg)` · 그림자: `var(--shadow-sm|--shadow-md|--shadow-lg)`
- 간격: `var(--space-1..12)` · 폰트 크기: `var(--fs-xs..3xl)` · z-index: `var(--z-*)`
- 상태 색 객체는 `lib/tokens/status-colors.ts`(SSOT) import — 화면마다 색맵 복붙 금지
- **예외**: 차트 데이터 팔레트(api/), 원형(50%)·pill(9999px), 의도적 이질 액센트만

### 2. 공용 컴포넌트 우선 (재구현 금지)
- 버튼 → `components/ui/nb/NbButton`, 카드 → `NbCard`, 뱃지 → `NbBadge`
- 레이아웃 → `MobileShell`(member/admin layout 자동 상속), 페이지 패딩 → `page-inner`
- 같은 UI를 인라인으로 다시 만들지 말 것. 없으면 공용 컴포넌트로 만들어 재사용.

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

### 2-3. 페이지 헤더 표준 (필수 — 페이지마다 헤더 인라인 자작 시 갈라짐)
> **왜**: 공용 *페이지헤더* 컴포넌트가 없어 각 페이지가 헤더를 인라인 작성 → 토큰을 빠뜨리면 브라우저 기본 h1로 밋밋. (실제 사고: v0.7.52 부서업무 리스트 h1이 `style={{margin:0}}`만 있어 일일/주간과 달라 보임)
- 페이지 제목 `<h1>` raw 금지. 최소 `fontSize: var(--fs-2xl)` + `fontWeight: 700` + `letterSpacing: -0.03em` + `color: var(--text)` (기준: `weekly-report/page.tsx` 헤더).
- 권장: 공용 `components/ui/PageHeader.tsx`(title·desc·actions) 신설 → 모든 (member) 페이지 동일 사용. 만들면 §2 목록에 추가.
- 동일 성격 화면(일일/부서/주간)은 **반드시 동일 헤더·컨테이너 패턴 공유**.

### 2-4. 페이지 폭/컨테이너 표준 (필수 — 페이지마다 폭이 튀면 안 됨)
> **왜**: 일부 페이지만 `.daily-page`(max-width 1200)로 좁고 나머지(부서·주간)는 전체폭 → 탭/페이지 전환 시 콘텐츠 폭이 제각각. (실제 사고: v0.7.x 일일=1200폭, 부서·주간=전체폭)
- **전 페이지 full-width 반응형이 표준** — 폭 제한(max-width 클램프) 금지. 콘텐츠는 화면을 꽉 채우고 반응형으로 동작한다.
- 콘텐츠 폭·패딩은 **`MobileShell <main className="page-inner">` 한 곳에서만** 제어한다(SSOT). `page-content` 같은 폭 래퍼나 `daily-page` 같은 페이지전용 폭 클래스 금지.
- 폰트 크기는 `--fs-xs|sm|base|md|lg|xl|2xl|3xl`만. `--text-sm`·`--text-lg` 등 **미정의 토큰 금지**(폴백으로 우연히 작동해도 체계 이탈).

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
- **⚠️ design:check 사각지대**: 현재 가드는 **hex 색/치수 하드코딩만** 검사한다. `input-field`/`label`/`tape-title` **클래스 누락·공용 컴포넌트 미재사용은 탐지 못 함**(통과해도 디자인 깨질 수 있음). → 폼/모달 작성 시 §2-1·§2-2를 **눈으로 대조**하거나, 가드에 `<input(?!.*className)` 류 패턴 탐지를 추가할 것.

## 기술 스택
- Next.js 14+ (App Router)
- Tailwind CSS + globals.css 유틸 + 디자인 토큰(SSOT)
- Supabase (Auth + DB)
- TypeScript

## 버전
v0.7.256

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

> **왜 중요한가**: `apps/web/next.config.js:2`가 `require('../../package.json').version`을 읽어
> 빌드 타임에 `NEXT_PUBLIC_APP_VERSION`으로 주입한다.
> 사이드바(`MobileShell.tsx:261`)는 이 env var를 표시한다.
> **루트 `package.json`이 단일 소스** — `.env.local`로 재정의하지 말 것.

패치 버전(3rd)은 `0`부터 `999`까지 입력 가능하다. 999 초과 시 MINOR(2nd)를 1 올리고 PATCH는 0으로 리셋한다.

### 2. 사용자향 업데이트 내역 — CI 자동 (수기 금지)

`apps/web/lib/changelog/entries.ts`(사용자향 changelog)는 **수기로 채우지 않는다.** main 푸시 시 `.github/workflows/changelog-gen.yml`이 비동기로 `apps/web/scripts/changelog-gen.mjs`를 실행 → git log를 읽어 Gemini가 사용자 체감 변경만 선별·친절어로 작성 → entries.ts에 `[skip changelog]` 커밋백(배포=게시). 키는 앱과 동일하게 DB `org_content`(META).gemini_api_key를 서비스롤로 조회(env 폴백). 수동 백필/미리보기는 `pnpm changelog:gen [--dry-run]`. CI 시크릿: `NEXT_PUBLIC_SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`(gcube와 공용).
