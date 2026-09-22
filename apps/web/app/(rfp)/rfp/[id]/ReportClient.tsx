'use client'

// 리포트 화면 — 항목 카드와 원문 뷰어를 나란히 놓는다.
//
// 근거를 누르면 오른쪽 뷰어가 그 블록으로 간다. 두 화면을 오가지 않아도
// 「이 값이 원문 어디서 왔나」가 한 번에 보여야 한다.

import { GeneratedNotice } from '@ax/ai-react'
import { AI_LABELS } from '@/lib/terms'
import { useMemo, useState } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import ReportCard from '@/components/rfp/ReportCard'
import ReportSheet from '@/components/rfp/ReportSheet'
import DocSurface from '@/components/ui/doc/DocSurface'
import { sectionLabel, orderFields, orderSections } from '@/lib/rfp/report/field-labels'
import styles from '@/app/(rfp)/rfp.module.css'
import SourceViewer, { type SourceBlock } from '@/components/rfp/SourceViewer'
import OutcomeForm, { type OutcomeFormProps } from '@/components/rfp/OutcomeForm'
import RevisionDiffPanel, { type RevisionChainItem } from '@/components/rfp/RevisionDiffPanel'
import CrossVerifyDialog, { type CrossField } from '@/components/rfp/CrossVerifyDialog'
import {
  RFP_REPORT, RFP_LIST, DOC_CLASS_LABEL, FIT_VERDICT_LABEL, RFP_FAILURE_REASON,
  ANOMALY_SEVERITY_LABEL, type AnomalySeverity, type FitVerdict,
} from '@/lib/rfp/terms'
import { taskFace, type MissingSection } from '@/lib/rfp/analyze/failure-reason'
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
  /** 케이스 단계 — 리포트가 없을 때 어디까지 왔는지 */
  stage: string
  /** 리포트가 없는 이유를 말하기 위한 사실들 */
  progress: {
    fileCount: number
    runningJob: string | null
    deadJob: { jobType: string; error: string } | null
    /** 잡은 끝났는데 못 만든 절 — 빈 절과 못 만든 절은 다른 것이다 */
    missing: MissingSection[]
    noticeUrl: string | null
  }
}

export default function ReportClient({
  caseId, caseTitle, docClass, report, blocks, stage, progress, fit, outcome, revisions, vendors,
}: ReportClientProps) {
  const [mode, setMode] = useState<'work' | 'report'>('work')
  const [activeBlock, setActiveBlock] = useState<string | null>(null)
  const [crossOpen, setCrossOpen] = useState(false)
  /** 보고용 미리보기 — 종이로 나가는 것은 이 안에서만 */
  const [preview, setPreview] = useState(false)

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
    /*
      **왜 리포트가 없는지 말한다.** 셋은 서로 다른 상황이고 사람이 할 다음 행동도 다르다 —
      「아직 리포트가 없어요」만 보면 무엇을 해야 할지 알 수 없다(실측 2026-09-10).
    */
    const empty = progress.fileCount === 0
      ? { title: RFP_REPORT.noFiles, desc: RFP_REPORT.noFilesDesc }
      : progress.deadJob
        ? { title: RFP_REPORT.analysisFailed, desc: progress.deadJob.error || RFP_REPORT.analysisFailedDesc }
        : progress.runningJob
          ? { title: RFP_REPORT.analyzing, desc: `${RFP_REPORT.analyzingDesc} (${progress.runningJob})` }
          : { title: RFP_REPORT.notReady, desc: RFP_REPORT.notReadyDesc }

    return (
      <main className="page-inner">
        <PageHeader title={caseTitle} back={{ href: '/rfp', label: RFP_LIST.title }} />
        <EmptyState title={empty.title} description={empty.desc} />

        {/* 다음 행동을 준다 — 공고를 열어 첨부를 직접 받거나, 파일을 올리거나 */}
        {progress.fileCount === 0 && (
          <div className={styles.actions}>
            {progress.noticeUrl && (
              <NbButton variant="secondary" href={progress.noticeUrl} target="_blank">
                {RFP_REPORT.openNotice}
              </NbButton>
            )}
            <NbButton href="/rfp/new">{RFP_REPORT.uploadFiles}</NbButton>
          </div>
        )}
        {/*
          리포트가 없어도 결과는 적을 수 있어야 한다 —
          「분석은 안 돌렸지만 안 내기로 했다」도 학습의 정답지다
        */}
        <OutcomeForm caseId={caseId} initial={outcome} />
      </main>
    )
  }

  /*
    못 만든 절 — 작업 이름과 사유를 화면 말로 바꿔 둔다.
    모르는 작업 id 는 버린다(옛 기록). 버린 것까지 세면 「셋을 못 만들었다」인데
    목록에는 둘만 있는 화면이 된다.
  */
  const missing = progress.missing
    .map((m) => ({ ...m, face: taskFace(m.taskId) }))
    .filter((m): m is MissingSection & { face: { title: string; section: string } } => m.face !== null)

  /** 절 이름 → 그 절을 못 만든 사유. 절 카드가 자기 자리에서 말할 수 있게 */
  const missingBySection = new Map(missing.map((m) => [m.face.section, m]))

  // 확인 안 된 값이 몇 개인가 — 보고용에서 「왜 흐린지」를 수로 밝힌다
  const unconfirmed = SECTIONS.reduce((n, sec) => {
    const bucket = report[sec.key as keyof typeof report] as Record<string, ValueNode<unknown>>
    return n + Object.values(bucket ?? {}).filter(
      (v) => v?.value !== null && v?.value !== undefined && v?.grounding === 'unconfirmed',
    ).length
  }, 0)

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
            {/* 보고용은 **읽는 화면**이다. 작업 도구를 남기면 보고서가 아니라
                근거만 숨긴 작업 화면이 된다.
                인쇄는 DocSurface 안에서만 — 화면을 그대로 인쇄하면 사이드바와
                회색 앱 배경이 종이에 찍힌다(가드: doc-export-standard) */}
            {mode === 'report' ? (
              <NbButton variant="ghost" onClick={() => setPreview(true)}>
                {RFP_REPORT.preview}
              </NbButton>
            ) : (
              <NbButton variant="ghost" onClick={() => setCrossOpen(true)}>
                {RFP_REPORT.crossVerify}
              </NbButton>
            )}
          </>
        )}
      />

      {/* AI 기본법 투명성 의무 — 화면에도 붙는다 */}
      <div className={styles.row}>
        <NbBadge status="note"><GeneratedNotice labels={AI_LABELS} /></NbBadge>
        <NbBadge status="note">{DOC_CLASS_LABEL[docClass]}</NbBadge>
        {/* 보고용에서 값이 흐린 이유를 **수로** 밝힌다.
            근거 배지를 숨겨 놓고 흐리게만 그리면, 보고 받는 사람은 왜 흐린지 모른 채
            확인 안 된 값을 확인된 값과 나란히 읽는다 */}
        {mode === 'report' && unconfirmed > 0 && (
          <NbBadge status="blocker">{RFP_REPORT.unconfirmedCount} {unconfirmed}</NbBadge>
        )}
      </div>

      {/* 종이로 나가는 것 — **화면에서 보는 것과 같은 것**이다.
          미리보기가 앱 셸을 걷어내므로 사이드바·회색 배경이 종이에 안 찍힌다 */}
      {preview && (
        <DocSurface
          title={caseTitle}
          onClose={() => setPreview(false)}
          actions={
            <NbButton variant="ghost" onClick={() => window.print()}>
              {RFP_REPORT.print}
            </NbButton>
          }
        >
          <ReportSheet
            report={report}
            anomalies={anomalies}
            fit={fit}
            caseTitle={caseTitle}
            docClass={docClass}
          />
        </DocSurface>
      )}

      <div className={mode === 'report' ? styles.stack : styles.reportGrid}>
        <div className={styles.stack}>
          {/*
            **일부만 됐다**를 맨 위에서 말한다.

            분석은 절 단위로 따로 돌아서 잡은 성공인데 절은 실패할 수 있다.
            그 절은 값이 0이라 아래에서 아예 안 그려지고, 사용자는 그 절이
            «원문에 없었다»고 읽는다. 「이상 조항 없음」으로 읽힌 실측이 있다(2026-09-22).
            보고용에서도 그대로 보인다 — 빠진 채로 보고되면 안 되는 사실이다.
          */}
          {missing.length > 0 && (
            <section className="card">
              <div className={styles.sectionHead}>
                <div className={styles.between}>
                  <span className={styles.sectionTitle}>{RFP_REPORT.missingSome}</span>
                  <NbBadge status="blocker">{missing.length}</NbBadge>
                </div>
                <span className={styles.sectionDesc}>{RFP_REPORT.missingSomeDesc}</span>
              </div>
              <div className={styles.valueList}>
                {missing.map((m) => (
                  <div key={m.taskId} className={styles.valueRow}>
                    <span className={styles.valueName}>{m.face.title}</span>
                    <div className={styles.valueBody}>
                      <span className={styles.valueText}>{RFP_FAILURE_REASON[m.reason]}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

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
            const miss = missingBySection.get(sectionKey)
            /*
              **비어 있는 것과 못 만든 것은 다르다.**

              값이 0인데 분석은 성공했다면 원문에 없던 것이다 — 지금처럼 안 그린다.
              못 만든 절은 그린다. 안 그리면 「원문에 없었다」와 똑같이 보이고,
              사용자는 없는 것을 확인했다고 읽는다.
            */
            if (entries.length === 0) {
              if (!miss) return null
              return (
                <section key={sectionKey} className="card">
                  <div className={styles.sectionHead}>
                    <div className={styles.between}>
                      <span className={styles.sectionTitle}>{sectionLabel(sectionKey)}</span>
                      <NbBadge status="blocker">{RFP_REPORT.missingOne}</NbBadge>
                    </div>
                    <span className={styles.sectionDesc}>{RFP_FAILURE_REASON[miss.reason]}</span>
                  </div>
                </section>
              )
            }
            const byKey = new Map(entries)
            return (
              <section key={sectionKey} className="card">
                <div className={styles.sectionHead}>
                  <div className={styles.between}>
                    <span className={styles.sectionTitle}>{sectionLabel(sectionKey)}</span>
                    <NbBadge status={miss ? 'blocker' : 'note'}>{entries.length}</NbBadge>
                  </div>
                  {/* 일부는 됐고 일부는 못 됐다 — 값이 있다고 다 본 것이 아니다 */}
                  {miss && <span className={styles.sectionDesc}>{RFP_FAILURE_REASON[miss.reason]}</span>}
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

          {/*
            이상 조항은 **없다고 말하는 것 자체가 판단**이다.
            못 봤는데 안 그리면 「이상 없음」으로 읽힌다 — 실측 2026-09-22 이 자리가 그랬다
          */}
          {anomalies.length === 0 && missingBySection.has('anomalies') && (
            <section className="card">
              <div className={styles.sectionHead}>
                <div className={styles.between}>
                  <span className={styles.sectionTitle}>{RFP_REPORT.anomalies}</span>
                  <NbBadge status="blocker">{RFP_REPORT.missingOne}</NbBadge>
                </div>
                <span className={styles.sectionDesc}>
                  {RFP_FAILURE_REASON[missingBySection.get('anomalies')!.reason]}
                </span>
              </div>
            </section>
          )}

          {anomalies.length > 0 && (
            <section className="card">
              <div className={styles.sectionHead}>
                <div className={styles.between}>
                  <span className={styles.sectionTitle}>{RFP_REPORT.anomalies}</span>
                  <NbBadge status={missingBySection.has('anomalies') ? 'blocker' : 'note'}>
                    {anomalies.length}
                  </NbBadge>
                </div>
                {missingBySection.has('anomalies') && (
                  <span className={styles.sectionDesc}>
                    {RFP_FAILURE_REASON[missingBySection.get('anomalies')!.reason]}
                  </span>
                )}
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

        {mode === 'work' && (
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
        )}
      </div>
    </main>
  )
}
