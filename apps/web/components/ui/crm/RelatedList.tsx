'use client'

// components/ui/crm/RelatedList.tsx — 상세 우측 "이어져 있는 것" 목록
//
// **왜 부품인가**: 회사·인물·딜 상세가 각자 `<ul style={{ listStyle: 'none', … }}>` 을
// 인라인으로 그리고 있었다(4곳). 골격은 `RecordLayout` 으로 통일해 놓고 **그 안의 목록은
// 화면마다 다시 짠 것**이라, 같은 성격의 자리가 화면마다 다르게 굴었다.
//
// 실제로 갈린 것:
//   · 회사 상세의 인물 목록은 `email`·`phone` 을 받아 놓고 **버렸다** — 회사 화면에서
//     그 회사 담당자에게 연락할 방법이 하나도 없었다(사용자 지적: "연관된거 다 동일한 UX가
//     되려면 UI 셋업도 동일하게 공통컴포넌트 형식으로 이용되야 하는거 아니야?").
//   · 같은 `DealDetail` 안에서도 '이 딜의 사람들'은 부품, '단계 이력'은 자작이었다.
//
// 그래서 한 줄의 구성을 여기서 못 박는다: **제목(링크) · 부가정보 · 닿는 길**.

import Link from 'next/link'
import type { ReactNode } from 'react'
import EmptyState, { type EmptyStateAction } from '@/components/ui/EmptyState'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ContactLink from '@/components/ui/ContactLink'
import styles from './related-list.module.css'

/** 한 줄이 가리키는 것. `contacts` 를 주면 그 자리에서 바로 연락할 수 있다 */
export interface RelatedItem {
  id: string
  /** 눌렀을 때 갈 곳. 없으면 제목이 링크가 아니다(아직 만들어지지 않은 대상) */
  href?: string
  title: ReactNode
  /** 직함·단계·금액처럼 제목을 보조하는 한 줄 */
  meta?: ReactNode
  /** 이 상대에게 닿는 길. 있는 것만 그린다 */
  contacts?: {
    email?: string | null
    phone?: string | null
    domain?: string | null
  }
}

interface Props {
  items: RelatedItem[]
  empty: { title: string; description?: ReactNode; action?: EmptyStateAction }
  /**
   * 아직 불러오는 중인가.
   *
   * **왜 부품이 맡나**: 안 주면 화면은 "아직 모른다"를 "없다"로 그린다 — 실측(v0.7.599)에서
   * 인물 상세가 회사를 불러오는 동안 **"소속 회사가 없어요"** 를 띄웠다. 소속이 있는 사람인데도.
   * 빈 상태는 **사실 주장**이라, 모르는 동안 하면 안 되는 말이다.
   */
  loading?: boolean
}

export default function RelatedList({ items, empty, loading }: Props) {
  // 모르는 동안에는 "없다"고 말하지 않는다
  if (loading && items.length === 0) return <AXDotLoader />
  if (items.length === 0) {
    return <EmptyState title={empty.title} description={empty.description} action={empty.action} />
  }

  return (
    <ul className={styles.list}>
      {items.map((it) => {
        const c = it.contacts
        const hasContact = !!(c?.email || c?.phone || c?.domain)
        return (
          <li key={it.id} className={styles.row}>
            <div className={styles.head}>
              {it.href ? (
                <Link href={it.href} className={styles.title}>{it.title}</Link>
              ) : (
                <span className={styles.title}>{it.title}</span>
              )}
              {it.meta && <span className={styles.meta}>{it.meta}</span>}
            </div>

            {hasContact && (
              <div className={styles.contacts}>
                {c?.domain && <ContactLink kind="domain" value={c.domain} />}
                {c?.email && <ContactLink kind="email" value={c.email} />}
                {c?.phone && <ContactLink kind="phone" value={c.phone} />}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
