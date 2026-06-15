# FAST PATH Summary — v0.7.126

작업: GPU 통합뷰에서 사라진 "판매 마진(%) 설정" 컨트롤을 통합 표 툴바에 복구
대상:
- 신규 `apps/web/components/pricing/gpu/MarginControl.tsx` (공용 — 프리셋 15/18/20/25·−/+·입력, `/api/pricing/gpu/settings` PATCH 저장, 관리자만 편집/비관리자 읽기전용)
- `apps/web/components/pricing/gpu/unified/UnifiedTable.tsx` (툴바에 MarginControl 배치 + props)
- `apps/web/components/pricing/gpu/unified/UnifiedTableConnected.tsx` (marginPct·isAdmin 수신, 저장 후 cockpit SWR `mutate` + settings revalidate)
- `apps/web/app/(member)/pricing/gpu/GpuPricingClient.tsx` (settings.margin_pct·isAdmin·mutateSettings 전달)
- `apps/web/app/globals.css` (`gpu-margin-ctrl*` 토큰 기반 스타일)

이유: 기본뷰가 탭→통합으로 바뀌며 구 PriceTableTab의 "마진 바"가 통합뷰엔 없어, 마진율을 보거나 조정할 수단이 사라짐. 마진은 전역 가격 설정이고 통합 표의 auto_price에 직접 영향 → 통합 표 툴바가 적절한 위치.

영향:
- 마진 계산 로직 무변경(서버 SSOT 유지). 저장 경로는 기존 settings API 재사용.
- 저장 시 cockpit SWR + settings SWR revalidate → 표의 자동가가 즉시 새 마진 반영.
- 권한: PATCH는 서버에서 관리자 게이트(requireAdminApi). 비관리자는 읽기 전용 표시.
- 마진바 로직을 PriceTableTab에서 복붙하지 않고 공용 컴포넌트로 단일화(SSOT). 단, 레거시 PriceTableTab은 회귀 방지 위해 이번엔 미교체.

검증: tsc 0 · design:check · e2e(통합 표) 무회귀
