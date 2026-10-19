'use client'

import { useState, useTransition } from 'react'
import { Cpu } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ModelPickerModal from '@/components/ui/ModelPickerModal'
import { listModelCatalog, refreshModelCatalog } from '@/app/(ai)/ai/actions'
import { PROVIDER_LABELS } from '@/lib/ai-chat/labels'
import { AI_MODEL_FIELD } from '@/lib/terms'
import type { AiChatProviderId } from '@/types/database'

interface Props {
  provider: AiChatProviderId
  hasKey: boolean
  /** 사람이 고른 모델. 고르지 않았으면 null — 기본값으로 채워 넘기지 않는다 */
  savedModel: string | null
  /** 고르지 않았을 때 실제로 불리는 모델. 없으면 null */
  defaultModel?: string | null
  /** 이 프로바이더의 메인 모델을 META에 저장하는 서버 액션 */
  onSave: (model: string) => Promise<{ ok: boolean; error?: string }>
}

/**
 * 연동 카드의 모델 선택 (§2-5 동종 UI 통일).
 *
 * 예전에는 카드마다 드롭다운을 따로 만들어(Gemini·Claude·OpenAI 3벌 복붙) 모델 ID만 나열했다.
 * 그래서 어떤 모델이 무엇에 쓰는 것인지, 지금 쓸 수 있기는 한지 화면에서 알 수 없었다.
 * AI 채팅이 쓰는 모델 선택 모달과 **같은 부품**을 쓴다 — 능력·컨텍스트·출시일·가용성까지 한 화면에서 본다.
 */
export default function ModelSelectField({ provider, hasKey, savedModel, defaultModel = null, onSave }: Props) {
  const [open, setOpen] = useState(false)
  const [currentModel, setCurrentModel] = useState<string | null>(savedModel)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startSave] = useTransition()

  function handleSelect(_provider: AiChatProviderId, model: string) {
    setMsg(null)
    startSave(async () => {
      const result = await onSave(model)
      if (result.ok) {
        setCurrentModel(model)
        setMsg({ ok: true, text: `모델이 저장되었습니다: ${model}` })
      } else {
        setMsg({ ok: false, text: result.error ?? '저장 실패' })
      }
    })
  }

  return (
    <div style={{ borderTop: 'var(--border-w-2) solid var(--border-color)', paddingTop: 'var(--space-4)', marginTop: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', minWidth: 0 }}>
          <Cpu size={14} color="var(--brand)" />
          <span style={{ fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--text)' }}>모델 선택</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!hasKey || pending}
          className="btn-ghost"
        >
          {pending ? <AXDotLoader size={4} color="var(--text-faint)" /> : null}
          {currentModel ? AI_MODEL_FIELD.change : AI_MODEL_FIELD.choose}
        </button>
      </div>

      {currentModel ? (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', margin: 0, fontFamily: 'monospace' }}>{currentModel}</p>
      ) : hasKey && defaultModel ? (
        /* 고르지 않았는데 기본값이 불린다 — 그 사실과 그 모델을 같이 말한다. 고른 것처럼 그리지 않는다 */
        <div>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', margin: 0 }}>{AI_MODEL_FIELD.notChosenDefault}</p>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', margin: 0, fontFamily: 'monospace' }}>{defaultModel}</p>
        </div>
      ) : (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', margin: 0 }}>
          {hasKey ? AI_MODEL_FIELD.notChosen : AI_MODEL_FIELD.needKey}
        </p>
      )}

      {msg && (
        <p className={`status-pill ${msg.ok ? 'status-pill-ok' : 'status-pill-danger'}`} role="status" style={{ marginTop: 'var(--space-2)' }}>
          {msg.text}
        </p>
      )}

      {open && (
        <ModelPickerModal
          providers={[{ id: provider, label: PROVIDER_LABELS[provider] }]}
          currentProvider={provider}
          currentModel={currentModel}
          onSelect={handleSelect}
          onClose={() => setOpen(false)}
          /* 관문은 이 화면이 들고 있다 — 두 서버 액션 모두 관리자만 지난다 */
          load={listModelCatalog}
          refresh={refreshModelCatalog}
        />
      )}
    </div>
  )
}
