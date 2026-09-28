'use client'

// app/(trading)/trading/settings/CredentialPanel.tsx — 증권사 자격증명
//
// **왜 이제야 생기나** (실측 2026-09-27): `saveTradingCredentials` 는 있었는데
// **부르는 자리가 0곳**이었다. 저장·암호화·가린 계좌번호까지 다 만들어 두고 넣을 화면이
// 없어서, 실제로 넣으려면 사람이 DB 를 직접 만져야 했다.
//
// **넣는 칸만 있고 보는 칸은 없다.** 앱키와 시크릿은 저장한 뒤 화면으로 다시 안 나온다.
// 화면이 아는 것은 「넣었나 · 어느 계좌인가(가린 번호) · 언제 넣었나」 셋이다.
// 「확인용으로 한 번만」을 만들면 그 길이 곧 유출 경로가 된다.

import { useState, useTransition } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import { ACTION, progress } from '@/lib/terms'
import { eulReul, gwaWa, withJosa } from '@/lib/ui/josa'
import { formatKstDateTimeExact } from '@/lib/datetime/kst'
import { saveTradingCredentialsAction } from './actions'

export interface CredentialStatusRow {
  env: 'real' | 'paper'
  label: string
  configured: boolean
  accountMask: string | null
  updatedAt: string | null
}

export default function CredentialPanel({ rows }: { rows: readonly CredentialStatusRow[] }) {
  return (
    <section className="card">
      <h2
        style={{
          fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)',
          margin: 0, marginBottom: 'var(--space-2)',
        }}
      >
        증권사 자격증명
      </h2>
      <p style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
        넣은 값은 다시 보이지 않습니다. 바꾸려면 새로 넣으세요. 모의와 실전은 따로 저장됩니다
      </p>
      <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
        {rows.map((row) => <EnvForm key={row.env} row={row} />)}
      </div>
    </section>
  )
}

function EnvForm({ row }: { row: CredentialStatusRow }) {
  const [appKey, setAppKey] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [accountNo, setAccountNo] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [pending, startTransition] = useTransition()

  const filled = appKey.trim() !== '' && appSecret.trim() !== ''
  /*
    **왜 못 누르는지 화면이 말한다** (실측 2026-09-28: 이유가 아무 데도 없었다 — title 조차).
    앱키만 넣고 저장이 안 켜지면 사람은 값이 틀렸다고 읽고 지웠다 다시 넣는다.
    계좌번호는 `filled` 가 안 보므로 필수가 아니다 — 그 사실도 같이 말한다.
  */
  const missing = [
    appKey.trim() === '' ? '앱키' : null,
    appSecret.trim() === '' ? '앱시크릿' : null,
  ].filter((w): w is string => w !== null)
  /* 조사를 손으로 적으면 「앱키과 앱시크릿를」이 된다 — 받침은 `lib/ui/josa` 가 본다 */
  const blocked = missing.length > 0
    ? `${missing.map((w, i) => (i < missing.length - 1 ? withJosa(w, gwaWa) : w)).join(' ')}`
      + `${eulReul(missing[missing.length - 1])} 넣어야 저장할 수 있습니다`
    : null

  function save() {
    setMessage(null)
    startTransition(async () => {
      const res = await saveTradingCredentialsAction(row.env, appKey, appSecret, accountNo)
      setOk(res.ok)
      setMessage(res.ok ? '저장했습니다' : res.userMessage)
      // 성공하면 입력칸을 비운다 — 화면에 남겨 두면 그 자체가 새는 자리가 된다
      if (res.ok) { setAppKey(''); setAppSecret(''); setAccountNo('') }
    })
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>{row.label}</strong>
        {/* 안 넣었으면 무엇이 없는지 말한다 — 빈 칸만 보여 주면 넣은 줄 알 수도 있다 */}
        <NbBadge status={row.configured ? 'done' : 'note'}>
          {row.configured ? '등록됨' : '아직 없음'}
        </NbBadge>
        {row.accountMask && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{row.accountMask}</span>
        )}
        {row.updatedAt && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            {formatKstDateTimeExact(row.updatedAt)}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label className="label" htmlFor={`appkey-${row.env}`}>앱키</label>
          <input
            id={`appkey-${row.env}`}
            className="input-field"
            type="password"
            autoComplete="off"
            value={appKey}
            disabled={pending}
            onChange={(e) => setAppKey(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor={`appsecret-${row.env}`}>앱시크릿</label>
          <input
            id={`appsecret-${row.env}`}
            className="input-field"
            type="password"
            autoComplete="off"
            value={appSecret}
            disabled={pending}
            onChange={(e) => setAppSecret(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor={`account-${row.env}`}>계좌번호 (나중에 넣어도 됩니다)</label>
          <input
            id={`account-${row.env}`}
            className="input-field"
            autoComplete="off"
            value={accountNo}
            disabled={pending}
            onChange={(e) => setAccountNo(e.target.value)}
          />
        </div>
        <NbButton disabled={pending || !filled} onClick={save} title={blocked ?? undefined}>
          {pending ? progress(ACTION.save) : ACTION.save}
        </NbButton>
      </div>

      {blocked && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 'var(--space-2) 0 0' }}>
          {blocked}
        </p>
      )}

      {message && (
        <p
          role={ok ? undefined : 'alert'}
          style={{ margin: 0, fontSize: 'var(--fs-xs)', color: ok ? 'var(--success)' : 'var(--danger)' }}
        >
          {message}
        </p>
      )}
    </div>
  )
}
