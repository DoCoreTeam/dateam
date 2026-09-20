import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { Palette, Bot, Plug, Server } from 'lucide-react'
import MfaPolicySettings from './MfaPolicySettings'
import PageHeader from '@/components/ui/PageHeader'
import SegmentedTabs, { type SegmentedTab } from '@/components/ui/SegmentedTabs'
import SettingsSection from './SettingsSection'
import YoutubeSettings from './YoutubeSettings'
import G2bSettings from './G2bSettings'
import VercelSettings from './VercelSettings'
import AiProviderOrder from './AiProviderOrder'
import AiProviderCard from './AiProviderCard'
import { AI_PROVIDERS } from '@/lib/ai/provider-catalog'
import { readProviderKey, readProviderModel } from '@/lib/ai/provider-keys'
import { listKeys, type KeyView } from '@/lib/ai/key-store'
import { getProviderOrder } from '@/lib/ai-chat/registry'
import { getAvailableProviders, META_DEFAULT_PROVIDER_KEY } from '@/lib/ai-chat/registry'
import { PROVIDER_LABELS } from '@/lib/ai-chat/labels'
import type { AiChatProviderId } from '@/types/database'
import DbSettings from './DbSettings'
import KoraeximSettings from './KoraeximSettings'
import BrandingSettings from './BrandingSettings'
import ThemeSettings from './ThemeSettings'
import TokenAlertSettings from './TokenAlertSettings'
import GoogleDriveSettings from './GoogleDriveSettings'
import DriveConnectedBanner from './DriveConnectedBanner'
import { getBranding } from '@/lib/branding'
import { getActiveTheme } from '@/lib/theme'
import { getDriveConnectionStatus } from '@/lib/google-drive'
import { VERCEL_META, maskToken } from '@/lib/vercel/config'

const GEMINI_KEY = 'gemini_api_key'
const YOUTUBE_KEY = 'youtube_api_key'
const KOREAEXIM_KEY = 'koreaexim_api_key'
// 나라장터 — RFP 공고 레이더가 쓴다. 이름은 lib/rfp/g2b/client 의 G2B_KEY_FIELD 와 같아야 한다
const G2B_KEY = 'g2bServiceKey'
const CLAUDE_KEY = 'claude_api_key'
const OPENAI_KEY = 'openai_api_key'
const STT_KEY = 'stt_api_key'

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
  const user = await getRequestUser()
  if (!user) redirect('/login')

  // Drive 연결 상태는 다른 연동 카드와 동일하게 **서버 렌더**로 읽는다.
  // (예전엔 카드가 진입할 때마다 클라이언트에서 /status를 불러 이 카드만 동작이 달랐다 — §2-5)
  const [branding, activeTheme, driveStatus, adminClient] = await Promise.all([
    getBranding(),
    getActiveTheme(),
    getDriveConnectionStatus(),
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
  const ytKey = meta[YOUTUBE_KEY] as string | undefined
  const ytMasked = ytKey ? `${ytKey.slice(0, 7)}••••••••${ytKey.slice(-4)}` : null
  const g2bKey = meta[G2B_KEY] as string | undefined
  const g2bMasked = g2bKey ? maskKey(g2bKey) : null
  const hasKey = !!storedKey
  const maskedKey = storedKey ? maskKey(storedKey) : null
  const savedModel = (meta.gemini_model as string | undefined) ?? null

  // 음성 인식(STT) — 회의노트·CRM 미팅이 같은 키 하나를 쓴다
  const sttKey = meta[STT_KEY] as string | undefined
  const sttMasked = sttKey ? maskKey(sttKey) : null
  // Groq 는 키 한 벌을 둘이 쓴다 — AI 모델(채팅·분석)과 음성 인식(전사)
  const groqModel = (meta.groq_model as string | undefined) ?? null
  const sttModel = (meta.stt_model as string | undefined) ?? null

  /*
    공급자마다 등록된 키 줄. **못 읽어도 화면을 죽이지 않는다** —
    표가 없는 조직은 빈 목록이 오고, 카드가 예전 모양(META 한 칸)으로 그려진다.
  */
  const keyRowsByProvider: Partial<Record<string, KeyView[]>> = Object.fromEntries(
    await Promise.all(AI_PROVIDERS.map(async (spec) => {
      try {
        return [spec.id, await listKeys(spec.id)] as const
      } catch {
        return [spec.id, [] as KeyView[]] as const
      }
    })),
  )

  // Vercel 토큰은 화면으로 나가지 않는다 — 마스킹은 lib/vercel/config 의 것을 쓴다(SSOT)
  const vercelToken = meta[VERCEL_META.token] as string | undefined
  const vercelProject = (meta[VERCEL_META.projectId] as string | undefined) ?? null
  const vercelTeam = (meta[VERCEL_META.teamId] as string | undefined) ?? null

  const storedClaudeKey = meta[CLAUDE_KEY] as string | undefined
  const hasClaudeKey = !!storedClaudeKey
  const maskedClaudeKey = storedClaudeKey ? maskKey(storedClaudeKey) : null
  const savedClaudeModel = (meta.claude_model as string | undefined) ?? null

  const storedOpenAiKey = meta[OPENAI_KEY] as string | undefined
  const hasOpenAiKey = !!storedOpenAiKey
  const maskedOpenAiKey = storedOpenAiKey ? maskKey(storedOpenAiKey) : null
  const savedOpenAiModel = (meta.openai_model as string | undefined) ?? null

  // 채팅 기본 프로바이더 셀렉트 — 가용 프로바이더만 노출
  const availableChatProviders = getAvailableProviders(meta).map((p) => ({
    id: p.id,
    label: PROVIDER_LABELS[p.id],
  }))
  const currentDefaultProvider = (meta[META_DEFAULT_PROVIDER_KEY] as AiChatProviderId | undefined) ?? ''

  const storedKoraeximKey = meta[KOREAEXIM_KEY] as string | undefined
  const hasKoraeximKey = !!storedKoraeximKey
  const maskedKoraeximKey = storedKoraeximKey ? maskKey(storedKoraeximKey) : null

  const storedDbUrl = meta.db_connection_url as string | undefined
  const hasDbUrl = !!storedDbUrl

  /**
   * 「관리자는 2단계 필수」 현재 값과, 지금 몇 명이 켰는지.
   *
   * 숫자를 함께 보여 주는 이유: 스위치만 있으면 켜도 되는 상태인지 알 수 없다.
   * 아무도 안 켰을 때 켜도 안전하지만(등록 화면으로 보낼 뿐 막지 않는다),
   * 그 사실을 화면이 말해 주는 편이 낫다.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const secDb = createAdminClient() as any
  const [{ data: mfaFlagRow }, { data: adminRows }, { data: factorRows }] = await Promise.all([
    secDb.from('system_settings').select('value').eq('key', 'mfa_required_for_admin').maybeSingle(),
    secDb.from('profiles').select('id').eq('role', 'admin').is('deleted_at', null),
    secDb.schema('auth').from('mfa_factors').select('user_id').eq('status', 'verified'),
  ])
  const mfaRequiredForAdmin = mfaFlagRow?.value === 'true'
  const adminIds = new Set<string>(((adminRows ?? []) as { id: string }[]).map((r) => r.id))
  const adminsTotal = adminIds.size
  const adminsWithMfa = new Set(
    ((factorRows ?? []) as { user_id: string }[]).map((r) => r.user_id).filter((id) => adminIds.has(id)),
  ).size
  const maskedDbUrl = storedDbUrl ? storedDbUrl.replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/i, (_m, a, _pw, c) => `${a}••••••••${c}`) : null

  // 탭 구성 — 아래로 계속 스크롤하는 대신 성격별로 나눈다.
  // YouTube는 "AI 모델"이 아니라 데이터 수집용 API라 연동 탭으로 옮겼다(원래 자리가 틀렸다).
  const tabs: SegmentedTab[] = [
    {
      id: 'branding',
      label: '브랜딩',
      icon: <Palette size={15} />,
      content: (
        <div className="settings-grid">
          {/* 한 칸씩 차지하면 입력 폭이 읽기 좋은 크기가 되고, 두 카드 높이가 맞는다. */}
          <SettingsSection title="브랜딩 설정" desc="로고와 이름은 사이드바·로그인 화면에 그대로 쓰입니다.">
            <BrandingSettings
              initialLogoUrl={branding.logoUrl}
              initialBrandName={branding.brandName}
              initialTagline={branding.tagline}
            />
          </SettingsSection>
          <SettingsSection title="디자인 테마" desc="선택한 테마가 전 화면에 즉시 적용됩니다.">
            <ThemeSettings initialTheme={activeTheme} />
          </SettingsSection>
        </div>
      ),
    },
    {
      id: 'ai',
      label: 'AI 모델',
      icon: <Bot size={15} />,
      content: (
        <div className="settings-stack">
          <SettingsSection title="AI 모델 연동" desc="키를 등록한 모델만 AI 기능에서 고를 수 있습니다.">
            <div className="settings-grid">
              {/* 공급자 카드는 명세를 훑어 그린다 — 공급자를 하나 더하려면 명세에 한 줄을 더한다 */}
              {AI_PROVIDERS.map((spec) => {
                const key = readProviderKey(spec.id, meta)
                return (
                  <AiProviderCard
                    key={spec.id}
                    provider={spec.id}
                    hasKey={Boolean(key)}
                    maskedKey={key ? maskKey(key) : null}
                    savedModel={readProviderModel(spec.id, meta)}
                    // 전사 모델 칸은 그 키가 전사에도 쓰이는 공급자에게만 준다
                    transcriptionModel={spec.alsoUsedFor ? sttModel : undefined}
                    keyRows={keyRowsByProvider[spec.id] ?? []}
                  />
                )
              })}
              <AiProviderOrder
                providers={AI_PROVIDERS.map((spec) => ({
                  id: spec.id,
                  label: spec.label,
                  hasKey: Boolean(readProviderKey(spec.id, meta)),
                }))}
                order={getProviderOrder(meta)}
                current={currentDefaultProvider}
              />
            </div>
          </SettingsSection>
          <SettingsSection title="AI 토큰 알림" desc="사용량이 기준을 넘으면 알려드립니다.">
            <TokenAlertSettings currentThreshold={tokenAlertThreshold} />
          </SettingsSection>
        </div>
      ),
    },
    {
      id: 'integrations',
      label: '외부 연동',
      icon: <Plug size={15} />,
      content: (
        <div className="settings-stack">
          <SettingsSection title="데이터 수집·저장 연동" desc="콘텐츠 수집과 자료 보관에 쓰이는 외부 서비스입니다.">
            <div className="settings-grid">
              <YoutubeSettings hasKey={Boolean(ytKey)} maskedKey={ytMasked} />
              <GoogleDriveSettings
                connected={driveStatus.connected}
                email={driveStatus.email}
                outcome={typeof driveParam === 'string' ? driveParam : undefined}
                reason={typeof params.reason === 'string' ? params.reason : undefined}
              />
              <KoraeximSettings hasKey={hasKoraeximKey} maskedKey={maskedKoraeximKey} />
              <G2bSettings hasKey={Boolean(g2bKey)} maskedKey={g2bMasked} />
              <VercelSettings
                hasToken={Boolean(vercelToken)}
                maskedToken={vercelToken ? maskToken(vercelToken) : null}
                projectId={vercelProject}
                teamId={vercelTeam}
              />
            </div>
          </SettingsSection>
        </div>
      ),
    },
    {
      id: 'system',
      label: '시스템',
      icon: <Server size={15} />,
      content: (
        <div className="settings-stack">
          <SettingsSection title="보안" desc="로그인에 한 겹을 더할지 정합니다.">
            <MfaPolicySettings
              enabled={mfaRequiredForAdmin}
              adminsWithMfa={adminsWithMfa}
              adminsTotal={adminsTotal}
            />
          </SettingsSection>
          <SettingsSection title="DB 연결" desc="마이그레이션과 운영 점검에 쓰는 연결 정보입니다.">
            <DbSettings hasUrl={hasDbUrl} maskedUrl={maskedDbUrl} />
          </SettingsSection>
        </div>
      ),
    },
  ]

  return (
    <>
      {driveParam === 'connected' && <DriveConnectedBanner />}
      <PageHeader title="시스템 설정" description="브랜딩·외부 연동·시스템 값을 한곳에서 관리합니다" />
      <SegmentedTabs tabs={tabs} ariaLabel="시스템 설정 분류" />
    </>
  )
}
