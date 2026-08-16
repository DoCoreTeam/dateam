import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { getShellSettings } from '@/lib/settings'

export const DEFAULT_BRAND_NAME = 'AX사업본부'
export const DEFAULT_BRAND_TAGLINE = '본부 운영 플랫폼'

export interface BrandingConfig {
  brandName: string
  tagline: string
  logoUrl: string | null
}

// unstable_cache 제거: Route Handler의 revalidateTag가 완전히 동작하지 않는 Next.js 14 이슈.
//
// 대신 React `cache()`로 **요청 스코프**만 묶는다. 이건 값을 오래 들고 있는 캐시가 아니라
// "같은 요청 안에서 같은 질문을 반복하지 않는다"는 뜻이라 무효화 문제가 아예 없다.
// 왜 필요한가: 한 번의 화면 요청에서 루트 layout의 generateMetadata와
// 그룹 layout(member·ci·admin)이 **각각** 이걸 부른다 — 매번 왕복이 하나씩 늘었다.
// (근거: docs/2026-08-16-performance-audit/PLAN.md §2-2)
export const getBranding = cache(async (): Promise<BrandingConfig> => {
  try {
    const settings = await getShellSettings()
    const logoPath = settings.logo_path ?? null
    let logoUrl: string | null = null

    if (logoPath) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adminClient = createAdminClient() as any
      const { data: urlData } = adminClient.storage.from('branding').getPublicUrl(logoPath)
      logoUrl = urlData?.publicUrl ?? null
    }

    return {
      brandName: settings.brand_name ?? DEFAULT_BRAND_NAME,
      tagline: settings.brand_tagline ?? DEFAULT_BRAND_TAGLINE,
      logoUrl,
    }
  } catch {
    return { brandName: DEFAULT_BRAND_NAME, tagline: DEFAULT_BRAND_TAGLINE, logoUrl: null }
  }
})
