'use client'

import { useState, useTransition } from 'react'
import { Sparkles, CheckCircle, XCircle } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import type { AiChatProviderId } from '@/types/database'
import { saveAiChatDefaultProvider } from './actions'

interface AiChatDefaultProviderPickerProps {
  available: { id: AiChatProviderId; label: string }[]
  current: AiChatProviderId | ''
}

export default function AiChatDefaultProviderPicker({ available, current }: AiChatDefaultProviderPickerProps) {
  const [value, setValue] = useState<AiChatProviderId | ''>(current)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startSave] = useTransition()

  function handleChange(next: AiChatProviderId | '') {
    setValue(next)
    setMsg(null)
    startSave(async () => {
      const result = await saveAiChatDefaultProvider(next)
      if (result.ok) {
        setMsg({ ok: true, text: '기본 프로바이더가 저장되었습니다' })
      } else {
        setMsg({ ok: false, text: result.error ?? '저장 실패' })
        setValue(current)
      }
    })
  }

  return (
    <div className="card" style={{ padding: 'var(--space-6)', maxWidth: '640px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '0.75rem' }}>
        <Sparkles size={16} color="var(--brand)" />
        <h2 className="tape-title" style={{ margin: 0 }}>채팅 기본 프로바이더</h2>
      </div>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0 0 var(--space-4)' }}>
        새 대화를 시작할 때 미리 선택되는 프로바이더입니다. &apos;자동&apos;은 사용 가능한 첫 프로바이더를 사용합니다.
      </p>

      {available.length === 0 ? (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', margin: 0 }}>
          먼저 위에서 하나 이상의 프로바이더 API 키를 등록하세요.
        </p>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <select className="input-field"
            value={value}
            onChange={(e) => handleChange(e.target.value as AiChatProviderId | '')}
            disabled={pending}
            style={{ flex: 1, fontSize: 'var(--fs-sm)' }}
            aria-label="채팅 기본 프로바이더"
          >
            <option value="">자동 (첫 가용)</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          {pending && <AXDotLoader size={5} color="var(--text-muted)" />}
        </div>
      )}

      {msg && (
        <div
          role="status"
          style={{
            marginTop: '0.625rem',
            padding: '0.625rem 0.875rem',
            borderRadius: 'var(--radius)',
            fontSize: 'var(--fs-sm)',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            backgroundColor: msg.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
            color: msg.ok ? 'var(--success)' : 'var(--danger)',
            border: `var(--hairline) solid ${msg.ok ? 'var(--success-border)' : 'var(--danger-border)'}`,
          }}
        >
          {msg.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
          {msg.text}
        </div>
      )}
    </div>
  )
}
