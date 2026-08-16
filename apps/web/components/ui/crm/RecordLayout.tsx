'use client'

// 레코드 3열 표준 (dacrm 구현명세 §6.2)
//
// 회사·인물·딜 상세가 **같은 골격**을 쓴다. 화면마다 3열을 다시 짜면
// 속성이 어디 있는지, 이력이 어느 쪽인지가 화면마다 달라진다 — 사용자는 매번 다시 찾는다.
//
//   좌: 필드 패널   — 이 레코드가 무엇인가
//   중: 타임라인    — 이 레코드에 무슨 일이 있었나
//   우: 연결 패널   — 이 레코드가 무엇과 이어져 있나
//
// 좁은 화면에서는 한 줄로 접힌다. 접히는 순서는 좌 → 중 → 우 —
// 폰에서 먼저 알아야 하는 것은 "무엇인가"이지 "무엇과 이어져 있나"가 아니다.

import type { ReactNode } from 'react'
import styles from './record-layout.module.css'

interface Props {
  fields: ReactNode
  timeline: ReactNode
  related: ReactNode
}

export default function RecordLayout({ fields, timeline, related }: Props) {
  return (
    <div className={styles.record}>
      <aside className={styles.col} aria-label="속성">{fields}</aside>
      <section className={styles.colMain} aria-label="타임라인">{timeline}</section>
      <aside className={styles.col} aria-label="연결">{related}</aside>
    </div>
  )
}

/** 3열 안의 한 덩어리. 제목은 항상 같은 크기·같은 자리다 */
export function RecordPanel({ title, action, children }: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={`card ${styles.panel}`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

/**
 * 값이 없을 때 칸을 비워 두지 않는다 — 빈 칸은 "값이 없다"인지 "안 불러왔다"인지 구분이 안 된다.
 * 그래서 없으면 '—'를 그린다.
 */
export function RecordField({ label, children }: { label: string; children?: ReactNode }) {
  const empty = children === null || children === undefined || children === ''
  return (
    <div className={styles.field}>
      <dt className={styles.fieldLabel}>{label}</dt>
      <dd className={styles.fieldValue}>
        {empty ? <span className={styles.fieldEmpty}>—</span> : children}
      </dd>
    </div>
  )
}

export function RecordFieldList({ children }: { children: ReactNode }) {
  return <dl className={styles.fieldList}>{children}</dl>
}
