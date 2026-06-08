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

### 3. 테마 대응
- 색·치수를 토큰으로 쓰면 `[data-theme]` 전환에 자동 대응됨. 하드코딩하면 테마 전환에서 누락됨.
- 새 테마 추가: `globals.css [data-theme="id"]` 블록 1개 + `lib/themes.ts` 1줄. (테마별 필수 오버라이드 토큰 누락 주의)

### 4. 강제 검증
- 커밋/PR 전 `pnpm design:check`(=`scripts/check-design-tokens.mjs`) 통과 필수. CI(`.github/workflows/design-guard.yml`)가 PR에서 자동 차단.

## 기술 스택
- Next.js 14+ (App Router)
- Tailwind CSS + globals.css 유틸 + 디자인 토큰(SSOT)
- Supabase (Auth + DB)
- TypeScript

## 버전
v0.7.44

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
