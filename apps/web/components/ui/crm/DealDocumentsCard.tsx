'use client'

// 딜의 계약서 카드 — 이 딜에서 만든 계약서를 상태와 보냄 체크와 함께 보인다 (P0132 I13)
//
// 견적 카드와 같은 줄 모양을 쓴다(quote-panel.module.css) — 같은 딜 안의 같은 종류 문서가
// 카드마다 다른 모양이면 사람은 다른 기능으로 읽는다. 만들기는 견적 카드의 「계약서 만들기」가 맡는다:
// 계약서는 견적 값으로 채워지므로 어느 견적인지가 먼저 정해져야 한다.

import { useCallback, useEffect, useState } from 'react'
import { CheckSquare, Square, FileSignature } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { kstDateKey } from '@/lib/datetime/kst'
import { linkWithBack } from '@/lib/crm/nav/back-link'
import type { StatusKey } from '@/lib/tokens/status-colors'
import { failedTo } from '@/lib/terms'
import { CONTRACT_DOC, CONTRACT_STATUS_LABEL, DEAL_CONTRACTS, DOC_HEADER } from '@/lib/terms/contract-doc'
import styles from './quote-panel.module.css'
import docStyles from './doc/doc.module.css'

interface ContractItem {
  id: string
  contractNo: string
  title: string
  status: string
  currentVersionNo: number
  sentAt: string | null
  sentVersionNo: number | null
}

const STATUS_TONE: Record<string, StatusKey> = {
  DRAFT: 'note', CONCLUDED: 'done', TERMINATED: 'blocker', CANCELLED: 'blocker',
}

type Load =
  | { kind: 'loading' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; items: ContractItem[] }

interface Props {
  dealId: string
  dealName: string
  /** 견적 카드에서 무엇을 하면 다시 읽는다 */
  reloadKey?: number
}

export default function DealDocumentsCard({ dealId, dealName, reloadKey }: Props) {
  const [state, setState] = useState<Load>({ kind: 'loading' })
  const here = { path: `/crm/deals/${dealId}`, label: dealName }
  const fail = failedTo(CONTRACT_DOC.entity, '불러오지')

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const res = await fetch(`/api/crm/contracts?dealId=${encodeURIComponent(dealId)}`, { cache: 'no-store' })
      const body = await res.json()
      if (res.status === 403) { setState({ kind: 'denied' }); return }
      if (!res.ok) { setState({ kind: 'error', message: body?.error?.message ?? fail }); return }
      setState({ kind: 'ok', items: body.items ?? [] })
    } catch {
      setState({ kind: 'error', message: fail })
    }
  }, [dealId, fail])

  useEffect(() => { void load() }, [load, reloadKey])

  if (state.kind === 'loading') return <AXDotLoader />
  if (state.kind === 'denied') return <EmptyState title={DEAL_CONTRACTS.denied} />
  if (state.kind === 'error') return <ErrorState message={state.message} onRetry={() => void load()} />
  if (state.items.length === 0) {
    return <EmptyState icon={<FileSignature size={24} aria-hidden />} title={DEAL_CONTRACTS.empty} description={DEAL_CONTRACTS.emptyNext} />
  }

  return (
    <ul className={styles.list}>
      {state.items.map((c) => {
        const sent = c.sentAt ? kstDateKey(c.sentAt) : null
        return (
          <li className={styles.item} key={c.id}>
            <div className={styles.itemTop}>
              <span className={styles.quoteNo}>{c.contractNo}</span>
              <NbBadge status={STATUS_TONE[c.status] ?? 'note'}>{CONTRACT_STATUS_LABEL[c.status] ?? c.status}</NbBadge>
            </div>
            <div className={styles.itemTitle}>{c.title}</div>
            <div className={styles.meta}>
              <span className={sent ? docStyles.sentOn : docStyles.sentOff}>
                {sent ? <CheckSquare size={14} aria-hidden /> : <Square size={14} aria-hidden />}
                {sent && c.sentVersionNo ? DOC_HEADER.sentVersion(sent, c.sentVersionNo) : DOC_HEADER.notSent}
              </span>
              {' · '}{DOC_HEADER.current(c.currentVersionNo)}
            </div>
            <div className={styles.itemActions}>
              <NbButton href={linkWithBack(`/crm/contracts/${c.id}`, here)}>
                <FileSignature size={14} /> {CONTRACT_DOC.open}
              </NbButton>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
