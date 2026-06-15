# v0.7.127 — 통합뷰 그룹 기본 전체접기 + 마진 컨트롤 SSOT 완성

## 작업 요약
① 통합 표 모델 그룹의 **기본값을 전체 접힘**으로 변경(첫 데이터 로드 시 1회 초기화).
② 레거시 `PriceTableTab`의 마진바를 공용 `MarginControl`로 교체 → 마진 설정 컴포넌트 **SSOT 완성**
(통합뷰 툴바 + 레거시 탭이 동일 컴포넌트 사용).

## 수정 파일
- `apps/web/components/pricing/gpu/unified/UnifiedTable.tsx`
  - `collapseInited` ref + effect: rows 최초 로드 시 모든 model_name을 collapsed로 초기화(기본 전체접힘).
    이후 데이터 갱신엔 재초기화 안 함(사용자 펼침 상태 보존).
- `apps/web/components/pricing/gpu/MarginControl.tsx`
  - `showLabel?: boolean`(기본 true) 추가 — 외부에 별도 라벨이 있으면 내부 "마진" 라벨 숨김(중복 방지).
- `apps/web/app/(member)/pricing/gpu/tabs/PriceTableTab.tsx`
  - `isAdmin` prop 추가. 인라인 마진바(프리셋/입력/handleMarginSave/marginInput/marginSaving state) 제거
    → `<MarginControl showLabel={false} onSaved={revalidate} />`로 대체.
  - 미사용이 된 `useCallback` import 제거.
- `apps/web/app/(member)/pricing/gpu/GpuPricingClient.tsx`
  - PriceTableTab에 `isAdmin` 전달.
- `apps/web/app/globals.css`
  - 공용 컴포넌트로 대체되어 orphan이 된 `.gpu-mb-preset/.gpu-mb-input/.gpu-mb-pct` 제거
    (`.gpu-margin-bar/-left/-icon/-ctrl`은 레거시 바 레이아웃에 계속 사용 → 유지).
- `apps/web/e2e/gpu-unified-table.spec.ts`
  - 기본 전체접힘 반영: 그룹 첫 상태 `aria-expanded=false`로 토글 단언 정정.

## 변경 이유
- 모델이 많아 기본 펼침이면 스크롤이 길어짐 → 기본 접힘으로 개관성↑(사용자 요청).
- 마진 저장 로직이 통합/레거시 두 곳에 분산되어 있던 것을 공용 컴포넌트로 단일화(재사용·단일구현 정책).

## 영향 범위
- 표시·상호작용·설정저장만. 마진 계산 SSOT(서버) 무변경.
- 레거시 마진바: 비관리자는 이제 읽기 전용(기존엔 누구나 클릭→서버 403). 권한 UX 일관화(개선).
- orphan CSS 제거로 design:check baseline 301→300.

## 검증
- `tsc --noEmit` 0 · `pnpm design:check` 통과 · `pnpm lint`(신규 에러 0, 기존 경고만)
- Playwright e2e 3/3(기본 접힘 토글 + off 롤백)
- 실인증 스크린샷 2종: 통합뷰 전체접힘 / 레거시 탭 마진바(공용 컴포넌트) 정상
