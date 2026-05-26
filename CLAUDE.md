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
3. **테이블**: 항상 `.table-responsive` 래퍼로 감싸기
4. **레이아웃 컨테이너**: `MobileShell` 컴포넌트 사용 (사이드바 자동 처리)
5. **페이지 패딩**: `page-inner` 클래스 사용 (모바일 자동 축소)
6. **터치 영역**: 버튼/링크 최소 높이 44px

### 사용 가능한 유틸 클래스 (globals.css)
```
.app-shell           — 전체 앱 레이아웃 컨테이너
.app-sidebar         — 사이드바 (모바일 자동 드로어)
.app-content         — 메인 콘텐츠 영역
.page-inner          — 페이지 내부 패딩 (desktop: 2rem, mobile: 1rem)
.responsive-grid-2   — 2컬럼 레이아웃 (desktop: 1fr 352px, mobile: 1fr)
.responsive-grid-cols-2 — 2컬럼 그리드 (mobile: 1col)
.responsive-grid-cols-3 — 3컬럼 그리드 (mobile: 1col, tablet: 2col)
.responsive-grid-cols-4 — 4컬럼 그리드 (mobile: 2col)
.table-responsive    — 테이블 가로 스크롤 래퍼
.mobile-only         — 모바일에서만 표시
.desktop-only        — 데스크탑에서만 표시
.mobile-menu-btn     — 햄버거 버튼 (모바일에서만 표시)
```

### 금지 사항
- `style={{ display: 'grid', gridTemplateColumns: 'repeat(N, 1fr)' }}` → className 사용
- 반응형 없는 고정 width 레이아웃 (사이드바 등 예외)
- `overflow: hidden` 단독 사용 (모바일 콘텐츠 잘림 유발)

## 기술 스택
- Next.js 14+ (App Router)
- Tailwind CSS + globals.css 유틸
- Supabase (Auth + DB)
- TypeScript

## 버전
v0.2.4
