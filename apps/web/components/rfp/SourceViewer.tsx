'use client'

// 원문 뷰어 — **문서처럼 보여 준다.**
//
// ## 예전에 왜 글 덩어리였나
//
// 파싱 결과에는 구조가 다 있었다 — 표 71개(HTML 보관), 섹션 100개(번호·제목),
// 문단 349개. 그런데 화면은 **글자만 읽어서** 순서대로 이어 붙였다.
// 표는 셀이 탭으로만 구분돼 한 줄로 흐르고, 섹션 제목은 본문과 구분이 없었다.
// 사용자가 「이게 문서로 나와 있는 건가」라고 물은 것의 정체다(실측 2026-09-09).
//
// ## 원문 이미지는 여전히 안 그린다
//
// 우리 조판이 한컴 뷰어와 달라 쪽 번호가 근사이기 때문이다(설계서 4장 11).
// 사용자가 확인하려는 것은 「그 문장이 원문에 있나」이고, 그건 블록으로 답이 된다.
// 한글 문서는 쪽 개념이 없어 `page_no` 가 전부 null 이다 — 그래서 쪽 자리를 안 만든다.

import { useEffect, useMemo, useRef, useState } from 'react'
import EmptyState from '@/components/ui/EmptyState'
import NbBadge from '@/components/ui/nb/NbBadge'
import NbButton from '@/components/ui/nb/NbButton'
import { RFP_REPORT } from '@/lib/rfp/terms'
import { parseSimpleTable, looksLikeDataTable } from '@/lib/rfp/report/table-html'
import { groupBySection, type SourceBlock } from '@/lib/rfp/report/source-group'
import styles from '@/app/(rfp)/rfp.module.css'

export interface SourceViewerProps {
  blocks: SourceBlock[]
  /** 지금 보고 있는 블록 */
  activeBlockId: string | null
}

export default function SourceViewer({ blocks, activeBlockId }: SourceViewerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')

  const groups = useMemo(() => groupBySection(blocks), [blocks])
  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return groups
    // 찾는 글자가 든 블록만 남긴다 — 420개를 눈으로 훑게 하지 않는다
    return groups
      .map((g) => ({ ...g, blocks: g.blocks.filter((b) => b.text.includes(q)) }))
      .filter((g) => g.blocks.length > 0)
  }, [groups, query])

  useEffect(() => {
    if (!activeBlockId || !ref.current) return
    const el = ref.current.querySelector(`[data-block="${activeBlockId}"]`)
    // 근거를 눌렀는데 화면이 안 움직이면 눌린 줄도 모른다
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeBlockId])

  if (blocks.length === 0) {
    return <EmptyState title={RFP_REPORT.notReady} description={RFP_REPORT.notReadyDesc} />
  }

  const tableCount = blocks.filter((b) => b.type === 'table').length
  const headingCount = groups.filter((g) => g.title || g.number).length

  return (
    <div className="card">
      <div className={styles.sectionHead}>
        <div className={styles.between}>
          <span className={styles.sectionTitle}>{RFP_REPORT.source}</span>
          <span className={styles.row}>
            <NbBadge status="note">{RFP_REPORT.sourceBlocks} {blocks.length}</NbBadge>
            {tableCount > 0 && <NbBadge status="note">{RFP_REPORT.sourceTables} {tableCount}</NbBadge>}
            {headingCount > 0 && <NbBadge status="note">{RFP_REPORT.sourceSections} {headingCount}</NbBadge>}
          </span>
        </div>
        <span className={styles.sectionDesc}>{RFP_REPORT.sourceHint}</span>
      </div>

      {/* 420개를 눈으로 훑게 하지 않는다 */}
      <div className={styles.row}>
        <input
          className="input-field"
          value={query}
          placeholder={RFP_REPORT.sourceSearch}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <NbButton variant="ghost" onClick={() => setQuery('')}>{RFP_REPORT.sourceClear}</NbButton>
        )}
      </div>

      <div ref={ref} className={styles.sourceScroll}>
        {filtered.length === 0 && (
          <span className={styles.sectionDesc}>{RFP_REPORT.sourceNoHit}</span>
        )}

        {filtered.map((g) => (
          <section key={g.key} className={styles.sourceSection}>
            {(g.number || g.title) && (
              <h3 className={styles.sourceHeading}>
                {g.number ? `${g.number} ` : ''}{g.title ?? ''}
              </h3>
            )}
            {g.blocks.map((b) => (
              <BlockView key={b.blockId} block={b} active={b.blockId === activeBlockId} />
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}

function BlockView({ block, active }: { block: SourceBlock; active: boolean }) {
  // 표는 표로 그린다. 다만 **데이터 표만** 그린다 —
  // 공고문 머리말 같은 레이아웃 표는 열이 열 개가 넘고 대부분 비어서,
  // 표로 그리면 좁은 자리에서 글자가 세로로 한 자씩 쪼개진다(실측: 「우/편/번/호」).
  // 못 풀거나 레이아웃 표면 원문 글자로 떨어진다.
  const parsed = block.type === 'table' ? parseSimpleTable(block.html) : null
  const table = parsed && looksLikeDataTable(parsed) ? parsed : null

  if (table) {
    return (
      <div
        data-block={block.blockId}
        className={active ? `${styles.sourceBlock} ${styles.sourceActive}` : styles.sourceBlock}
      >
        <div className={styles.tableWrap}>
          <table className={styles.sourceTable}>
            {table.hasHeader && (
              <thead>
                <tr>{table.rows[0].map((c, i) => <th key={i}>{c}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {(table.hasHeader ? table.rows.slice(1) : table.rows).map((row, r) => (
                <tr key={r}>{row.map((c, i) => <td key={i}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <p
      data-block={block.blockId}
      className={
        active
          ? `${styles.sourceBlock} ${styles.sourceText} ${styles.sourceActive}`
          : `${styles.sourceBlock} ${styles.sourceText}`
      }
    >
      {block.text}
    </p>
  )
}

export type { SourceBlock }
