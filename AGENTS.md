# newAX 프로젝트 코딩 정책 (Codex)

> 이 파일은 Codex CLI가 읽는 정책 메모리입니다.
> `GEMINI.md`의 핵심 정책을 공유하며, Codex 전용 추가 컨벤션을 포함합니다.

## 기술 스택

- Next.js 14+ (App Router)
- Tailwind CSS + `globals.css` 유틸 클래스
- Supabase (Auth + DB)
- TypeScript

## 버전
v0.7.468

버전 변경 시 아래 **모든** 항목을 반드시 업데이트한다:

1. `/package.json` — `"version"` 필드 ← 단일 소스 (`next.config.js`가 자동 주입)
2. `/apps/web/package.json` — `"version"` 필드 (monorepo 동기화)
3. `GEMINI.md` — `## 버전` 라인
4. `AGENTS.md` (이 파일) — `## 버전` 라인
5. `apps/web/lib/changelog/entries.ts` — **사용자 체감 변경이 있으면** `CHANGELOG` 맨 위에 이번 버전 블록 추가 (아래 changelog 항목 참조)

> `apps/web/next.config.js:2`가 `require('../../package.json').version`을 읽어
> 빌드 타임에 `NEXT_PUBLIC_APP_VERSION`으로 주입한다.
> 사이드바(`MobileShell.tsx:261`)는 이 env var를 표시한다.
> **루트 `package.json`이 단일 소스** — `.env.local`로 재정의하지 말 것.

### 사용자향 업데이트 내역 (changelog) — 버전 올릴 때 직접 기록

`apps/web/lib/changelog/entries.ts` = 사용자향 changelog. **버전을 올리는 커밋에 사용자 체감 변경이 있으면 작업자가 `CHANGELOG` 배열 맨 위에 이번 버전 블록을 직접 추가**한다(외부 LLM·CI 불필요 — 본인이 무엇을 바꿨는지 알고 직접 친절어로 쓴다). 형식: `{ version, date, title, items:[{ kind:'feature'|'fix'|'improve', emoji, headline, detail }] }`. 새 블록만 넣으면 사용자 "새로운 소식" 알림이 자동으로 뜬다. 포함=사용자 체감 변경만(**어드민/백엔드/내부 제외**), 톤=친절한 비즈니스 언어. (CI 폴백: `.github/workflows/changelog-gen.yml` — 없거나 실패해도 changelog 유지.)

---

## Git 커밋 규칙 (필수)

### 커밋 범위 (필수 — 작업 공간은 항상 공유된다고 가정)

> **왜**: 같은 저장소에서 여러 작업이 동시에 진행된다. 작업 트리에 내가 만들지 않은 변경이 있는 건 **정상**이다. 사고로 취급해 보고하거나 통째로 담으면 남의 작업을 망친다.

- **내가 바꾼 파일만 경로 지정 스테이징.** `git add -A` · `git add .` · `git commit -a` **금지**
- 내 것이 아닌 변경은 **건드리지도·되돌리지도·보고하지도 않는다**
- **주제가 다르면 커밋을 나눈다** (문서·정책 / 기능 코드 / 마이그레이션)
- **검증은 내 변경 범위로 판정.** 내 변경 밖 파일의 tsc/lint/test 오류는 손대지 않고 내 범위만 본다
- 커밋 후 남는 다른 변경은 **그대로 둔다**

### 형식

```
v{버전}: {변경 내용} codex
```

**규칙:**
- 커밋 메시지 **제목줄 맨 마지막**에 반드시 소문자 `codex` 추가 (공백 1칸 후)
- 버전은 `package.json`의 현재 버전 사용
- `Co-Authored-By` 트레일러는 커밋 본문 영역에 별도 유지 (본 규칙과 무관)

**예외:** merge / revert 커밋은 Git 자동 생성 메시지 그대로 사용 — `codex` 불요

**예시:**
```bash
# ✅ 올바른 예
git commit -m "v0.4.6: 거래처 목록 검색 필터 추가 codex"
git commit -m "v0.4.6: 모바일 카드 레이아웃 버그 수정 codex"

# ❌ 금지
git commit -m "v0.4.6: 거래처 목록 검색 필터 추가"        # codex 누락
git commit -m "v0.4.6: 거래처 목록 검색 필터 추가 Codex"  # 대문자 금지
git commit -m "codex v0.4.6: 거래처 목록 검색 필터 추가"  # 위치 오류
```

---

## 재사용·단일구현 정책 (필수 — 위반 시 회귀/정합성 오염)

**같은 처리가 여러 곳에 필요하면 새로 짜지 말고 단일 구현(SSOT)을 만들어 import해 재사용한다.**

- 설계부터 재사용 우선: 새 기능 전, 유관 시스템에 동일/유사 처리가 있으면 그 모듈을 재사용. 없으면 `lib/`에 공용 모듈로 만들고 모든 호출처가 import.
- 한 곳 수정 = 전체 반영: 로직(중복제거·정규화·tier판정·매핑·환산 등)은 한 파일에 두고 각 라우트/컴포넌트는 호출만. 복붙 금지.
- 신규 라우트/화면 추가 시 "이 처리, 다른 곳에도 동일하게 들어가야 하나?" 점검 필수 — 예면 공용 모듈로 적용.
- 공용 모듈 예: `lib/gpu/dedup.ts`(추출 중복제거), `lib/gpu/tier-dict.ts`, `lib/gpu/normalize.ts`, `lib/gpu/extract-helpers.ts`, DB `infer_tier()`·`get_schema_digest()`.

## 실제 렌더 경로 우선 수정 정책 (필수 — 위반 시 "고쳤는데 화면 그대로" 사고)

> **왜**: 구/신 컴포넌트가 공존(feature flag·뷰스위처·`?tab=` 분기)하는 화면이 있다. 사용자가 보는 건 기본값 경로 하나뿐인데 다른(죽은) 경로를 고치면 검증은 통과해도 화면은 그대로다. (사고: v0.7.173 GPU 장수 표기를 구 탭뷰 `PriceTableTab`에 적용 → 기본 렌더는 `unified` 플래그 ON의 `UnifiedTableConnected`라 누락 → v0.7.174 재수정)

UI/표시 수정 착수 전, 코드 손대기 전에 반드시:
1. **실제 렌더 경로 확정** — 분기 코드를 직접 읽어 확인(feature flag `DEFAULT_ON`, `?tab=`/라우트 분기, `dynamic()` 조건, 뷰스위처). 파일명이 그럴듯하다는 이유로 추정 금지.
2. **활성(기본 ON) 경로 먼저 수정** → 이어서 플래그·분기로 도달 가능한 **모든 공존 경로(롤백용 구뷰 포함)**에 동일 SSOT 적용. 활성만 고쳐 구뷰 방치(롤백 회귀)도, 구뷰만 고침(사고)도 금지.
3. **검증은 실제 렌더 경로에서** — tsc·design·unit 통과만으로 "완료" 금지. 기본 플래그 상태의 실제 화면에서 변경 확인.
4. **표시 로직도 SSOT** — 같은 값을 여러 뷰가 렌더하면 표시 변환을 `lib/` 공용 함수로(예 `lib/gpu/card-memory.ts`) 두고 전 뷰가 import. 뷰별 인라인 포맷 복붙 금지(= "한 곳만 고쳐 누락"의 근본 원인).

## 복귀 경로 정책 (필수 — "설정을 마치면 원래 있던 화면으로")

> **왜**: 외부 왕복 흐름(OAuth·외부 인증·결제)이 끝나면 **떠났던 화면**으로 돌아와야 한다. 라우트가 복귀 주소를 직접 적으면 쿼리(탭·필터·정렬)가 날아간다.
> (실제 사고: Drive 콜백이 `/admin/settings?drive=connected` 고정 → `?tab=integrations` 소실 → 엉뚱한 탭이 열림)

**모든 왕복 흐름은 `lib/nav/return-to.ts`(SSOT)를 쓴다. 복귀 주소를 라우트에 적지 않는다.**

- 떠날 때: `withReturnTo(href, currentReturnTo())` — 경로+쿼리를 담아 탭·필터 유지
- 보관: 시작 라우트가 `sanitizeReturnTo()`로 검증 후 **httpOnly 쿠키**(CSRF state와 같은 수명)
- 돌아올 때: `appendParams(returnTo, { 결과 })` — **기존 쿼리 보존**하고 결과만 얹기
- 보안: `sanitizeReturnTo()`가 절대 URL·`//`·`/\`·CR/LF 차단(열린 리다이렉트 방어). 검증 없이 리다이렉트 금지
- **결과 표시 필수**: `?xxx=error&reason=…`을 화면이 반드시 표시. 붙여만 놓고 안 보여주면 실패가 묻힌다
- 가드: `lib/nav/return-to.test.ts`

---

## 디자인 시스템 참조 순서 (필수 — 코드를 쓰기 전에 먼저 한다)

> **왜**: 정책이 "카드 → `NbCard`"라고 못 박아 놨는데 **`NbCard` 실사용은 0건**이고, 실제 그 일은 `.card` 클래스(196건)가 하고 있었다.
> 정책이 가리키는 목록과 현실이 달라서 만드는 사람은 매번 **새로 만드는 쪽**을 택했다.
> v0.7.438 실측: **로딩 6종·탭 5종·표 4방식·빈상태 2벌·페이지헤더 2벌·정렬아이콘 2벌**이 동시에 살아 있다.
> 근거: `docs/2026-08-12-v0.7.438-ui-system-audit/01-AUDIT.md`

**무엇을 만들지 정해지면, 코드를 쓰기 전에 반드시 이 순서를 따른다.**

1. **`docs/ui-system/INVENTORY.md`를 연다** — UI 부품 121심볼 전수 색인(SSOT).
2. **동일 성격 부품이 있으면 그대로 쓴다.** 부족하면 **그 부품을 고쳐서** 쓴다. 새로 만들지 않는다.
3. **INVENTORY §1 "중복 경보" 성격이면**(로딩·탭·표·빈상태·헤더·상세표면·셸) **신규 제작 금지.** 통일 대상을 쓴다.
4. **없으면 시스템에 먼저 정의한다** — `components/ui/`에 부품 생성 → **INVENTORY.md 등재** → 화면에서 사용.
5. **화면에만 존재하는 UI를 만들지 않는다.** 두 번째 사용처가 생기면 이미 늦다.

**부품 실사용 확인은 반드시 export 이름 기준:**
```bash
node docs/ui-system/scan-inventory.mjs           # 전체 사용량
node docs/ui-system/scan-inventory.mjs --dupes   # 같은 이름 2곳 export = 중복 구현
node docs/ui-system/scan-inventory.mjs --dead    # 사용 0건
```
> 파일명으로 세면 안 된다. `LoadingSkeleton.tsx`는 `SkelPage/SkelCard/SkelList`를 export하므로 `<LoadingSkeleton`으로 세면 **27건 쓰이는 부품이 0건으로 보인다.** 1차 조사가 실제로 이 오판을 했다.

### 클래스 축 vs 컴포넌트 축

| 축 | 무엇 | 규모/채택 | 언제 |
|---|---|---|---|
| **클래스**(`globals.css`) | `input-field` 247 · `label` 185 · `tape-title` 118 · `.card` 196 · `table-card` 70 · `responsive-grid-*` 61 | 9,710줄 / 규칙 1,550 / 토큰 123 | **순수 스타일(모양만)** |
| **컴포넌트**(`components/`) | `NbButton` 85 · `EmptyState` · `SkelPage` · `PageHeader` | 97파일 / 121심볼 | **상태·이벤트·조합** |

1. 모양만 → **클래스.** 컴포넌트 신설 금지.
2. 상태·이벤트 → **컴포넌트.** 컴포넌트 **내부가** 클래스를 쓴다.
3. **화면 전용 스타일을 `globals.css`에 추가 금지.** 이미 94%(약 1,350규칙)가 화면 전용(`gpu-*` 505 · `ai-*` 142 · `cockpit-*` 116 · `ci-*` 112). 새 도메인 스타일은 CSS Module.

### 무엇을 쓸 것인가 (실사용 기준 — v0.7.439 정정)

| 무엇 | 쓸 것 | 실사용 | 쓰지 말 것 |
|---|---|---|---|
| 버튼 | `components/ui/nb/NbButton` | 85 | `<button style={{…}}` 자작(352) |
| 카드 | **`className="card"`** | 196 | ~~`NbCard`~~(0·폐기예정), 자작 박스(476) |
| 입력·레이블 | **`input-field` / `label`** | 247 / 185 | ~~`NbField` 계열~~(0·폐기예정) |
| 뱃지 | `NbBadge` | 10 | 인라인 pill |
| 표 | **`.table-card`** + `DynamicTable` | 70 / 7 | 가로 스크롤 표, 새 표 컴포넌트 |
| 빈 상태 | `components/ui/EmptyState` | 18 | "없습니다" 직접 렌더(188) |
| 오류 | `ErrorState`(`components/ci/states.tsx` — 공용 승격 대상) | 11 | 자작 오류 박스 |
| 로딩(골격) | `SkelPage`/`SkelCard`/`SkelList` | 11/9/7 | "불러오는 중" 직접 렌더(37) |
| 로딩(인라인) | `AXDotLoader` | 35 | 자작 스피너 |
| 탭 | `components/ui/SegmentedTabs` | 1 | `WorkSubTabs`·`ProjectTabs`·`StageNav`·`WorkTabBar`(통합 대상) |
| 페이지 헤더 | `components/ui/PageHeader` | 15 | raw `<h1>`, `CiPageHeader`(통합 대상) |
| 모달 | `NbModal` + 모달 체크리스트 | 5 | 처음부터 자작 |
| 리치텍스트 | `components/ui/RichText` | 11 | `dangerouslySetInnerHTML` 직접 |
| 레이아웃 | `MobileShell` | 3 | 새 셸 신설 |

**⛔ 목록 툴바·페이지네이션·필터·정렬은 공용 부품이 없다**(전수 검색 0건). 목록 화면 신규 시 4번 절차(시스템에 먼저 정의)를 따른다.

### 가드 — 현황과 사각지대

- `pnpm design:check`가 잡는 것(v0.7.441 확장): ① hex **즉시차단** ② swr 전역 `mutate` **즉시차단** ③ `rgba()` ④ 미정의 토큰 ⑤ **raw `<input/select/textarea>`의 `input-field` 누락** ⑥ z-index 하드코딩 ⑦ `'white'`·3자리 hex ⑧ 자작 버튼·자작 카드 박스 ⑨ 자작 로딩/빈상태 문구 ⑩ **globals.css 10px 미만 폰트** ⑪ **globals.css 화면 전용 CSS 신규 추가** (③~⑪ = ratchet, baseline 동결·신규만 차단).
- **스캔 루트**: `app` + `components`(.tsx) + **`app/globals.css`**. 예전의 "globals.css를 안 본다" 사각지대는 v0.7.441에서 해소.
- 기존 UI 정적 가드: `lib/ui/integration-consistency.test.ts` · `lib/ui/shell-contract.test.ts` · `lib/ui/dock-exclusive.test.ts` · `lib/ui/duplicate-component.test.ts` · `lib/work/mobile-layout-guard.test.ts` (스캔 공용 모듈 `lib/ui/component-scan.ts`). 새 가드는 **이 옆에 추가 + design:check 확장**. 병렬 시스템 신설 금지.
- **새 `*.test.ts`는 `apps/web/package.json`의 `test` 목록(수기, 175개)에 반드시 등재.** 등재 안 하면 안 돈다.
- **가드는 만든 뒤 일부러 깨서 실패를 확인**한다.

### 신규 화면 착수 체크리스트

- [ ] `INVENTORY.md`에서 동일 성격 부품 부재 확인 · [ ] 중복 경보면 통일 대상 사용
- [ ] `MobileShell` 상속(새 셸 금지) · [ ] `PageHeader`(raw h1 금지)
- [ ] `input-field`/`label` · [ ] 모달 `useEscClose`/`tape-title` · [ ] 표 `.table-card`
- [ ] 빈·로딩·오류를 **기존 부품**으로 · [ ] 색·폰트·z-index 토큰만(10px 미만 금지)
- [ ] 화면 전용 CSS를 `globals.css`에 추가하지 않음 · [ ] 새 부품이면 INVENTORY 등재

> **면제**: 셸 밖 공개·인증 4화면(`/login`·`/change-password`·`/develop`·`/api-access`)은 **셸 계약만 면제**. 토큰·폼 클래스·프리미티브·모달 표준은 동일 적용. `/develop`·`/api-access`는 **외부 공개**라 예외 없음.

---

## 반응형 디자인 정책 (필수)

**모든 UI 구현은 반드시 반응형 기반으로 작성한다.**

### 브레이크포인트

| 이름 | 조건 | 설명 |
|------|------|------|
| mobile | < 768px | 스마트폰 세로 |
| tablet | 768px ~ 1023px | 태블릿, 스마트폰 가로 |
| desktop | ≥ 1024px | PC |

### 레이아웃 규칙

1. **신규 레이아웃**: 모바일 우선(mobile-first) 작성 원칙
2. **그리드**: 고정 `gridTemplateColumns` 금지 → `responsive-grid-*` 클래스 사용
3. **테이블**: `.table-card` 클래스 사용 — 모바일에서 카드 레이아웃으로 자동 변환 (가로 스크롤 금지)
4. **레이아웃 컨테이너**: `MobileShell` 컴포넌트 사용 (사이드바 자동 처리)
5. **페이지 패딩**: `page-inner` 클래스 사용 (모바일 자동 축소)
6. **터치 영역**: 버튼/링크 최소 높이 44px

### 테이블 — 모바일 카드 패턴 (필수)

가로 스크롤 테이블은 **절대 금지**. 반드시 카드 레이아웃으로 변환한다.

```tsx
// ✅ 올바른 방법
<table className="table-base table-card">
  <thead>...</thead>
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

- `style={{ display: 'grid', gridTemplateColumns: 'repeat(N, 1fr)' }}` → `className` 사용
- 반응형 없는 고정 width 레이아웃 (사이드바 등 예외)
- `overflow: hidden` 단독 사용 (모바일 콘텐츠 잘림 유발)
- `.table-responsive` 래퍼 + `minWidth` 조합 (가로 스크롤 유발) → `.table-card` 사용
- 클라이언트 컴포넌트 내 `<style>` 태그 (hydration 오류 유발)

---

## 코딩 컨벤션

### 네이밍

| 대상 | 규칙 |
|------|------|
| 파일 | kebab-case |
| 컴포넌트 | PascalCase |
| 함수/변수 | camelCase |
| 상수 | SCREAMING_SNAKE_CASE |
| DB 컬럼 | snake_case |

### 에러 처리

- 모든 API 호출 `try-catch` 필수
- 사용자 메시지 / 개발자 로그 분리

### 함수 크기

- 함수당 최대 50줄
- 파일당 최대 800줄
- 중첩 깊이 최대 4단계

### Supabase RLS

- 모든 테이블에 Row Level Security 필수 구현
- 서버 컴포넌트에서 `createServerClient` 사용
- 클라이언트 컴포넌트에서 `createBrowserClient` 사용

---

## 버전 관리 정책

패치 버전(3rd)은 `0`부터 `999`까지 입력 가능하다. 999 초과 시 MINOR(2nd)를 1 올리고 PATCH는 0으로 리셋한다.

| 단계 | 조건 |
|------|------|
| PATCH (3rd) | 버그 픽스, 소규모 수정 (0~999, 999 초과 시 MINOR 올림) |
| MINOR (2nd) | 릴리즈 가능한 새 기능 |
| MAJOR (1st) | 브레이킹 체인지 (API 변경, DB 스키마 호환 불가) |
