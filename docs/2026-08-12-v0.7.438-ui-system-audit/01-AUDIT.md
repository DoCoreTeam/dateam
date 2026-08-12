# UI/UX 전수조사 — 실측 결과

조사일 2026-08-12 · **정정 2026-08-12**(`00-VERIFY.md` 검증 반영) · 기준 v0.7.438
대상 `apps/web` 전체 화면 **80개**(`page.tsx` 81개 − 루트 redirect 1) · 컴포넌트 **97파일 / export 심볼 121개**
**이 문서는 조사 결과만 담는다. 설계·기획은 `02-SYSTEM.md`, 이행 계획은 `03-PLAN.md`, 검증은 `00-VERIFY.md`.**

> **⚠️ 1차 조사 정정**: 1차는 부품 사용량을 **파일명**(`<LoadingSkeleton`)으로 셌다. 실제 export 이름이 다른 부품이 전부 "0건"으로 오판됐다.
> 이 판(2판)은 **export 이름 기준 실측**(`docs/ui-system/scan-inventory.mjs`)이다. §0·§1·§7·§12가 그에 따라 바뀌었다.

---

## 0. 한 줄 결론 (정정됨)

> **부품이 없어서도, 안 써서도 아니다. 같은 부품을 두 번 만들어서다.**
> 빈 상태 2벌·페이지 헤더 2벌·정렬 아이콘 2벌·로딩 **6종**·탭 **5종**이 동시에 살아 있다.
> 그래서 "정리했는데 또 새로 만들어 낸다"가 반복된다 — 만들 때 **이미 있는 걸 찾을 색인이 없기 때문**이다.

1차 조사의 "**공용 부품이 사문화됐다**"는 절반만 맞다:

| 축 | 실태 | 판정 |
|---|---|---|
| **클래스 시스템**(`input-field` 247 · `label` 185 · `tape-title` 118 · `table-card` 70 · `responsive-grid` 61 · `useEscClose` 91) | 잘 지켜지고 있음 | ✅ **1차가 아예 측정 안 함** |
| **컴포넌트 시스템**(`NbButton` 85 · `EmptyState` 36 · `Skel*` 27) | 쓰이지만 **중복 구현** | ⚠️ |
| **진짜 죽은 부품** | `NbCard` 0 · `NbField/NbInput/NbSelect/NbTextarea` 0 · `LogoutButton` 0 · `WeeklyReportBannerButton` 0 | ❌ 4파일뿐 |

가장 아픈 한 줄은 여전히 유효하다: **CLAUDE.md §2가 "카드 → `NbCard`"라고 못 박아 놨는데 `NbCard` 실사용은 0건이다.**
다만 그 이유가 다르다 — 안 써서가 아니라, **`.card` 클래스(196건)가 이미 그 일을 하고 있고 정책이 그걸 모른다.**

---

## 1. 공용 부품 실태 — 중복이 본질 (정정됨)

### 1-1. 채택률 (export 이름 기준 재측정)

| 부품 | 정책 명시 | 1차(파일명) | **실제(export명)** | 판정 |
|---|---|---|---|---|
| `NbButton` | §2 "버튼 → NbButton" | 85 | **85** | ✅ 최다 |
| `AXDotLoader` | — | (미조사) | **35** | ✅ 사실상 표준 로딩 |
| `SortIcon`(gpu) + `SortIcon`(cockpit) | — | (미조사) | **26 + 26** | ⛔ 2벌 |
| `EmptyState`(ui) + `EmptyState`(ci/states) | — | 18 | **18 + 18** | ⛔ 2벌 동률 |
| `PageHeader` + `CiPageHeader` | §2-3 "raw h1 금지" | 15 | **15 + 14** | ⛔ 2벌 |
| `SkelPage`/`SkelCard`/`SkelList` | — | **0 (오판)** | **11 / 9 / 7 = 27** | ✅ **쓰이고 있었다** |
| `ErrorState`(ci/states) | — | (미조사) | **11** | ⚠️ 공용 위치 아님 |
| `RichText` | §5-2 SSOT | (미조사) | **11** | ✅ |
| `DraftRestoreBanner` | — | (미조사) | **10** | ✅ |
| `NbBadge` | §2 "뱃지 → NbBadge" | 10 | **10** | ⚠️ 저조 |
| `DynamicTable` · `WorkPageShell` · `WorkSubTabs` · `AXLoadingOverlay` | — | (미조사) | **각 7** | ⚠️ 미색인 |
| `NbModal` | §2-2 모달 표준 | (미조사) | **5** | ⚠️ |
| `NbTable` · `NbNavItem` | — | 2 | **2** | ⚠️ |
| `SegmentedTabs` | §2-5(신설) | 1 | **1** | ⚠️ 신설분 |
| `NbCard` | §2 "카드 → NbCard" | 0 | **0** | ❌ 진짜 사문화 |
| `NbField`/`NbInput`/`NbSelect`/`NbTextarea` | — | 0 | **0** | ❌ 클래스 축에 밀림 |

### 1-2. 🚨 같은 것이 2벌 이상 — 이게 근본 문제

| 무엇 | 구현 수 | 실사용 |
|---|---|---|
| **로딩** | **6종** | `AXDotLoader` 35 · `Skel*` 27 · `AXLoadingOverlay` 7 · `RowSkeleton` 5 · `BrandLoaderMark` 2 · `NavigationLoader` 1 = **77건** |
| **탭** | **5종** | `WorkSubTabs` 7 · `ProjectTabs` 4 · `StageNav` 4 · `SegmentedTabs` 1 · `WorkTabBar` 1 |
| **표** | **4방식** | `.table-card` 70 · `DynamicTable` 7 · `NbTable` 2 · GPU `UnifiedTable` 1 |
| **빈 상태** | **2벌** | `ui/EmptyState` 18 + `ci/states→EmptyState` 18 (**이름까지 같다**) |
| **페이지 헤더** | **2벌** | `PageHeader` 15 + `CiPageHeader` 14 |
| **정렬 아이콘** | **2벌** | `gpu/SortIcon` 26 + `cockpit/SortIcon` 26 |
| **상세 표면** | **3방식** | 시트(`DetailSheet` 4/`SlidePanel` 3) · 모달 26파일 · `[id]` 페이지 9 |
| **셸** | **3벌** | `(member)` · `admin` · `CiShell` |

> **"로딩 부품이 없다"가 아니라 "로딩 부품이 6개다."** 새로 만들면 7번째가 된다.

### 1-3. 버튼 — 방식 3가지 공존 (정정: 클래스 수치)
| 버튼 구현 방식 | 건수 |
|---|---|
| `NbButton` (정책이 지정한 것) | 85 |
| `btn-primary`/`btn-ghost` 클래스 | **180** (124+56, 1차 107은 과소집계) |
| **`<button style={{…}}` 자작 인라인** | **352** |

→ 정책이 지정한 방식이 **최소 사용**이고, 금지에 가까운 자작이 **최다**다. (이 결론은 유지)

### 1-4. 상태 표시 (정정됨)
| | 공용 | 자작 |
|---|---|---|
| 빈 상태 | `EmptyState` **36**(2벌 합) | "없습니다/비어 있/아직 없" 문구 **188** |
| 오류 | `ErrorState` **11** (ci 전용 위치) | — |
| 로딩 | **6종 77건** | "불러오는 중/로딩 중/확인 중" **37** |
| 카드 | `className="card"` 196 | `borderRadius:var(--radius)` 자작 박스 **476** |

---

## 2. 상위 인터페이스(셸) — 셸이 3개인데 구성이 전부 다르다

셸 3종: `app/(member)/layout.tsx` · `app/admin/layout.tsx` · `components/ci/CiShell.tsx`
(셋 다 `MobileShell`을 쓰지만 **무엇을 꽂는지는 각자 마음대로**)

| 상위 요소 | (member) | admin | CI |
|---|---|---|---|
| 좌측하단 계정 메뉴 | `SidebarProfile` | **`AdminUserMenu`(별개)** | `SidebarProfile` |
| └ 테마 전환 | ✅ | **❌** | ✅ |
| └ 비밀번호 변경 | ✅ | **❌** | ✅ |
| └ 이름 설정 | ✅ | **❌** | ✅ |
| └ 패치노트 | ✅ | **❌** | ✅ |
| └ 로그아웃 | ✅ | ✅ | ✅ |
| 우측상단 전역 검색 | `GlobalSearchBox` ✅ | **❌ 없음** | **❌ 없음** |
| 우측상단 전체 메뉴 | `QuickNav` ✅ | **❌ 없음** | `QuickNav` ✅ |
| 알림(벨) | **❌ 없음** | **❌ 없음** | `NotificationBell` ✅ |

> 사용자 지적 그대로다 — "좌측 하단 계정 메뉴도 각 화면마다 말을 해야 나온다", "우측 상단 검색이나 전체메뉴도 그렇고".
> **원인**: `MobileShell`이 `footer`/`headerRight`를 **자유 슬롯(ReactNode)** 으로 열어둬서, 무엇을 넣을지가 셸마다 결정된다. 계약이 없으니 새 셸을 만들 때마다 빠뜨린다.

### 2-1. 셸 밖 화면 4개 (1차 조사에서 누락 — 정정)

`MobileShell`을 쓰지 않는 화면이 4개 더 있다. 1차의 "전체 화면 76개"는 이들을 뺀 수였다.

| 화면 | 줄 | 성격 | 인증 |
|---|---|---|---|
| `/login` | 97 | 로그인 | ❌ 불필요 |
| `/change-password` | 168 | 비밀번호 변경 | ✅ |
| **`/develop`** | **924** | **외부 공개** API 문서 | ❌ 불필요 |
| **`/api-access`** | 155 | **외부 공개** 신청 폼 | ❌ 불필요 |

(`app/page.tsx`는 5줄 `redirect('/home')` — 화면 아님. 그래서 실제 화면 수 = 81 − 1 = **80**)

> **뒤 둘은 로그인 없이 외부인이 보는 표면이다.** 사이드바가 없는 건 정상이지만, 토큰·폼 클래스·프리미티브는 동일하게 적용돼야 한다. 설계에서 명시적으로 다뤄야 한다(§02-SYSTEM).

---

## 3. 우측하단 고정 레이어 — 실제로 겹친다 (실측·육안 확인)

`/ci/inbox`에서 우측하단 200px 안에 **고정 레이어 3개**가 동시에 존재:

| 레이어 | right | bottom | 크기 | z-index |
|---|---|---|---|---|
| AI 어시스턴트 FAB (CI) | 16 | **16** | 127×39 | 90 |
| QuickAddFab (MobileShell 전역) | 24 | **24** | 56×56 | 90 |
| ScrollJumpButtons (MobileShell 전역) | 16 | 92 | 40×40 | 40 |

- 1번과 2번이 **x·y 모두 중첩**하고 **z-index도 같은 90** → 육안으로 "어시스턴트" 버튼이 `+` 버튼에 **가려져 잘려 보인다**(스크린샷 확인).
- `ScrollJumpButtons`는 소스에 `bottom: 92, // FAB(하단) 위로` 라고 **매직넘버로 회피** 중이다. 슬롯 규약이 없으니 좌표를 손으로 피하는 것.
- `admin/content/ContentSections.tsx:328`은 또 다른 FAB를 `zIndex: 9999`로 띄운다.

> 사용자 지적 그대로 — "그 레이어가 있으면 다른걸 구현할때는 피해서 할텐데 그것도 안되고".

---

## 4. z-index — 토큰이 있는데 안 쓴다

| | 건수 |
|---|---|
| `zIndex: 숫자` 하드코딩 | **57** |
| `var(--z-*)` 토큰 | 7 |

하드코딩 값 분포: `50, 60, 100, 110, 200, 1000, 1100, 8000, 9000, 9990, 9998, 9999`
→ 토큰(`--z-dropdown:40 / sticky:90 / overlay:100 / modal:200 / toast:300 / onboarding:1100`)과 **무관한 축**이 병행 중. 겹침 사고가 구조적으로 예약돼 있다.

---

## 5. 목록 화면 — 표준이 없다

목록형 화면 약 40개를 조사. **공용 목록 툴바/페이지네이션/정렬/필터 컴포넌트가 하나도 없다.**
전수 검색(`ListToolbar|Pagination|Paginator|DataTable|TableToolbar|FilterBar|SortControl`) 결과 **0건**.

정정 — 목록 주변에 **부분 부품은 있다**(1차 미조사):
`DynamicTable` 7 · `BulkActionBar` 2 · `TrashToggle` 2 · `.table-card` 클래스 70 · GPU 전용 `ViewSwitcher` 1.
→ **표·일괄액션·휴지통은 있고, 툴바·페이저·필터·정렬만 없다.** 신설 시 위 5개를 흡수해야 6번째가 안 된다.

### 5-1. 페이지네이션 방식 3종 혼재
| 방식 | 화면 |
|---|---|
| 더보기(누적) | assets, accounts, ai-chat/analyze, contacts, deals, home, meeting-notes, pricing/gpu, work/activity, work/projects, work/search, admin/ai-chat |
| 커서 | ci/assets, accounts, ai-chat/analyze, contacts, deals, work/projects, work/search, admin/ai-chat |
| 페이지 번호(`?page=`) | meeting-notes, admin/ai-usage |
| **없음(전량 렌더)** | 나머지 다수 |

### 5-2. 필터·정렬 상태 저장 위치가 갈린다
- URL(`useSearchParams`) 기반: **11개 화면**
- 로컬(`useState`) 기반: **9개 화면**
→ CLAUDE.md는 "URL state가 관례"라고 적어놨지만 **절반이 로컬**이라 공유·새로고침 시 상태가 날아간다.

### 5-3. 없는 기능들
| 기능 | 상태 |
|---|---|
| 보기 전환(카드/목록/표) | ci/assets 등 극소수만. **공용 없음** |
| 보기 수량(20/50/100) | 사실상 전무 |
| 정렬 UI 표준 | 없음 (GPU만 자체 `SortIcon` 2종) |
| 필터 바 표준 | 없음 |
| 화면별 설정 기억 | `localStorage` 5개 화면뿐, **서버 저장은 0** (`user_preferences` 류 테이블 없음) |

---

## 6. 상세 보기 — 진입 방식 3종 혼재

| 방식 | 화면 |
|---|---|
| 우측 시트(`DetailSheet`/`SlidePanel`) | ci, ci/channels, ci/inbox, ci/trends, accounts, contacts, deals |
| 모달 | 16개 화면 |
| 별도 상세 페이지(`[id]`) | 9개 |

→ "모든 데이터 항목이나 영역을 누르면 상세정보가 나오게" 라는 규약이 없어서, 같은 성격의 목록이라도 클릭 결과가 다르다. `DetailSheet`는 CI 전용이고 `SlidePanel`은 3곳만 쓴다.

---

## 7. 토큰 준수율 (정정됨)

| 항목 | 토큰 | 하드코딩 | 준수율 |
|---|---|---|---|
| 폰트 크기 | 1,138 | 209 | 84.5% |
| z-index | 7(`var(--z-*)` 총 22회 참조) | **57** | **10.9%** |
| 색(흰색) | — | `'#fff'/'white'` **217** | ❌ |
| 색(rgba) | — | **187** | ❌ |

**정의된 CSS 변수: 고유 123개** (`--fs-*` 11 · `--space-*` 10 · `--z-*` 7 · `--border-*` 6 · `--shadow-*` 6 · `--radius-*` 3 · `--gpu-*` 23 …)

**§3-1 "10px 미만 금지" 위반 — 확정 5건. 그중 3건이 `globals.css` 본체에 있다:**
| 위치 | 값 |
|---|---|
| `globals.css:4792` `.gpu-chip span` | **7px** |
| `globals.css:4788` | **9px** |
| `globals.css:5936` | 0.55rem(8.8px) |
| `calendar/DayDetailPanel.tsx:238,239` | 0.6rem(9.6px) ×2 |

→ **`design:check`의 스캔 루트가 `app`+`components`뿐이라 `globals.css`를 안 본다.** 그래서 CSS 본체 위반이 통과한다.

**테마 관련 정정** — 1차의 "**다크 테마**에서 흰 박스로 튄다"는 표현은 과장이다.
테마는 3종(`nb` 기본 · `classic` Indigo · `mono` Monochrome)이고 **전면 다크 테마는 없다.** `mono`도 `--sidebar-bg:#111`(사이드바만 다크) / `--surface-bg:#f8f8f8`(본문 밝음)이다.
→ 위험은 **실재하지만** 범위는 "다크 사이드바 맥락 + 향후 테마 추가 시"다. (v0.7.437 브랜딩 카드 사고가 이 맥락)

---

## 8. 인라인 style 대 클래스 — 구조적 이탈

| | 줄 수 |
|---|---|
| `style={{` | **4,931** |
| `className=` | 3,257 |

인라인이 **1.5배**. 상위 파일은 GPU 탭들이 독식:
`MarketTab 278 · ReviewTab 137 · daily/page 104 · SuppliersTab 102 · PriceTableTab 98 · SpecsTab 94 · QuoteRegisterTab 79 · InventoryTab 78`

### 8-1. 그런데 클래스 쪽도 이미 비대하다 (1차 미조사 — 중요)

`app/globals.css` = **9,710줄 / 최상위 규칙 1,550개 / `@media` 60개**.
prefix별 분포:

| prefix | 규칙 수 | 성격 |
|---|---|---|
| `gpu-*` | **505 (33%)** | 도메인 전용 |
| `ai-*` | 142 | 도메인 전용 |
| `cockpit-*` | 116 | 도메인 전용 |
| `ci-*` | 112 | 도메인 전용 |
| `monitor-*` 59 · `work-*` 39 · `artifact-*` 34 · `daily-*` 31 · `calendar-*` 30 · `triage-*` 29 · `origin-*` 28 · `home-*` 25 … | 각 20~60 | 도메인 전용 |
| **공용 프리미티브** (`nb-*` 12 · `filter-*` 10 · `quickadd-*` 9 · `detail-*` 9 · `slide-*` 8 · `seg-*` 7 · `skel-*` 7 + `input-field`·`label`·`table-card`·`tape-title`·`responsive-grid-*`) | **≈100 (6%)** | 진짜 시스템 |

> **globals.css의 94%는 특정 화면 전용 CSS다.**
> 따라서 "인라인 4,931줄을 클래스로 옮기자"는 처방은 **틀렸다** — 옮기면 globals.css가 6,000줄 더 커질 뿐이다.
> 문제는 인라인이냐 클래스냐가 아니라, **화면 전용 스타일이 어디에도 캡슐화돼 있지 않다**는 것이다.

---

## 9. GPU 관리 — "할 때마다 다른 구현"의 실체

- 탭 파일 **15개** (`tabs/` 아래), 각각 독립 구현
- 표 렌더 경로가 **공존**: `unified/UnifiedTable` + `UnifiedTableConnected` + 구 `PriceTableTab` + 각 탭 자체 표
- `feature-flags.ts`의 `unified` 플래그로 구/신 분기 → **실제 렌더 경로가 플래그에 따라 달라짐**
  (CLAUDE.md에 "실제 렌더 경로 우선 수정 정책"이 이미 있는 이유 = v0.7.173 사고)
- 정렬 아이콘만 **2벌**(`components/pricing/gpu/SortIcon.tsx`, `cockpit/SortIcon.tsx`)
- 인라인 style 최상위 8개 파일 중 **6개가 GPU 탭**

---

## 10. 사용자가 지적한 항목 ↔ 실측 대조

| 사용자 지적 | 실측 결과 | 확인 |
|---|---|---|
| 좌측하단 계정 메뉴가 화면마다 다름 | admin은 `AdminUserMenu`로 **로그아웃만**, 테마·비번·이름·패치노트 없음 | ✅ 사실 |
| 우측상단 검색·전체메뉴 누락 | 검색은 member만, CI·admin **없음** | ✅ 사실 |
| 우측하단 레이어 회피 안 됨 | FAB 2개 좌표·z 동시 충돌, 육안으로 잘림 | ✅ 사실 |
| 누르면 상세정보 규약 없음 | 시트/모달/페이지 3종 혼재 | ✅ 사실 |
| GPU는 할 때마다 다른 구현 | 탭 15개 + 표 경로 공존 + 플래그 분기 + `SortIcon` 2벌(26/26) + globals.css `gpu-*` 505규칙 | ✅ 사실 |
| 테마 때 정리했는데 또 새로 만듦 | **로딩 6종·탭 5종·EmptyState 2벌·PageHeader 2벌** (사문화가 아니라 중복) | ✅ 사실 (원인 정정) |
| 목록 표준(정렬·필터·페이지·보기) 없음 | 툴바·페이저·필터·정렬 **0건**, 페이지네이션 3종 혼재 | ✅ 사실 |

---

## 11. 사용자가 짚지 않았지만 같은 뿌리인 것 (정정됨)

1. **로딩·빈 상태가 "없는" 게 아니라 "여러 벌"** — 로딩 6종 77건, 빈 상태 2벌 36건. 화면마다 모양이 다른 건 부재가 아니라 **선택지 과잉** 탓.
2. **z-index 축이 두 개** — 토큰(40~1100)과 하드코딩(50~9999)이 병행. 새 레이어를 얹을 때마다 숫자 경쟁. (유지)
3. **테마 안전성** — `'white'` 217 + `rgba()` 187 = 404곳. 단, **전면 다크 테마는 없으므로** 즉시 깨지는 범위는 `mono` 다크 사이드바 맥락에 한정(§7).
4. **사용자 환경설정 서버 저장이 0** — 보기 방식·정렬·페이지 크기를 기억할 저장소 자체가 없음(`localStorage` 5곳뿐). (유지)
5. **`globals.css`가 가드 밖에 있다** — `design:check` 스캔 루트가 `app`+`components`뿐. CSS 본체의 `7px`·`9px` 폰트가 통과 중(§7).
6. **페이지 헤더 2벌** — `PageHeader` 15 + `CiPageHeader` 14 = 29/80. 나머지 51곳은 raw h1 가능성.
7. **죽은 부품 4파일** — `NbCard`·`NbField`·`LogoutButton`·`WeeklyReportBannerButton`. 정책(§2)이 지정한 `NbCard`가 그중 하나라는 게 문제.
8. **셸 밖 화면 4개가 조사·설계 밖에 있었다** — `/login`(97줄) · `/change-password`(168줄) · **`/develop`(924줄, 외부 공개)** · `/api-access`(155줄, 외부 공개).

---

## 12. 근본 원인 (정정됨)

| # | 원인 | 증거 | 1차 대비 |
|---|---|---|---|
| **A′** | **같은 부품을 두 번 만든다 — 이미 있는 걸 찾을 색인이 없다** | 로딩 6종 · 탭 5종 · 표 4방식 · EmptyState/PageHeader/SortIcon 각 2벌 | **A("안 쓴다") 교체** |
| B | 셸이 자유 슬롯이라 상위 UI가 셸마다 결정된다 | `footer`/`headerRight`가 ReactNode, 계약 없음 | 유지 |
| C | 고정 레이어에 슬롯 개념이 없다 | `bottom: 92 // FAB 위로` 매직넘버 | 유지 |
| D | 목록 공용 부품이 아예 없다 | 툴바·페이저·필터·정렬 컴포넌트 **0개**(전수 검색 확인) | 유지 — **유일하게 "진짜 없는" 축** |
| **E′** | **가드는 이미 클래스 미사용까지 잡는다. 다만 `globals.css`를 안 본다** | `check-design-tokens.mjs:45` `rawInputRe`가 `input-field` 누락을 이미 차단. 스캔 루트에 CSS 없음 | **E("hex만 본다") 정정** |
| F | 신규 기능이 "새 폴더 + 새 컴포넌트"로 시작한다 | CI는 `components/ci/*`에 셸·헤더·빈상태·시트를 **전부 새로** 만듦 | 유지 |
| **G** | **정책이 실제 시스템(클래스 축)을 모른다** | §2는 `NbCard`(0건)를 지정, 실제로 일하는 `.card`(196건)·`input-field`(247건)는 §2에 없음 | **신규** |

> **A′·F·G는 한 문장이다 — "만들 때 이미 있는 걸 찾을 단일 색인이 없고, 정책이 가리키는 목록이 현실과 다르다."**
> 그래서 `docs/ui-system/INVENTORY.md`(신설)가 이 계획의 1번이다.
