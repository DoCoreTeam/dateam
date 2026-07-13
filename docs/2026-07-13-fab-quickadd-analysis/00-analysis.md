# 우하단 + 버튼(FAB) 분석 보고서

- 접수일: 2026-07-13 / 성격: **분석 전용 (구현·수정 없음 — "절대 구현하지마")**
- 분석: 🟦 DC-ANA → CEO 코드 검증(가드·액션 SSOT)

## 1. 정체 (한 줄)
화면 우하단 `+` 버튼 = **`QuickAddFab`** (`apps/web/components/ui/QuickAddFab.tsx`). 현재 페이지 맥락에 맞는 "빠른 추가" 액션을 펼치는 speed-dial FAB.

## 2. 렌더처 · 노출 조건
- **렌더처(단 1곳)**: `components/ui/MobileShell.tsx:365` → `<QuickAddFab isAdmin={isAdmin} />`
- **노출 범위**: `(member)` 라우트 그룹 전체. `MobileShell`은 member/admin 레이아웃 둘 다 쓰지만, `QuickAddFab.tsx:32`의 `if (pathname.startsWith('/admin')) return null` 가드로 **admin 콘솔에서는 숨김**.
- **반응형**: 데스크탑·모바일·태블릿 전부 노출(별도 mobile-only 제어 없음).
- **위치 CSS**: `.quickadd-fab-wrap` = `position:fixed; bottom:1.5rem; right:1.5rem; z-index:var(--z-sticky,90)` (globals.css:2898~).

## 3. 클릭 동작 · 액션 목록
- 클릭 = `setOpen(v=>!v)` 토글. 아이콘 닫힘 `+`(Plus) ↔ 열림 `×`(X, rotate45). 항목은 `<Link>` — 클릭 시 이동 + 메뉴 닫힘.
- 목록은 `fabActionsForPath(pathname, isAdmin)`(`lib/fab-actions.ts:45`)가 경로별로 반환:

**A. `/pricing/gpu*` 경로** (primary=gpu-intake):
| key | 라벨 | href | 비관리자 노출 |
|-----|------|------|:---:|
| gpu-intake | 가격·견적 입력 | `/pricing/gpu?tab=intake` | ✅ |
| gpu-supplier | 공급사 등록 | `...tab=suppliers&create=1` | ❌ 필터됨 |
| gpu-competitor | 경쟁사 등록 | `...tab=competitors&create=1` | ❌ 필터됨 |
| gpu-market | 시장가·매핑 등록 | `...tab=market&create=1` | ⚠️ **노출됨**(필터 안 함) |

**B. 그 외 모든 페이지** (현재 경로 매칭 항목을 최상단 강조, 매칭 없으면 intake가 primary):
daily(`/daily?new=1`) · account(`/accounts`) · contact(`/contacts`) · deal(`/deals`) · calendar(`/calendar`) + intake(`/pricing/gpu?tab=intake`)

## 4. 상태 · 접근성 · 디자인
- 상태: `useState(open)`, 경로 변경 시 자동 닫힘(`useEffect [pathname]`), ESC 닫힘, 바깥 클릭 닫힘(모두 cleanup 있음).
- 접근성: `aria-expanded`/`aria-haspopup="menu"`/`aria-label`(상태 분기) 있음.
- 디자인: 색·간격·z-index 토큰 사용, 항목 min-height 44px, 버튼 56px — 정책 준수.

## 5. 발견 이슈 / 개선 여지 (구현 안 함 — 참고)
| # | 이슈 | 확신도 | 비고 |
|---|------|:---:|------|
| 1 | **비관리자 GPU 필터 불일치**: supplier·competitor는 숨기는데 `gpu-market`(`&create=1` 생성 모달)은 노출 | 높음 | 비관리자가 시장가 등록 클릭 시 권한 없으면 먹통/튕김 가능 — 의도 여부 확인 필요 (`fab-actions.ts:50`) |
| 2 | 하드코딩 shadow `rgba(124,58,237,…)` | 높음 | 테마/브랜드색 변경 시 그림자만 불일치 (globals.css:2885,2890). `--brand` 파생 토큰 권장 |
| 3 | ARIA 계약 불일치: `aria-haspopup="menu"` ↔ `role="group"` | 높음 | `role="menu"`+`menuitem` 또는 haspopup 값 조정 |
| 4 | 메뉴 오픈 시 첫 항목 포커스 이동 없음 | 높음 | 키보드 사용자 Tab 추가 필요 |
| 5 | 죽은 CSS `.routine-fab*`(globals.css:2954~) 미사용 | 높음 | 잔재 — 혼란 유발 |
| 6 | href 쿼리 혼용 `?new=1`(daily) vs `?create=1`(그 외) | 중간 | 파일 주석은 `?create=1` 통일 서술 — 정합 확인 필요 |
| 7 | admin layout이 `isAdmin` 미전달(기본 false) | 중간 | `/admin` 가드로 런타임 영향 없음, 인터페이스 계약만 불일치 |
| 8 | 메뉴 등장 애니메이션 없음 | 높음 | UX 개선 여지 |

> 코드는 일절 수정하지 않았다. 이슈 #1(권한 필터)은 실사용 영향이 있을 수 있어 우선 확인 권장.
