import { createAdminClient } from '@/lib/supabase/server'

export const DEFAULT_BRAND_NAME = 'AX사업본부'

export interface BrandingConfig {
  brandName: string
  logoUrl: string | null
}

// unstable_cache 제거: Route Handler의 revalidateTag가 완전히 동작하지 않는 Next.js 14 이슈
// 레이아웃 렌더 시마다 DB 직접 조회 (설정값이므로 성능 영향 무시)
export const getBranding = async (): Promise<BrandingConfig> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminClient = createAdminClient() as any
    const { data } = await adminClient
      .from('system_settings')
      .select('key, value')
      .in('key', ['brand_name', 'logo_path'])

    const settings: Record<string, string | null> = {}
    for (const row of (data ?? []) as { key: string; value: string | null }[]) {
      settings[row.key] = row.value
    }

    const logoPath = settings.logo_path ?? null
    let logoUrl: string | null = null

    if (logoPath) {
      const { data: urlData } = adminClient.storage
        .from('branding')
        .getPublicUrl(logoPath)
      logoUrl = urlData?.publicUrl ?? null
    }

    return {
      brandName: settings.brand_name ?? DEFAULT_BRAND_NAME,
      logoUrl,
    }
  } catch {
    return { brandName: DEFAULT_BRAND_NAME, logoUrl: null }
  }
}
