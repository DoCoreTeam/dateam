import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Key, Palette, Bell, Cloud } from 'lucide-react'
import GeminiSettings from './GeminiSettings'
import KoraeximSettings from './KoraeximSettings'
import BrandingSettings from './BrandingSettings'
import TokenAlertSettings from './TokenAlertSettings'
import GoogleDriveSettings from './GoogleDriveSettings'
import DriveConnectedBanner from './DriveConnectedBanner'
import { getBranding } from '@/lib/branding'

const GEMINI_KEY = 'gemini_api_key'
const KOREAEXIM_KEY = 'koreaexim_api_key'

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 7) + '••••••••' + key.slice(-4)
}

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const driveParam = params.drive

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [branding, adminClient] = await Promise.all([
    getBranding(),
    Promise.resolve(createAdminClient()),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: metaData } = await (adminClient as any)
    .from('org_content')
    .select('value')
    .eq('key', 'META')
    .single()

  const meta = (metaData?.value as Record<string, unknown>) ?? {}
  const tokenAlertThreshold = typeof meta.ai_token_alert_threshold === 'number' ? meta.ai_token_alert_threshold : 1_000_000
  const storedKey = meta[GEMINI_KEY] as string | undefined
  const hasKey = !!storedKey
  const maskedKey = storedKey ? maskKey(storedKey) : null
  const savedModel = (meta.gemini_model as string | undefined) ?? null

  const storedKoraeximKey = meta[KOREAEXIM_KEY] as string | undefined
  const hasKoraeximKey = !!storedKoraeximKey
  const maskedKoraeximKey = storedKoraeximKey ? maskKey(storedKoraeximKey) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
      {driveParam === 'connected' && <DriveConnectedBanner />}
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          시스템 설정
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          브랜딩 및 외부 API를 관리합니다
        </p>
      </div>

      {/* 브랜딩 설정 */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <Palette size={15} color="#6366f1" />
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>브랜딩 설정</h2>
        </div>
        <BrandingSettings initialLogoUrl={branding.logoUrl} initialBrandName={branding.brandName} />
      </section>

      {/* API 설정 */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <Key size={15} color="#6366f1" />
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>AI 모델 연동</h2>
        </div>
        <GeminiSettings hasKey={hasKey} maskedKey={maskedKey} savedModel={savedModel} />
      </section>

      {/* 한국수출입은행 환율 API */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <Key size={15} color="#6366f1" />
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>환율 API 연동</h2>
        </div>
        <KoraeximSettings hasKey={hasKoraeximKey} maskedKey={maskedKoraeximKey} />
      </section>

      {/* AI 토큰 알림 설정 */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <Bell size={15} color="#6366f1" />
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>AI 토큰 알림</h2>
        </div>
        <TokenAlertSettings currentThreshold={tokenAlertThreshold} />
      </section>

      {/* Google Drive 연동 */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <Cloud size={15} color="#6366f1" />
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>Google Drive 연동</h2>
        </div>
        <GoogleDriveSettings />
      </section>
    </div>
  )
}
