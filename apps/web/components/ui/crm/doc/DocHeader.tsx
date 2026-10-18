'use client'

// 문서 머리줄 — 견적서와 계약서가 같은 자리에 같은 것을 둔다 (P0132 I12a)
//
// **왜 한 부품인가**: 두 문서는 같은 질문에 답해야 한다 — 이 문서가 지금 어떤 상태이고
// 고객에게 냈는가. 화면마다 머리줄을 따로 짜면 한쪽은 상태만, 다른 쪽은 보냄만 보여 준다.
//
// **보냄은 상태 배지와 따로 선다.** 계약서는 작성 중인 채로 보낼 수 있고 보낸 뒤에도 고친다
// (contract-status.ts). 둘을 한 배지에 합치면 「작성 중」과 「보냄」 중 하나가 안 보인다.

import type { ReactNode } from 'react'
import { CheckSquare, Square } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import NbBadge from '@/components/ui/nb/NbBadge'
import type { StatusKey } from '@/lib/tokens/status-colors'
import { DOC, DOC_HEADER } from '@/lib/terms/contract-doc'
import styles from './doc.module.css'

export interface DocSentMark {
  /** 보낸 날 (YYYY-MM-DD). null 이면 아직 안 보냈다 */
  date: string | null
  /** 보낸 버전 번호 — 계약서처럼 버전이 있는 문서만 */
  versionNo?: number | null
}

interface Props {
  title: string
  back: { href: string; label: string }
  status: { label: string; tone: StatusKey }
  sent: DocSentMark
  /** 제목 옆에 더 붙일 것 — 지금 버전 같은 것 */
  extra?: ReactNode
  /** 이 문서 자체를 다루는 자리(삭제 같은 것) */
  actions?: ReactNode
}

function sentText(sent: DocSentMark): string {
  if (!sent.date) return DOC_HEADER.notSent
  return sent.versionNo ? DOC_HEADER.sentVersion(sent.date, sent.versionNo) : DOC.sentOn(sent.date)
}

export default function DocHeader({ title, back, status, sent, extra, actions }: Props) {
  const isSent = Boolean(sent.date)
  return (
    <PageHeader
      title={title}
      back={back}
      titleAfter={(
        <div className={styles.marks}>
          <NbBadge status={status.tone}>{status.label}</NbBadge>
          {/*
            체크 모양은 읽는 사람에게도 같은 뜻이어야 한다 — 아이콘은 가리고 글로 말한다.
            「아직 안 보냄」을 숨기지 않는다: 안 보인 것과 안 보낸 것을 사람이 구분할 수 없다.
          */}
          <span className={isSent ? styles.sentOn : styles.sentOff}>
            {isSent ? <CheckSquare size={14} aria-hidden /> : <Square size={14} aria-hidden />}
            {sentText(sent)}
          </span>
          {extra}
        </div>
      )}
      actions={actions}
    />
  )
}
