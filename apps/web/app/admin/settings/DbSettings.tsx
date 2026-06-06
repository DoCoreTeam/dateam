'use client'

import { useState, useTransition } from 'react'
import { Database, CheckCircle, XCircle, Trash2, RefreshCw } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { saveDbUrl, deleteDbUrl, checkDbHealth } from './actions'

interface DbSettingsProps {
  hasUrl: boolean
  maskedUrl: string | null
}

export default function DbSettings({ hasUrl: initialHas, maskedUrl: initialMasked }: DbSettingsProps) {
  const [hasUrl, setHasUrl] = useState(initialHas)
  const [maskedUrl, setMaskedUrl] = useState(initialMasked)
  const [inputUrl, setInputUrl] = useState('')
  const [showInput, setShowInput] = useState(!initialHas)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [healthMsg, setHealthMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savePending, startSave] = useTransition()
  const [deletePending, startDelete] = useTransition()
  const [healthPending, startHealth] = useTransition()

  function mask(url: string): string {
    return url.replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/i, (_m, a, _pw, c) => `${a}••••••••${c}`)
  }

  function handleSave(formData: FormData) {
    setSaveMsg(null)
    startSave(async () => {
      const result = await saveDbUrl(formData)
      if (result.ok) {
        setSaveMsg({ ok: true, text: 'DB 연결 문자열이 저장되었습니다' })
        setHasUrl(true)
        setMaskedUrl(mask((formData.get('dbUrl') as string).trim()))
        setInputUrl('')
        setShowInput(false)
      } else {
        setSaveMsg({ ok: false, text: result.error ?? '저장 실패' })
      }
    })
  }

  function handleDelete() {
    setSaveMsg(null); setHealthMsg(null)
    startDelete(async () => {
      const result = await deleteDbUrl()
      if (result.ok) {
        setHasUrl(false); setMaskedUrl(null); setShowInput(true)
        setSaveMsg({ ok: true, text: 'DB 연결 문자열이 삭제되었습니다' })
      } else {
        setSaveMsg({ ok: false, text: result.error ?? '삭제 실패' })
      }
    })
  }

  function handleHealth() {
    setHealthMsg(null)
    startHealth(async () => {
      const result = await checkDbHealth()
      setHealthMsg({ ok: result.ok, text: result.message })
    })
  }

  return (
    <div className="card" style={{ padding: '1.5rem', maxWidth: '640px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <Database size={16} color="var(--brand)" />
        <h2 className="tape-title" style={{ margin: 0 }}>DB 연결 (PostgreSQL)</h2>
      </div>

      {hasUrl && maskedUrl && (
        <div style={{ padding: '0.875rem 1rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius)', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle size={14} color="#16a34a" />
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#15803d' }}>연결 문자열 설정됨</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" onClick={() => setShowInput((v) => !v)} style={{ fontSize: '0.75rem', color: 'var(--brand)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem 0.5rem' }}>변경</button>
              <button type="button" onClick={handleDelete} disabled={deletePending} style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                {deletePending ? <AXDotLoader size={4} color="#dc2626" /> : <Trash2 size={12} />}삭제
              </button>
            </div>
          </div>
          <code style={{ fontSize: '0.75rem', color: '#374151', marginTop: '0.375rem', display: 'block', fontFamily: 'monospace', wordBreak: 'break-all' }}>{maskedUrl}</code>
        </div>
      )}

      {showInput && (
        <form action={handleSave} style={{ marginBottom: '1rem' }}>
          <label className="label">연결 문자열 입력</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.375rem' }}>
            <input name="dbUrl" type="password" value={inputUrl} onChange={(e) => setInputUrl(e.target.value)} placeholder="postgresql://user:password@host:5432/db" className="input-field" style={{ flex: 1, fontFamily: 'monospace' }} autoComplete="off" />
            <button type="submit" disabled={savePending || !inputUrl.trim()} className="btn-primary" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              {savePending ? <AXDotLoader size={4} color="#fff" /> : null}저장
            </button>
          </div>
        </form>
      )}

      {saveMsg && (
        <div role="status" style={{ padding: '0.625rem 0.875rem', borderRadius: 'var(--radius)', marginBottom: '1rem', fontSize: '0.8125rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.375rem', backgroundColor: saveMsg.ok ? '#f0fdf4' : '#fef2f2', color: saveMsg.ok ? '#15803d' : '#b91c1c', border: `1px solid ${saveMsg.ok ? '#bbf7d0' : '#fecaca'}` }}>
          {saveMsg.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}{saveMsg.text}
        </div>
      )}

      <div style={{ borderTop: '2px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>연결 테스트</span>
          <button type="button" onClick={handleHealth} disabled={!hasUrl || healthPending} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.5rem 0.875rem', backgroundColor: hasUrl ? 'var(--brand)' : 'var(--color-border)', color: hasUrl ? '#fff' : '#94a3b8', border: 'none', borderRadius: 'var(--radius)', fontSize: '0.8125rem', fontWeight: 600, cursor: hasUrl ? 'pointer' : 'not-allowed' }}>
            {healthPending ? <AXDotLoader size={4} color="#fff" /> : <RefreshCw size={13} />}헬스체크
          </button>
        </div>
        {healthMsg && (
          <div role="status" style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius)', fontSize: '0.8125rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: healthMsg.ok ? '#f0fdf4' : '#fef2f2', color: healthMsg.ok ? '#15803d' : '#b91c1c', border: `1px solid ${healthMsg.ok ? '#bbf7d0' : '#fecaca'}` }}>
            {healthMsg.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}{healthMsg.text}
          </div>
        )}
        {!healthMsg && (
          <p style={{ fontSize: '0.8125rem', color: '#94a3b8', margin: 0 }}>{hasUrl ? '저장된 연결 문자열로 실제 접속을 테스트합니다 (SELECT version)' : 'DB 연결 문자열을 먼저 저장해주세요'}</p>
        )}
      </div>
    </div>
  )
}
