'use client'

import { useState, useTransition } from 'react'
import { Key, CheckCircle, XCircle, Trash2, RefreshCw } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { saveKoraeximKey, deleteKoraeximKey, checkKoraeximHealth } from './actions'

interface KoraeximSettingsProps {
  hasKey: boolean
  maskedKey: string | null
}

export default function KoraeximSettings({ hasKey: initialHasKey, maskedKey: initialMasked }: KoraeximSettingsProps) {
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
      const result = await saveKoraeximKey(formData)
      if (result.ok) {
        setSaveMsg({ ok: true, text: 'API 키가 저장되었습니다' })
        setHasKey(true)
        setInputKey('')
        setShowInput(false)
        const k = (formData.get('apiKey') as string).trim()
        setMaskedKey(k.slice(0, 4) + '••••••••' + k.slice(-4))
      } else {
        setSaveMsg({ ok: false, text: result.error ?? '저장 실패' })
      }
    })
  }

  function handleDelete() {
    setSaveMsg(null)
    setHealthMsg(null)
    startDelete(async () => {
      const result = await deleteKoraeximKey()
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
      const result = await checkKoraeximHealth()
      setHealthMsg({ ok: result.ok, text: result.message })
    })
  }

  return (
    <div className="card" style={{ padding: '1.5rem', maxWidth: '640px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <Key size={16} color="var(--brand)" />
        <h2 className="tape-title" style={{ margin: 0 }}>한국수출입은행 API 키</h2>
      </div>

      <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1rem', margin: '0 0 1rem 0' }}>
        GPU 환율 자동 갱신에 사용됩니다.{' '}
        <a href="https://www.koreaexim.go.kr/site/program/financial/exchangeJSON" target="_blank" rel="noreferrer" style={{ color: 'var(--brand)', textDecoration: 'underline' }}>
          키 발급 안내
        </a>
      </p>

      {hasKey && maskedKey && (
        <div style={{ padding: '0.875rem 1rem', backgroundColor: 'var(--success-bg)', border: 'var(--hairline) solid var(--success-border)', borderRadius: 'var(--radius)', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle size={14} color="var(--success)" />
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--success)' }}>API 키 설정됨</span>
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
                style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              >
                {deletePending ? <AXDotLoader size={4} color="var(--danger)" /> : <Trash2 size={12} />}
                삭제
              </button>
            </div>
          </div>
          <code style={{ fontSize: '0.8125rem', color: 'var(--text)', marginTop: '0.375rem', display: 'block', fontFamily: 'monospace' }}>
            {maskedKey}
          </code>
        </div>
      )}

      {showInput && (
        <form action={handleSave} style={{ marginBottom: '1rem' }}>
          <label className="label">API 키 입력</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.375rem' }}>
            <input
              name="apiKey"
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="인증키를 입력하세요"
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
            backgroundColor: saveMsg.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
            color: saveMsg.ok ? 'var(--success)' : 'var(--danger)',
            border: `var(--hairline) solid ${saveMsg.ok ? 'var(--success-border)' : 'var(--danger-border)'}`,
          }}
        >
          {saveMsg.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
          {saveMsg.text}
        </div>
      )}

      <div style={{ borderTop: 'var(--border-w-2) solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)' }}>연결 테스트</span>
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
              color: hasKey ? '#fff' : 'var(--text-faint)',
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
              backgroundColor: healthMsg.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
              color: healthMsg.ok ? 'var(--success)' : 'var(--danger)',
              border: `var(--hairline) solid ${healthMsg.ok ? 'var(--success-border)' : 'var(--danger-border)'}`,
            }}
          >
            {healthMsg.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
            {healthMsg.text}
          </div>
        )}

        {!healthMsg && (
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-faint)', margin: 0 }}>
            {hasKey ? '한국수출입은행 API 연결을 확인합니다' : 'API 키를 먼저 저장해주세요'}
          </p>
        )}
      </div>
    </div>
  )
}
