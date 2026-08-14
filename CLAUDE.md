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

### 커밋 범위 정책 (필수 — 작업 공간은 항상 공유된다고 가정한다)

> **왜**: 같은 저장소에서 여러 작업이 동시에 진행된다(다른 도구·다른 창·자동 루프). 작업 트리에 내가 만들지 않은 변경이 섞여 있는 건 **정상 상태**다. 그걸 사고로 취급해 보고하거나, 통째로 커밋에 쓸어 담으면 남의 작업을 망친다.

- **내가 바꾼 파일만 경로로 지정해 스테이징한다.** `git add -A` · `git add .` · `git commit -a` **금지**.
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
> (v0.7.445에서 빈상태·오류·페이지헤더·정렬아이콘·탭은 1벌로 통일했다. **표 4방식과 로딩 5종은 아직 남아 있다.**)
> (전수 근거: `docs/2026-08-12-v0.7.438-ui-system-audit/01-AUDIT.md`)

**무엇을 만들지 정해지면, 코드를 쓰기 전에 반드시 이 순서를 따른다.**

1. **`docs/ui-system/INVENTORY.md`를 연다** — UI 부품 121심볼 전수 색인(SSOT).
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
| 표 | **`ListSurface`**(표/카드/조밀 한 벌, 내부에서 `.table-card` 사용) | 신설 | 화면에서 `<table>` 직접 작성(가드가 차단), 새 표 컴포넌트 |
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
- **현재 design:check가 잡는 것**(v0.7.441 확장): ① hex 색 **즉시 차단** ② swr 모듈레벨 `mutate` **즉시 차단** ③ `rgba()` ④ 미정의 토큰(`var(--text-sm)` 등) ⑤ **raw `<input/select/textarea>`의 `input-field` 누락** ⑥ **z-index 하드코딩** ⑦ **이름색/3자리 hex(`'white'`·`#fff`)** ⑧ **자작 버튼(`<button style={{`)·자작 카드 박스** ⑨ **자작 로딩·빈상태 문구** ⑩ **`globals.css`의 10px 미만 폰트** ⑪ **`globals.css`에 화면 전용 CSS 신규 추가** — ③~⑪은 ratchet(baseline 동결, **신규 유입만 차단**).
- **스캔 루트**: `apps/web/app` + `apps/web/components`(.tsx) + **`apps/web/app/globals.css`**. 예전 판의 "globals.css를 안 본다"는 v0.7.441에서 해소됐다.
- **기존 UI 정적 가드**: `lib/ui/integration-consistency.test.ts`(연동 카드 일관성 §2-5) · `lib/ui/shell-contract.test.ts`(셸 계약·PublicSurface 면제) · `lib/ui/dock-exclusive.test.ts`(우측하단 Dock 독점) · `lib/ui/duplicate-component.test.ts`(같은 이름 2곳 export 차단) · `lib/work/mobile-layout-guard.test.ts`(업무 화면 모바일). 스캔 공용 모듈은 `lib/ui/component-scan.ts`. 새 가드는 **이것들 옆에 추가**하고 `design:check`를 확장한다. 병렬 시스템을 새로 만들지 않는다.
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
- [ ] 새 부품을 만들었다면 **INVENTORY.md에 등재**했는가

> **면제**: 셸 밖 공개·인증 화면 4개(`/login` · `/change-password` · `/develop` · `/api-access`)는 **사이드바·전역검색·계정메뉴 계약만 면제**된다. 토큰·폼 클래스·프리미티브·모달 표준은 **동일하게 적용**된다. 특히 `/develop`·`/api-access`는 **로그인 없이 외부인이 보는 화면**이라 예외를 주지 않는다.

## 기술 스택
- Next.js 14+ (App Router)
- Tailwind CSS + globals.css 유틸 + 디자인 토큰(SSOT)
- Supabase (Auth + DB)
- TypeScript

## 버전
v0.7.460

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
5. `apps/web/lib/changelog/entries.ts` — **사용자 체감 변경이 있으면** `CHANGELOG` 맨 위에 이번 버전 블록 추가 (§2 참조. 어드민/내부 전용 변경만이면 생략).

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
