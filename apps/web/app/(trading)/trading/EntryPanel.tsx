'use client'

// app/(trading)/trading/EntryPanel.tsx — 내가 들어간 것
//
// 사용자 지시 2026-09-30: 「지금 관점으로 들어가야 하고 들어갔으면 체크하게 해줘
// 얼마에 들어갔는지 확인하고 말이야」.
//
// ## 기본값이 지금 가격이다
//
// 「들어갔습니다」를 누를 때 값을 처음부터 적게 하면 대개 안 적는다. 지금 가격을 미리 넣어
// 두고 고칠 수 있게 한다 — 대부분 지금 가격 근처에서 들어가고, 다르면 그때만 고친다.
//
// ## 주문은 안 나간다
//
// 사용자가 못 박았다 — 「직접 매매는 안해도 데이터는 받을수있으니」.
// 이 칸은 표 한 줄을 적을 뿐이고 증권사에 아무것도 안 보낸다. 화면이 그 사실을 말한다.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { LogIn, LogOut } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { MANUAL_ENTRY_LABEL, manualPnl, entryLine, type Direction } from '@/lib/trading/position/manual-entry'
import { formatIndexPrice } from '@/lib/trading/signal-labels'
import { seoulTimeText, UNKNOWN_TEXT } from '@/lib/trading/position-labels'
import { markEntered, markExited } from './actions'
import styles from './EntryPanel.module.css'

export interface EntryPanelProps {
  /** 지금 열려 있는 내 기록. 없으면 null */
  open: {
    id: string
    direction: Direction
    entryPrice: number
    quantity: number
    stopPrice: number | null
    targetPrice: number | null
    enteredAt: string
  } | null
  /** 마지막으로 받은 현재가 */
  nowPrice: number | null
  /** 1계약 승수(원). 0 이면 점으로 말한다 */
  multiplier: number
  /** 지금 화면이 권하는 방향과 값. 없으면 손으로 적는다 */
  suggested: {
    direction: Direction
    referencePrice: number
    stopPrice: number
    targetPrice: number
  } | null
}

export default function EntryPanel({ open, nowPrice, multiplier, suggested }: EntryPanelProps) {
  /*
    **적고 나면 화면이 곧바로 바뀌어야 한다.** 서버 액션의 `revalidatePath` 만으로는
    이 칸이 안 다시 그려졌다(실측 2026-09-30: 표에는 줄이 생겼는데 화면은 그대로였다).
    적은 것이 안 보이면 사람은 한 번 더 누르고, 그때 「이미 들어간 것이 있습니다」가 뜬다.
  */
  const router = useRouter()
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  /** 적을 가격. **지금 가격을 미리 넣는다** — 빈 칸이면 대개 안 적는다 */
  const [price, setPrice] = useState<string>('')
  const [quantity, setQuantity] = useState<string>('1')

  useEffect(() => {
    // 값이 바뀌면 안 건드린 칸만 따라간다. 사람이 고쳐 둔 값을 덮으면 안 된다
    setPrice((p) => (p === '' && nowPrice !== null ? nowPrice.toFixed(2) : p))
  }, [nowPrice])

  const pnl = open
    ? manualPnl({
      direction: open.direction,
      entryPrice: open.entryPrice,
      nowPrice,
      quantity: open.quantity,
      multiplier: multiplier > 0 ? multiplier : null,
    })
    : null

  const enter = (direction: Direction): void => {
    setMessage(null)
    start(async () => {
      const r = await markEntered({
        direction,
        price: Number(price),
        quantity: Number(quantity),
        stopPrice: suggested?.direction === direction ? suggested.stopPrice : null,
        targetPrice: suggested?.direction === direction ? suggested.targetPrice : null,
        judgmentId: null,
      })
      setMessage(r.userMessage)
      if (r.ok) router.refresh()
    })
  }

  const exit = (): void => {
    if (!open) return
    setMessage(null)
    start(async () => {
      const r = await markExited({ id: open.id, price: Number(price) })
      setMessage(r.userMessage)
      if (r.ok) router.refresh()
    })
  }

  return (
    <section className={`card ${styles.panel}`}>
      <div className={styles.head}>
        <h2 className={styles.title}>{MANUAL_ENTRY_LABEL.title}</h2>
        {/* 이것이 무엇인지 — 증권사 체결과 섞이면 대조가 늘 어긋난다 */}
        <span className={styles.note}>{MANUAL_ENTRY_LABEL.note}</span>
      </div>

      {open
        ? (
          <>
            <p className={styles.line}>{entryLine(open.direction, open.entryPrice, open.quantity)}</p>
            <dl className={styles.facts}>
              <div className={styles.fact}>
                <dt>{MANUAL_ENTRY_LABEL.nowPrice}</dt>
                <dd>{nowPrice === null ? UNKNOWN_TEXT : formatIndexPrice(nowPrice)}</dd>
              </div>
              <div className={styles.fact}>
                <dt>{MANUAL_ENTRY_LABEL.pnl}</dt>
                {/* 안 재면 0원으로 안 적는다 — 0원은 「본전」이라는 사실이다 */}
                <dd className={pnl && pnl.points > 0 ? styles.win : pnl && pnl.points < 0 ? styles.lose : undefined}>
                  {pnl ? pnl.text : UNKNOWN_TEXT}
                </dd>
              </div>
              <div className={styles.fact}>
                <dt>{MANUAL_ENTRY_LABEL.target}</dt>
                <dd>{open.targetPrice === null ? UNKNOWN_TEXT : formatIndexPrice(open.targetPrice)}</dd>
              </div>
              <div className={styles.fact}>
                <dt>{MANUAL_ENTRY_LABEL.stop}</dt>
                <dd>{open.stopPrice === null ? UNKNOWN_TEXT : formatIndexPrice(open.stopPrice)}</dd>
              </div>
              <div className={styles.fact}>
                <dt>{MANUAL_ENTRY_LABEL.since}</dt>
                <dd>{seoulTimeText(open.enteredAt)}</dd>
              </div>
            </dl>
            <div className={styles.row}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>나온 가격</span>
                <input
                  className="input-field"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
              <NbButton variant="danger" onClick={exit} disabled={pending}>
                <LogOut size={14} /> {MANUAL_ENTRY_LABEL.exit}
              </NbButton>
            </div>
            <p className={styles.note}>{MANUAL_ENTRY_LABEL.undo}</p>
          </>
        )
        : (
          <>
            <p className={styles.line}>{MANUAL_ENTRY_LABEL.none}</p>
            <div className={styles.row}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{MANUAL_ENTRY_LABEL.entryPrice}</span>
                <input
                  className="input-field"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>계약 수</span>
                <input
                  className="input-field"
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </label>
            </div>
            <div className={styles.row}>
              <NbButton onClick={() => enter('long')} disabled={pending}>
                <LogIn size={14} /> 샀습니다 (롱)
              </NbButton>
              <NbButton onClick={() => enter('short')} disabled={pending}>
                <LogIn size={14} /> 팔았습니다 (숏)
              </NbButton>
            </div>
          </>
        )}

      {message && <p role="status" className={styles.message}>{message}</p>}
    </section>
  )
}
