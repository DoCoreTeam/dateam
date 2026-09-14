'use client'

import { useState, useTransition } from 'react'
import { Key, CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { saveGeminiKey, deleteGeminiKey, checkGeminiHealth, saveGeminiModel } from './actions'
import ModelSelectField from './ModelSelectField'
import { IntegrationStatus, IntegrationTest } from './integration-ui'
import StatusPill from '@/components/ui/settings/StatusPill'
import SettingsCard from '@/components/ui/settings/SettingsCard'

interface GeminiSettingsProps {
  hasKey: boolean
  maskedKey: string | null
  savedModel: string | null
}

export default function GeminiSettings({ hasKey: initialHasKey, maskedKey: initialMasked, savedModel }: GeminiSettingsProps) {
  const [hasKey, setHasKey] = useState(initialHasKey)
  const [maskedKey, setMaskedKey] = useState(initialMasked)
  const [inputKey, setInputKey] = useState('')
  const [showInput, setShowInput] = useState(!initialHasKey)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [healthMsg, setHealthMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savePending, startSave] = useTransition()
  const [deletePending, startDelete] = useTransition()
  const [healthPending, startHealth] = useTransition()

  function handleSave(formData: FormData) {
    setSaveMsg(null)
    startSave(async () => {
      const result = await saveGeminiKey(formData)
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

  function handleDelete() {
    setSaveMsg(null)
    setHealthMsg(null)
    startDelete(async () => {
      const result = await deleteGeminiKey()
      if (result.ok) {
        setHasKey(false)
        setMaskedKey(null)
        setShowInput(true)
        setSaveMsg({ ok: true, text: 'API 키가 삭제되었습니다' })
      } else {
        setSaveMsg({ ok: false, text: result.error ?? '삭제 실패' })
      }
    })
  }

  function handleHealth() {
    setHealthMsg(null)
    startHealth(async () => {
      const result = await checkGeminiHealth()
      setHealthMsg({ ok: result.ok, text: result.message })
    })
  }

  return (
    <SettingsCard title="Gemini API 키" headingLevel={2} icon={<Key size={16} />}>

      {/* 현재 상태 */}
      {hasKey && maskedKey && (
        <IntegrationStatus
          value={maskedKey}
          onChange={() => setShowInput((v) => !v)}
          onDisconnect={handleDelete}
          disconnectPending={deletePending}
        />
      )}

      {/* 키 입력 폼 */}
      {showInput && (
        <form action={handleSave} style={{ marginBottom: '1rem' }}>
          <label className="label">API 키 입력</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '0.375rem' }}>
            <input
              name="apiKey"
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="AIza..."
              className="input-field"
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

      {/* 저장/삭제 피드백 */}
      {saveMsg && (
        <p role="status" style={{ marginBottom: 'var(--space-3)' }}>
          <StatusPill tone={saveMsg.ok ? 'ok' : 'danger'}>
            {saveMsg.ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {saveMsg.text}
          </StatusPill>
        </p>
      )}

      {/* 모델 선택 — 앱 전역 AI 기능이 쓰는 메인 모델 */}
      <ModelSelectField provider="gemini" hasKey={hasKey} savedModel={savedModel} onSave={saveGeminiModel} />

      <IntegrationTest
        onRun={handleHealth}
        pending={healthPending}
        result={healthMsg}
        desc="Gemini API에 연결 가능한지 확인합니다"
      />
    </SettingsCard>
  )
}
