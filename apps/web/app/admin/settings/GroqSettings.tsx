'use client'

// Groq API 키와 모델 — **AI 모델 탭에 있다.**
//
// ## 왜 옮겼나
//
// Groq 키는 「음성 인식」 카드(외부 연동)에만 있었다. 녹음 전사용으로 넣은 키인데
// **AI 채팅과 RFP 분석도 같은 키를 쓴다.** 그런데 모델을 고를 자리가 없어서
// 기본값에 묶여 있었고, 그 기본값이 폐기되자 **분석이 404 로만 죽었다**
// (실측 2026-09-09: `llama-3.3-70b-versatile does not exist`, 9번 호출 전부 실패).
//
// 키는 여전히 한 벌이다(META `stt_api_key`). 여기서 바꾸면 전사도 같이 바뀐다 —
// 그 사실을 카드가 말한다.

import { useState, useTransition } from 'react'
import { Key, CheckCircle, XCircle } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import NbButton from '@/components/ui/nb/NbButton'
import { saveGroqKey, saveGroqModel, getGroqModels, deleteGroqKey } from './actions'
import ModelSelectField from './ModelSelectField'
import { IntegrationStatus, IntegrationTest } from './integration-ui'
import SettingsCard from '@/components/ui/settings/SettingsCard'

interface GroqSettingsProps {
  hasKey: boolean
  maskedKey: string | null
  savedModel: string | null
}

export default function GroqSettings({ hasKey: initialHasKey, maskedKey: initialMasked, savedModel }: GroqSettingsProps) {
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
      const result = await deleteGroqKey()
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
      const r = await getGroqModels()
      setHealthMsg(r.ok
        ? { ok: true, text: `연결 성공: ${r.models?.length ?? 0}개 모델 사용 가능` }
        : { ok: false, text: r.error ?? '연결 실패' })
    })
  }

  function handleSave(formData: FormData) {
    setSaveMsg(null)
    startSave(async () => {
      const result = await saveGroqKey(formData)
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
    <SettingsCard title="Groq API 키" headingLevel={2} icon={<Key size={16} />}>

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
              placeholder="gsk_..."
              style={{ flex: 1, fontFamily: 'monospace' }}
              autoComplete="off"
            />
            <NbButton type="submit" disabled={savePending || !inputKey.trim()}>
              {savePending ? <AXDotLoader size={4} color="var(--brand-fg)" /> : null}
              저장
            </NbButton>
          </div>
        </form>
      )}

      {saveMsg && (
        <p
          role="status"
          className={`status-pill ${saveMsg.ok ? 'status-pill-ok' : 'status-pill-danger'}`}
          style={{ marginBottom: '1rem', display: 'inline-flex' }}
        >
          {saveMsg.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
          {saveMsg.text}
        </p>
      )}

      {/* 모델 선택 — AI 채팅과 같은 부품(§2-5) */}
      <ModelSelectField provider="groq" hasKey={hasKey} savedModel={savedModel} onSave={saveGroqModel} />

      <IntegrationTest
        onRun={handleHealth}
        pending={healthPending}
        result={healthMsg}
        desc="Groq API에 연결 가능한지 확인합니다"
      />
    </SettingsCard>
  )
}
