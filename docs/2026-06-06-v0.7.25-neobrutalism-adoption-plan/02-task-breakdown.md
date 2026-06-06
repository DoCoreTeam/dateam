# 02. 작업 분해 — 전 화면/컴포넌트 단계별 롤아웃 (누락 0)

> 기획 전용. 순서 = **공용 → 인증 → member → admin**. 각 단계 끝에 검증 게이트(03 문서).
> 범례: 🟥 파급 큼/회귀 위험 · 🟨 보통 · 🟩 단순 · ⚠️ 가독성 보정 필수(데이터 밀집)

---

## PHASE 0 — 토큰 기반 (코드 0줄 위험, 외형 1차 전환)
| # | 대상 | 작업 | 등급 |
|---|------|------|------|
| 0-1 | `globals.css :root` (L16~34) | NB Primitive+Semantic 토큰 추가 | 🟨 |
| 0-2 | `globals.css :root` | 기존 인디고 토큰 → NB 토큰 **브릿지 alias** | 🟥 |
| 0-3 | `globals.css @layer components` | `.card .btn-primary .btn-ghost .input-field .label .badge .badge-* .table-base` 보더3px/radius2px/shadow-hard 반영 | 🟥 |
| 0-4 | 폰트 | Pretendard 로컬/셀프호스트 적용(빌드형, CDN 아님) + `--font-tape` Nanum Pen Script preload | 🟨 |
| 0-5 | 자산 | 노이즈 PNG 타일 생성, 커스텀 커서 SVG(폴백 가드 포함) | 🟩 |
| 0-6 | `globals.css` 반응형 | `--border-w-mobile` 분기, `.table-card` 색상 토큰화 | 🟥⚠️ |

---

## PHASE 1 — 공용 컴포넌트 (28개 전수, 1곳=다수 라우트 반영)
### 1-A 레이아웃 셸 (전 화면)
| # | 파일 | 작업 | 등급 |
|---|------|------|------|
| 1-1 | `components/ui/MobileShell.tsx` | 인라인 29개 → CSS 변수/className. 사이드바 `#1e293b`, nav active/highlight 토큰화 | 🟥 |
| 1-2 | `components/ui/SidebarProfile.tsx` | `onMouseEnter` style mutation → `:hover` CSS | 🟥 |
| 1-3 | `components/ui/NavigationLoader.tsx` | 오버레이/진행바 색 NB 토큰 | 🟨 |
| 1-4 | `components/ui/QuickNav.tsx` | NB 칩/버튼 | 🟨 |
| 1-5 | `components/ui/AdminUserMenu.tsx` | admin 헤더 메뉴(NB) | 🟩 |

### 1-B 공용 모달/오버레이 (member+admin 공유)
| # | 파일 | 등급 |
|---|------|------|
| 1-6 | `PasswordChangeModal.tsx` | 🟨 |
| 1-7 | `NameSetupModal.tsx` | 🟨 |
| 1-8 | `AXLoadingOverlay.tsx` | 🟨 |
| 1-9 | `AXDotLoader.tsx` | 🟩 |
| 1-10 | `SlidePanel.tsx` (클래스 기반=쉬움) | 🟩 |
| 1-11 | `EditorModal.tsx` / `TiptapEditor.tsx` | 🟨 |
| 1-12 | `ContentDiffModal.tsx` / `DiffConfirmModal.tsx` | 🟩 |

### 1-C 공용 데이터/입력 컴포넌트 ⚠️
| # | 파일 | 작업 | 등급 |
|---|------|------|------|
| 1-13 | `DynamicTable.tsx` | `CSSProperties` 상수 → 유틸 클래스, 셀 그림자 금지(C-1) | 🟥⚠️ |
| 1-14 | `DynamicKeyValue.tsx` | NB 입력/라벨 | 🟨 |
| 1-15 | `ProjectTabs.tsx` | NB 탭(테이프 라벨 활용) | 🟨 |

### 1-D 기타 공용/도메인 위젯
| # | 파일 | 등급 |
|---|------|------|
| 1-16 | `FridaySpotlightOverlay.tsx` | 🟩 |
| 1-17 | `SpotlightOnboarding.tsx` | 🟩 |
| 1-18 | `RoutineCheckinGate.tsx` | 🟨 |
| 1-19 | `WeeklyReportBannerButton.tsx` | 🟩 |
| 1-20 | `LogoutButton.tsx` | 🟩 |
| 1-21 | memo/* 4개: `MemoListView` `MemoPromoteModal` `UnreviewedMemoWidget` `WeeklyMemoReview` | 🟨 |
| 1-22 | `gpu/SupplierBadge.tsx` `gpu/CategoryGroup.tsx` (GPU 토큰 충돌 주의) | 🟨 |

### 1-E 레이아웃 파일 7개
| # | 파일 | 작업 | 등급 |
|---|------|------|------|
| 1-23 | `app/layout.tsx` (root) | globals.css import만 — 자체 변경 최소 | 🟩 |
| 1-24 | `(member)/layout.tsx` | headerLeft/Right 인라인색 토큰화 | 🟨 |
| 1-25 | `admin/layout.tsx` | headerLeft 인라인색 토큰화 | 🟨 |
| 1-26 | `accounts/ contacts/ deals/ lead-intake /layout.tsx` (동일코드 4개) | ProjectTabs 경유 — 1줄 | 🟩 |

---

## PHASE 2 — 인증/공통 단독 화면 (MobileShell 미사용)
| # | 라우트 | 작업 | 등급 |
|---|--------|------|------|
| 2-1 | `(auth)/login` | NB 로그인 카드/입력/버튼 (test.html 기준 적용) | 🟥(첫 체감면) |
| 2-2 | `/page` (root 랜딩/리다이렉트) | 진입 처리 확인 | 🟩 |
| 2-3 | `/change-password` | NB 폼 | 🟨 |
| 2-4 | `/develop` | NB 적용 | 🟩 |
| 2-5 | `/api-access` (루트) | NB 적용 | 🟩 |

---

## PHASE 3 — member 26개 (사용빈도/단순도순)
### 3-A 핵심 화면
| # | 라우트 | 비고 | 등급 |
|---|--------|------|------|
| 3-1 | `(member)/home` | 홈 대시보드(test.html 클론 기준) | 🟥 |
| 3-2 | `(member)/daily` | 일일업무(globals 전용클래스 多) | 🟨 |
| 3-3 | `(member)/calendar` | 캘린더(전용클래스 ~25개) | 🟨 |
| 3-4 | `(member)/weekly-report` | 주간보고 + EditorModal | 🟨 |
| 3-5 | `(member)/dashboard` | 대시보드 | 🟨 |

### 3-B 프로젝트관리(ProjectTabs 하위) ⚠️ 테이블 多
| # | 라우트 | 등급 |
|---|--------|------|
| 3-6 | `accounts` (list) | 🟥⚠️ |
| 3-7 | `accounts/new` · `accounts/[id]` · `accounts/[id]/edit` | 🟨 |
| 3-8 | `contacts` (list/new/[id]/[id]/edit) | 🟥⚠️ |
| 3-9 | `deals` (list/new/[id]/[id]/edit) | 🟥⚠️ |
| 3-10 | `lead-intake` | 🟨 |
| 3-11 | `intake` | 🟨 |

### 3-C AX사업본부 기능
| # | 라우트 | 등급 |
|---|--------|------|
| 3-12 | `kpi` | 🟨⚠️ |
| 3-13 | `routine` | 🟨 |
| 3-14 | `operations` (본부 운영) | 🟨 |
| 3-15 | `org` | 🟨 |
| 3-16 | `api-keys` | 🟩 |
| 3-17 | `ralph` | 🟩 |

### 3-D 가격정책 ⚠️ (GPU 토큰 영역)
| # | 라우트 | 비고 | 등급 |
|---|--------|------|------|
| 3-18 | `pricing/gpu` | `--gpu-*` 토큰 영역 — NB와 정합 검토 | 🟥⚠️ |
| 3-19 | `pricing/catalog` | 판매가격표(테이블) | 🟨⚠️ |

> **member 26개 카운트 명시**: 단순/핵심 5(home·daily·calendar·weekly-report·dashboard) + accounts 4(list·new·[id]·[id]/edit) + contacts 4 + deals 4 + lead-intake·intake 2 + 본부기능 6(kpi·routine·operations·org·api-keys·ralph) + pricing 2(gpu·catalog) **= 26** (동적 [id] 라우트 포함, 누락 0)

---

## PHASE 4 — admin 16개 (가장 마지막·가장 보수적 톤, C-3) ⚠️
> 전부 데이터 밀집 → C-1 보정 필수(셀 그림자0/컨테이너만/thead만 강조). 별도 가독성 게이트.

| # | 라우트 | 성격 | 등급 |
|---|--------|------|------|
| 4-1 | `admin/members` | 멤버 테이블 | 🟥⚠️ |
| 4-2 | `admin/users` | 유저 테이블 | 🟥⚠️ |
| 4-3 | `admin/settings` | 설정 폼(브랜딩 등) | 🟨 |
| 4-4 | `admin/reports` | 주간보고 취합(대형 테이블) | 🟥⚠️ |
| 4-5 | `admin/kpi` | KPI 집계 | 🟨⚠️ |
| 4-6 | `admin/routine` | 루틴 관리 | 🟨⚠️ |
| 4-7 | `admin/ai-prompts` | 프롬프트 관리 | 🟨 |
| 4-8 | `admin/ai-usage` | 토큰/사용량(차트·표) | 🟥⚠️ |
| 4-9 | `admin/api-access` | API 접근 | 🟨 |
| 4-10 | `admin/api-keys` | 키 관리 | 🟨 |
| 4-11 | `admin/api` | API 관리 | 🟨 |
| 4-12 | `admin/content` | 콘텐츠+DiffModal | 🟨 |
| 4-13 | `admin/daily-logs` | 일일로그 테이블 | 🟥⚠️ |
| 4-14 | `admin/data-quality` | 데이터 품질(드릴다운 표) | 🟥⚠️ |
| 4-15 | `admin/org-chart` | 조직도 | 🟨 |
| 4-16 | `admin/partner-tiers` | 파트너 등급표 | 🟨⚠️ |

---

## PHASE 5 — 정리/브릿지 퇴역
| # | 작업 |
|---|------|
| 5-1 | 하드코딩 `#6366f1`(242건) 잔여 0 확인 → 브릿지 alias 제거 |
| 5-2 | Stylelint 규칙(하드코딩 색 warning→error) 승격 |
| 5-3 | GPU 토큰(`--gpu-*`) NB 통합 여부 별도 결정 |
| 5-4 | test.html → 디자인 시스템 문서/스토리보드로 보존 |

---

## 합계 (누락 검증)
- 토큰/자산 6 · 공용 컴포넌트 28(전수) · 레이아웃 7 · 라우트 48(auth1+root/공통4+member26+admin16, 동적 [id] 포함) · 정리 4
- **모든 page.tsx 48개가 PHASE 2~4에 배정됨** (member 26 = 3-1~3-19의 list/new/[id]/edit 포함, admin 16 = 4-1~4-16).
