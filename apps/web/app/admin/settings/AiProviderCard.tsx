'use client'

// AI 공급자 카드 한 벌
//
// 예전에는 공급자마다 카드 파일이 하나씩 있었다 — Gemini, Claude, OpenAI, Groq, 그리고
// 「음성 인식」이라는 이름으로 외부 연동 탭에 따로 앉은 Groq 하나 더. 다섯 파일이 같은 일을
// 조금씩 다르게 했고, 그래서 Gemini 칸에만 있던 접두사 검증이 Claude 칸에는 없었다.
//
// 이 파일 하나가 다섯을 다 그린다. 무엇을 그릴지는 명세(lib/ai/provider-catalog)가 정하고,
// 저장과 해제와 연결 확인은 창구 한 벌(lib/ai/provider-keys 를 부르는 서버액션)이 한다.
// 공급자를 하나 더하려면 명세에 한 줄을 더하면 되고 이 파일은 안 고친다.

import { useState, useTransition } from 'react'
import { Key, CheckCircle, XCircle, ExternalLink, ChevronUp, ChevronDown, Trash2, Power } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import NbButton from '@/components/ui/nb/NbButton'
import SettingsCard from '@/components/ui/settings/SettingsCard'
import StatusPill from '@/components/ui/settings/StatusPill'
import FieldNote from '@/components/ui/settings/FieldNote'
import ModelSelectField from './ModelSelectField'
import { IntegrationStatus, IntegrationTest } from './integration-ui'
import { getProviderSpec, type AiProviderId } from '@/lib/ai/provider-catalog'
import {
  saveProviderKey,
  deleteProviderKey,
  saveProviderModel,
  checkProviderConnection,
  saveTranscriptionModel,
  addProviderKeyRow,
  deleteProviderKeyRow,
  moveProviderKeyRow,
  toggleProviderKeyRow,
} from './actions'
import { ACTION } from '@/lib/terms'
import type { KeyView } from '@/lib/ai/key-store-core'

interface Props {
  provider: AiProviderId
  hasKey: boolean
  maskedKey: string | null
  savedModel: string | null
  /** 회의 녹음을 글로 옮기는 모델. 그 일에도 쓰이는 공급자에게만 온다 */
  transcriptionModel?: string | null
  /**
   * 이 공급자에 등록된 키 줄. 꺼진 줄과 인증이 깨진 줄도 온다.
   *
   * **보는 목록은 고르는 목록과 다르다** — 못 쓰는 줄을 빼면 관리자는
   * 「내가 넣은 키가 사라졌다」고 읽는다. 왜 못 쓰는지가 이 화면의 용건이다.
   */
  keyRows?: KeyView[]
}

export default function AiProviderCard({
  provider, hasKey: initialHasKey, maskedKey: initialMasked, savedModel, transcriptionModel,
  keyRows: initialRows = [],
}: Props) {
  const spec = getProviderSpec(provider)

  const [hasKey, setHasKey] = useState(initialHasKey)
  const [maskedKey, setMaskedKey] = useState(initialMasked)
  const [inputKey, setInputKey] = useState('')
  const [showInput, setShowInput] = useState(!initialHasKey)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savePending, startSave] = useTransition()
  const [disconnectPending, startDisconnect] = useTransition()
  const [healthPending, startHealth] = useTransition()
  const [healthMsg, setHealthMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [rows, setRows] = useState<KeyView[]>(initialRows)
  const [newLabel, setNewLabel] = useState('')
  const [rowPending, startRow] = useTransition()

  /** 줄을 고치는 네 가지가 같은 모양이다 — 결과가 오면 목록을 통째로 갈아 끼운다 */
  function runRowAction(act: () => Promise<{ ok: boolean; error?: string; message?: string; keys?: KeyView[] }>) {
    setMsg(null)
    startRow(async () => {
      const r = await act()
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? '바꾸지 못했습니다' }); return }
      if (r.keys) {
        setRows(r.keys)
        setHasKey(r.keys.length > 0)
      }
      if (r.message) setMsg({ ok: true, text: r.message })
    })
  }

  function handleAddRow(formData: FormData) {
    setMsg(null)
    startRow(async () => {
      const r = await addProviderKeyRow(provider, formData)
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? '저장 실패' }); return }
      setRows(r.keys ?? [])
      setHasKey((r.keys ?? []).length > 0)
      setInputKey('')
      setNewLabel('')
    })
  }

  function handleSave(formData: FormData) {
    setMsg(null)
    startSave(async () => {
      const r = await saveProviderKey(provider, formData)
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? '저장 실패' }); return }
      setHasKey(true)
      setInputKey('')
      setShowInput(false)
      // 서버가 가림값을 돌려준다 — 원문 키를 화면 상태로 들고 있지 않는다
      setMaskedKey(r.masked ?? null)
      setMsg({ ok: true, text: r.message ?? 'API 키가 저장되었습니다' })
    })
  }

  function handleDisconnect() {
    setMsg(null)
    startDisconnect(async () => {
      const r = await deleteProviderKey(provider)
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? '연결 해제 실패' }); return }
      setHasKey(false)
      setMaskedKey(null)
      setShowInput(true)
      // 이 키가 또 하던 일이 있으면 무엇이 함께 멈추는지 그 자리에서 말한다
      if (r.message) setMsg({ ok: true, text: r.message })
    })
  }

  function handleHealth() {
    setHealthMsg(null)
    startHealth(async () => {
      const r = await checkProviderConnection(provider)
      setHealthMsg({ ok: r.ok, text: r.message })
    })
  }

  return (
    <SettingsCard
      title={`${spec.label} API 키`}
      headingLevel={2}
      icon={<Key size={16} />}
      description={spec.purpose}
    >
      {/* 이 키가 채팅 말고 또 무엇을 하는지. 해제하기 전에 알아야 하는 사실이다 */}
      {spec.alsoUsedFor && (
        <StatusPill tone="info" title="해제하면 그 기능도 함께 멈춥니다">
          {spec.alsoUsedFor}
        </StatusPill>
      )}

      {/*
        표에 줄이 있으면 목록으로 그린다. 없으면 예전 그대로 — 표가 아직 안 만들어진
        조직에서 화면이 빈손이 되면 안 된다(그 조직은 META 칸 하나로 돌고 있다).
      */}
      {rows.length > 0 ? (
        <KeyRowList
          rows={rows}
          pending={rowPending}
          onMove={(id, dir) => runRowAction(() => moveProviderKeyRow(provider, id, dir))}
          onToggle={(id, active) => runRowAction(() => toggleProviderKeyRow(provider, id, active))}
          onDelete={(id) => runRowAction(() => deleteProviderKeyRow(provider, id))}
        />
      ) : hasKey && maskedKey ? (
        <IntegrationStatus
          value={maskedKey}
          onChange={() => setShowInput((v) => !v)}
          onDisconnect={handleDisconnect}
          disconnectPending={disconnectPending}
        />
      ) : null}

      {rows.length > 0 ? (
        <form action={handleAddRow}>
          <label className="label" htmlFor={`ai-key-label-${provider}`}>키 이름</label>
          <input
            className="input-field"
            id={`ai-key-label-${provider}`}
            name="label"
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="두 번째 계정"
            style={{ marginTop: '0.375rem' }}
            autoComplete="off"
          />
          <label className="label" htmlFor={`ai-key-${provider}`} style={{ marginTop: 'var(--space-2)' }}>
            API 키
          </label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '0.375rem' }}>
            <input
              className="input-field"
              id={`ai-key-${provider}`}
              name="apiKey"
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder={`${spec.keyPrefixes[0]}...`}
              style={{ flex: 1, fontFamily: 'monospace' }}
              autoComplete="off"
            />
            <NbButton type="submit" disabled={rowPending || !inputKey.trim() || !newLabel.trim()}>
              {rowPending ? <AXDotLoader size={4} color="var(--brand-fg)" /> : null}
              새 키
            </NbButton>
          </div>
          <FieldNote>
            앞에 있는 키부터 씁니다. 한도에 걸리면 다음 키로 이어서 부릅니다{' '}
            <a href={spec.keyIssueUrl} target="_blank" rel="noreferrer">
              {spec.label} 키 발급 <ExternalLink size={11} />
            </a>
          </FieldNote>
        </form>
      ) : showInput ? (
        <form action={handleSave}>
          <label className="label" htmlFor={`ai-key-${provider}`}>API 키 입력</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '0.375rem' }}>
            <input
              className="input-field"
              id={`ai-key-${provider}`}
              name="apiKey"
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder={`${spec.keyPrefixes[0]}...`}
              style={{ flex: 1, fontFamily: 'monospace' }}
              autoComplete="off"
            />
            <NbButton type="submit" disabled={savePending || !inputKey.trim()}>
              {savePending ? <AXDotLoader size={4} color="var(--brand-fg)" /> : null}
              {ACTION.save}
            </NbButton>
          </div>
          {/* 어디서 받는지를 화면 밖에서 찾게 하지 않는다 */}
          <FieldNote>
            <a href={spec.keyIssueUrl} target="_blank" rel="noreferrer">
              {spec.label} 키 발급 <ExternalLink size={11} />
            </a>
          </FieldNote>
        </form>
      ) : null}

      {msg && (
        <p role="status">
          <StatusPill tone={msg.ok ? 'ok' : 'danger'}>
            {msg.ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {msg.text}
          </StatusPill>
        </p>
      )}

      <ModelSelectField
        provider={provider}
        hasKey={hasKey}
        savedModel={savedModel}
        onSave={(model) => saveProviderModel(provider, model)}
      />

      {/* 전사 모델은 채팅 모델과 다른 값이다. 키가 하나라서 자리만 같이 둔다 */}
      {transcriptionModel !== undefined && (
        <TranscriptionModelField hasKey={hasKey} saved={transcriptionModel} />
      )}

      <IntegrationTest
        onRun={handleHealth}
        pending={healthPending}
        result={healthMsg}
        desc={`${spec.label} API 에 연결 가능한지 확인합니다`}
      />
    </SettingsCard>
  )
}

/** 상태마다 칩 색. 무엇이라고 부를지는 규칙 모듈이 정하고 화면은 색만 고른다 */
const STATUS_TONE: Record<KeyView['status'], 'ok' | 'warn' | 'danger' | 'info'> = {
  usable: 'ok',
  cooling: 'warn',
  auth_broken: 'danger',
  off: 'info',
}

/**
 * 등록된 키 줄.
 *
 * **왜 순서가 보이나**: 앞에 있는 키부터 소진한다. 고르게 나눠 쓰면 전부 같은 날 같이 마르고,
 * 그러면 마른 키와 남은 키가 눈에 안 보인다. 순서가 곧 정책이라 화면에 드러낸다.
 */
function KeyRowList({ rows, pending, onMove, onToggle, onDelete }: {
  rows: KeyView[]
  pending: boolean
  onMove: (id: string, direction: 'up' | 'down') => void
  onToggle: (id: string, active: boolean) => void
  onDelete: (id: string) => void
}) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
      {rows.map((row, i) => (
        <li
          key={row.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap',
            padding: 'var(--space-2) 0',
            borderBottom: 'var(--hairline) solid var(--border-light)',
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{row.label}</span>
          <code style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{row.maskedKey}</code>
          <StatusPill tone={STATUS_TONE[row.status]} title={row.lastError ?? undefined}>
            {row.statusText}
          </StatusPill>

          <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-1)' }}>
            <NbButton
              type="button" variant="ghost" disabled={pending || i === 0}
              onClick={() => onMove(row.id, 'up')} title="위로" aria-label={`${row.label} 위로`}
            >
              <ChevronUp size={14} />
            </NbButton>
            <NbButton
              type="button" variant="ghost" disabled={pending || i === rows.length - 1}
              onClick={() => onMove(row.id, 'down')} title="아래로" aria-label={`${row.label} 아래로`}
            >
              <ChevronDown size={14} />
            </NbButton>
            <NbButton
              type="button" variant="ghost" disabled={pending}
              onClick={() => onToggle(row.id, row.status === 'off' || row.status === 'auth_broken')}
              title={row.status === 'off' ? '켜기' : '끄기'}
              aria-label={`${row.label} ${row.status === 'off' ? '켜기' : '끄기'}`}
            >
              <Power size={14} />
            </NbButton>
            <NbButton
              type="button" variant="danger-ghost" disabled={pending}
              onClick={() => onDelete(row.id)} title={ACTION.delete} aria-label={`${row.label} ${ACTION.delete}`}
            >
              <Trash2 size={14} />
            </NbButton>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** 회의 녹음을 글로 옮길 때 쓰는 모델. 비우면 코드 기본값(정확도 우선)을 쓴다 */
function TranscriptionModelField({ hasKey, saved }: { hasKey: boolean; saved: string | null | undefined }) {
  const [value, setValue] = useState(saved ?? '')
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  return (
    <div>
      <label className="label" htmlFor="stt-model">회의 전사 모델</label>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '0.375rem' }}>
        <input
          className="input-field"
          id="stt-model"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="whisper-large-v3"
          disabled={!hasKey}
          style={{ flex: 1 }}
        />
        <NbButton
          type="button"
          disabled={!hasKey || pending}
          onClick={() => {
            setMsg(null)
            start(async () => {
              const r = await saveTranscriptionModel(value)
              setMsg(r.ok ? '저장했습니다' : (r.error ?? '저장 실패'))
            })
          }}
        >
          저장
        </NbButton>
      </div>
      <FieldNote>비워 두면 정확도가 가장 높은 기본 모델을 씁니다{msg ? ` · ${msg}` : ''}</FieldNote>
    </div>
  )
}
