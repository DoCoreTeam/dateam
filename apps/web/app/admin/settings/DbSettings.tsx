'use client'

import { useState, useTransition } from 'react'
import { Database, CheckCircle, XCircle, Trash2, RefreshCw } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { saveDbUrl, deleteDbUrl, checkDbHealth } from './actions'
import { IntegrationTest } from './integration-ui'
import StatusPill from '@/components/ui/settings/StatusPill'
import SettingsCard from '@/components/ui/settings/SettingsCard'

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
    <SettingsCard title="DB 연결 (PostgreSQL)" headingLevel={2} icon={<Database size={16} />}>

      {hasUrl && maskedUrl && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <StatusPill tone="ok">
              <CheckCircle size={12} />
              연결 문자열 설정됨
            </StatusPill>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button type="button" onClick={() => setShowInput((v) => !v)} style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 'var(--space-1) var(--space-2)' }}>변경</button>
              <button type="button" onClick={handleDelete} disabled={deletePending} style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 'var(--space-1) var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                {deletePending ? <AXDotLoader size={4} color="var(--danger)" /> : <Trash2 size={12} />}삭제
              </button>
            </div>
          </div>
          <code style={{ fontSize: 'var(--fs-xs)', color: 'var(--text)', marginTop: '0.375rem', display: 'block', fontFamily: 'monospace', wordBreak: 'break-all' }}>{maskedUrl}</code>
        </div>
      )}

      {showInput && (
        <form action={handleSave} style={{ marginBottom: '1rem' }}>
          <label className="label">연결 문자열 입력</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '0.375rem' }}>
            <input name="dbUrl" type="password" value={inputUrl} onChange={(e) => setInputUrl(e.target.value)} placeholder="postgresql://user:password@host:5432/db" className="input-field" style={{ flex: 1, fontFamily: 'monospace' }} autoComplete="off" />
            <button type="submit" disabled={savePending || !inputUrl.trim()} className="btn-primary" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              {savePending ? <AXDotLoader size={4} color="var(--brand-fg)" /> : null}저장
            </button>
          </div>
        </form>
      )}

      {saveMsg && (
        <p role="status" style={{ marginBottom: 'var(--space-3)' }}>
          <StatusPill tone={saveMsg.ok ? 'ok' : 'danger'}>
            {saveMsg.ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {saveMsg.text}
          </StatusPill>
        </p>
      )}

      <IntegrationTest
        onRun={handleHealth}
        pending={healthPending}
        result={healthMsg}
        desc="DB 연결을 확인합니다"
      />
    </SettingsCard>
  )
}
