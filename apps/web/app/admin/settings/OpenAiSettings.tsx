'use client'

import { useState, useTransition } from 'react'
import { Key, CheckCircle, XCircle } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { saveOpenAiKey, saveOpenAiModel, getOpenAiModels, deleteOpenAiKey } from './actions'
import ModelSelectField from './ModelSelectField'
import { IntegrationStatus, IntegrationTest } from './integration-ui'

interface OpenAiSettingsProps {
  hasKey: boolean
  maskedKey: string | null
  savedModel: string | null
}

export default function OpenAiSettings({ hasKey: initialHasKey, maskedKey: initialMasked, savedModel }: OpenAiSettingsProps) {
  const [hasKey, setHasKey] = useState(initialHasKey)
  const [maskedKey, setMaskedKey] = useState(initialMasked)
  const [inputKey, setInputKey] = useState('')
  const [showInput, setShowInput] = useState(!initialHasKey)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savePending, startSave] = useTransition()

  const [disconnectPending, startDisconnect] = useTransition()

  function handleDisconnect() {
    setSaveMsg(null)
    startDisconnect(async () => {
      const result = await deleteOpenAiKey()
      if (result.ok) {
        setHasKey(false)
        setMaskedKey(null)
        setShowInput(true)
      } else {
        setSaveMsg({ ok: false, text: result.error ?? '연결 해제 실패' })
      }
    })
  }

  const [healthPending, startHealth] = useTransition()
  const [healthMsg, setHealthMsg] = useState<{ ok: boolean; text: string } | null>(null)

  /** 모델 목록 조회가 곧 연결 확인이다 — 키·네트워크·권한을 한 번에 검증한다. */
  function handleHealth() {
    setHealthMsg(null)
    startHealth(async () => {
      const r = await getOpenAiModels()
      setHealthMsg(r.ok
        ? { ok: true, text: `연결 성공 — ${r.models?.length ?? 0}개 모델 사용 가능` }
        : { ok: false, text: r.error ?? '연결 실패' })
    })
  }

  function handleSave(formData: FormData) {
    setSaveMsg(null)
    startSave(async () => {
      const result = await saveOpenAiKey(formData)
      if (result.ok) {
        setSaveMsg({ ok: true, text: 'API 키가 저장되었습니다' })
        setHasKey(true)
        setInputKey('')
        setShowInput(false)
        const k = (formData.get('apiKey') as string).trim()
        setMaskedKey(k.slice(0, 7) + '••••••••' + k.slice(-4))
      } else {
        setSaveMsg({ ok: false, text: result.error ?? '저장 실패' })
      }
    })
  }

  return (
    <div className="card" style={{ padding: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '1.25rem' }}>
        <Key size={16} color="var(--brand)" />
        <h2 className="tape-title" style={{ margin: 0 }}>OpenAI API 키</h2>
      </div>

      {hasKey && maskedKey && (
        <IntegrationStatus
          value={maskedKey}
          onChange={() => setShowInput((v) => !v)}
          onDisconnect={handleDisconnect}
          disconnectPending={disconnectPending}
        />
      )}

      {showInput && (
        <form action={handleSave} style={{ marginBottom: '1rem' }}>
          <label className="label">API 키 입력</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '0.375rem' }}>
            <input className="input-field"
              name="apiKey"
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="sk-..."
              style={{ flex: 1, fontFamily: 'monospace' }}
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={savePending || !inputKey.trim()}
              className="btn-primary"
              style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            >
              {savePending ? <AXDotLoader size={4} color="var(--brand-fg)" /> : null}
              저장
            </button>
          </div>
        </form>
      )}

      {saveMsg && (
        <div
          role="status"
          style={{
            padding: '0.625rem 0.875rem',
            borderRadius: 'var(--radius)',
            marginBottom: '1rem',
            fontSize: 'var(--fs-sm)',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            backgroundColor: saveMsg.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
            color: saveMsg.ok ? 'var(--success)' : 'var(--danger)',
            border: `var(--hairline) solid ${saveMsg.ok ? 'var(--success-border)' : 'var(--danger-border)'}`,
          }}
        >
          {saveMsg.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
          {saveMsg.text}
        </div>
      )}

      {/* 모델 선택 — AI 채팅과 같은 부품(§2-5) */}
      <ModelSelectField provider="openai" hasKey={hasKey} savedModel={savedModel} onSave={saveOpenAiModel} />

      <IntegrationTest
        onRun={handleHealth}
        pending={healthPending}
        result={healthMsg}
        desc="OpenAI API에 연결 가능한지 확인합니다"
      />
    </div>
  )
}
