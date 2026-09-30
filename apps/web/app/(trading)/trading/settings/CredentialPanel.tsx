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
import { credentialIntent, accountShapeFromMask } from '@/lib/trading/broker/credential-input'
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
        {/* 별표는 마크다운이 아니라 글자로 그려진다 — 화면 문구에 표식을 안 쓴다 */}
        앱키와 앱시크릿은 다시 보이지 않습니다. 계좌번호만 고칠 때는 두 칸을 비워 두세요.
        그러면 저장된 앱키는 그대로 둡니다. 모의와 실전은 따로 저장됩니다
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

  /*
    **무엇을 하려는 것인지 서버와 같은 함수로 판정한다.**

    사용자 지적 2026-09-30: 「수정좀 가능하게 해줄래? 키만 넣으면 수정이 안되네」.
    전에는 앱키와 시크릿을 둘 다 넣어야만 저장 단추가 켜졌다. 그런데 그 둘은 넣고 나면
    화면으로 다시 안 나온다 — 계좌번호 하나를 고치려고 보이지도 않는 값을 다시 적어야 했다.

    화면이 따로 판정하면 「단추는 켜지는데 서버가 거절」이 생기고, 그때 사람은 값이
    틀렸다고 읽는다. 그래서 `credentialIntent` 하나를 양쪽이 같이 본다.
  */
  const intent = credentialIntent({ appKey, appSecret, accountNo, configured: row.configured })
  const filled = intent.kind !== 'blocked'
  /*
    **왜 못 누르는지 화면이 말한다** (실측 2026-09-28: 이유가 아무 데도 없었다 — title 조차).
    앱키만 넣고 저장이 안 켜지면 사람은 값이 틀렸다고 읽고 지웠다 다시 넣는다.
  */
  const missing = intent.kind === 'blocked' ? intent.missing : []
  /* 조사를 손으로 적으면 「앱키과 앱시크릿를」이 된다 — 받침은 `lib/ui/josa` 가 본다 */
  const blocked = missing.length > 0
    ? `${missing.map((w, i) => (i < missing.length - 1 ? withJosa(w, gwaWa) : w)).join(' ')}`
      + `${eulReul(missing[missing.length - 1])} 넣어야 저장할 수 있습니다`
    : null
  /* 이번에 무엇이 바뀌는지를 누르기 전에 말한다 — 누르고 나서 알면 되돌릴 수가 없다 */
  const willDo = intent.kind === 'account_only'
    ? '계좌번호만 바꿉니다. 앱키와 앱시크릿은 그대로 둡니다'
    : intent.kind === 'full' && row.configured
      ? '앱키와 앱시크릿을 새 값으로 덮어씁니다'
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
        {/*
          **지금 무엇이 저장돼 있나** — 가린 번호만으로는 뒤 두 자리가 들어갔는지 모른다.
          별표 수가 곧 자릿수라 번호를 열어 보지 않고도 모양을 말할 수 있다(S3)
        */}
        {row.accountMask && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            {row.accountMask}
            {(() => {
              const shape = accountShapeFromMask(row.accountMask)
              if (!shape) return null
              return shape.hasProductCode
                ? ` · ${shape.digits}자리`
                : ` · ${shape.digits}자리 · 뒤 두 자리를 안 넣었습니다`
            })()}
          </span>
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
          {/* 뒤 두 자리가 상품코드다 — 안 적으면 설정값이 쓰인다 (사용자 지적 2026-09-30 「-01 이 없어서 그런거 아냐?」) */}
          <label className="label" htmlFor={`account-${row.env}`}>계좌번호 (뒤 두 자리까지, 예 12345678-01)</label>
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

      {willDo && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 'var(--space-2) 0 0' }}>
          {willDo}
        </p>
      )}

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
