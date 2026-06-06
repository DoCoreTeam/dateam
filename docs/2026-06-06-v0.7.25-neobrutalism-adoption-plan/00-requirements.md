# 00. 요구사항 — Neo-brutalism 전 서비스 점진 도입

> v0.7.25 · 2026-06-06 · **기획 전용 문서 (구현 금지)**
> 디자인 방향 확정: `good.html`(Neo-brutalism)

## 목적
newAX 실서비스 **전 화면**(member 26 + admin 16 + auth/공용 + 공용 컴포넌트 28)에 Neo-brutalism 디자인을 **회귀 없이 점진 도입**하기 위한 완전한 로드맵. 본 문서군은 기획만 다루며 **어떤 실서비스 파일도 구현하지 않는다**(test.html 프리뷰 제외).

## 확정된 의사결정 (사용자 승인)
| 항목 | 결정 |
|------|------|
| 디자인 방향 | good.html = Neo-brutalism (하드보더 3px / 오프셋 하드섀도 4px4px0 / 노랑 #fcd34d · 퍼플 #7c3aed / Pretendard / 테이프 라벨 / 종이질감) |
| 구현 전략 | **globals.css 토큰 + 유틸 클래스** (CDN·Tailwind 도입 안 함, 기존 스택 유지) |
| 적용 강도 | **전면 풀강도** — 단, 데이터 밀집 화면(admin 테이블/폼)은 가독성 보정 토큰 적용(아래 제약 참조) |
| 롤아웃 순서 | **공용 → 인증 → member → admin** |

## 기능 요구사항 (FR)
- **FR-1** Neo-brutalism 디자인 토큰을 globals.css에 3레이어(Primitive→Semantic→Component)로 정의.
- **FR-2** 기존 인디고 토큰(`--color-brand #6366f1` 등)을 **브릿지 alias**로 새 토큰에 연결 → 컴포넌트 코드 즉시 변경 없이 외형 전환.
- **FR-3** 전 48개 라우트 + 7개 레이아웃 + 28개 공용 컴포넌트에 대해 **각각의 적용 방안과 순서**를 누락 없이 정의(02 문서).
- **FR-4** 정보구조(IA)·라벨·위치·동작은 **불변**. 색·보더·그림자·타이포만 변경.
- **FR-5** 단계별 롤아웃 사이에 검증 게이트(시각 회귀 / a11y / 성능 / 모바일 카드).

## 비기능 요구사항 (NFR)
- **NFR-1 (접근성)** WCAG 2.1 AA: 노랑 배경 위 흰 텍스트 금지, `:focus-visible` 별도 3px outline, 커스텀 커서는 `prefers-reduced-motion`/`pointer:coarse` 폴백.
- **NFR-2 (성능)** 성능 규정 준수(LCP<2.5s 등). `feTurbulence` 풀뷰포트 금지(PNG 타일), `transition: all` 금지(transform/box-shadow 명시), 테이블 셀 단위 box-shadow 금지.
- **NFR-3 (반응형)** CLAUDE.md 정책 유지: `table-card` 모바일 카드 변환·`MobileShell`·`page-inner` 동작 보존, 모바일 보더 두께 축소 변수 분리.
- **NFR-4 (무회귀)** 단계별로 기존 화면 동작 0 회귀. 인라인 `<style>` 금지(hydration).
- **NFR-5 (SSOT)** 모든 토큰/유틸은 globals.css 단일 소스. 하드코딩 hex 신규 발생 0.

## 제약 (CONSTRAINTS — DC-RES/DC-BIZ 근거)
- **C-1** admin 데이터 밀집 화면: 테이블 **셀에는 그림자 금지**, 컨테이너에만 `--shadow-md`. 행 구분은 alternating bg. thead만 `--border-thick`.
- **C-2** "프랑켄슈타인 구간"(톤 혼재)을 4주 이내로 짧게. 각 단계 출시 시 사내 1줄 안내.
- **C-3** admin은 **가장 마지막 + 가장 보수적 톤** (실제 업무 화면 — 망치면 본부 업무 마비).
- **C-4** 버전 정책: 점진 도입은 PATCH 누적이 빠름 → MINOR 승격 타이밍 사용자 합의.

## 이해관계자 / 사용자
- 내부 사용자: AX사업본부 구성원(member) + 관리자(admin). 소수 표본(26+@) → 통계 ROI 측정 한계 → 정성 피드백 게이트 중시.

## 본 작업의 진짜 사업가치 (DC-BIZ)
디자인 미화 자체보다 **globals.css 토큰 시스템화 + Neo-brutalism 공용 컴포넌트 자산화**가 핵심 — 차후 신규 내부 프로덕트/고객사 B2B PoC의 출발점. 영업 시연 캡처 레퍼런스 가치 HIGH.

## 비범위 (OUT OF SCOPE)
- 실서비스 코드 구현 일절(이 PR은 문서만).
- IA/기능/라우트 구조 변경.
- GPU 모듈 전용 토큰(`--gpu-*`) 통합(별도 후속).
- Tailwind/CDN 도입.
