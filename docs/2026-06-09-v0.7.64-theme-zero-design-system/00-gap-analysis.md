# 테마 작업 0 — 갭 분석 보고서 (목표 상태까지 뭐가 빠졌나)
작성 2026-06-09 · 기준 v0.7.63

## 목표 상태 정의
"웹 구성요소(버튼·표·입력·카드·뱃지·텍스트·모달)가 각 1회 토큰 기반으로 모듈화 + 사용 강제 → 신규 기능은 조합만, 테마는 토큰 스왑. 새 기능에 테마 작업 0."

## 현재 갭 (인벤토리 근거)
| 영역 | 현재 | 갭 |
|------|------|----|
| 버튼 | NbButton 있음(채택 3파일) | 채택률↓ |
| 카드 | NbCard 있음(거의 미사용) | 채택률↓ |
| 뱃지 | NbBadge 있음 | OK |
| nav | NbNavItem(완전 채택) | OK |
| **모달** | **공용 없음** — 25파일 직접 작성(backdrop rgba 제각각) | **신설 필요** |
| **표** | **공용 없음** — 28파일 raw `<table>` | **신설 필요** |
| **입력** | `.input-field` 클래스만, raw 태그 68파일 | **래퍼 컴포넌트 신설** |
| **토큰 fg/bg 짝** | accent/brand/status에 전경색 짝 없음 | **신설 필요(badge 사고 근본원인)** |
| status 색 | status-colors.ts hex 하드코딩 | 토큰 연결 필요 |
| rgba 인라인 | 44파일 | 토큰화 필요 |
| 가드 | TSX hex만 탐지 | rgba·raw input·미정의토큰 미탐지 |

## 채우는 순서 (의존성)
1. **토큰 fg/bg 짝** (모든 컴포넌트가 의존) → globals.css 양 테마 + status-colors.ts 토큰화
2. **프리미티브 신설**: NbModal · NbTable · NbField(Input/Select/Textarea) + Nb* 보강
3. **가드 강제**: rgba·raw input·미정의토큰 탐지 추가 (신규 위반 차단 = 0 보장 핵심)
4. **전체 마이그레이션**: 모달25→NbModal, 표28→NbTable, 입력68→NbField, rgba44→토큰
5. **검증**: 두 테마(nb/classic) Playwright + 테스트 + DC-QA/SEC/REV + GATE

## 완료 후 보장
프리미티브 완성 + fg/bg 짝 + 가드 강제 → 신규 화면은 `<NbModal>/<NbTable>/<NbField>/<NbButton>` 조합만으로 두 테마 자동. 하드코딩은 가드가 차단.
