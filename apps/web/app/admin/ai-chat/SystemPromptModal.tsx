'use client'
import { useState } from 'react'
import { X } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import { updateSystemPrompt } from '@/app/admin/ai-chat/actions'

const MAX_CHARS = 4000

interface Props {
  conversationId: string
  systemPrompt: string | null // 현재 저장값
  onSave: (systemPrompt: string | null) => void
  onClose: () => void
}

export default function SystemPromptModal({ conversationId, systemPrompt, onSave, onClose }: Props) {
  useEscClose(onClose)
  const [draft, setDraft] = useState(systemPrompt ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const over = draft.length > MAX_CHARS

  async function save() {
    if (busy) return
    const trimmed = draft.trim()
    if (trimmed.length > MAX_CHARS) {
      setError(`시스템 프롬프트는 최대 ${MAX_CHARS}자입니다`)
      return
    }
    setBusy(true)
    setError(null)
    const value = trimmed === '' ? null : trimmed
    const r = await updateSystemPrompt(conversationId, value)
    setBusy(false)
    if (!r.ok) {
      setError(r.error ?? '저장에 실패했습니다')
      return
    }
    onSave(value)
    onClose()
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
        background: 'var(--modal-backdrop)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 520,
          background: 'var(--color-surface)', borderRadius: 'var(--radius)',
          padding: 'var(--space-6)', boxShadow: 'var(--shadow-modal)',
          maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>시스템 프롬프트</h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}
          >
            <X size={18} />
          </button>
        </div>

        <p style={{ margin: `0 0 var(--space-3)`, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          이 대화에만 적용되는 지침입니다. 매 요청의 system 메시지로 전달됩니다. 비우면 해제됩니다.
        </p>

        <label className="label" htmlFor="ai-chat-system-prompt">지침</label>
        <textarea
          id="ai-chat-system-prompt"
          className="input-field"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          maxLength={MAX_CHARS}
          placeholder="예: 항상 한국어로, 간결하게 답변하세요."
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />

        <div
          style={{
            marginTop: 'var(--space-1)', textAlign: 'right',
            fontSize: 'var(--fs-xs)', color: over ? 'var(--danger)' : 'var(--text-faint)',
          }}
        >
          {draft.length} / {MAX_CHARS}
        </div>

        {error && (
          <div
            role="alert"
            style={{
              marginTop: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)',
              background: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)',
              borderRadius: 'var(--radius)', fontSize: 'var(--fs-sm)', color: 'var(--danger)',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-5)', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            취소
          </button>
          <button
            onClick={save}
            disabled={busy || over}
            style={{
              fontSize: 'var(--fs-sm)', fontWeight: 600,
              color: 'var(--accent-fg)', background: 'var(--accent)', border: 'none',
              borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-5)',
              cursor: busy ? 'wait' : over ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? '저장중' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
