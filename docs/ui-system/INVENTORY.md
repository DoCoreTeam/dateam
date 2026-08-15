# UI 시스템 인벤토리 — 단일 색인 (SSOT)

실측일 2026-08-12 · 기준 v0.7.438 · 대상 `apps/web/components` **97파일 / export 심볼 121개** 전수

> **이 문서는 "무엇을 만들지 정해졌을 때 가장 먼저 여는 곳"이다.**
> 여기 있으면 **그대로 쓴다.** 없으면 **여기 등재하면서 만든다.** 화면에만 존재하는 UI는 만들지 않는다.
> 숫자는 실사용 건수(JSX 태그 기준, export 이름으로 집계 — 파일명 아님).

---

## 0. 읽는 법 — 클래스 시스템과 컴포넌트 시스템이 둘 다 있다

newAX의 UI는 **두 축**으로 되어 있다. 어느 쪽을 쓸지는 아래 기준으로 정한다.

| 축 | 정체 | 규모 | 채택률 | 언제 쓰나 |
|---|---|---|---|---|
| **A. 클래스** (`globals.css`) | `input-field` · `label` · `table-card` · `tape-title` · `responsive-grid-*` | 9,710줄 / 최상위 규칙 1,550 / 토큰 123 | **높음** (247·185·70·118·61) | 폼·표·그리드·타이포 — **기존대로 유지** |
| **B. 컴포넌트** (`components/`) | `NbButton` · `EmptyState` · `SkelPage` · `PageHeader` | 97파일 / 심볼 121 | **혼재** (0~85) | 상태·동작·조합이 붙는 것 |

**결정 규칙**
1. **순수 스타일**(모양만)이면 → **클래스**. 새 컴포넌트를 만들지 않는다.
2. **상태·이벤트·조합**이 붙으면 → **컴포넌트**. 컴포넌트 내부가 클래스를 쓴다.
3. 화면이 클래스와 컴포넌트를 **동시에 재구현하지 않는다.**

---

## 1. 🚨 중복 경보 — 같은 것이 2벌 이상 존재 (신규 작업 전 필독)

**이게 이 시스템의 가장 큰 실제 문제다. "안 쓴다"가 아니라 "두 번 만들었다".**

| 무엇 | 구현 A | 구현 B | 상태 |
|---|---|---|---|
| **빈 상태** | ~~2벌~~ → **`ui/EmptyState` 1벌** (v0.7.445, 이긴 CI판을 승격) | — | ✅ 해소 |
| **페이지 헤더** | ~~2벌~~ → **`ui/PageHeader` 1벌** (v0.7.445, `below` 슬롯으로 stageNav 흡수) | — | ✅ 해소 |
| **정렬 아이콘** | ~~7곳 자작~~ → **`ui/SortIcon` 1벌** (v0.7.445, `active`+`dir` 계약) | — | ✅ 해소 |
| **로딩** | `ui/LoadingSkeleton`(Skel*) **32** · `ui/AXDotLoader` **35** · `ui/AXLoadingOverlay` **7** · `ui/BrandLoaderMark` **2** · `ui/NavigationLoader` **1** | — | ⛔ **5종 병존** (v0.7.445에 `ci/states` 골격만 `SkelList`로 흡수) |
| **탭** | ~~5종~~ → **`ui/SegmentedTabs` 1벌이 그린다** (v0.7.445). `WorkSubTabs`·`ProjectTabs`·`WorkTabBar`·`StageNav`는 데이터/프롭 어댑터 | — | ✅ 해소 |
| **상세 표면** | `ci/DetailSheet` **4** · `ui/SlidePanel` **6** · 모달 26파일 · `[id]` 페이지 9 | — | ⛔ 3방식 (v0.7.456에 자작 드로어 3벌은 SlidePanel로 흡수) |
| **표** | ~~4방식~~ → **`ui/list/ListSurface` 1벌** (v0.7.477). `ui/nb/NbTable`·`ui/BulkActionBar` **삭제** — 화면 2개만을 위한 병렬 소계통이었다. 전체선택은 ListSurface가 흡수 | 28 | ✅ 부품은 1벌. 화면 이관은 `list-standard` PENDING으로 단조 감소 |
| **셸** | ~~3벌~~ → **`ui/shell/AppShell` 1벌** (v0.7.443 통합) | `ui/shell/AppShell` | ✅ 해소 |

> **신규 작업 규칙: 위 표에 있는 성격의 UI를 만들 때는 새로 만들지 말고, 어느 쪽으로 통일할지 먼저 정한다.**

---

## 2. L0 — 셸 (전 화면 골격)

| 부품 | 사용 | 역할 |
|---|---|---|
| **`ui/shell/AppShell`** | **3** | **화면이 쓰는 유일한 셸.** 계정 메뉴·전역검색·전체메뉴·Dock을 **항상** 넣는다(끄는 옵션 없음). `items·groups·session·branding·workspace·extras` |
| `ui/shell/Dock` | 1 | 우측하단 고정 레이어의 **유일한 좌표 주인**. 슬롯 `primary/assistant/utility` |
| `ui/MobileShell` | 1 | AppShell **내부 구현**(사이드바·헤더·모바일 드로어). 화면에서 직접 import 금지 |
| `ui/SidebarProfile` | 1 | 좌측하단 계정 메뉴 — 이름·비번·테마·패치노트·로그아웃. `/admin`에서는 "멤버 화면으로" |
| `ui/QuickNav` | 1 | 우측상단 전체 메뉴 — AppShell이 항상 넣음 |
| `ui/GlobalSearchBox` | 1 | 우측상단 전역 검색 — AppShell이 항상 넣음(예전엔 admin·CI에 없었다) |
| `ci/NotificationBell` | 1 | 알림 벨 — CI가 `extras.headerExtra`로 **추가** |

**빠뜨릴 수 없는 구조다.** 예전 자유 슬롯(`footer`/`headerRight`) 시절엔 admin에 전역검색·테마·비밀번호가 통째로 없었고 CI엔 검색이 없었다.
가드: `lib/ui/shell-contract.test.ts`(새 셸 신설·셸 밖 화면 차단) · `lib/ui/dock-exclusive.test.ts`(좌표 독점).

### 고정 레이어 (우측하단) — 좌표 충돌 구역
**좌표는 `Dock`만 안다.** 부품은 슬롯에 등록만 하고 자기 위치를 정하지 않는다.

| 부품 | Dock 슬롯 | 등록처 |
|---|---|---|
| `ui/QuickAddFab` | `primary` | `MobileShell`(AppShell 내부) |
| `ci/AssistantPanel` FAB | `assistant` | `(ci)/layout` `extras.dock` |
| `ui/ScrollJumpButtons` | `utility` | `MobileShell`(AppShell 내부) |

> 예전엔 셋이 각자 `position:fixed`로 같은 자리를 잡아 실제로 겹쳤고, 그걸 피하려 만든 `bottom:92` 손계산이 매직넘버로 남아 있었다.

---

## 3. L1 — 페이지 골격

| 부품 | 사용 | 역할 | 비고 |
|---|---|---|---|
| `ui/PageHeader` | **32** | 제목·설명·액션·`below`(스테이지/탭)·`icon`·`back`(v0.7.477) | **표준** — raw `<h1>` 0건, `screen-standard` 가드가 잠금 |
| `ui/WorkPageShell` | **7** | 업무영역 페이지 골격 (globals.css §3007 SSOT와 한 쌍) | **PageScaffold 유사품 — 이미 존재** |
| `ui/SegmentedTabs` | **16** | 탭을 그리는 유일한 곳(이동형/제어형/패널형 × segment·primary·stage) | **표준** |
| `ui/WorkSubTabs` | 7 | 업무 하위 탭 **데이터** | 어댑터 |
| `ui/WorkTabBar` | 1 | 업무 상위 탭 **데이터** | 어댑터 |
| `ui/ProjectTabs` | 4 | CRM 탭 **데이터** | 어댑터 |
| `ci/StageNav` | 4 | CI 단계 **데이터**(번호·화살표) | 어댑터 |

---

## 4. L2 — 표면 (목록·표·상세·카드)

| 부품 | 사용 | 역할 |
|---|---|---|
| `ui/DynamicTable` | **7** | 동적 컬럼 표 |
| `ui/DynamicKeyValue` | 2 | 키-값 표시 |
| `ui/TrashToggle` | 2 | 휴지통 필터 토글 |
| `ci/DetailSheet` | **4** | 우측 상세 시트 |
| `ui/SlidePanel` | **6** | 우측 슬라이드 패널(드로어) — v0.7.456에 포커스 트랩·스크롤 잠금 보유분으로 확정하고 자작 드로어 3벌 흡수 |
| `ci/EvidenceSheet` | 1 | 근거 시트 |
| `ci/ContentCard` | 4 | 콘텐츠 카드 |
| `ci/ChannelGroupedList` / `ChannelListView` | 2 / 2 | 목록 뷰 |
| `ui/memo/MemoListView` | 1 | 메모 목록 |

### ❌ 존재하지 않는 목록 부품 (진짜 공백)
`ListToolbar` · `ListPager`/`Pagination` · `FilterBar` · `SortControl` · `ViewSwitcher(공용)` · `useListQuery`
→ 전수 검색 결과 **0건**. 목록형 약 40화면이 각자 자작 중.

---

## 5. L3 — 프리미티브

### 5-1. 버튼
| 방식 | 건수 | 판정 |
|---|---|---|
| `ui/nb/NbButton` | **85** | 표준 |
| `.btn-primary` / `.btn-ghost` 클래스 | 180 (124+56) | 클래스 축 — 허용 |
| `<button style={{…}}` 자작 | **352** | ⛔ 금지 대상 |

### 5-2. 상태 3종
| 상태 | 부품 | 사용 |
|---|---|---|
| 빈 | `ui/EmptyState` | **19** (v0.7.445 1벌) |
| 오류(영역) | `ui/ErrorState` | **11** (v0.7.445 공용 승격, 도움 링크는 `helpHref`로 주입) |
| 오류(한 줄) | **`ui/InlineError`** | **56** (v0.7.456 신설 — 폼·버튼 옆 한 줄. 예전엔 화면마다 인라인 style, 글자 크기 8종) |
| 로딩 | `ui/LoadingSkeleton→SkelPage/SkelCard/SkelList` | **11 / 9 / 7** |
| 로딩 | `ui/AXDotLoader` | **35** |
| 로딩 | `ui/AXLoadingOverlay` | 7 |
| 데이터부족 | `ci/states→InsufficientData` | 2 |

### 5-3. 뱃지·기타
| 부품 | 사용 |
|---|---|
| `ui/nb/NbBadge` | 10 |
| `ci/StatusBadge→Ingest/Confidence/Comparability/Completeness` | 3/3/2/3 |
| `ci/MetricBadge` | 5 |
| `ui/InfoHint` | 1 |
| `ui/RichText` | **11** (HTML 렌더 SSOT — `dangerouslySetInnerHTML` 직접 사용 금지) |
| `ui/TiptapEditor` | 3 |
| `ui/QueryToast` | 2 |
| `ui/DraftRestoreBanner` | **10** |
| `ui/OrgPeoplePicker` | 1 |

### 5-4. 모달
| 부품 | 사용 |
|---|---|
| `ui/nb/NbModal` | **8** (가운데 카드 표준 — v0.7.456 org-chart·세션모달 흡수) |
| `ui/EditorModal` | 3 |
| 개별 모달 파일 | **26개** (`*Modal.tsx`) |
| 모달 표준 준수 | `useEscClose` **91** · `tape-title` **118** (§2-2 — 채택률 높음) |

---

## 6. L4 — 토큰 (globals.css `:root`)

**고유 CSS 변수 123개.** 그룹별:

| 그룹 | 개수 | 예 |
|---|---|---|
| `--gpu-*` | 23 | GPU 화면 전용 |
| `--fs-*` | 11 | `2xs`(11px) ~ `3xl`, `--fs-price` |
| `--space-*` | 10 | `1`~`12` |
| `--nb-*` | 7 | 네오브루탈 테마 |
| `--color-*` | 7 | |
| `--z-*` | **7** | `dropdown:40 sticky:90 overlay:100 modal:200 toast:300 onboarding:1100` |
| `--border-*` / `--shadow-*` / `--brand-*` | 6/6/6 | |
| `--radius-*` | 3 | |

**테마 3종**: `nb`(기본) · `classic`(Indigo) · `mono`(Monochrome, **사이드바만 다크**). **전면 다크 테마는 없다.**
`@media` 블록 60개.

---

## 7. globals.css 1,550 규칙의 정체 — "시스템"이 아니라 "화면 CSS 저장소"

| prefix | 규칙 수 | 성격 |
|---|---|---|
| `gpu-*` | **505 (33%)** | 도메인 전용 |
| `ai-*` | 142 | 도메인 전용 |
| `cockpit-*` | 116 | 도메인 전용 |
| `ci-*` | 112 | 도메인 전용 |
| `monitor-*` | 59 | 도메인 전용 |
| `work-*` `daily-*` `calendar-*` `home-*` `triage-*` … | 각 20~40 | 도메인 전용 |
| **공용 프리미티브** (`nb-*` 12 · `filter-*` 10 · `quickadd-*` 9 · `detail-*` 9 · `slide-*` 8 · `seg-*` 7 · `skel-*` 7 + `input-field`·`label`·`table-card`·`tape-title`·`responsive-grid-*`) | **≈100 (6%)** | 진짜 시스템 |

> **결론: globals.css의 94%는 특정 화면 전용 CSS다. 인라인 style(4,931줄)을 클래스로 옮겨봐야 이 파일만 더 비대해진다.**
> **신규 도메인 CSS를 globals.css에 추가하지 않는다** — 해당 도메인 폴더의 CSS Module로 둔다.

---

## 8. ⚰️ 죽은 부품 (사용 0건) — 신규 작업에서 되살리거나 삭제 대상

| 심볼 | 파일 | 줄 | 조치 |
|---|---|---|---|
| ~~`NbCard`~~ | ~~`ui/nb/NbCard.tsx`~~ | 24 | ✅ v0.7.445 삭제 — 정책(§2)의 지정도 함께 정정(`.card` 클래스가 실제 표준) |
| ~~`NbField` `NbInput` `NbSelect` `NbTextarea`~~ | ~~`ui/nb/NbField.tsx`~~ | 47 | ✅ v0.7.445 삭제 — 클래스 축(`input-field` 247)이 이미 이겼다 |
| ~~`LogoutButton`~~ | ~~`ui/LogoutButton.tsx`~~ | 31 | ✅ v0.7.443 삭제 (`SidebarProfile`에 흡수) |
| ~~`WeeklyReportBannerButton`~~ | ~~`ui/WeeklyReportBannerButton.tsx`~~ | 34 | ✅ v0.7.445 삭제 |
| `SkelLine` | `ui/LoadingSkeleton.tsx` | — | 나머지 3개(`SkelCard/List/Page`)는 **27건 사용 중** |
| ~~`CardSkeleton`~~ | ~~`ci/states.tsx`~~ | — | ✅ v0.7.445 삭제 (`RowSkeleton`은 `SkelList`로 흡수) |
| `MetricPlaceholder` | `ci/MetricBadge.tsx` | — | |

> **주의: `LoadingSkeleton.tsx`는 죽지 않았다.** export 이름이 `SkelPage/SkelCard/SkelList`라서 파일명으로 세면 0건으로 보인다. **부품 조사는 반드시 export 이름 기준으로 한다.**

---

## 9. 도메인 전용 부품 (공용 승격 금지 — 해당 도메인에서만)

- **GPU/가격** `components/pricing/gpu/**` 23파일 — `UnifiedTable`(403줄) · `DetailPanel`(633줄) · `BulkReflectPanel` · 각종 Modal · `cockpit/*`
- **CI** `components/ci/**` — `states.tsx`의 빈상태/오류/골격은 v0.7.445에 `components/ui/`로 승격했고, `CiPageHeader`는 삭제했다. 남은 `InsufficientData`("모집단이 얇아 계산 불가")만 CI 고유 판정이라 도메인에 둔다
- **온보딩** `components/onboarding/**` 2파일 — `OnboardingProvider`(driver.js)

---

## 10. 가드 — 이미 있는 것 (신설 전 확인)

| 가드 | 검사 항목 | 방식 |
|---|---|---|
| `scripts/check-design-tokens.mjs` (`pnpm design:check`) | ① hex 색 **즉시 차단** ② swr 전역 `mutate` **즉시 차단** ③ `rgba()` ④ 미정의 토큰(`--text-sm` 등) ⑤ **raw `<input/select/textarea>`에 `input-field` 누락** | ratchet + baseline **294건** |
| `lib/ui/integration-consistency.test.ts` | 연동 카드 용어·기능 일관성 (CLAUDE.md §2-5) | 정적 스캔 |
| `lib/ui/shell-contract.test.ts` | 새 셸 신설 금지 · 모든 화면이 셸 아래 (공개 4경로만 면제) | 정적 스캔 |
| `lib/ui/dock-exclusive.test.ts` | 우측하단 좌표 독점 · `bottom` 매직넘버 금지 | 정적 스캔 |
| `lib/ui/duplicate-component.test.ts` | 같은 export 이름을 2곳이 내보내는 중복 구현 차단 | 정적 스캔 |
| `lib/work/mobile-layout-guard.test.ts` | 업무 화면 모바일 레이아웃 | 정적 스캔 |

**⚠️ 알려진 사각지대 (실측 확인)**
- `check-design-tokens.mjs`의 스캔 루트는 `apps/web/app` + `apps/web/components` 뿐 → **`globals.css`를 안 본다.**
  그래서 `.gpu-chip span{font-size:7px}` · `font-size:9px` · `0.55rem` 같은 **§3-1(10px 미만 금지) 위반이 CSS 본체에 살아 있다.**
- CLAUDE.md §3-1의 "design:check는 클래스 누락을 탐지 못 함"이라는 서술은 **낡았다** — ⑤가 이미 있다.

**신규 가드는 이 스크립트를 확장한다. 병렬 시스템을 새로 만들지 않는다.**
새 `*.test.ts`를 만들면 **반드시 `apps/web/package.json`의 `test` 스크립트 파일 목록(현재 171개)에 등재**한다. 등재 안 하면 안 돈다.

---

## 11. 셸 밖 화면 4개 (공개·인증 표면)

| 화면 | 줄 | 성격 | 셸 |
|---|---|---|---|
| `/login` | 97 | 인증 | 없음 |
| `/change-password` | 168 | 인증 | 없음 |
| `/develop` | **924** | **외부 공개** API 문서 | 없음 |
| `/api-access` | 155 | **외부 공개** 신청 폼 | 없음 |

(`app/page.tsx`는 5줄 `redirect('/home')` — 화면 아님)

**이 4개는 사이드바·전역검색·Dock이 없는 것이 정상이다.** 다만 **토큰·프리미티브·폼 클래스는 동일하게 적용**된다.
→ 셸 계약(§2)의 예외이되, L2~L4 계약의 예외는 아니다.

---

## 11-1. 왕복 흐름 (외부로 나갔다 돌아오는 화면)

| 부품 | 경로 | 역할 |
|---|---|---|
| `sanitizeReturnTo` · `withReturnTo` · `currentReturnTo` · `appendParams` | `lib/nav/return-to.ts` | **복귀 경로 SSOT** — "설정을 마치면 원래 있던 화면으로". 열린 리다이렉트 방어 포함 |

**규칙**: 복귀 주소를 라우트에 하드코딩하지 않는다. 콜백이 붙인 `?xxx=error&reason=…`은 **반드시 화면에 표시**한다.
현재 적용: Google Drive OAuth(`app/api/auth/google-drive/*` + `GoogleDriveSettings`).
가드: `lib/nav/return-to.test.ts` (CLAUDE.md §복귀 경로 정책)

---

## 12. 등재 규칙

1. 새 부품을 만들면 **이 문서에 줄을 추가**한다(부품명·경로·역할·사용처).
2. §1 중복 경보에 해당하는 성격이면 **새로 만들지 않고** 통일 대상을 먼저 정한다.
3. 부품 사용량 실측은 아래로 재현한다 (**export 이름 기준**):

```bash
cd apps/web && node - <<'EOF'
# components/**의 export 심볼별 JSX 사용 건수 집계
# (파일명으로 세면 LoadingSkeleton 같은 부품이 0건으로 오판된다)
EOF
```
전체 스크립트: `docs/ui-system/scan-inventory.mjs` (§13)


---

## v0.7.477 — 표준이 "지켜지는지"를 코드가 보게 만든 판

이 판의 핵심은 부품을 더 만든 게 아니라 **가드의 구멍을 막은 것**이다.

| 무엇 | 전 | 후 |
|---|---|---|
| design:check ratchet | `파일::유형` **키 존재**만 확인 → 이미 등록된 파일엔 같은 유형을 **몇 개든 더 넣어도 통과** | `{키: 개수}` — 지금보다 늘면 차단, 줄면 기준도 자동 하향(되돌리기 차단) |
| 상태 문구 판정 | 가드와 화면 스캐너가 **각자 정의** (가드는 `없습니다`만, `없어요`는 통과) | `scripts/ui-phrases.mjs` SSOT 공유 + JSX 텍스트 노드일 때만 자작으로 판정 |
| 표 | ListSurface·NbTable·DynamicTable·raw `<table>` 4방식 | ListSurface 1벌(+입력격자 DynamicTable은 성격이 다름을 명시) |
| 페이지 헤더 | raw `<h1>` 3곳 | 0곳 + 가드로 잠금 (`icon`·`back` 슬롯을 부품에 넣어 자작 이유를 없앰) |
| 탭 | `role="tab"` 자작 2곳 | PENDING 2곳으로 동결(접촉 시 이관) + 죽은 예외 방지 테스트 |
| 대화상자 ESC | 3곳 누락 | 0곳 + 가드로 잠금 |
| `useListQuery` | 주소를 통째로 새로 써 **`?tab=` 같은 남의 상태를 삭제** | 소유하지 않은 파라미터 보존 — 이게 목록들이 표준을 안 쓰고 자작하던 실제 이유였다 |

**교훈**: 표준을 안 쓰는 이유는 대개 게으름이 아니라 **표준이 그 화면에서 실제로 못 쓰게 돼 있어서**다.
(전체선택이 없어서 NbTable을 썼고, `?tab=`이 지워져서 URL 동기화를 자작했고, 뒤로가기 슬롯이 없어서 헤더를 베꼈다.)
부품을 고쳐서 쓸 수 있게 만드는 게 먼저고, 가드는 그 다음이다.
