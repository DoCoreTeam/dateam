'use client'

// 원문 뷰어 — 근거를 눌렀을 때 그 블록으로 간다.
//
// **원문 이미지를 그리지 않는다.** 우리 조판이 한컴 뷰어와 달라 쪽 번호가 근사이기 때문이다
// (설계서 4장 11). 대신 파싱한 블록을 순서대로 보여 주고 그 블록을 표시한다 —
// 사용자가 확인하려는 것은 「그 문장이 원문에 있나」이고, 그건 블록으로 답이 된다.

import { useEffect, useRef } from 'react'
import EmptyState from '@/components/ui/EmptyState'
import NbBadge from '@/components/ui/nb/NbBadge'
import { RFP_REPORT } from '@/lib/rfp/terms'
import styles from '@/app/(rfp)/rfp.module.css'

export interface SourceBlock {
  blockId: string
  text: string
  pageNo: number | null
  type: string
}

export interface SourceViewerProps {
  blocks: SourceBlock[]
  /** 지금 보고 있는 블록 */
  activeBlockId: string | null
}

export default function SourceViewer({ blocks, activeBlockId }: SourceViewerProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activeBlockId || !ref.current) return
    const el = ref.current.querySelector(`[data-block="${activeBlockId}"]`)
    // 근거를 눌렀는데 화면이 안 움직이면 눌린 줄도 모른다
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeBlockId])

  if (blocks.length === 0) {
    return <EmptyState title={RFP_REPORT.notReady} description={RFP_REPORT.notReadyDesc} />
  }

  return (
    <div className="card">
      {/* 무엇을 보고 있는지 말한다 — 제목이 없으면 오른쪽 절반이 정체불명의 글 덩어리가 된다 */}
      <div className={styles.sectionHead}>
        <div className={styles.between}>
          <span className={styles.sectionTitle}>{RFP_REPORT.source}</span>
          <NbBadge status="note">{blocks.length}</NbBadge>
        </div>
        <span className={styles.sectionDesc}>{RFP_REPORT.sourceHint}</span>
      </div>

      <div ref={ref} style={{ maxHeight: '68vh', overflowY: 'auto' }}>
        {blocks.map((b) => {
          const active = b.blockId === activeBlockId
          return (
            <p
              key={b.blockId}
              data-block={b.blockId}
              className={styles.sourceText}
              style={{
                // 표시는 배경으로 한다 — 글자색을 바꾸면 테마에 따라 안 보인다
                background: active ? 'var(--surface-active)' : undefined,
                padding: 'var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                // 문단 사이를 벌린다 — 붙여 두면 표와 항목이 한 덩어리로 뭉갠다
                marginBottom: 'var(--space-2)',
              }}
            >
              {b.pageNo !== null && (
                <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>{b.pageNo} </span>
              )}
              {b.text}
            </p>
          )
        })}
      </div>
    </div>
  )
}
