import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Palette, Bot, Plug, Server } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import SegmentedTabs, { type SegmentedTab } from '@/components/ui/SegmentedTabs'
import SettingsSection from './SettingsSection'
import GeminiSettings from './GeminiSettings'
import YoutubeSettings from './YoutubeSettings'
import ClaudeSettings from './ClaudeSettings'
import OpenAiSettings from './OpenAiSettings'
import AiChatDefaultProviderPicker from './AiChatDefaultProviderPicker'
import { getAvailableProviders, META_DEFAULT_PROVIDER_KEY } from '@/lib/ai-chat/registry'
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

const GEMINI_KEY = 'gemini_api_key'
const YOUTUBE_KEY = 'youtube_api_key'
const KOREAEXIM_KEY = 'koreaexim_api_key'
const CLAUDE_KEY = 'claude_api_key'
const OPENAI_KEY = 'openai_api_key'

const AI_PROVIDER_LABELS: Record<AiChatProviderId, string> = {
  gemini: 'Gemini',
  claude: 'Claude',
  openai: 'OpenAI',
}

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
  const hasKey = !!storedKey
  const maskedKey = storedKey ? maskKey(storedKey) : null
  const savedModel = (meta.gemini_model as string | undefined) ?? null

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
    label: AI_PROVIDER_LABELS[p.id],
  }))
  const currentDefaultProvider = (meta[META_DEFAULT_PROVIDER_KEY] as AiChatProviderId | undefined) ?? ''

  const storedKoraeximKey = meta[KOREAEXIM_KEY] as string | undefined
  const hasKoraeximKey = !!storedKoraeximKey
  const maskedKoraeximKey = storedKoraeximKey ? maskKey(storedKoraeximKey) : null

  const storedDbUrl = meta.db_connection_url as string | undefined
  const hasDbUrl = !!storedDbUrl
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
              <GeminiSettings hasKey={hasKey} maskedKey={maskedKey} savedModel={savedModel} />
              <ClaudeSettings hasKey={hasClaudeKey} maskedKey={maskedClaudeKey} savedModel={savedClaudeModel} />
              <OpenAiSettings hasKey={hasOpenAiKey} maskedKey={maskedOpenAiKey} savedModel={savedOpenAiModel} />
              <AiChatDefaultProviderPicker available={availableChatProviders} current={currentDefaultProvider} />
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
