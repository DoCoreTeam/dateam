'use client'

// app/(trading)/trading/AccountPanel.tsx — 증권사 계좌를 지금 한 번 읽는다
//
// 사용자 지시 2026-09-30: 「계좌를 직접 볼 수 있으면 그것도 하고 직접 매매는 안해도
// 데이터는 받을수있으니」.
//
// ## 왜 단추인가
//
// 화면을 그릴 때마다 증권사를 부르면 탭을 열어 두는 것만으로 호출이 계속 나가고,
// 매분 도는 수집과 같은 초당 제한에 함께 걸린다. **사람이 누를 때만** 나간다.
//
// ## 못 읽으면 고칠 자리를 짚는다
//
// 실측 2026-09-30 지금 상태는 `APAC0071` — 증권사에 그 계좌번호가 없다는 뜻이다.
// 코드만 찍으면 사흘 동안 아무도 못 고친다(2026-09-28 전례). 그래서 뜻과 갈 곳을 함께 쓴다.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Landmark } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import {
  ACCOUNT_VIEW_LABEL,
  type AccountMoneyRow, type AccountPositionRow,
} from '@/lib/trading/broker/account-view'
import { readBrokerAccount } from './actions'
import { DIRECTION_LABEL, formatIndexPrice } from '@/lib/trading/signal-labels'
import { wonText, UNKNOWN_TEXT } from '@/lib/trading/position-labels'
import styles from './AccountPanel.module.css'

interface Loaded {
  money: AccountMoneyRow[]
  positions: AccountPositionRow[]
  partial: { why: string; how: string } | null
}

export default function AccountPanel() {
  const [pending, start] = useTransition()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState<{ why: string; how: string; code: string | null } | null>(null)

  const read = (): void => {
    setFailed(null)
    start(async () => {
      try {
        /*
          **창구를 새로 안 연다.** 트레이딩 API 라우트는 크론 둘뿐이고 셋째를 열면
          소유자 확인이 흩어진다 — 서버 액션이 그 확인을 안에서 한다
        */
        const r = await readBrokerAccount()
        if (!r.ok) {
          setLoaded(null)
          setFailed({ why: r.why, how: r.how, code: r.code })
          return
        }
        setLoaded({ money: [...r.money], positions: [...r.positions], partial: r.partial })
      } catch {
        // 서버에 못 닿은 것과 증권사가 거절한 것은 다르다. 섞어 적지 않는다
        setLoaded(null)
        setFailed({ why: '서버에 닿지 못했습니다', how: '연결을 확인하고 다시 눌러 주세요', code: null })
      }
    })
  }

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <h3 className={styles.title}>{ACCOUNT_VIEW_LABEL.title}</h3>
        <span className={styles.note}>{ACCOUNT_VIEW_LABEL.note}</span>
        <NbButton onClick={read} disabled={pending}>
          <Landmark size={14} /> {pending ? ACCOUNT_VIEW_LABEL.reading : ACCOUNT_VIEW_LABEL.read}
        </NbButton>
      </div>

      {failed && (
        <p role="status" className={styles.failed}>
          <strong>{failed.why}</strong>
          {failed.how && <span className={styles.how}>{failed.how}</span>}
          {/* 갈 곳이 있으면 그 자리에서 갈 수 있어야 한다 */}
          {failed.how.includes('설정') && (
            <Link href="/trading/settings" className={styles.link}>트레이딩 설정으로</Link>
          )}
          {/* 코드는 남긴다 — 고치는 사람이 찾아볼 값이다. 증권사 원문은 안 싣는다 */}
          {failed.code && <span className={styles.code}>{failed.code}</span>}
        </p>
      )}

      {!loaded && !failed && <p className={styles.note}>{ACCOUNT_VIEW_LABEL.none}</p>}

      {loaded && (
        <>
          {loaded.partial && (
            <p role="status" className={styles.failed}>
              <strong>{loaded.partial.why}</strong>
              <span className={styles.how}>{loaded.partial.how}</span>
            </p>
          )}
          <dl className={styles.facts}>
            {loaded.money.map((m) => (
              <div key={m.name} className={styles.fact}>
                <dt>{m.name}</dt>
                {/* 안 받은 값은 0 으로 안 그린다 — 0원은 「돈이 0원」이라는 사실이다 */}
                <dd className={m.danger && (m.won ?? 0) !== 0 ? styles.danger : undefined}>
                  {m.won === null ? UNKNOWN_TEXT : wonText(m.won)}
                </dd>
              </div>
            ))}
          </dl>
          {loaded.positions.length === 0
            ? <p className={styles.note}>{ACCOUNT_VIEW_LABEL.noPosition}</p>
            : (
              <ul className={styles.positions}>
                {loaded.positions.map((p) => (
                  <li key={p.contractCode} className={styles.position}>
                    <span className={styles.posName}>{p.productName || p.contractCode}</span>
                    <span>
                      {p.direction ? DIRECTION_LABEL[p.direction] : UNKNOWN_TEXT}
                      {` ${p.quantity}계약`}
                    </span>
                    <span>{p.avgPrice === null ? UNKNOWN_TEXT : formatIndexPrice(p.avgPrice)}</span>
                    <span className={(p.evalPnlKrw ?? 0) < 0 ? styles.lose : styles.win}>
                      {p.evalPnlKrw === null ? UNKNOWN_TEXT : wonText(p.evalPnlKrw)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </>
      )}
    </div>
  )
}
