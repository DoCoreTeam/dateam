import { createAdminClient } from '@/lib/supabase/server'
import { unstable_cache } from 'next/cache'

export const DEFAULT_BRAND_NAME = 'AX사업본부'

export interface BrandingConfig {
  brandName: string
  logoUrl: string | null
}

const fetchBranding = async (): Promise<BrandingConfig> => {
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

export const getBranding = unstable_cache(
  fetchBranding,
  ['branding-config'],
  { revalidate: 3600, tags: ['branding'] }
)
