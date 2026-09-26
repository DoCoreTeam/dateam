'use client'

// app/(trading)/trading/settings/SettingsForm.tsx — 값 하나를 고쳐 저장하는 줄
//
// **왜 값마다 저장인가**: 88개를 한 단추로 저장하면 하나가 거절될 때 나머지가 어떻게 됐는지
// 화면이 말할 수 없다. 저장기는 값 하나를 한 판으로 쌓으므로(`saveTradingSetting`),
// 화면도 같은 단위로 둔다 — 거절은 그 줄에만 뜨고 나머지는 건드리지 않는다.
//
// **고친 것만 저장 단추가 깨어난다.** 같은 값을 다시 저장하면 판만 하나 늘고
// 「그날 무엇으로 판단했나」에 쓸모없는 줄이 쌓인다.

import { useState, useTransition } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import { ACTION, progress } from '@/lib/terms'
import { saveTradingSettingValue } from './actions'

export interface SettingRow {
  key: string
  label: string
  help: string
  type: 'boolean' | 'number' | 'string' | 'choice'
  choices?: readonly string[]
  unit?: string
  /** 입력칸에 들어갈 값. 예약된 판이 있으면 그 값이다 */
  value: string
  /** 예약이 있을 때만: 오늘 판단에 쓰이는 값 */
  today?: string
  /** 예약이 언제부터인가 */
  from?: string
  /** 여기서 못 바꾸는 값이면 어디서 바꾸는지. 바꿀 수 있으면 null */
  elsewhere: string | null
  usedFrom: string
}

const FIELD: React.CSSProperties = { minWidth: '9rem', maxWidth: '14rem' }

export default function SettingsForm({ row }: { row: SettingRow }) {
  const [draft, setDraft] = useState(row.value)
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [pending, startTransition] = useTransition()

  const changed = draft !== row.value
  const locked = row.elsewhere !== null

  function save() {
    setMessage(null)
    startTransition(async () => {
      const res = await saveTradingSettingValue(row.key, draft)
      setOk(res.ok)
      // 성공도 말한다 — 아무 말이 없으면 눌렸는지 아닌지를 사용자가 못 가린다
      setMessage(res.ok ? `판 ${res.version}으로 저장했습니다. 다음 거래일부터 적용됩니다` : res.userMessage)
    })
  }

  return (
    <div
      style={{
        display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start',
        flexWrap: 'wrap', justifyContent: 'space-between',
      }}
    >
      <div style={{ minWidth: 0, flex: '1 1 18rem' }}>
        <label className="label" htmlFor={`set-${row.key}`} style={{ fontWeight: 600 }}>
          {row.label}
        </label>
        <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          {row.help}
          {/* 언제부터 이 값을 읽는지 — 아직 아무도 안 읽는 값을 고쳐 놓고 기다리지 않게 */}
          <span style={{ color: 'var(--text-faint)' }}>{` · ${row.usedFrom}`}</span>
        </p>
        {/* 못 바꾸는 값은 숨기지 않는다 — 없으면 왜 없는지 물을 데가 없다 */}
        {/*
          예약된 판이 있으면 **둘 다** 말한다. 입력칸에는 예약된 값이 들어 있는데
          오늘 판단은 아직 옛 값으로 돈다 — 그 사실을 안 적으면 화면과 판단이 다른 말을 한다.
        */}
        {row.today !== undefined && row.from && (
          <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--fs-xs)', color: 'var(--info)' }}>
            {`오늘은 ${row.today} · ${row.from}부터 ${row.value}`}
          </p>
        )}
        {locked && (
          <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--fs-xs)', color: 'var(--warning)' }}>
            {row.elsewhere}
          </p>
        )}
        {message && (
          <p
            role={ok ? undefined : 'alert'}
            style={{
              margin: 'var(--space-1) 0 0', fontSize: 'var(--fs-xs)',
              color: ok ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {message}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
        {row.type === 'boolean' ? (
          <select
            id={`set-${row.key}`}
            className="input-field"
            style={FIELD}
            value={draft}
            disabled={locked || pending}
            onChange={(e) => setDraft(e.target.value)}
          >
            <option value="true">켬</option>
            <option value="false">끔</option>
          </select>
        ) : row.type === 'choice' ? (
          <select
            id={`set-${row.key}`}
            className="input-field"
            style={FIELD}
            value={draft}
            disabled={locked || pending}
            onChange={(e) => setDraft(e.target.value)}
          >
            {(row.choices ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <input
            id={`set-${row.key}`}
            className="input-field"
            style={FIELD}
            type={row.type === 'number' ? 'number' : 'text'}
            value={draft}
            disabled={locked || pending}
            onChange={(e) => setDraft(e.target.value)}
          />
        )}
        {row.unit && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{row.unit}</span>}
        <NbButton disabled={locked || pending || !changed} onClick={save}>
          {pending ? progress(ACTION.save) : ACTION.save}
        </NbButton>
      </div>
    </div>
  )
}
