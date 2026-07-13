'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Send, Square } from 'lucide-react'
import type { AiChatProviderId } from '@/types/database'
import type { ProviderView } from './AiChatClient'

interface ComposerProps {
  streaming: boolean
  currentProvider: AiChatProviderId | null
  currentModel: string | null
  providers: ProviderView[]
  onSend: (content: string) => void
  onStop: () => void
  onChangeModel: (provider: AiChatProviderId, model: string) => void
}

const MAX_LEN = 32000

export default function Composer({
  streaming,
  currentProvider,
  currentModel,
  providers,
  onSend,
  onStop,
  onChangeModel,
}: ComposerProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const noProviders = providers.length === 0

  const autoGrow = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => {
    autoGrow()
  }, [value, autoGrow])

  function submit() {
    const trimmed = value.trim()
    if (!trimmed || streaming || noProviders) return
    onSend(trimmed.slice(0, MAX_LEN))
    setValue('')
    // 높이 리셋
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) el.style.height = 'auto'
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // IME 조합 중 Enter는 전송 금지
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  function handleModelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const p = providers.find((pv) => pv.id === e.target.value)
    if (p) onChangeModel(p.id, p.model)
  }

  return (
    <div className="ai-chat-composer">
      <div className="ai-chat-composer-row">
        <textarea className="input-field ai-chat-textarea"
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={noProviders ? '설정에서 API 키를 먼저 등록하세요' : '메시지를 입력하세요  (Enter 전송 · Shift+Enter 줄바꿈)'}
          rows={1}
          disabled={noProviders}
          aria-label="메시지 입력"
        />
        {streaming ? (
          <button type="button" className="ai-chat-send" data-variant="stop" onClick={onStop} aria-label="생성 중단">
            <Square size={16} />
            중단
          </button>
        ) : (
          <button
            type="button"
            className="ai-chat-send"
            onClick={submit}
            disabled={!value.trim() || noProviders}
            aria-label="전송"
          >
            <Send size={16} />
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <label className="label" htmlFor="ai-chat-model" style={{ margin: 0, fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>
          모델
        </label>
        <select id="ai-chat-model" className="input-field"
          value={currentProvider ?? ''}
          onChange={handleModelChange}
          disabled={noProviders}
          style={{ width: 'auto', maxWidth: '100%', fontSize: 'var(--fs-xs)', padding: 'var(--space-1) var(--space-2)' }}
          aria-label="프로바이더 및 모델 선택"
        >
          {noProviders && <option value="">사용 가능한 프로바이더 없음</option>}
          {currentProvider && !providers.some((p) => p.id === currentProvider) && (
            <option value={currentProvider}>
              {currentProvider} · {currentModel}
            </option>
          )}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {p.model}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
