interface BrandLoaderMarkProps {
  /** 로고 이미지 alt / 미등록 시 미사용 */
  brandName: string
  /** 등록된 브랜드 로고 이미지 — 있으면 이미지, 없으면 X마크 폴백 */
  logoUrl?: string | null
  /** 어두운 오버레이 위에 올릴 때 텍스트 색 보정 */
  dark?: boolean
}

/**
 * 공용 로딩 브랜드 마크 (SSOT) — 로고 이미지가 있으면 이미지, 없으면 DATA ALLIANCE X마크.
 * NavigationLoader(라우트 전환)·AXLoadingOverlay(AI/로그인 등)가 동일 비주얼을 쓰도록 단일화.
 * 화면마다 로더 마크업을 복붙하지 말고 이 컴포넌트를 재사용한다.
 */
export default function BrandLoaderMark({ brandName, logoUrl, dark }: BrandLoaderMarkProps) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        aria-hidden
        src={logoUrl}
        alt={brandName}
        style={{ maxHeight: '56px', maxWidth: '200px', objectFit: 'contain' }}
      />
    )
  }

  return (
    <div aria-hidden className="da-loader-logo">
      {/* DATA ALLIANCE 로고: 두 개의 쉐브론이 X자를 형성 */}
      <svg
        viewBox="0 0 80 56"
        width="80"
        height="56"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="da-loader-mark"
      >
        <polyline points="4,4 36,28 4,52" stroke="var(--brand)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points="76,4 44,28 76,52" stroke="var(--brand)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="da-loader-text" style={dark ? { color: 'var(--color-border)', opacity: 0.9 } : undefined}>DATA ALLIANCE</div>
    </div>
  )
}
