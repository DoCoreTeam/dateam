/**
 * GpuModelName — GPU 모델명 + ×N 구성 강조 SSOT 컴포넌트
 *
 * 4개 탭(PriceTableTab / PriceCockpitTab / MarketTab / SalePriceCatalogPage) 공용.
 * ×N 구성 강조 스타일은 globals.css .gpu-model-config 클래스로 토큰 관리.
 * 인라인 style로 fontSize/fontWeight/color 하드코딩 금지.
 */

interface GpuModelNameProps {
  /** GPU 모델명 (예: A100, H100) */
  modelName: string
  /**
   * GPU 수량 (×N 강조 표시).
   * 0 / null / undefined / NaN 이면 ×N 배지를 렌더하지 않음.
   * 1 이상의 정수만 표시.
   */
  gpuCount?: number | null
  /** 추정(derived) 행 여부 — true이면 파란 계열로 표시 */
  isDerived?: boolean
}

export function GpuModelName({ modelName, gpuCount, isDerived = false }: GpuModelNameProps) {
  const showCount = gpuCount != null && Number.isFinite(gpuCount) && gpuCount > 0
  return (
    <span className="gpu-model-nm-wrap">
      <span className="gpu-model-nm">{modelName}</span>
      {showCount && (
        <span className={`gpu-model-config${isDerived ? ' gpu-model-config--derived' : ''}`}>
          ×{gpuCount}
        </span>
      )}
    </span>
  )
}
