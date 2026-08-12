# 감사문서 검증 — "전수조사 맞나"

검증일 2026-08-12 · 기준 v0.7.438 · 대상 `01-AUDIT.md` / `02-SYSTEM.md` / `03-PLAN.md`
**이 문서는 검증 결과만 담는다. 코드·정책·DB 변경 0.**

---

## 0. 한 줄 결론

> **적힌 수치는 재현된다. 그러나 "전수"는 아니다.**
> 조사 대상에서 **화면 5개 · 공용부품 42개 · globals.css 9,710줄**이 통째로 빠졌고,
> 그 누락이 문서의 핵심 결론("공용 부품이 사문화됐다")을 **부분적으로 뒤집는다.**

---

## 1. 재현 검증 — 문서 수치 ↔ 독립 실측

전부 `apps/web`에서 직접 재측정.

| 문서 주장 | 문서값 | 실측값 | 판정 |
|---|---|---|---|
| `NbCard` 사용 | 0 | **0** | ✅ |
| `NbField` 사용 | 0 | **0** | ✅ |
| `LoadingSkeleton` 사용 | 0 | **0** | ✅ |
| `NbButton` 사용 | 85 | **85** | ✅ |
| `PageHeader` 사용 | 15 | **15** | ✅ |
| `EmptyState` 사용 | 18 | **18** | ✅ |
| `NbBadge` 사용 | 10 | **10** | ✅ |
| `<button style={{` 자작 | 352 | **352** | ✅ |
| 인라인 `style={{` | 4,931 | **4,931** | ✅ |
| `className=` | 3,257 | **3,257** | ✅ |
| `zIndex:` 숫자 하드코딩 | 57 | **57** | ✅ |
| `rgba()` | 187 | **187** | ✅ |
| 셸 3종 | 3 | **3** (`(member)/layout` · `admin/layout` · `CiShell`) | ✅ |
| design:check baseline | 294 | **294** (실행 확인) | ✅ |
| `btn-primary`/`btn-ghost` | 107 | **180** (124+56) | ⚠️ 과소집계, 방향은 동일 |
| `'white'`/`#fff` | 209 | **217** | ⚠️ 오차 소폭 |
| 10px 미만 폰트 | 8 | **5 확정**(tsx 2 + globals.css 3) | ⚠️ 위치 귀속 불명 |

**FAB 충돌(§3)** — 소스로 재확인:
- `globals.css .intake-fab` → `position:fixed; bottom:1.5rem; right:1.5rem; z-index:90`
- `components/ci/AssistantPanel.tsx:77` → `position:'fixed'; right:var(--space-4); bottom:var(--space-4); zIndex:var(--z-sticky,90)`
- `components/ui/ScrollJumpButtons.tsx:57` → `bottom: 92, // FAB(하단) 위로` (매직넘버 실재)

→ **좌표·z 동시 충돌 사실. 매직넘버 회피도 사실.** ✅

**목록 공용부품 0개(§5)** — `Pagination|Paginator|ListToolbar|DataTable|TableToolbar|FilterBar|SortControl` 전수 검색 결과 **0건**. ✅

> **1절 판정: 문서가 제시한 수치는 조작·추정이 아니라 실측이다. 재현 가능하다.**

---

## 2. 빠진 것 — "전수"가 성립하지 않는 근거

### 2-1. 화면 5개가 조사 대상에서 빠졌다

문서: "apps/web **전체 화면 76개**"
실측: `find app -name page.tsx` = **81개**

빠진 5개 = **셸(layout) 밖에 있는 화면 전부**:

| 화면 | 성격 |
|---|---|
| `app/page.tsx` (`/`) | 루트 |
| `app/(auth)/login` | 로그인 |
| `app/change-password` | 비밀번호 변경 |
| `app/develop` | 외부 API 프로그램(공개) |
| `app/api-access` | 외부 API 프로그램(공개) |

- 이 5개는 `MobileShell`을 쓰지 않는다(= 셸 3개 중 어디에도 안 들어감).
- **02-SYSTEM §2가 "새 셸을 만들 수 없게 한다 / AppShell만 허용"이라고 설계했는데, 셸이 아예 없는 이 5개를 어떻게 할지는 설계에 없다.**
- `/develop`·`/api-access`는 **로그인 없이 외부인이 보는 화면**이다. 디자인 일관성이 가장 중요한 표면인데 조사에서 빠졌다.

### 2-2-0. 🚨 결정적 오판 — **부품 사용량을 파일명으로 셌다**

감사문서는 `<LoadingSkeleton` 같이 **파일명**으로 JSX 사용을 셌다.
그런데 `components/ui/LoadingSkeleton.tsx`가 export 하는 이름은 **`SkelPage`·`SkelCard`·`SkelList`·`SkelLine`** 이다.

**export 이름 기준 재측정 결과:**

| 심볼 | 실사용 |
|---|---|
| `SkelPage` | **11** |
| `SkelCard` | **9** |
| `SkelList` | **7** |
| `SkelLine` | 0 |
| **합계** | **27** |

> **감사문서 §1 "`LoadingSkeleton` **0** ❌ 완전 사문화"는 사실이 아니다. 27곳에서 쓰이고 있다.**
> 그리고 02-SYSTEM §6은 이걸 "0건"으로 보고 **`ListSkeleton`·`Skeleton`을 신설**하겠다고 설계했다.
> 그대로 구현하면 **7번째 로딩 부품**이 생긴다 — 사용자가 지적한 "또 새로 만들어 낸다"를 설계가 그대로 재생산한다.

같은 방식으로 드러난 것:

| 발견 | 실측 |
|---|---|
| `EmptyState`가 **2벌**이고 **이름까지 같다** | `ui/EmptyState.tsx`(18) ↔ `ci/states.tsx`(18) |
| `ErrorState`가 이미 있다 (설계는 "신설"이라 했음) | `ci/states.tsx` **11건** |
| 페이지 헤더가 **2벌** | `PageHeader` 15 ↔ `CiPageHeader` **14** |
| 정렬 아이콘 **2벌**, 사용량 동률 | `gpu/SortIcon` 26 ↔ `cockpit/SortIcon` **26** |
| 로딩 부품이 **6종 77건** | `AXDotLoader` 35 · `Skel*` 27 · `AXLoadingOverlay` 7 · `RowSkeleton` 5 · `BrandLoaderMark` 2 · `NavigationLoader` 1 |
| 탭이 **5종** | `WorkSubTabs` 7 · `ProjectTabs` 4 · `StageNav` 4 · `SegmentedTabs` 1 · `WorkTabBar` 1 |
| **진짜** 죽은 부품은 4파일뿐 | `NbCard` · `NbField`(4심볼) · `LogoutButton` · `WeeklyReportBannerButton` |

**재현**: `node docs/ui-system/scan-inventory.mjs --dupes` / `--dead`
**총계**: 컴포넌트 97파일 / export 심볼 **121개** / 미사용 12심볼

> **결론 정정: 문제는 "안 쓴다"가 아니라 "두 번 만들었다"이다.**

### 2-2. 공용 부품 52개 중 10개만 조사했다

`components/ui/**` 실측 = **52개 파일**. 감사문서 §1 표는 **10개**만 다뤘다.

**빠진 것 중, 이미 준표준으로 쓰이고 있는 것들:**

| 부품 | 실사용 | 성격 | 감사문서 |
|---|---|---|---|
| `AXDotLoader` | **35** | 로딩 표시 | ❌ 미언급 |
| `DraftRestoreBanner` | 10 | 초안 복구 | ❌ |
| `WorkPageShell` | 7 | **페이지 골격(=PageScaffold 유사)** | ❌ |
| `WorkSubTabs` | 7 | 탭 | ❌ |
| `DynamicTable` | 7 | **표(=ListSurface 유사)** | ❌ |
| `AXLoadingOverlay` | 7 | 로딩 오버레이 | ❌ |
| `NbModal` | 5 | 모달 | ❌ |
| `ProjectTabs` | 4 | 탭 | ❌ |
| `SlidePanel` | 3 | 상세 시트 | △ (§6에만 언급) |
| `BulkActionBar` | 2 | 목록 일괄액션 | ❌ |
| `QueryToast` | 2 | 토스트 | ❌ |
| `TrashToggle` | 2 | 목록 필터 | ❌ |

**이게 왜 치명적인가:**

1. **§1 "로딩: LoadingSkeleton 0 / 자작 37"** → 실제로는 `AXDotLoader`가 **35곳**에서 쓰이는 사실상의 표준 로딩 부품이다. 문서는 이걸 "자작 37"에 섞어 넣었거나 아예 못 봤다. **02-SYSTEM §6이 "ListSkeleton·Skeleton 단일"로 새로 만들면 로딩 방식이 4번째로 늘어난다.**
2. **§1 표에 `WorkPageShell`(7)이 없다** → 02-SYSTEM §4가 `PageScaffold`를 "신설"한다고 하는데, 유사 부품이 이미 7곳에서 돌고 있다. 흡수인지 대체인지 폐기인지 설계에 없다.
3. **`DynamicTable`(7)·`BulkActionBar`(2)·`TrashToggle`(2)** → 목록 부품이 "0개"라는 §5 주장은 **완전히 0은 아니다.** 툴바·페이저는 실제로 없지만, 표·일괄액션·휴지통 토글은 있다.

### 2-3. globals.css 9,710줄이 조사 대상에서 0이다

| 항목 | 실측 |
|---|---|
| `app/globals.css` | **9,710줄** |
| 최상위 `.클래스` 규칙 | **약 1,550개** |
| 테마 블록 | 3개 (`nb`/`classic`/`mono`) |

**감사문서 3종 어디에도 globals.css 분석이 없다.** 부품 채택률·인라인 비율·토큰 준수율을 전부 `.tsx`에서만 셌다.

그 결과 놓친 것:
- **10px 미만 폰트 위반이 globals.css 안에 있다** — `.gpu-chip span { font-size: 7px }`, `font-size: 9px`, `font-size: 0.55rem`. §3-1 위반이 **CSS 본체**에 박혀 있는데 §7은 tsx만 봤다.
- `.intake-fab`의 `z-index:90`·좌표도 globals.css에 있다 — §3은 브라우저 실측으로 잡았지만 **소스 위치를 특정하지 못했다.**

> **newAX의 디자인 시스템 본체는 globals.css다. 그걸 안 열어보고 "시스템이 안 지켜진다"고 판정했다.**

### 2-4. CLAUDE.md 필수정책 4개 항목을 측정하지 않았다 — 그런데 그게 결론을 뒤집는다

감사문서는 §2(컴포넌트)만 봤고, **§2-1(폼 클래스)·§2-2(모달 표준)·반응형 정책(table-card/responsive-grid)** 은 측정하지 않았다.

실측 결과:

| 필수정책 | 표준 사용 | 대상 총량 | 채택 상태 |
|---|---|---|---|
| §2-1 `input-field` | **247** | `<input>` 243 + `<select>` 108 + `<textarea>` 47 | ✅ **높음** |
| §2-1 `className="label"` | **185** | — | ✅ 높음 |
| §2-2 `useEscClose` | **91** | 모달 파일 26 | ✅ 높음 |
| §2-2 `tape-title` | **118** | — | ✅ 높음 |
| 반응형 `.table-card` | **70** | `<table>` 65 | ✅ **높음** |
| 반응형 `.table-responsive`(금지) | 7 | — | ⚠️ 잔존 |
| 반응형 `responsive-grid-*` | **61** | `gridTemplateColumns` 34 | ✅ 우세 |

**이게 왜 결론을 바꾸는가:**

감사문서 §0의 결론은 **"부품도 있고 정책도 있는데 코드가 안 쓴다 = 강제력 부족"** 이다.
그런데 실측은 두 갈래다:

| 시스템 종류 | 채택률 | 판정 |
|---|---|---|
| **React 컴포넌트 계열**(`Nb*`, `PageHeader`, `EmptyState`, `LoadingSkeleton`) | 0~18 | ❌ 사문화 — **문서 주장 맞음** |
| **CSS 클래스 계열**(`input-field`, `label`, `tape-title`, `table-card`, `responsive-grid`, `useEscClose`) | 61~247 | ✅ **잘 지켜지고 있음 — 문서가 안 봤음** |

> **newAX의 실제 디자인 시스템은 "CSS 클래스 기반"이고, 그건 꽤 잘 지켜지고 있다.**
> **감사는 "React 컴포넌트 기준"으로만 재서 "시스템이 안 지켜진다"고 판정했다.**
>
> 실제 문제는 "강제력 부족"보다 **"두 시스템이 병존하는데 정책 문서(§2)만 컴포넌트 편을 든다"** 에 가깝다.

### 2-5. 가드 진단이 틀렸다 — design:check는 이미 클래스 미사용을 잡는다

감사문서 §12-E: "가드가 hex/치수만 본다(design:check 사각지대)".
**실측 — `scripts/check-design-tokens.mjs`(98줄)가 이미 잡는 것:**

| # | 검사 | 방식 |
|---|---|---|
| ① | hex 색 (`#rrggbb`) | **즉시 차단** |
| ② | swr 모듈레벨 전역 `mutate` import | **즉시 차단** |
| ③ | `rgba()` | ratchet |
| ④ | 미정의 토큰 (`var(--text-sm)` 등) | ratchet |
| ⑤ | **raw `<input/select/textarea>`에 `input-field` 누락** (`:45 rawInputRe`) | ratchet |

→ **⑤가 이미 "공용 클래스 미사용"을 탐지한다.** 감사문서는 CLAUDE.md §3-1의 **낡은 자백문("클래스 누락은 탐지 못 함")을 그대로 옮겼다.**

**진짜 사각지대는 따로 있다** — 스캔 루트가 `apps/web/app` + `apps/web/components` 뿐이라 **`app/globals.css`를 보지 않는다.**
그래서 CSS 본체의 `.gpu-chip span{font-size:7px}` · `font-size:9px` · `0.55rem`이 §3-1(10px 미만 금지)을 위반한 채 통과 중이다.

**그 외 이미 존재하는 UI 정적 가드 2종 (감사문서 미언급):**

| 가드 | 잡는 것 |
|---|---|
| `lib/ui/integration-consistency.test.ts` | 연동 카드 용어·기능 일관성 (v0.7.438, CLAUDE.md §2-5) |
| `lib/work/mobile-layout-guard.test.ts` | 업무 화면 모바일 레이아웃 |

- 02-SYSTEM 1판은 가드 5종을 "추가"한다고 했는데, **이미 있는 3종(design:check 포함)과의 관계가 없었다.**
- `pnpm test`는 **171개 테스트 파일을 손수 나열한 목록**으로 돈다. 새 가드는 그 목록에 등재해야 도는데 1판 03-PLAN에 없었다.

---

## 3. 다루지 않은 축 (UI 범위 밖이지만 "모든 기능" 기준으로는 공백)

| 축 | 규모 | 감사 |
|---|---|---|
| API 라우트 | **201개** (`app/api/**/route.ts`) | 대상 아님(UI 감사) |
| 접근성(a11y) | `aria-*` 542 · `role=` 248 | ❌ 미조사 |
| 반응형 실측(320/768/1024/1440) | — | ❌ 미조사 (`/ci/inbox` 1화면 육안 확인만) |
| 테마 3종 교차 검증 | nb/classic/mono | ❌ 미조사 |

**테마 관련 정정 필요:**
문서 §7은 `'white'` 209건 → "**다크 테마**에서 흰 박스로 튄다"고 했다.
실측: 테마 3개 중 **전면 다크 테마는 없다.** `mono`가 `--sidebar-bg:#111` (사이드바만 다크), `--surface-bg:#f8f8f8`(본문은 밝음).
→ 위험은 **실재하지만**(mono 사이드바 맥락 + 향후 테마 추가), 문서 표현("396곳이 다크에서 깨진다")은 **현재 테마 구성에서 과장**이다.

---

## 4. 종합 판정

| 질문 | 답 |
|---|---|
| 수치가 실측인가 | ✅ **그렇다.** 16개 중 13개 정확 일치, 3개 소폭 오차 |
| 사용자 지적 7건이 사실인가 | ✅ **전부 사실 확인됨** (셸 3종 불일치·FAB 충돌·목록 툴바 부재·상세 진입 3종) |
| **"우리가 가진 모든 기능"을 조사했는가** | ❌ **아니다** |

**빠진 범위:**
1. 화면 **5개**(셸 밖 공개·인증 화면 — `/develop`, `/api-access` 포함)
2. 공용 부품 **42개**(52 중 10만 조사) — 그중 사용량 있는 준표준 12개
3. **globals.css 9,710줄 / 규칙 1,550개 = 디자인 시스템 본체 전체**
4. CLAUDE.md 필수정책 **4개 항목**(폼·모달·표·그리드) — 측정했다면 결론이 달라짐
5. 기존 UI 가드 **2개**

**그 결과 결론이 한쪽으로 기울었다:**
"공용 부품이 전부 사문화" → 실제로는 **컴포넌트 계열만 사문화, 클래스 계열은 잘 지켜짐**.

---

## 5. 구현 전 보완이 필요한 것 (권고 — 실행 안 함)

| # | 보완 | 이유 |
|---|---|---|
| 1 | `components/ui/**` **52개 전수 인벤토리** 작성 | `AXDotLoader`(35)·`WorkPageShell`(7)·`DynamicTable`(7)을 모르고 `Skeleton`·`PageScaffold`·`ListSurface`를 새로 만들면 **방식이 하나 더 늘어난다** |
| 2 | **globals.css 1,550 규칙 ↔ 신설 컴포넌트 매핑** 결정 | 컴포넌트 레이어가 기존 클래스를 흡수하는지 병존하는지 미정. 병존하면 지금 문제가 그대로 재생산 |
| 3 | 셸 밖 화면 **5개 처리 방침** 명시 | AppShell 강제 정책이 이 5개에 어떻게 적용되는지 공백. 외부 공개 화면 포함 |
| 4 | 기존 가드 2종 + `pnpm test` 목록 등재 절차 반영 | 가드 5종 신설 시 등재 누락하면 **만들고 안 도는 가드**가 된다 |
| 5 | §7 "다크 테마" 표현 정정 | 전면 다크 테마 부재. mono 사이드바 맥락으로 근거 재기술 |
| 6 | 감사 결론 §0 재작성 | "부품 사문화"가 아니라 "**컴포넌트 시스템과 클래스 시스템의 이중화**"가 실제 문제 |

---

## 6. 재현 명령

```bash
cd apps/web
find app -name "page.tsx" | wc -l                      # 81 (문서 76)
find components/ui -name "*.tsx" | wc -l               # 52 (문서 표 10)
wc -l app/globals.css                                  # 9710
grep -cE "^\." app/globals.css                         # ~1550
for c in AXDotLoader WorkPageShell DynamicTable NbModal; do
  echo "$c $(grep -rn "<$c" app components | wc -l)"; done
grep -rn "input-field" app components | wc -l          # 247
grep -rn "table-card" app components | wc -l           # 70
grep -rn "<table" app components | wc -l               # 65
find lib -name "*guard*" -o -name "*consistency*"      # 기존 가드 7종
```

---

## 7. 보완 이행 결과 (2026-08-12 · 사용자 선택 (a) — 문서 정정 후 구현)

| # | 보완 | 결과 |
|---|---|---|
| ① | 부품 전수 인벤토리 | ✅ `docs/ui-system/INVENTORY.md`(121심볼 색인 + 중복 경보) · `docs/ui-system/scan-inventory.mjs`(실측 재현) |
| ② | globals.css ↔ 컴포넌트 매핑 | ✅ `02-SYSTEM §2` — 토큰 유지 / 공용클래스 흡수 / **도메인 1,350규칙 이동 금지·신규만 차단** |
| ③ | 셸 밖 화면 처리 | ✅ `02-SYSTEM §3-1` — `PublicSurface` 4경로, **셸 계약만 면제·나머지 전부 적용** |
| ④ | 기존 가드 + test 등재 | ✅ `02-SYSTEM §8` — design:check **확장**(병렬 신설 금지) + `package.json` 등재 절차 + 일부러 깨서 확인 |
| ⑤ | 감사문서 정정 | ✅ `01-AUDIT` 2판(§0·§1·§2-1·§5·§7·§8-1·§10·§11·§12) · `02-SYSTEM` 2판 · `03-PLAN` 2판 |
| ⑥ | 정책 개정 | ✅ `CLAUDE.md §0·§0-1·§2·§4·§4-1` · `AGENTS.md` 동기화 |

**변경 파일 (전부 문서·정책. 앱 코드 0줄)**
```
docs/2026-08-12-v0.7.438-ui-system-audit/00-VERIFY.md   (신규)
docs/2026-08-12-v0.7.438-ui-system-audit/01-AUDIT.md    (정정)
docs/2026-08-12-v0.7.438-ui-system-audit/02-SYSTEM.md   (2판 재작성)
docs/2026-08-12-v0.7.438-ui-system-audit/03-PLAN.md     (2판 재작성)
docs/ui-system/INVENTORY.md                             (신규)
docs/ui-system/scan-inventory.mjs                       (신규)
CLAUDE.md                                               (정책)
AGENTS.md                                               (정책 동기화)
```

**아직 하지 않은 것 (Phase 0 이후 — 범위 승인 대기)**
- `design:check` 스캔 루트에 `globals.css` 추가
- 가드 3종 신설(`shell-contract`·`dock-exclusive`·`duplicate-component`) + `package.json` 등재
- `AppShell`·`Dock`·`PageScaffold`·목록 부품 신설
- 부품 중복 통일(로딩 6→2, 탭 5→1, 헤더/빈상태/정렬아이콘 2벌→1)
- 죽은 부품 4파일 삭제

→ **앱 코드·DB 변경 0. 커밋 0.**
