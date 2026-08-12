# 이행 계획 · 리스크 · 결정 요청 — 2판

기준 v0.7.438 · 근거 `01-AUDIT.md`(2판) · 설계 `02-SYSTEM.md`(2판) · 검증 `00-VERIFY.md` · 색인 `docs/ui-system/INVENTORY.md`

> **1판 대비**: 1판은 "부품 신설 → 화면 이관"이었다. 실측 결과 부품은 **이미 여러 벌 있었다.**
> 2판은 **"통일 대상 확정 → 흡수·폐기 → 신설은 목록 축만"** 이다. 신설 물량이 줄고, 대신 **폐기·이관 물량이 생겼다.**

---

## 1. 규모 산정 (정정됨)

| 대상 | 규모 | 1판 대비 |
|---|---|---|
| 화면 | **80** (`page.tsx` 81 − 루트 redirect) | 76 → 80 |
| 셸 | 3 → 1 (+ `PublicSurface` 4개 면제) | 신규 명시 |
| 목록형 화면 | 약 40 | 동일 |
| 컴포넌트 파일 / export 심볼 | **97 / 121** | 신규 |
| **폐기 대상 부품** | `NbCard` `NbField`(4심볼) `LogoutButton` `WeeklyReportBannerButton` `SkelLine` `CardSkeleton` `MetricPlaceholder` = **12심볼 / 4파일 전량사망** | 신규 |
| **통일(흡수) 대상** | 로딩 6종→2 · 탭 5종→1 · 헤더 2벌→1 · 빈상태 2벌→1 · 정렬아이콘 2벌→1 · 표 4방식→1 | 신규 |
| **신설 대상** | `ListToolbar` `ListPager` `ListSurface` `ColumnDef` `useListQuery` `AppShell` `Dock` `PageScaffold` = **8** | 1판보다 감소 |
| 자작 버튼 | 352 | 동일 |
| 자작 카드 박스 | 476 | 동일 |
| 자작 빈 상태 문구 | 188 | 동일 |
| 자작 로딩 문구 | 37 | 동일 |
| z-index 하드코딩 | 57 | 동일 |
| 하드코딩 색 | **404** (`white/#fff` 217 + `rgba` 187) | 396 → 404 |
| 인라인 style | 4,931줄 | 동일 |
| **globals.css** | **9,710줄 / 규칙 1,550 / 토큰 123 / @media 60** | **1판 미조사** |
| `pnpm test` 수기 목록 | **171 파일** (가드 추가 시 등재 필수) | 신규 |

> **전면 교체는 여전히 현실적이지 않다.** 80개 화면이 동시에 흔들리고 회귀 검증 방법이 없다.
> **"신규 차단 먼저, 기존은 접촉 시 이관"** 전략을 유지한다.
> **추가 원칙: 기존 CSS 1,350 도메인 규칙은 옮기지 않는다.** 신규 유입만 막는다.

---

## 2. 단계 계획

### Phase 0 — 출혈 멈추기 + 색인 (가장 먼저, 가장 싸다)

기존 화면 코드는 손대지 않는다.

| 작업 | 산출물 | 상태 |
|---|---|---|
| `docs/ui-system/INVENTORY.md` 신설 | 부품 121심볼 전수 색인 + 중복 경보 | ✅ **완료** |
| `docs/ui-system/scan-inventory.mjs` | 실측 재현 스크립트(export명 기준) | ✅ **완료** |
| `design:check` 스캔 루트에 `globals.css` 추가 | 7px/9px 폰트 차단 | ⬜ |
| 가드 3종 신설 (`shell-contract`·`dock-exclusive`·`duplicate-component`) + **`package.json` test 목록 등재** | `lib/ui/*.test.ts` | ⬜ |
| `design:check` ratchet 확장 (자작 버튼/카드/로딩/빈상태·z-index·색) | baseline 재생성 | ⬜ |
| CLAUDE.md §2 개편 + **낡은 서술 3곳 정정** + AGENTS.md 동기화 | 정책 | ⬜ |

- **위험 낮음**: 기존 화면 코드 변경 0. baseline이 현재 위반을 전부 흡수.
- **효과 즉시**: 다음 기능부터 "또 새로 만들어 냄"이 CI에서 막힌다.
- **검증**: 각 가드를 **일부러 깨서 실패 확인** 후 원복(§02-SYSTEM 8-4).

### Phase 1 — 상위 인터페이스 통일 (사용자 체감 가장 큼)

| 작업 | 영향 |
|---|---|
| `AppShell`(역할 슬롯) + `Dock` 신설 — `MobileShell`은 내부 구현으로 존치 | 신규 파일 |
| 셸 3개 → AppShell 이관 | `(member)/layout` · `admin/layout` · `CiShell` |
| `AdminUserMenu` 폐기 → `SidebarProfile` 단일화 | admin에 테마·비번·이름·패치노트 **생김** |
| CI·admin에 전역 검색 추가 | 누락 해소 |
| FAB 3종 Dock 슬롯 등록 | 충돌 해소 (`bottom:92` 매직넘버 제거) |
| `LogoutButton`(0건) 삭제 | 죽은 코드 |
| `PublicSurface` 4경로 화이트리스트 등록 | `/login` `/change-password` `/develop` `/api-access` |

- **위험 중간**: 전 화면 셸이 바뀐다. 변경 지점은 3파일로 좁다.
- **검증**: 80화면 중 대표 12개(각 그룹 4개)를 데스크탑·모바일 실화면 확인. **`/develop`·`/api-access`는 필수 포함**(외부 공개).

### Phase 1.5 — 프리미티브 중복 통일 (**2판 신규 · 저위험 고효과**)

부품 통일만 하고 화면 로직은 안 건드린다. 치환 위주라 위험이 낮다.

| 작업 | 건수 |
|---|---|
| `ci/states→EmptyState` → `ui/EmptyState` 이관 | 18 |
| `ci/states→ErrorState` → `ui/ErrorState` 승격 | 11 |
| `ci/states→RowSkeleton` → `SkelList` 이관 | 5 |
| `AXLoadingOverlay` → `SkelPage`+오버레이 옵션 흡수 | 7 |
| `CiPageHeader` → `PageHeader` 이관 | 14 |
| 탭 5종(`WorkSubTabs`·`ProjectTabs`·`StageNav`·`WorkTabBar`) → `SegmentedTabs` | 16 |
| `SortIcon` 2벌 → 1벌 | 26+26 |
| 죽은 부품 삭제 (`NbCard`·`NbField`·`WeeklyReportBannerButton`·`SkelLine`·`CardSkeleton`·`MetricPlaceholder`) | 12심볼 |
| `INVENTORY.md` 갱신 | — |

- **왜 Phase 1.5인가**: Phase 2(목록 표준)가 이 부품들을 **전제로** 쓴다. 먼저 1벌로 만들어야 목록 부품이 무엇을 쓸지 정해진다.

### Phase 2 — 목록 표준 부품 (유일한 신설 축)

| 작업 |
|---|
| `useListQuery` · `ListToolbar` · `ListPager` · `ListSurface` · `ColumnDef` |
| `DynamicTable`(7)·`BulkActionBar`(2)·`TrashToggle`(2)·`ViewSwitcher`(1) 흡수 |
| `ui_preferences` 테이블 마이그레이션 + 저장/복원 |
| **파일럿 3화면** 이관 (제안: `contacts` · `ci/inbox` · `admin/members`) |

- 파일럿으로 계약을 검증한 뒤 확산. 처음부터 40개를 건드리지 않는다.

### Phase 3 — 확산 (접촉 시 이관)
- **새 규칙: 어떤 화면을 기능 수정으로 건드리면, 그 화면을 표준으로 이관한다.**
- 별도 대규모 작업을 잡지 않는다. 자연 감소.
- 예외: 목록형 상위 10개 화면은 별도 배치로 우선 이관(사용 빈도 기준).

### Phase 4 — GPU 관리 정리 (마지막, 가장 위험)
- 탭 15개 + 표 경로 공존 + `unified` 플래그 + **globals.css `gpu-*` 505규칙 + `--gpu-*` 토큰 23개**.
- **단독 배치로 분리.** 다른 Phase와 섞지 않는다.
- 선행 조건: Phase 2 목록 표준 안정화.

---

## 3. 리스크 (정정됨)

| 리스크 | 내용 | 대응 | 남는 위험 |
|---|---|---|---|
| **회귀 폭** | 셸 교체가 80개 화면에 동시 영향 | Phase 1 단독 배포, 대표 12화면 실화면 검증 | 저빈도 화면 미검출 |
| **통일 중 기능 손실** | `AXLoadingOverlay`→`SkelPage` 등 흡수 시 옵션 누락 | 흡수 전 각 부품의 props 전수 대조 | 미세 UX 차이 |
| **`ci/states` 이관 파급** | `EmptyState`/`ErrorState` 29건이 CI 전역 | 이름이 같아 import 경로만 바뀜 → 기계적 치환 | import 누락 |
| **가드 오탐** | ratchet baseline 오작성 시 개발 차단 | baseline 자동 생성 + `// ui-ok` 예외 | 예외 남용 |
| **가드 무용화** | "만들고 안 씀" 재발 | **일부러 깨서 실패 확인** + **package.json 등재 확인** | — |
| **가드 미등재** | `pnpm test`가 수기 목록 171개 | Phase 0 체크리스트에 등재 단계 명시 | — |
| **globals.css 비대화** | 인라인→클래스 이관 시 CSS가 6,000줄 증가 | **이관 금지.** 신규만 CSS Module | 기존 1,350규칙 방치 |
| **작업량 과대** | Phase 3 무한정 | "접촉 시 이관" + 상위 10화면만 명시 | 잔여 화면 장기 방치 |
| **테마 깨짐 잔존** | `white` 217 · `rgba` 187 | design:check 확장으로 신규 차단, 기존 접촉 시 | mono 사이드바 맥락 산발 |
| **외부 공개면 노출** | `/develop`(924줄)·`/api-access`가 표준 밖 | `PublicSurface` 분류 + 가드 예외 없음 | 대외 노출 |

---

## 4. 결정 필요 (①은 2판에서 답이 바뀜)

### ① 범위 — 어디까지
| 안 | 내용 | 기간감 | 위험 |
|---|---|---|---|
| A. Phase 0만 | 출혈만 멈춤 | 짧음 | 낮음. 현재 불일치 잔존 |
| **B. Phase 0+1+1.5** (**2판 권장**) | 출혈 차단 + 상위 인터페이스 통일 + **프리미티브 중복 제거** | 중간 | 중간. 체감 개선 최대 |
| C. Phase 0~2 | 목록 표준까지 | 김 | 중상 |
| D. 전체(0~4) | GPU까지 | 매우 김 | 높음 |

> **2판 권장은 B(Phase 1.5 포함).** 1판 권장(0+1)에 **1.5를 추가**한다 —
> 사용자가 말한 "정리했는데 또 새로 만들어 낸다"의 실제 원인이 **중복 6종·5종·2벌**이고, 그걸 없애는 게 Phase 1.5이기 때문이다.
> 1.5는 치환 위주라 위험이 낮은데 효과는 크다.

### ② 페이지네이션 기본값
- 제안: **기본 `pages`**, 피드형(활동로그·알림)만 `more`. 누적은 DOM이 자라고 위치를 잃는다.

### ③ 필터 저장 여부
- 제안: **저장하지 않음.** 저장하면 다음 방문에 "데이터가 왜 없지"가 된다.

### ④ `admin` 셸 통합 시 테마 노출
- `AdminUserMenu` 폐기 시 admin에도 **테마 전환이 생긴다.** 의도한 것인지 확인 필요.

### ⑤ 죽은 부품 4파일 삭제 승인
- `NbCard`(24줄) · `NbField`(47줄) · `LogoutButton`(31줄) · `WeeklyReportBannerButton`(34줄) = 0건.
- **`NbCard`는 CLAUDE.md §2가 지정한 부품**이므로 삭제 시 정책도 같이 고친다(→ `.card` 클래스).

### ⑥ GPU(Phase 4) 착수 여부
- 지금 결정 불요. 단 **안 하기로 하면** GPU(탭 15 + CSS 505규칙 + 토큰 23)는 영구적으로 표준 밖에 남는다.

---

## 5. 지금 상태

- **코드 변경 0. DB 변경 0. 커밋 0.**
- 완료: `00-VERIFY.md`(검증) · `docs/ui-system/INVENTORY.md`(색인) · `scan-inventory.mjs`(실측 재현) · 01·02·03 문서 2판 정정.
- 다음: **①(범위) 승인 시 Phase 0 착수** — 가드 + 정책.

---

## 6. 부록 — 재현 명령

```bash
# 부품 인벤토리 (export 이름 기준 — 파일명으로 세면 오판)
node docs/ui-system/scan-inventory.mjs
node docs/ui-system/scan-inventory.mjs --dupes    # 중복 구현
node docs/ui-system/scan-inventory.mjs --dead     # 사용 0건

cd apps/web
find app -name "page.tsx" | wc -l                 # 81 (− 루트 redirect = 80)
wc -l app/globals.css                             # 9710
grep -cE "^\." app/globals.css                    # 1550
grep -rn "input-field" app components | wc -l     # 247
grep -rn "table-card" app components | wc -l      # 70
grep -rEn "zIndex: *[0-9]" app components | wc -l # 57
cd .. && pnpm design:check                        # baseline 294
```
