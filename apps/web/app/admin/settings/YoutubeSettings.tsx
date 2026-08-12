'use client'

// YouTube Data API 키 설정 — Gemini 키와 같은 저장소(org_content META), 같은 패턴.
//
// 왜 필요한가: 키가 없으면 채널 수집이 RSS로 묶여 최근 15개까지만 본다.
// 543개 올린 채널을 15개로 판단하게 된다. 이 키가 곧 분석 범위다.

import { useState, useTransition } from 'react'
import { Key } from 'lucide-react'
import { saveYoutubeKey, deleteYoutubeKey, checkYoutubeHealth } from './actions'
import { IntegrationStatus, IntegrationTest } from './integration-ui'

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

  const [healthPending, startHealth] = useTransition()
  const [healthMsg, setHealthMsg] = useState<{ ok: boolean; text: string } | null>(null)

  function handleHealth() {
    setHealthMsg(null)
    startHealth(async () => {
      const r = await checkYoutubeHealth()
      setHealthMsg({ ok: r.ok, text: r.message })
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
    <section className="card" style={{ padding: 'var(--space-6)' }}>
      <h2 className="tape-title" style={{ margin: '0 0 var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <Key size={18} /> YouTube Data API 키
      </h2>
      <p className="ci-basis" style={{ marginBottom: 'var(--space-4)' }}>
        콘텐츠 인텔리전스의 채널 수집 범위를 결정합니다.
        키가 없으면 최근 15개(RSS)까지만 볼 수 있고, 키가 있으면 설정한 기간의 업로드를 전부 가져옵니다.
      </p>

      {!showInput && (
        <IntegrationStatus
          value={hasKey ? maskedKey : null}
          emptyHint="채널 수집이 최근 15개로 제한됩니다"
          onChange={() => setShowInput(true)}
          onDisconnect={handleDelete}
          disconnectPending={deletePending}
        />
      )}

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
      ) : null}

      {msg && (
        <p className={`ci-status ${msg.ok ? 'ci-status-ok' : 'ci-status-danger'}`}
          style={{ marginTop: 'var(--space-3)', display: 'inline-flex' }} role="status">
          {msg.text}
        </p>
      )}
      <IntegrationTest
        onRun={handleHealth}
        pending={healthPending}
        result={healthMsg}
        desc="YouTube Data API 연결과 수집 범위를 확인합니다"
      />
    </section>
  )
}
