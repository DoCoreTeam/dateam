# FAST PATH Summary — GPU 관리 화면 깜빡임(구뷰↔신뷰) 제거

## 작업
GPU 관리 페이지가 첫 진입 시 예전 화면(PriceTableTab/PriceCockpitTab)→통합표(UnifiedTableConnected)로 깜빡이던 것 제거.

## 원인 (확인 결과)
GpuPricingClient에서:
1. `unifiedOn`을 `useState(false)` → `useEffect`로 true 전환 → 첫 페인트=구뷰(!unifiedOn=PriceTableTab) → 마운트 후 신뷰로 교체 = 깜빡임.
2. `activeTab`을 `useState('board')` → 마운트 effect로 URL ?tab= 반영 → board→실제탭 추가 스왑.
   (isGpuFlagOn은 서버=base=true(DEFAULT_ON)인데 클라가 false로 시작한 게 핵심.)

## 대상 파일
- `lib/gpu/feature-flags.ts` — `gpuFlagBase(key)` export(localStorage 무관 base, SSR=클라 동일).
- `app/(member)/pricing/gpu/GpuPricingClient.tsx` —
  - `unifiedOn` = `useState(() => gpuFlagBase('unified'))` (첫 페인트부터 통합뷰). localStorage 오버라이드는 기존 effect가 마운트 후 반영.
  - `activeTab` = `useState(initialTab)` (URL/세션의 실제 탭으로 시작). VALID_TABS/initialTab 모듈 레벨 승격.

## 이유
첫 페인트 값을 서버 렌더(base)와 일치시켜 하이드레이션 불일치 없이 구뷰 플래시 제거.

## 영향
- GPU 페이지 board/탭 진입 깜빡임 제거. localStorage 'unified:off' 오버라이드 사용자만 마운트 후 1회 스왑(드문 파일럿).
- 가격 로직·통합표 내부 무변경.
