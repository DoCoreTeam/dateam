'use client'

// 나라장터(공공데이터포털) 서비스 키 — YouTube 키와 같은 저장소(org_content META), 같은 패턴.
//
// 왜 필요한가: 이 키가 없으면 RFP 레이더가 나라장터 공고를 **한 건도** 못 가져온다.
// 기관 자체 사이트는 키 없이 돌지만, 나라장터는 전부 이 키를 지난다.

import { useState, useTransition } from 'react'
import { Key } from 'lucide-react'
import { saveG2bKey, deleteG2bKey, checkG2bHealth } from './actions'
import { IntegrationStatus, IntegrationTest } from './integration-ui'
import SettingsCard from '@/components/ui/settings/SettingsCard'

interface Props {
  hasKey: boolean
  maskedKey: string | null
}

export default function G2bSettings({ hasKey: initialHasKey, maskedKey: initialMasked }: Props) {
  const [hasKey, setHasKey] = useState(initialHasKey)
  const [maskedKey, setMaskedKey] = useState(initialMasked)
  const [showInput, setShowInput] = useState(!initialHasKey)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savePending, startSave] = useTransition()
  const [deletePending, startDelete] = useTransition()
  const [healthPending, startHealth] = useTransition()
  const [healthMsg, setHealthMsg] = useState<{ ok: boolean; text: string } | null>(null)

  function handleSave(formData: FormData) {
    setMsg(null)
    startSave(async () => {
      const result = await saveG2bKey(formData)
      if (result.ok) {
        const k = (formData.get('apiKey') as string).trim()
        setMsg({ ok: true, text: '서비스 키가 저장되었습니다. 이제 레이더가 나라장터 공고를 가져옵니다' })
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
      const result = await deleteG2bKey()
      if (result.ok) {
        setMsg({ ok: true, text: '삭제했습니다. 나라장터 공고는 더 이상 안 들어옵니다' })
        setHasKey(false)
        setMaskedKey(null)
        setShowInput(true)
      } else {
        setMsg({ ok: false, text: result.error ?? '삭제 실패' })
      }
    })
  }

  function handleHealth() {
    setHealthMsg(null)
    startHealth(async () => {
      const r = await checkG2bHealth()
      setHealthMsg({ ok: r.ok, text: r.message })
    })
  }

  return (
    <SettingsCard title="나라장터 서비스 키" headingLevel={2} icon={<Key size={18} />}>
      <p className="field-note" style={{ marginBottom: 'var(--space-4)' }}>
        RFP 공고 레이더가 나라장터에서 입찰 공고를 가져올 때 씁니다.
        공공데이터포털(data.go.kr)에서 「입찰공고정보서비스」를 신청하면 받습니다.
      </p>

      {!showInput && (
        <IntegrationStatus
          value={hasKey ? maskedKey : null}
          emptyHint="나라장터 공고를 못 가져옵니다"
          onChange={() => setShowInput(true)}
          onDisconnect={handleDelete}
          disconnectPending={deletePending}
        />
      )}

      {showInput ? (
        <form action={handleSave} style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: '260px' }}>
            <label className="label" htmlFor="g2b-service-key">서비스 키</label>
            <input className="input-field" id="g2b-service-key" name="apiKey" type="password"
              placeholder="Decoding 키를 그대로 붙여 넣습니다" autoComplete="off" disabled={savePending} />
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
        <p className={`status-pill ${msg.ok ? 'status-pill-ok' : 'status-pill-danger'}`}
          style={{ marginTop: 'var(--space-3)', display: 'inline-flex' }} role="status">
          {msg.text}
        </p>
      )}
      <IntegrationTest
        onRun={handleHealth}
        pending={healthPending}
        result={healthMsg}
        desc="나라장터 연결과 조회 권한을 확인합니다"
      />
    </SettingsCard>
  )
}
