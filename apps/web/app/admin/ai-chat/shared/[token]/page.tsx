import { Lock, MessageSquareOff } from 'lucide-react'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createAdminClient } from '@/lib/supabase/server'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import type { AiChatCitation } from '@/types/database'
import MarkdownMessage from '../../MarkdownMessage'
import CitationCards from '../../CitationCards'

// 세션 3 §5-2 — admin 경계 내 공유 옵트인 read-only 뷰.
// 공개 라우트 아님: requireAdmin으로 인증 경계 유지 + 서버가 shared=true·token 일치·미삭제를
// 명시 검증한 뒤에만 열람 제공한다. RLS는 owner 격리 그대로(정책 완화 없음).

interface SharedConversation {
  id: string
  user_id: string
  title: string
  provider: string
  model: string
  created_at: string
}

interface SharedMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  citations: AiChatCitation[] | null
}

export default async function SharedConversationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  // 인증 경계 유지 — 여전히 admin만 접근(공개 공유 아님)
  await requireAdmin()
  const { token } = await params

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  // 공유 대화 조회 — 반드시 shared=true AND share_token 일치 AND 미삭제만
  const { data: conv } = await db
    .from('ai_conversations')
    .select('id, user_id, title, provider, model, created_at')
    .eq('share_token', token)
    .eq('shared', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (!conv) {
    return (
      <div className="ai-chat-state" role="alert">
        <MessageSquareOff size={30} style={{ opacity: 0.4 }} />
        <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
          공유된 대화를 찾을 수 없습니다
        </div>
        <p style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>
          링크가 만료되었거나 공유가 해제된 대화입니다.
        </p>
      </div>
    )
  }

  const c = conv as SharedConversation

  const [msgRes, ownerRes] = await Promise.all([
    db
      .from('ai_messages')
      .select('id, role, content, created_at, citations')
      .eq('conversation_id', c.id)
      .is('error', null)
      .order('created_at', { ascending: true }),
    db
      .from('profiles')
      .select('name')
      .eq('id', c.user_id)
      .maybeSingle(),
  ])

  const messages = (Array.isArray(msgRes?.data) ? msgRes.data : []) as SharedMessage[]
  const ownerName = (ownerRes?.data?.name as string | undefined)?.trim() || '알 수 없는 사용자'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* 읽기 전용 배너 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--info-bg)',
          border: 'var(--hairline) solid var(--info-border)',
          borderRadius: 'var(--radius)',
          color: 'var(--info)',
          fontSize: 'var(--fs-sm)',
          fontWeight: 600,
        }}
      >
        <Lock size={15} aria-hidden="true" />
        <span>읽기 전용 — {ownerName}의 공유 대화</span>
      </div>

      {/* 대화 헤더 */}
      <header style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <h1
          style={{
            fontSize: 'var(--fs-2xl)',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            color: 'var(--text)',
            margin: 0,
          }}
        >
          {c.title}
        </h1>
        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          {c.provider} · {c.model} · {formatKstDateTimeShort(c.created_at)}
        </p>
      </header>

      {/* 트랜스크립트 (입력창 없음 — read-only) */}
      {messages.length === 0 ? (
        <div className="ai-chat-state">
          <MessageSquareOff size={28} style={{ opacity: 0.4 }} />
          <span style={{ fontSize: 'var(--fs-sm)' }}>표시할 메시지가 없습니다.</span>
        </div>
      ) : (
        <div className="ai-chat-messages" style={{ padding: 0 }}>
          {messages.map((m) => (
            <div key={m.id} className="ai-chat-row" data-role={m.role}>
              <div className="ai-chat-turn">
                {m.role === 'user' ? (
                  <div className="ai-chat-bubble" data-role="user">
                    {m.content}
                  </div>
                ) : (
                  <div className="ai-chat-bubble" data-role="assistant">
                    <MarkdownMessage content={m.content} />
                    {m.citations && m.citations.length > 0 && <CitationCards citations={m.citations} />}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
