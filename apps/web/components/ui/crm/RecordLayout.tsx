'use client'

// 레코드 상세 골격 — **읽는 곳 / 하는 곳** (정책 §2-3-2 「자리의 축」)
//
//   왼쪽(info)   — 읽는 것: 속성 → 관계 → 이력 (L-2 순서)
//   오른쪽(actions) — 하는 것: 다음 할 일 · 생성 진입 · 상태 변경
//
// **왜 두 열인가**: 예전 3열은 "무엇인가 / 무슨 일 / 무엇과 이어짐"으로 나뉘어 있었는데,
// 그 계약이 **이 파일 주석에만** 있어서 화면마다 다르게 해석됐다(실측 v0.7.599):
//   · 오른쪽 `related` 칸에 「다음 할 일」(입력 폼)이 얹혀 **행동과 정보가 한 열에 섞였다**
//   · 회사의 인물이 300px 좁은 칸으로 밀려 **연락하려면 스크롤**해야 했다
//     (같은 개념이 거래처 상세에서는 왼쪽 넓은 칸에 있었다 — 정반대)
//   · 미팅 상세는 슬롯 뜻을 **정반대로** 채웠다(관계를 '무엇인가' 자리에)
// 슬롯 이름이 `related` 인 한 사람은 거기에 관계를 넣는다. **이름이 바뀌어야 행동이 바뀐다.**
//
// **폰에서는 행동이 먼저 온다(L-4).** 좌우를 그대로 상하로 접으면 제일 급한 것이 제일 아래로
// 간다 — 영업은 밖에서 하는 일인데 「다음 할 일」이 타임라인 전체 뒤에 있었다.
// 이 뒤집기는 **부품이 한다.** 화면이 매번 기억할 규칙으로 두지 않는다.

import type { ReactNode } from 'react'
import { Lock, Unlock } from 'lucide-react'
import styles from './record-layout.module.css'

interface Props {
  /** 왼쪽 — 읽는 것. 속성 → 관계 → 이력 순으로 넣는다(L-2) */
  info?: ReactNode
  /** 오른쪽 — 하는 것. 입력 폼·생성 진입만. 읽을 것을 넣지 않는다(L-1) */
  actions?: ReactNode

  /**
   * @deprecated 레거시 3슬롯. 새 화면은 `info`/`actions` 를 쓴다.
   * 아직 이관하지 않은 화면(미팅 상세 — 슬롯 뜻이 뒤집혀 있어 단순 이관이 아니라 재배치가 필요하다)이
   * 남아 있어 함께 받는다. 그 화면을 다른 일로 건드릴 때 이관한다.
   */
  fields?: ReactNode
  /** @deprecated `info` 안으로 */
  timeline?: ReactNode
  /** @deprecated `info`(읽을 것) 또는 `actions`(할 것)로 나눠 넣는다 */
  related?: ReactNode
}

export default function RecordLayout({ info, actions, fields, timeline, related }: Props) {
  // 새 슬롯을 하나라도 주면 2열이다 — 레거시와 섞어 쓰지 않는다
  if (info !== undefined || actions !== undefined) {
    // 행동 레일에 넣을 것이 없는 화면(읽기 위주)은 한 열이다 —
    // 빈 레일이 320px 를 먹으면 그게 바로 L-5 가 막으려는 상태다
    const hasRail = actions !== undefined
    return (
      <div className={hasRail ? styles.record2 : styles.recordSolo}>
        <section className={styles.colInfo} aria-label="정보">{info}</section>
        {hasRail && (
          <aside className={styles.colActions} aria-label="할 수 있는 것">{actions}</aside>
        )}
      </div>
    )
  }

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
export interface RecordFieldProps {
  /** 긴 값(주소·설명)은 한 줄을 통째로 쓴다 */
  wide?: boolean
  label: string
  children?: ReactNode
  /**
   * 확정 토글을 붙일 필드 이름. 주면 자물쇠가 뜬다.
   *
   * **왜 여기 있나**: "사람이 확인한 값은 AI 가 못 덮는다"(절대규칙 2)를 켜는 스위치다.
   * 판정 로직은 처음부터 있었는데 이 스위치가 없어서 한 번도 실행되지 않았다 —
   * 판정 함수는 언제나 빈 목록을 받고 있었다.
   *
   * 부품에 넣는 이유: 화면마다 따로 만들면 어떤 상세에는 있고 어떤 상세에는 없게 된다.
   */
  field?: string
  /** 지금 확정돼 있나 */
  verified?: boolean
  /** 누르면 뒤집는다. 안 주면 토글을 안 그린다(읽기 전용 화면) */
  onToggleVerified?: (field: string, next: boolean) => void
}

export function RecordField({ label, children, field, verified, onToggleVerified, wide }: RecordFieldProps) {
  const empty = children === null || children === undefined || children === ''
  const canToggle = !!field && !!onToggleVerified

  return (
    <div className={wide ? `${styles.field} ${styles.fieldWide}` : styles.field}>
      <dt className={styles.fieldLabel}>
        {label}
        {canToggle && (
          <button
            type="button"
            className={`${styles.verifyBtn}${verified ? ` ${styles.verifyOn}` : ''}`}
            onClick={() => onToggleVerified!(field!, !verified)}
            /* 아이콘만 있는 버튼이라 무엇을 하는 버튼인지 말로 남긴다 */
            aria-pressed={!!verified}
            title={verified
              ? '확정을 풀면 AI가 이 값을 다시 채울 수 있습니다'
              : '확정하면 AI가 이 값을 바꾸지 않습니다'}
          >
            {verified ? <Lock size={13} /> : <Unlock size={13} />}
            <span className={styles.verifySr}>{verified ? '확정됨' : '확정하기'}</span>
          </button>
        )}
      </dt>
      <dd className={styles.fieldValue}>
        {empty ? <span className={styles.fieldEmpty}>—</span> : children}
      </dd>
    </div>
  )
}

export function RecordFieldList({ children }: { children: ReactNode }) {
  return <dl className={styles.fieldList}>{children}</dl>
}
