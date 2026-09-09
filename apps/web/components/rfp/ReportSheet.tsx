'use client'

// 종이에 올라가는 리포트 — **고객·상사에게 나가는 문서 그 자체**
//
// ## 왜 화면과 따로 그리나
//
// 화면은 훑어보는 자리라 절마다 배지와 개수가 붙는다. 종이는 읽는 자리다 —
// 조작 흔적(배지·개수·펼치기)이 찍히면 문서가 아니라 화면 사진이 된다.
//
// **다만 내용은 같은 것이다.** 값도 순서도 화면과 같은 SSOT(field-labels)를 쓴다 —
// 「화면에서 본 것과 다른 게 나갔다」가 가장 나쁜 결과다.
//
// ## 확인 안 된 값을 감추지 않는다
//
// 근거 목록은 종이에 안 싣지만 **「확인 안 됨」은 싣는다.** 감추면 보고 받는 사람이
// 확인된 값과 나란히 읽는다.

import { AI_NOTICE, DOC_CLASS_LABEL, RFP_REPORT, GROUNDING_LABEL, FIT_VERDICT_LABEL } from '@/lib/rfp/terms'
import { sectionLabel, orderFields, orderSections, fieldLabel, fieldUnit } from '@/lib/rfp/report/field-labels'
import { formatValue } from '@/lib/rfp/report/format-value'
import type { Report, ValueNode } from '@/lib/rfp/report/schema'
import type { DocClass } from '@/lib/rfp/domain/doc-class'
import styles from '@/app/(rfp)/rfp.module.css'

export interface SheetAnomaly {
  title?: string
  severity?: string | null
  rationale?: string | null
}

export interface ReportSheetProps {
  report: Report
  anomalies: SheetAnomaly[]
  fit: { score: number; verdict: keyof typeof FIT_VERDICT_LABEL; conditional?: boolean } | null
  caseTitle: string
  docClass: DocClass
}

/** 종이에 실을 절 — 화면과 같은 순서표를 쓴다 */
const SHEET_SECTIONS = ['overview', 'budget', 'schedule', 'scope', 'evaluation', 'constraints', 'checklist']

export default function ReportSheet({
  report, anomalies, fit, caseTitle, docClass,
}: ReportSheetProps) {
  return (
    <article className={styles.sheet}>
      <header className={styles.sheetHead}>
        {/* 문서 제목은 h2 다 — 페이지 제목이 아니다(견적서 QuoteSheet 와 같은 규칙).
            PageHeader 는 앱 화면의 머리이고, 이건 종이 위의 표제다 */}
        <h2 className={styles.sheetTitle}>{caseTitle}</h2>
        {/* AI 기본법 투명성 의무 — 종이에도 붙는다 */}
        <p className={styles.sheetMeta}>
          {AI_NOTICE} · {DOC_CLASS_LABEL[docClass]}
        </p>
      </header>

      {fit && (
        <section className={styles.sheetSection}>
          <h2 className={styles.sheetSectionTitle}>{RFP_REPORT.fit}</h2>
          <dl className={styles.sheetList}>
            <div className={styles.sheetRow}>
              <dt className={styles.sheetKey}>{RFP_REPORT.fitScore}</dt>
              <dd className={styles.sheetVal}>{fit.score}</dd>
            </div>
            <div className={styles.sheetRow}>
              <dt className={styles.sheetKey}>{RFP_REPORT.fit}</dt>
              <dd className={styles.sheetVal}>{FIT_VERDICT_LABEL[fit.verdict]}</dd>
            </div>
          </dl>
        </section>
      )}

      {orderSections(SHEET_SECTIONS).map((key) => {
        const bucket = report[key as keyof Report] as Record<string, ValueNode<unknown>>
        const entries = Object.entries(bucket ?? {})
          .filter(([, v]) => v?.value !== null && v?.value !== undefined)
        if (entries.length === 0) return null
        const byKey = new Map(entries)

        return (
          <section key={key} className={styles.sheetSection}>
            <h3 className={styles.sheetSectionTitle}>{sectionLabel(key)}</h3>
            <dl className={styles.sheetList}>
              {orderFields(Array.from(byKey.keys())).map((f) => {
                const node = byKey.get(f) as ValueNode<unknown>
                return (
                  <div key={f} className={styles.sheetRow}>
                    <dt className={styles.sheetKey}>{fieldLabel(f)}</dt>
                    <dd className={styles.sheetVal}>
                      {formatValue(node.value)}
                      {fieldUnit(f) && typeof node.value === 'number' ? ` ${fieldUnit(f)}` : ''}
                      {/* 근거 목록은 안 싣되 「확인 안 됨」은 싣는다 */}
                      {node.grounding === 'unconfirmed' && (
                        <span className={styles.valueNote}> {GROUNDING_LABEL.unconfirmed}</span>
                      )}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </section>
        )
      })}

      {anomalies.length > 0 && (
        <section className={styles.sheetSection}>
          <h3 className={styles.sheetSectionTitle}>{RFP_REPORT.anomalies}</h3>
          <dl className={styles.sheetList}>
            {anomalies.map((a, i) => (
              <div key={`${a.title ?? ''}-${i}`} className={styles.sheetRow}>
                <dt className={styles.sheetKey}>{a.severity ?? ''}</dt>
                <dd className={styles.sheetVal}>
                  {a.title ?? ''}
                  {a.rationale ? <span className={styles.sheetNote}>{a.rationale}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </article>
  )
}
