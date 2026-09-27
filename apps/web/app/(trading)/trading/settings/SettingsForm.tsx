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
import { ACTION, progress, SETTING_RECOMMENDED } from '@/lib/terms'
import { saveTradingSettingValue } from './actions'
import ModelPickField from './ModelPickField'
import { presetsFor, stepFor, canSlide } from '@/lib/trading/settings/presets'
import { tradingSetting } from '@/lib/trading/settings/registry'
import styles from './SettingsForm.module.css'

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
  /**
   * 모델 이름 칸이면 짝이 되는 공급자 설정과 지금 값.
   * 다른 칸은 없다 — 있으면 모든 칸이 이 값을 아는 척하게 된다
   */
  pickProvider?: { providerKey: string; provider: string }
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

  /** 숫자면 그 설정의 범위를 가져온다. 고를 것과 슬라이더가 이 값에서 나온다 */
  const numberSpec = row.type === 'number' ? tradingSetting(row.key) ?? null : null

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

      {/* 단추가 좁아져 글자가 세로로 쪼개지지 않게 — 줄바꿈을 막고 줄이지 않는다 */}
      <div
        style={{
          display: 'flex', gap: 'var(--space-2)', alignItems: 'center',
          flexShrink: 0, whiteSpace: 'nowrap',
        }}
      >
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
        ) : numberSpec ? (
          /**
           * 숫자는 **고를 것 셋과 슬라이더**로 준다.
           *
           * 최솟값과 최댓값을 코드가 이미 아는데 화면이 빈칸만 주고 있었다
           * (사용자 지적 2026-09-27). 가운데 것만 명세가 정한 값이라 권장이 붙는다.
           */
          <div className={styles.ctl}>
            <div className={styles.presets}>
              {presetsFor(numberSpec).map((p) => (
                <NbButton
                  key={p.label}
                  type="button"
                  /* 고른 것만 채워 그린다 — 셋이 다 같은 색이면 무엇을 골랐는지 화면이 말 안 한다 */
                  variant={String(p.value) === draft ? 'primary' : 'secondary'}
                  className={styles.preset}
                  disabled={locked || pending}
                  onClick={() => setDraft(String(p.value))}
                  title={p.recommended ? SETTING_RECOMMENDED : undefined}
                >
                  {p.label}{p.recommended ? ' ★' : ''}
                </NbButton>
              ))}
            </div>
            <div className={styles.slider}>
              {canSlide(numberSpec) && (
                <input
                  type="range"
                  aria-label={row.label}
                  min={numberSpec.min}
                  max={numberSpec.max}
                  step={stepFor(numberSpec)}
                  value={Number(draft) || 0}
                  disabled={locked || pending}
                  onChange={(e) => setDraft(e.target.value)}
                />
              )}
              <input
                id={`set-${row.key}`}
                className={`input-field mono ${styles.value}`}
                type="number"
                min={numberSpec.min}
                max={numberSpec.max}
                value={draft}
                disabled={locked || pending}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
          </div>
        ) : row.pickProvider ? (
          /**
           * 모델 이름은 **고르는 것**이지 적는 것이 아니다.
           * 벤더가 이름을 수시로 바꾸고 후보가 수십 개다 — 오타 하나면 판단이 통째로 안 돈다
           */
          <ModelPickField
            providerKey={row.pickProvider.providerKey}
            modelKey={row.key}
            provider={row.pickProvider.provider}
            current={draft}
            disabled={locked || pending}
            onSaved={(_p, model) => setDraft(model)}
          />
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
