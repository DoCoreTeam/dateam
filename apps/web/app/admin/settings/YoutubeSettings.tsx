'use client'

// YouTube Data API 키 설정 — Gemini 키와 같은 저장소(org_content META), 같은 패턴.
//
// 왜 필요한가: 키가 없으면 채널 수집이 RSS로 묶여 최근 15개까지만 본다.
// 543개 올린 채널을 15개로 판단하게 된다. 이 키가 곧 분석 범위다.

import { useState, useTransition } from 'react'
import { Key, CheckCircle, XCircle, Trash2 } from 'lucide-react'
import { saveYoutubeKey, deleteYoutubeKey } from './actions'

interface Props {
  hasKey: boolean
  maskedKey: string | null
}

export default function YoutubeSettings({ hasKey: initialHasKey, maskedKey: initialMasked }: Props) {
  const [hasKey, setHasKey] = useState(initialHasKey)
  const [maskedKey, setMaskedKey] = useState(initialMasked)
  const [showInput, setShowInput] = useState(!initialHasKey)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savePending, startSave] = useTransition()
  const [deletePending, startDelete] = useTransition()

  function handleSave(formData: FormData) {
    setMsg(null)
    startSave(async () => {
      const result = await saveYoutubeKey(formData)
      if (result.ok) {
        const k = (formData.get('apiKey') as string).trim()
        setMsg({ ok: true, text: 'API 키가 저장되었습니다. 이제 채널 전체를 수집합니다' })
        setHasKey(true)
        setShowInput(false)
        setMaskedKey(`${k.slice(0, 7)}••••••••${k.slice(-4)}`)
      } else {
        setMsg({ ok: false, text: result.error ?? '저장 실패' })
      }
    })
  }

  function handleDelete() {
    setMsg(null)
    startDelete(async () => {
      const result = await deleteYoutubeKey()
      if (result.ok) {
        setMsg({ ok: true, text: '삭제했습니다. 채널 수집이 최근 15개(RSS)로 제한됩니다' })
        setHasKey(false)
        setMaskedKey(null)
        setShowInput(true)
      } else {
        setMsg({ ok: false, text: result.error ?? '삭제 실패' })
      }
    })
  }

  return (
    <section className="card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
      <h2 style={{
        fontSize: 'var(--fs-lg)', fontWeight: 700, letterSpacing: '-0.02em',
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)',
      }}>
        <Key size={18} /> YouTube Data API 키
      </h2>
      <p className="ci-basis" style={{ marginBottom: 'var(--space-4)' }}>
        콘텐츠 인텔리전스의 채널 수집 범위를 결정합니다.
        키가 없으면 최근 15개(RSS)까지만 볼 수 있고, 키가 있으면 설정한 기간의 업로드를 전부 가져옵니다.
      </p>

      <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        {hasKey
          ? <><CheckCircle size={16} color="var(--success)" /> 설정됨 <code>{maskedKey}</code></>
          : <><XCircle size={16} color="var(--danger)" /> 설정되지 않음 — 채널 수집이 최근 15개로 제한됩니다</>}
      </p>

      {showInput ? (
        <form action={handleSave} style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: '260px' }}>
            <label className="label" htmlFor="yt-api-key">API 키</label>
            <input className="input-field" id="yt-api-key" name="apiKey" type="password"
              placeholder="AIza..." autoComplete="off" disabled={savePending} />
          </div>
          <button type="submit" className="btn-primary" disabled={savePending}>
            {savePending ? '저장 중…' : '저장'}
          </button>
          {hasKey && (
            <button type="button" className="btn-ghost" onClick={() => setShowInput(false)}>취소</button>
          )}
        </form>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" className="btn-ghost" onClick={() => setShowInput(true)}>키 교체</button>
          <button type="button" className="btn-ghost" onClick={handleDelete} disabled={deletePending}>
            <Trash2 size={14} /> {deletePending ? '삭제 중…' : '삭제'}
          </button>
        </div>
      )}

      {msg && (
        <p className={`ci-status ${msg.ok ? 'ci-status-ok' : 'ci-status-danger'}`}
          style={{ marginTop: 'var(--space-3)', display: 'inline-flex' }} role="status">
          {msg.text}
        </p>
      )}
    </section>
  )
}
