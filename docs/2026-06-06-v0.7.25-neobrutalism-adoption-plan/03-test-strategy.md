# 03. 테스트/검증 전략 — 단계별 게이트

> 기획 전용. 각 PHASE 종료 시 아래 게이트 통과해야 다음 진입.

## 검증 4축
| 축 | 도구/방법 | 기준 |
|----|-----------|------|
| 시각 회귀 | Playwright 스크린샷, 브레이크포인트 320/768/1024/1440 | 의도 외 레이아웃 변화 0 |
| 접근성 | axe/Lighthouse a11y + 키보드 탭 | WCAG AA, focus-visible 가시, 대비 통과 |
| 성능 | Lighthouse | LCP<2.5s, CLS<0.1, INP<200ms 회귀 0% |
| 반응형 | 모바일 카드 패턴 수동 | `table-card` 가로스크롤 0, 콘텐츠 잘림 0 |

## PHASE별 게이트
### PHASE 0 (토큰)
- 브릿지 alias 적용 후 **기존 화면 무회귀** 스냅샷 비교(전/후 동일 레이아웃, 색만 변화).
- `:root` 토큰 누락/오타로 인한 깨짐 0.

### PHASE 1 (공용 컴포넌트)
- MobileShell: member·admin 양 레이아웃에서 사이드바/nav active/모바일 드로어 정상.
- SidebarProfile: hover가 `:hover` CSS로 동작(인라인 mutation 제거 확인).
- DynamicTable: 셀 그림자 0, 컨테이너만 그림자(C-1), 모바일 카드 정상.
- 28개 컴포넌트 각각 렌더 스냅샷.

### PHASE 2 (인증)
- 로그인/비번변경 폼 키보드 흐름 + focus ring 3px + 노랑 위 흰글씨 없음.

### PHASE 3 (member)
- 화면별 스냅샷 + 모바일 카드 + 인라인 `#6366f1` 잔여 추적(감소 추세).
- pricing/gpu: `--gpu-*` 영역과 NB 정합(색 충돌 0).

### PHASE 4 (admin) — 강화 게이트 ⚠️
- 모든 admin 테이블: 셀 그림자 0 / thead 강조 / 행 alternating / 가로스크롤 0.
- **가독성 게이트**: 내부 사용자 ≥5명 1주 사용 후 "가독성/속도 저하" 클레임 0건(미충족 시 톤다운).
- 대형 표(reports/daily-logs/data-quality/ai-usage) 정보밀도 유지.

## 회귀 핫스팟 점검 체크(매 PHASE)
- [ ] MobileShell 인라인 잔여 0 / 토큰 반영
- [ ] onMouseEnter style mutation 잔여 0
- [ ] 하드코딩 `#6366f1` 잔여 카운트 기록(감소)
- [ ] `.table-card` 모바일 색 토큰화 동작
- [ ] `'use client'` + `<style>` 태그 0 (hydration)
- [ ] GPU 토큰 값 충돌 0

## 산출 아티팩트
- PHASE별 before/after 스크린샷 세트(데스크탑/모바일).
- a11y 리포트, Lighthouse 리포트.
- 인라인 style/하드코딩색 카운트 추이표.
