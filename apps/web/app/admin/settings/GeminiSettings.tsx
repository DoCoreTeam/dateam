'use client'

import { useState, useTransition } from 'react'
import { Key, CheckCircle, XCircle, Trash2, RefreshCw } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { saveGeminiKey, deleteGeminiKey, checkGeminiHealth } from './actions'
import GeminiModelPicker from './GeminiModelPicker'

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
    <div className="card" style={{ padding: '1.5rem', maxWidth: '640px' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <Key size={16} color="var(--brand)" />
        <h2 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>Gemini API 키</h2>
      </div>

      {/* 현재 상태 */}
      {hasKey && maskedKey && (
        <div style={{ padding: '0.875rem 1rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius)', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle size={14} color="#16a34a" />
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#15803d' }}>API 키 설정됨</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setShowInput((v) => !v)}
                style={{ fontSize: '0.75rem', color: 'var(--brand)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem 0.5rem' }}
              >
                변경
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deletePending}
                style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              >
                {deletePending ? <AXDotLoader size={4} color="#dc2626" /> : <Trash2 size={12} />}
                삭제
              </button>
            </div>
          </div>
          <code style={{ fontSize: '0.8125rem', color: '#374151', marginTop: '0.375rem', display: 'block', fontFamily: 'monospace' }}>
            {maskedKey}
          </code>
        </div>
      )}

      {/* 키 입력 폼 */}
      {showInput && (
        <form action={handleSave} style={{ marginBottom: '1rem' }}>
          <label className="label">API 키 입력</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.375rem' }}>
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
              {savePending ? <AXDotLoader size={4} color="#fff" /> : null}
              저장
            </button>
          </div>
        </form>
      )}

      {/* 저장/삭제 피드백 */}
      {saveMsg && (
        <div
          role="status"
          style={{
            padding: '0.625rem 0.875rem',
            borderRadius: 'var(--radius)',
            marginBottom: '1rem',
            fontSize: '0.8125rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            backgroundColor: saveMsg.ok ? '#f0fdf4' : '#fef2f2',
            color: saveMsg.ok ? '#15803d' : '#b91c1c',
            border: `1px solid ${saveMsg.ok ? '#bbf7d0' : '#fecaca'}`,
          }}
        >
          {saveMsg.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
          {saveMsg.text}
        </div>
      )}

      {/* 헬스체크 */}
      <div style={{ borderTop: '2px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>연결 테스트</span>
          <button
            type="button"
            onClick={handleHealth}
            disabled={!hasKey || healthPending}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.5rem 0.875rem',
              backgroundColor: hasKey ? 'var(--brand)' : 'var(--color-border)',
              color: hasKey ? '#fff' : '#94a3b8',
              border: 'none',
              borderRadius: 'var(--radius)',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: hasKey ? 'pointer' : 'not-allowed',
            }}
          >
            {healthPending ? <AXDotLoader size={4} color="#fff" /> : <RefreshCw size={13} />}
            헬스체크
          </button>
        </div>

        {healthMsg && (
          <div
            role="status"
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius)',
              fontSize: '0.8125rem',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              backgroundColor: healthMsg.ok ? '#f0fdf4' : '#fef2f2',
              color: healthMsg.ok ? '#15803d' : '#b91c1c',
              border: `1px solid ${healthMsg.ok ? '#bbf7d0' : '#fecaca'}`,
            }}
          >
            {healthMsg.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
            {healthMsg.text}
          </div>
        )}

        {!healthMsg && (
          <p style={{ fontSize: '0.8125rem', color: '#94a3b8', margin: 0 }}>
            {hasKey ? 'Gemini API에 연결 가능한지 확인합니다' : 'API 키를 먼저 저장해주세요'}
          </p>
        )}
      </div>

      {/* 모델 선택 */}
      <GeminiModelPicker hasKey={hasKey} savedModel={savedModel} />
    </div>
  )
}
