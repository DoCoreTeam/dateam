'use client'

// 리포트 화면 — 항목 카드와 원문 뷰어를 나란히 놓는다.
//
// 근거를 누르면 오른쪽 뷰어가 그 블록으로 간다. 두 화면을 오가지 않아도
// 「이 값이 원문 어디서 왔나」가 한 번에 보여야 한다.

import { useMemo, useState } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import ReportCard from '@/components/rfp/ReportCard'
import { sectionLabel, orderFields, orderSections } from '@/lib/rfp/report/field-labels'
import styles from '@/app/(rfp)/rfp.module.css'
import SourceViewer, { type SourceBlock } from '@/components/rfp/SourceViewer'
import OutcomeForm, { type OutcomeFormProps } from '@/components/rfp/OutcomeForm'
import RevisionDiffPanel, { type RevisionChainItem } from '@/components/rfp/RevisionDiffPanel'
import CrossVerifyDialog, { type CrossField } from '@/components/rfp/CrossVerifyDialog'
import {
  RFP_REPORT, RFP_LIST, AI_NOTICE, DOC_CLASS_LABEL, FIT_VERDICT_LABEL,
  ANOMALY_SEVERITY_LABEL, type AnomalySeverity, type FitVerdict,
} from '@/lib/rfp/terms'
import type { Report, ValueNode } from '@/lib/rfp/report/schema'
import type { DocClass } from '@/lib/rfp/domain/doc-class'

const SECTIONS: { key: keyof Report; title: string }[] = [
  { key: 'overview', title: RFP_REPORT.sectionOverview },
  { key: 'scope', title: RFP_REPORT.sectionScope },
  { key: 'schedule', title: RFP_REPORT.sectionSchedule },
  { key: 'budget', title: RFP_REPORT.sectionBudget },
  { key: 'constraints', title: RFP_REPORT.sectionConstraints },
  { key: 'checklist', title: RFP_REPORT.sectionChecklist },
  { key: 'evaluation', title: RFP_REPORT.sectionEvaluation },
]

export interface ReportClientProps {
  caseId: string
  caseTitle: string
  docClass: DocClass
  report: Report | null
  blocks: SourceBlock[]
  fit: { verdict: FitVerdict; score: number; conditional: boolean } | null
  /** 참여 결정과 낙찰 결과 — 이 데이터가 학습의 정답지다 */
  outcome: OutcomeFormProps['initial']
  /** 정정공고 차수 사슬 */
  revisions: RevisionChainItem[]
  vendors: { id: string; label: string }[]
}

export default function ReportClient({
  caseId, caseTitle, docClass, report, blocks, fit, outcome, revisions, vendors,
}: ReportClientProps) {
  const [mode, setMode] = useState<'work' | 'report'>('work')
  const [activeBlock, setActiveBlock] = useState<string | null>(null)
  const [crossOpen, setCrossOpen] = useState(false)

  // 교차검증 후보 — 근거가 없거나 확신이 낮은 값이 위로 온다
  const crossFields = useMemo<CrossField[]>(() => {
    if (!report) return []
    const out: CrossField[] = []
    for (const key of ['overview', 'schedule', 'budget', 'evaluation'] as const) {
      const bucket = report[key] as Record<string, ValueNode<unknown>>
      for (const [name, node] of Object.entries(bucket ?? {})) {
        if (node?.value === null || node?.value === undefined) continue
        out.push({
          fieldPath: `${key}.${name}`,
          label: `${key}.${name}`,
          confidence: node.confidence,
          grounded: node.grounding === 'confirmed',
          ruleFlagged: false,
          conflictingMentions: 0,
        })
      }
    }
    return out
  }, [report])

  const anomalies = useMemo(
    () => (Array.isArray(report?.anomalies) ? report!.anomalies as {
      title?: string; rationale?: string; severity?: AnomalySeverity
    }[] : []),
    [report],
  )

  if (!report) {
    return (
      <main className="page-inner">
        <PageHeader title={caseTitle} back={{ href: '/rfp', label: RFP_LIST.title }} />
        <EmptyState title={RFP_REPORT.notReady} description={RFP_REPORT.notReadyDesc} />
        {/*
          리포트가 없어도 결과는 적을 수 있어야 한다 —
          「분석은 안 돌렸지만 안 내기로 했다」도 학습의 정답지다
        */}
        <OutcomeForm caseId={caseId} initial={outcome} />
      </main>
    )
  }

  return (
    <main className="page-inner">
      <PageHeader
        title={caseTitle}
        back={{ href: '/rfp', label: RFP_LIST.title }}
        actions={(
          <>
            <NbButton variant={mode === 'work' ? 'primary' : 'ghost'} onClick={() => setMode('work')}>
              {RFP_REPORT.viewWork}
            </NbButton>
            <NbButton variant={mode === 'report' ? 'primary' : 'ghost'} onClick={() => setMode('report')}>
              {RFP_REPORT.viewReport}
            </NbButton>
            <NbButton variant="ghost" href={`/api/rfp/cases/${caseId}/export?mode=${mode}`}>
              {RFP_REPORT.exportMd}
            </NbButton>
            <NbButton variant="ghost" onClick={() => setCrossOpen(true)}>
              {RFP_REPORT.crossVerify}
            </NbButton>
          </>
        )}
      />

      {/* AI 기본법 투명성 의무 — 화면에도 붙는다 */}
      <NbBadge status="note">{AI_NOTICE}</NbBadge>
      <NbBadge status="note">{DOC_CLASS_LABEL[docClass]}</NbBadge>

      <div className={styles.reportGrid}>
        <div className={styles.stack}>
          {fit && (
            <section className="card">
              <div className={styles.sectionHead}>
                <span className={styles.sectionTitle}>{RFP_REPORT.fit}</span>
              </div>
              <div className={styles.statGrid}>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>{RFP_REPORT.fitScore}</span>
                  <span className={styles.statValue}>{fit.score}</span>
                </div>
                <div className={styles.stat}>
                  <span className={styles.statLabel}>{RFP_REPORT.fit}</span>
                  <span className={styles.statValue}>{FIT_VERDICT_LABEL[fit.verdict]}</span>
                </div>
              </div>
              {fit.conditional && <NbBadge status="doing">{RFP_REPORT.noEvidence}</NbBadge>}
            </section>
          )}

          {/* 절이 카드고 값은 그 안의 한 줄이다. 순서는 사업을 판단하는 순서(개요→예산→일정…) */}
          {orderSections(SECTIONS.map((s) => String(s.key))).map((sectionKey) => {
            const bucket = report[sectionKey as keyof typeof report] as Record<string, ValueNode<unknown>>
            const entries = Object.entries(bucket ?? {})
              .filter(([, v]) => v?.value !== null && v?.value !== undefined)
            if (entries.length === 0) return null
            const byKey = new Map(entries)
            return (
              <section key={sectionKey} className="card">
                <div className={styles.sectionHead}>
                  <div className={styles.between}>
                    <span className={styles.sectionTitle}>{sectionLabel(sectionKey)}</span>
                    <NbBadge status="note">{entries.length}</NbBadge>
                  </div>
                </div>
                <div className={styles.valueList}>
                  {orderFields(Array.from(byKey.keys())).map((key) => (
                    <ReportCard
                      key={key}
                      fieldKey={key}
                      node={byKey.get(key) as ValueNode<unknown>}
                      mode={mode}
                      onOpenEvidence={setActiveBlock}
                    />
                  ))}
                </div>
              </section>
            )
          })}

          {anomalies.length > 0 && (
            <section className="card">
              <div className={styles.sectionHead}>
                <div className={styles.between}>
                  <span className={styles.sectionTitle}>{RFP_REPORT.anomalies}</span>
                  <NbBadge status="note">{anomalies.length}</NbBadge>
                </div>
              </div>
              <div className={styles.valueList}>
                {anomalies.map((a, i) => (
                  <div key={`${a.title}-${i}`} className={styles.valueRow}>
                    <span className={styles.valueName}>
                      {a.severity ? ANOMALY_SEVERITY_LABEL[a.severity] : ''}
                    </span>
                    <div className={styles.valueBody}>
                      <span className={styles.valueText}>{a.title}</span>
                      <span className={styles.sectionDesc}>{a.rationale}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className={styles.stack}>
          {/* 원문은 화면에 붙어 따라온다 — 근거를 누를 때마다 위로 올라가면 못 쫓는다 */}
          <div className={styles.sourceSticky}>
            <SourceViewer blocks={blocks} activeBlockId={activeBlock} />
          </div>

          {crossOpen && (
            <CrossVerifyDialog
              caseId={caseId}
              candidates={crossFields}
              vendors={vendors}
              onClose={() => setCrossOpen(false)}
            />
          )}

          {/* 참여 결정과 결과 — 안 적으면 「우리 판정이 맞았나」에 영영 답할 수 없다 */}
          <OutcomeForm caseId={caseId} initial={outcome} />

          {revisions.length > 0 && (
            <RevisionDiffPanel
              chain={revisions}
              changes={[]}
              critical={[]}
              summary={null}
              onOpenEvidence={setActiveBlock}
            />
          )}
        </div>
      </div>
    </main>
  )
}
