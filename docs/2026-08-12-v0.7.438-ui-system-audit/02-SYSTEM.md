# UI/UX 시스템 설계안 (기획) — 2판

기준 v0.7.438 · 근거 `01-AUDIT.md`(2판) · 검증 `00-VERIFY.md` · 색인 `docs/ui-system/INVENTORY.md`
**구현 전 승인용. 이 문서만으로는 코드가 바뀌지 않는다.**

> **1판 대비 바뀐 것**: 1판은 "부품이 없거나 안 쓴다"를 전제로 **새 부품을 만드는** 설계였다.
> 실측 결과 전제가 틀렸다 — 로딩 6종·탭 5종·표 4방식이 **이미 있다.** 새로 만들면 7번째·6번째가 된다.
> 2판은 **"통일 대상을 고르고 나머지를 흡수·폐기하는"** 설계다. 신설은 진짜 공백(목록 툴바/페이저/필터/정렬)에만 한다.

---

## 0. 설계 원칙 (정정됨)

근본 원인은 **"만들 때 이미 있는 걸 찾을 색인이 없고, 정책이 가리키는 목록이 현실과 다르다"** 이다(`01-AUDIT §12 A′·F·G`).
그래서 "문서에 정책을 더 쓰는" 방식으로는 또 실패한다 — §2 "카드→NbCard"가 이미 그렇게 실패했다(`NbCard` 0건, 실제 일은 `.card` 196건이 함).

**네 축을 한 세트로 간다. 하나라도 빠지면 다시 갈라진다.**

| 축 | 없으면 벌어지는 일 |
|---|---|
| **① 색인** — 있는 걸 찾을 단일 목록 | 이미 있는 걸 또 만든다 (로딩 6종) |
| **② 통일** — 중복 중 하나를 고르고 나머지 흡수 | 선택지가 많으니 매번 다른 걸 고른다 |
| **③ 계약** — 안 쓰면 빠뜨릴 수 없게 | 자유 슬롯이라 admin에 검색이 없다 |
| **④ 가드** — 어긴 걸 CI가 잡는다 | 신규 유입이 계속된다 |

**색인 = `docs/ui-system/INVENTORY.md` (신설 완료).** 정책이 이 파일을 가리킨다.

---

## 1. 계층 정의 — 무엇이 "상위 인터페이스"인가

```
L0  AppShell        전 화면 공통 골격 — 사이드바·헤더·고정 레이어 슬롯
L1  PageScaffold    페이지 골격 — 헤더/탭/툴바/본문/상세 슬롯
L2  Surface         목록·카드·표·상세시트 (데이터 표현)
L3  Primitive       버튼·필드·뱃지·상태(빈/로딩/오류)
L4  Token+Class     토큰(123개) + 공용 프리미티브 클래스(≈100개)
L5  DomainStyle     화면 전용 스타일 — **globals.css 금지, 도메인 폴더 CSS Module**
```

**규칙: 위 계층은 아래 계층만 조합한다. 아래가 위를 알지 못한다.**

---

## 2. 🔑 클래스 축과 컴포넌트 축의 관계 (1판 최대 공백 — 보완②)

`globals.css`는 **9,710줄 / 최상위 규칙 1,550개 / 토큰 123개**다. 1판은 이걸 한 줄도 다루지 않고 컴포넌트만 설계했다.
그대로 가면 **1,550개 클래스 위에 컴포넌트 레이어가 얹혀 "세 번째 방식"이 된다.**

### 2-1. 규칙 세 줄

1. **순수 스타일(모양만)** → **클래스로 남긴다.** 컴포넌트를 만들지 않는다.
   (`input-field` 247 · `label` 185 · `table-card` 70 · `tape-title` 118 · `responsive-grid-*` 61 — **이미 잘 지켜지고 있다. 건드리지 않는다.**)
2. **상태·이벤트·조합이 붙으면** → **컴포넌트.** 컴포넌트 **내부가** 그 클래스를 쓴다. 화면은 클래스를 직접 안 쓴다.
3. **화면 전용 스타일** → **globals.css에 추가 금지.** 해당 도메인 폴더의 CSS Module.

### 2-2. 1,550 규칙의 처분

| 구분 | 규모 | 처분 |
|---|---|---|
| **토큰** (`:root` 변수 123) | 123 | ✅ **유지·확장.** L4의 진실 |
| **공용 프리미티브 클래스** (`nb-*` 12 · `seg-*` 7 · `skel-*` 7 · `filter-*` 10 · `slide-*` 8 · `detail-*` 9 · `quickadd-*` 9 + `input-field`/`label`/`table-card`/`tape-title`/`responsive-grid-*`) | ≈100 | ✅ **유지.** 컴포넌트의 **내부 구현**으로 흡수 (클래스 자체는 삭제 안 함 — 회귀 위험) |
| **도메인 전용 클래스** (`gpu-*` 505 · `ai-*` 142 · `cockpit-*` 116 · `ci-*` 112 · `monitor-*` 59 · `work-*` 39 · `daily-*` 31 · `calendar-*` 30 …) | ≈1,350 | ⏸ **현행 유지 · 이동 금지.** 다만 **신규 추가는 차단**(가드). 새 도메인 스타일은 CSS Module |

> **핵심: 기존 CSS를 옮기지 않는다.** 옮기는 순간 1,350개 규칙이 동시에 흔들리고 회귀를 검증할 방법이 없다.
> **막는 건 신규 유입뿐이다.**

### 2-3. `.card` vs `NbCard` — 정책 모순 해소

| | 실사용 | 결정 |
|---|---|---|
| `.card` 클래스 | **196** | ✅ **표준으로 승격.** 순수 스타일이므로 규칙①에 해당 |
| `NbCard` 컴포넌트 | **0** | ❌ **폐기.** 정책 §2의 "카드 → NbCard"를 "카드 → `.card`"로 정정 |
| 자작 박스 (`borderRadius:var(--radius)` 인라인) | 476 | ⛔ 신규 차단(ratchet) |

같은 논리로 `NbField`/`NbInput`/`NbSelect`/`NbTextarea`(0건)는 **폐기**한다 — `input-field`(247건)가 이미 이겼다.

---

## 3. L0 — AppShell: 상위 인터페이스를 "선택"에서 "기본"으로

### 문제
`MobileShell(footer, headerRight)` = 자유 슬롯 → 셸마다 다른 걸 꽂음 → admin엔 검색·테마·비번·패치노트가 없음.

### 설계: 자유 슬롯을 **역할 슬롯**으로 교체

```ts
// components/ui/shell/AppShell.tsx
interface AppShellProps {
  nav: NavGroup[]                    // 메뉴만 화면이 정한다
  session: ShellSession              // 이름·이메일·역할·테마 (필수)
  workspace?: WorkspaceContext       // CI처럼 워크스페이스 개념이 있을 때만
  extras?: {                         // 추가는 가능, 기본 제거는 불가
    headerExtra?: ReactNode
    dockExtra?: DockItem[]
  }
  children: ReactNode
}
```

**기본 제공(끄는 옵션 없음)**
| 위치 | 내용 | 근거 |
|---|---|---|
| 좌측 하단 | 계정 메뉴 = 이름·비밀번호·테마·패치노트·로그아웃 | admin에 4개가 빠져 있었음 |
| 우측 상단 | 전역 검색 · 전체 메뉴(QuickNav) · 알림 | CI·admin에 검색 없음 |
| 우측 하단 | Dock(§4) | FAB 충돌 |

- `AdminUserMenu`(1건, 로그아웃만) **폐기** → `SidebarProfile`(2건, 상위집합)로 단일화.
- `LogoutButton`(0건) 삭제.
- **새 셸을 만들 수 없게 한다.** CI도 `AppShell`을 쓰고 `workspace`만 주입 → `CiShell` 폐기.
- `MobileShell`은 **`AppShell`의 내부 구현**으로 남긴다(395줄 재작성 회피).

### 3-1. 셸 밖 화면 4개 처리 방침 (보완③ — 1판 공백)

| 화면 | 줄 | 성격 | 셸 계약 | L2~L5 계약 |
|---|---|---|---|---|
| `/login` | 97 | 인증 | ❌ **면제** | ✅ 적용 |
| `/change-password` | 168 | 인증 | ❌ **면제** | ✅ 적용 |
| `/develop` | **924** | 외부 공개 | ❌ **면제** | ✅ 적용 |
| `/api-access` | 155 | 외부 공개 | ❌ **면제** | ✅ 적용 |

**규칙**
- 이 4개는 **`PublicSurface`** 로 분류한다. 사이드바·전역검색·Dock·계정메뉴가 **없는 것이 정상**이다.
- 다만 **토큰(L4)·폼 클래스(`input-field`/`label`)·프리미티브(버튼·상태)·모달 표준은 동일 적용**한다.
- 가드의 `shell-contract`는 이 4개 경로를 **화이트리스트로 면제**한다. 화이트리스트에 없는 새 경로가 셸 없이 생기면 **차단**한다.
  → "면제"를 명시적 목록으로 두어야, 다음 사람이 "셸 안 써도 되네"로 오해하지 않는다.
- `/develop`(924줄)·`/api-access`는 **외부인이 보는 유일한 화면**이다. 토큰 이탈이 대외 신뢰에 직결되므로 **가드 예외를 주지 않는다.**

---

## 4. L0 — Dock: 우측 하단 레이어를 슬롯화

### 문제 (실측 확인)
| 레이어 | 좌표 | z |
|---|---|---|
| `QuickAddFab`(`.intake-fab`) | `bottom:1.5rem right:1.5rem` | 90 |
| `ci/AssistantPanel` FAB | `bottom:var(--space-4) right:var(--space-4)` | `var(--z-sticky)`=**90** |
| `ScrollJumpButtons` | `bottom:92` ← **매직넘버 회피** | 40 |

→ 앞의 둘이 좌표·z 모두 충돌. 육안으로 잘림.

### 설계: 좌표를 컴포넌트가 못 정하게 한다

```ts
// components/ui/shell/Dock.tsx — 우측하단 세로 스택. 좌표는 Dock만 안다.
type DockSlot = 'primary' | 'assistant' | 'utility'
interface DockItem { slot: DockSlot; order?: number; render: () => ReactNode }
```

| 슬롯 | 용도 | 현재 것 |
|---|---|---|
| `primary` | 화면의 주 행동 1개 | `QuickAddFab` |
| `assistant` | AI 어시스턴트 | `AssistantPanel` 트리거 |
| `utility` | 보조 | `ScrollJumpButtons` |

- Dock이 **세로 스택으로 자동 배치** → `bottom: 92` 매직넘버 소멸.
- 겹치면 Dock이 순서를 정하므로 **충돌이 물리적으로 불가능**.
- Dock 점유 영역을 `--dock-safe-area` CSS 변수로 노출 → 본문이 알아서 피한다.
- 화면이 `position: fixed`로 우측하단을 직접 점유하지 못하게 가드(§8).

---

## 5. L1 — PageScaffold: 페이지 골격 표준

### 흡수 대상 (신설 아님)
| 기존 | 사용 | 처분 |
|---|---|---|
| `ui/PageHeader` | 15 | ✅ **표준.** PageScaffold 내부로 |
| `ci/CiPageHeader` | 14 | ⛔ **폐기 → PageHeader로 이관** |
| `ui/WorkPageShell` | 7 | ✅ **PageScaffold의 원형.** 이걸 일반화한다 (globals.css `work-*` 39규칙과 한 쌍 — §3007 SSOT 주석 존재) |
| `ui/WorkSubTabs` 7 · `ProjectTabs` 4 · `StageNav` 4 · `WorkTabBar` 1 | 16 | ⛔ **`SegmentedTabs`로 통일** (5종 → 1종) |

```tsx
<PageScaffold
  title="채널"                      // PageHeader 내장 (raw h1 불가)
  description="..."
  tabs={[...]}                      // 있으면 SegmentedTabs 자동
  toolbar={<ListToolbar … />}       // 목록형이면 필수(§6)
  detail={<DetailSheet … />}        // 상세 슬롯 — 목록형이면 필수
>
  {본문}
</PageScaffold>
```

- 제목 타이포·간격·탭 위치가 **한 곳**에서 결정 → 헤더 2벌 문제 해소.
- `detail` 슬롯을 골격이 요구하므로 **"누르면 상세가 나온다"가 기본값**이 된다.

---

## 6. L2 — ListSurface: 목록 표준 (**유일하게 진짜 공백인 축**)

전수 검색 결과 `ListToolbar|Pagination|FilterBar|SortControl` **0건**. 여기만 신설이 정당하다.

### 6-1. 흡수 대상
| 기존 | 사용 | 처분 |
|---|---|---|
| `ui/DynamicTable` | 7 | ✅ `ListSurface`의 table 뷰로 흡수 |
| `ui/BulkActionBar` | 2 | ✅ `ListToolbar`의 선택 모드로 흡수 |
| `ui/TrashToggle` | 2 | ✅ `ListToolbar`의 필터칩으로 흡수 |
| `.table-card` 클래스 | **70** | ✅ **유지.** `ListSurface`가 내부에서 사용(모바일 카드 변환은 이미 이 클래스가 함) |
| `ui/nb/NbTable` | 2 | ⛔ `DynamicTable`로 흡수 후 폐기 |
| GPU `unified/ViewSwitcher` | 1 | ✅ 공용 `ViewSwitcher`로 승격 |

### 6-2. 하나의 계약

```ts
interface ListQuery {
  sort:   { key: string; dir: 'asc' | 'desc' }
  filters: Record<string, string | string[]>
  view:   'table' | 'card' | 'compact'
  size:   20 | 50 | 100
  page:   { mode: 'more' | 'pages'; cursor?: string; index?: number }
}
```

- **URL이 진실**(`?sort=…&view=…&size=…`) — 공유·새로고침·뒤로가기가 공짜로 성립. 현재 **절반(9화면)이 로컬 `useState`** 라 새로고침에 날아간다.
- `useListQuery(defaults)` 훅이 URL↔상태 동기화를 전담. 화면은 값만 읽는다.

### 6-3. 부품

| 부품 | 역할 | 신설/흡수 |
|---|---|---|
| `ListToolbar` | 검색·필터칩·정렬·보기전환·보기수량 한 줄 규격 | **신설** (+ BulkActionBar·TrashToggle 흡수) |
| `ListPager` | `more`/`pages` 두 모드를 같은 API로 | **신설** |
| `ListSurface` | `view`에 따라 표/카드/컴팩트 렌더 | 흡수(DynamicTable + .table-card) |
| `ColumnDef<T>` | 컬럼 1벌로 표·카드 양쪽을 그린다 | **신설** |
| `EmptyState`/`ErrorState`/`SkelList` | 빈·오류·로딩 3상태 강제 | **전부 기존 것**(§7) |

### 6-4. 성능 규약
| 규칙 | 이유 |
|---|---|
| 기본 `size=20`, 상한 100 | 무한 렌더 방지 |
| 목록 fetch는 **반드시 limit 포함** | 현재 전량 렌더 화면 다수 |
| 100행 초과 예상 목록은 `mode:'pages'` | 누적 `more`는 DOM이 계속 자람 |
| 카드 뷰는 이미지 `loading="lazy"` + 고정 비율 | CLS 방지 |
| 정렬·필터 변경은 **서버 재조회**, 클라 재정렬 금지 | 페이지네이션과 어긋남 |

### 6-5. 화면별 설정 기억
- 현재 **서버 저장소 0**(`user_preferences` 류 테이블 없음, `localStorage` 5화면뿐).
- 설계: `ui_preferences(user_id, scope_key, value jsonb, updated_at)` — `scope_key` = 라우트 경로.
- 우선순위: **URL > 저장된 설정 > 화면 기본값.** (공유 링크가 남의 설정에 덮이면 안 된다.)
- 저장 범위: `view`·`size`·`sort`만. **필터는 저장하지 않는다** — 다음 방문에 "왜 데이터가 없지?"가 된다.

---

## 7. L3 — 프리미티브: **중복 통일** (1판은 "신설"이었음 — 최대 정정)

### 7-1. 로딩 — 6종 77건 → 2종

| 현재 | 사용 | 결정 |
|---|---|---|
| `SkelPage`/`SkelCard`/`SkelList` (`ui/LoadingSkeleton.tsx`) | **27** | ✅ **표준 — 콘텐츠 골격형** |
| `AXDotLoader` | **35** | ✅ **표준 — 인라인 소형(버튼 내부·부분 갱신)** |
| `AXLoadingOverlay` | 7 | ⛔ `SkelPage` + 오버레이 옵션으로 흡수 |
| `ci/states→RowSkeleton` | 5 | ⛔ `SkelList`로 이관 |
| `BrandLoaderMark` 2 · `NavigationLoader` 1 | 3 | ⏸ 전역 라우팅 전용 — 존치(용도 다름) |
| `SkelLine` · `CardSkeleton` | **0** | ⛔ 삭제 |
| 자작 "불러오는 중" 문구 | 37 | ⛔ 신규 차단 |

> **1판은 "LoadingSkeleton 0건 → `ListSkeleton`·`Skeleton` 신설"이었다. 27건 쓰이는 걸 못 보고 7번째를 만들 뻔했다.**

### 7-2. 빈 상태 / 오류 — 2벌 → 1벌

| 현재 | 사용 | 결정 |
|---|---|---|
| `ui/EmptyState` | 18 | ✅ **표준** |
| `ci/states→EmptyState` (**이름 동일**) | 18 | ⛔ **폐기 → `ui/EmptyState`로 이관** |
| `ci/states→ErrorState` | **11** | ✅ **`ui/ErrorState`로 승격 이동** (신설 아님) |
| `ci/states→InsufficientData` | 2 | ⏸ CI 도메인 전용 존치 |
| 자작 "없습니다" 문구 | 188 | ⛔ 신규 차단 |

### 7-3. 나머지

| 항목 | 지금 | 목표 |
|---|---|---|
| 버튼 | `NbButton` 85 / 클래스 180 / 자작 **352** | `NbButton` 단일, 클래스는 내부 구현 |
| 카드 | `.card` **196** / `NbCard` **0** / 자작 476 | **`.card` 클래스 단일** (§2-3) |
| 폼 | `input-field` **247** / `NbField` **0** | **`input-field` 단일**, `NbField` 폐기 |
| 모달 | `NbModal` 5 / 개별 26파일 / `useEscClose` 91 · `tape-title` 118 | `NbModal`을 §2-2 체크리스트의 구현체로 삼고 점진 이관 |
| 탭 | 5종 16건 | `SegmentedTabs` 단일 |
| 정렬 아이콘 | `SortIcon` 26 + 26 (2벌) | **1벌로 통합** |
| z-index | 토큰 7종 / 하드코딩 **57** | 하드코딩 금지, 토큰만 |
| 색 | `'white'` 217 · `rgba()` 187 | 토큰만 |
| 폰트 | 토큰 84.5% | 100%, **10px 미만 0** (globals.css 포함) |

---

## 8. 가드 설계 — **기존 스크립트를 확장한다. 병렬 신설 금지** (보완④)

### 8-1. 이미 있는 것 (1판이 몰랐던 것)

| 가드 | 이미 잡는 것 |
|---|---|
| `scripts/check-design-tokens.mjs` (`pnpm design:check`) | hex **즉시차단** · swr 전역 mutate **즉시차단** · `rgba()` · 미정의 토큰(`--text-sm`) · **raw `<input/select/textarea>`의 `input-field` 누락** ← ratchet, baseline **294건** |
| `lib/ui/integration-consistency.test.ts` | 연동 카드 용어·기능 일관성(§2-5) |
| `lib/work/mobile-layout-guard.test.ts` | 업무 화면 모바일 레이아웃 |

> **1판 §7의 "design:check는 hex·치수만 본다"는 사실이 아니다.** 클래스 미사용 탐지는 이미 있다.
> CLAUDE.md §3-1의 "사각지대" 서술이 낡아서 그대로 옮겨진 것 → **정책도 같이 고친다**(§9).

### 8-2. 진짜 사각지대 → 이걸 먼저 막는다

| 사각지대 | 실측 증거 | 조치 |
|---|---|---|
| **`globals.css`를 스캔하지 않는다** (루트 = `app`+`components`) | `.gpu-chip span{font-size:7px}` · `9px` · `0.55rem`이 통과 중 | **스캔 루트에 `app/globals.css` 추가** |

### 8-3. 추가 가드 (전부 `check-design-tokens.mjs` 확장 + 기존 test 파일 옆에)

| 가드 | 잡는 것 | 위치 |
|---|---|---|
| `css-scope` | globals.css **신규** 도메인 prefix 규칙 추가 | design:check 확장 |
| `shell-contract` | `MobileShell` 직접 사용 / 새 셸 신설 (`PublicSurface` 4경로 화이트리스트 면제) | `lib/ui/shell-contract.test.ts` |
| `dock-exclusive` | 화면이 `fixed`+`bottom`+`right`로 우측하단 점유 | `lib/ui/dock-exclusive.test.ts` |
| `primitive-adoption` | 자작 버튼/카드/로딩/빈상태 **신규 유입** | design:check ratchet 확장 |
| `token-only` | z-index·색 하드코딩 | design:check 확장 |
| `duplicate-component` | **같은 이름을 2곳이 export**(EmptyState 사고 재발 방지) | `lib/ui/duplicate-component.test.ts` |

**ratchet 방식**: 기존 위반은 baseline 동결, **신규 유입만 차단**. (design:check가 이미 이 방식 — baseline 294건)

### 8-4. ⚠️ 등재 절차 (빠뜨리면 가드가 안 돈다)

`apps/web/package.json`의 `test` 스크립트는 **수기 파일 목록 171개**다. `*.test.ts`를 만들어도 자동 포함되지 않는다.

**새 가드 1개당 반드시:**
1. `lib/ui/<name>.test.ts` 작성
2. **`apps/web/package.json` `test` 목록에 경로 추가**
3. **일부러 위반 코드를 넣어 실패를 확인** ← v0.7.438에서 1차 가드가 부분문자열 매칭이라 통과해버린 전례 있음
4. 원복 후 통과 확인

---

## 9. 정책 문서 개정안 (CLAUDE.md + AGENTS.md)

§2를 **"§2 디자인 시스템 — 참조 순서"** 로 개편하고, **낡은 서술 2곳을 정정**한다.

### 9-1. 신설: 참조 순서 (강제)

> **구현 착수 전, 무엇을 만들지 정해지면 아래 순서로 시스템을 먼저 조회한다.**
> 1. **`docs/ui-system/INVENTORY.md`** 에 동일 성격 부품이 있는가 → 있으면 **그대로 쓴다**
> 2. **중복 경보(§1)에 해당하는 성격인가** → 해당하면 **새로 만들지 말고 통일 대상을 먼저 확인**한다
> 3. 없으면 **시스템에 먼저 정의**하고(부품 + INVENTORY 등재 + 가드) 그 다음 화면에 쓴다
> 4. 화면에만 존재하는 UI를 만들지 않는다 — 두 번째 사용처가 생기는 순간 이미 늦다

### 9-2. 정정할 낡은 서술

| 위치 | 현재 (틀림) | 정정 |
|---|---|---|
| §2 "카드 → `NbCard`" | `NbCard` 0건, 실제는 `.card` 196건 | **"카드 → `.card` 클래스"** |
| §2 (암묵) 필드 | `NbField` 0건 | **"입력 → `input-field` 클래스"**(§2-1과 통합) |
| §3-1 "design:check는 클래스 누락을 탐지 못 함" | `rawInputRe`가 이미 탐지 | **"globals.css를 스캔하지 않는다"로 정정** |

### 9-3. 신규 화면 체크리스트 (전부 충족해야 착수)

- [ ] `INVENTORY.md`를 열어 **동일 성격 부품이 없음을 확인**했는가
- [ ] `AppShell`을 쓰는가 (새 셸 신설 금지 / `PublicSurface` 4경로는 면제)
- [ ] `PageScaffold` + `PageHeader`를 쓰는가
- [ ] 목록형이면 `ListToolbar`/`ListPager`/`ListSurface` + `useListQuery`를 쓰는가
- [ ] 항목 클릭 시 상세(시트)가 열리는가
- [ ] 고정 레이어가 필요하면 **Dock 슬롯으로 등록**했는가
- [ ] 빈·로딩·오류 3상태를 **기존 부품**(`EmptyState`/`ErrorState`/`SkelList`)으로 처리했는가
- [ ] 폼은 `input-field`·`label`, 모달은 `useEscClose`·`tape-title`을 썼는가
- [ ] 색·폰트·z-index를 **토큰으로만** 썼는가
- [ ] 화면 전용 스타일을 **globals.css에 추가하지 않았는가**
- [ ] 새 부품을 만들었다면 **`INVENTORY.md`에 등재**했는가

**AGENTS.md에 동일 내용 동기화** (Codex 정책 파일).

---

## 10. 이 설계가 사용자 지적을 어떻게 막는가

| 지적 | 이 설계에서 |
|---|---|
| 계정 메뉴가 화면마다 다름 | AppShell이 **끌 수 없는 기본**으로 제공 |
| 검색·전체메뉴 누락 | 동일 |
| 우측하단 레이어 충돌 | Dock이 좌표를 독점, 화면은 슬롯 등록만 |
| 누르면 상세 안 나옴 | PageScaffold의 `detail` 슬롯 |
| 목록 표준 없음 | ListToolbar/Pager/Surface + `useListQuery` (**유일한 신설 축**) |
| 페이지 단위 설정 저장 | `ui_preferences` 테이블 + URL 우선순위 |
| GPU는 할 때마다 다른 구현 | 목록 표준으로 흡수(마지막 단계) |
| **또 새로 만들어 냄** | **INVENTORY 색인 + 중복 경보 + `duplicate-component` 가드** |
