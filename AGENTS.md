# newAX 프로젝트 코딩 정책 (Codex)

> 이 파일은 Codex CLI가 읽는 정책 메모리입니다.
> `GEMINI.md`의 핵심 정책을 공유하며, Codex 전용 추가 컨벤션을 포함합니다.

## 기술 스택

- Next.js 14+ (App Router)
- Tailwind CSS + `globals.css` 유틸 클래스
- Supabase (Auth + DB)
- TypeScript

## 버전

v0.6.39

버전 변경 시 아래 **모든** 항목을 반드시 업데이트한다:

1. `/package.json` — `"version"` 필드 ← 단일 소스 (`next.config.js`가 자동 주입)
2. `/apps/web/package.json` — `"version"` 필드 (monorepo 동기화)
3. `GEMINI.md` — `## 버전` 라인
4. `AGENTS.md` (이 파일) — `## 버전` 라인

> `apps/web/next.config.js:2`가 `require('../../package.json').version`을 읽어
> 빌드 타임에 `NEXT_PUBLIC_APP_VERSION`으로 주입한다.
> 사이드바(`MobileShell.tsx:261`)는 이 env var를 표시한다.
> **루트 `package.json`이 단일 소스** — `.env.local`로 재정의하지 말 것.

---

## Git 커밋 규칙 (필수)

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
