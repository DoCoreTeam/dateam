'use client'

// 음성 인식(STT) 키 — 회의 녹음을 글로 옮기는 데 쓴다.
//
// 왜 여기인가: CRM 은 자기 키를 갖지 않는다는 기존 원칙과 같은 자리다.
// 사내 회의노트와 영업 미팅이 **같은 키 하나**를 쓴다.
//
// 왜 오픈소스 모델인가: whisper-large-v3 는 MIT 라이선스이고 한국어를 포함한 99개 언어를 지원한다.
// 실행만 서버리스에 맡긴다 — 우리가 GPU 를 사거나 운영하지 않는다.
//
// 키가 없으면 녹음은 되지만 전사가 영원히 안 돈다. 그 사실을 화면이 먼저 말한다.

import { useState, useTransition } from 'react'
import { AudioLines } from 'lucide-react'
import { saveSttKey, deleteSttKey, checkSttHealth } from './actions'
import { IntegrationStatus, IntegrationTest } from './integration-ui'

interface Props {
  hasKey: boolean
  maskedKey: string | null
  savedModel: string | null
}

export default function SttSettings({ hasKey: initialHasKey, maskedKey: initialMasked, savedModel }: Props) {
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
      const result = await saveSttKey(formData)
      if (result.ok) {
        const k = (formData.get('apiKey') as string).trim()
        setMsg({ ok: true, text: '저장했습니다. 이제 회의 녹음이 끝나면 자동으로 전사됩니다' })
        setHasKey(true)
        setShowInput(false)
        setMaskedKey(`${k.slice(0, 5)}••••••••${k.slice(-4)}`)
      } else {
        setMsg({ ok: false, text: result.error ?? '저장 실패' })
      }
    })
  }

  function handleDelete() {
    setMsg(null)
    startDelete(async () => {
      const result = await deleteSttKey()
      if (result.ok) {
        // 무엇이 멈추는지 말한다 — 영향을 안 밝히면 사용자는 녹음까지 멈춘 줄 안다
        setMsg({ ok: true, text: '연결을 해제했습니다. 녹음은 그대로 되지만 전사가 멈춥니다' })
        setHasKey(false)
        setMaskedKey(null)
        setShowInput(true)
      } else {
        setMsg({ ok: false, text: result.error ?? '연결 해제 실패' })
      }
    })
  }

  function handleHealth() {
    setHealthMsg(null)
    startHealth(async () => {
      const r = await checkSttHealth()
      setHealthMsg({ ok: r.ok, text: r.message })
    })
  }

  return (
    <section className="card" style={{ padding: 'var(--space-6)' }}>
      <h2 className="tape-title" style={{ margin: '0 0 var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <AudioLines size={18} /> 음성 인식 (회의 전사)
      </h2>
      <p className="ci-basis" style={{ marginBottom: 'var(--space-4)' }}>
        회의 녹음을 글로 옮깁니다. 오픈소스 모델(whisper-large-v3)을 씁니다.
        키가 없으면 녹음은 되지만 전사가 돌지 않아 요약·할 일 뽑기까지 멈춥니다.
      </p>

      {!showInput && (
        <IntegrationStatus
          value={hasKey ? maskedKey : null}
          emptyHint="회의 녹음이 글로 옮겨지지 않습니다"
          onChange={() => setShowInput(true)}
          onDisconnect={handleDelete}
          disconnectPending={deletePending}
        />
      )}

      {showInput && (
        <form action={handleSave} style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: '240px' }}>
            <label className="label" htmlFor="stt-api-key">API 키</label>
            <input className="input-field" id="stt-api-key" name="apiKey" type="password"
              placeholder="gsk_..." autoComplete="off" disabled={savePending} />
          </div>
          <div style={{ flex: 1, minWidth: '240px' }}>
            <label className="label" htmlFor="stt-model">모델 (비우면 기본값)</label>
            <input className="input-field" id="stt-model" name="model" type="text"
              placeholder="whisper-large-v3" defaultValue={savedModel ?? ''}
              autoComplete="off" disabled={savePending} />
          </div>
          <button type="submit" className="btn-primary" disabled={savePending}>
            {savePending ? '저장 중…' : '저장'}
          </button>
          {hasKey && (
            <button type="button" className="btn-ghost" onClick={() => setShowInput(false)}>취소</button>
          )}
        </form>
      )}

      {/* 정확도를 이유로 turbo 를 기본으로 두지 않았다 — 그 선택을 화면에 밝힌다 */}
      {showInput && (
        <p className="ci-basis" style={{ marginTop: 'var(--space-2)' }}>
          기본 모델은 whisper-large-v3 입니다. 뒤에 -turbo 를 붙이면 훨씬 빠르지만 정확도가 조금 떨어집니다.
        </p>
      )}

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
        desc="저장한 키로 음성 인식 서비스에 실제로 연결되는지 확인합니다"
      />
    </section>
  )
}
