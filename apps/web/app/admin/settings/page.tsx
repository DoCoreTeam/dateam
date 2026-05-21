import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Key } from 'lucide-react'
import GeminiSettings from './GeminiSettings'

const GEMINI_KEY = 'gemini_api_key'

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 7) + '••••••••' + key.slice(-4)
}

export default async function AdminSettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: keyData } = await (adminClient as any)
    .from('org_content')
    .select('value')
    .eq('key', GEMINI_KEY)
    .single()

  const storedKey = keyData?.value as string | undefined
  const hasKey = !!storedKey
  const maskedKey = storedKey ? maskKey(storedKey) : null

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          API 설정
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.375rem', fontSize: '0.9rem' }}>
          외부 AI API 키를 관리합니다
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <Key size={15} color="#6366f1" />
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>AI 모델 연동</h2>
      </div>

      <GeminiSettings hasKey={hasKey} maskedKey={maskedKey} />
    </div>
  )
}
