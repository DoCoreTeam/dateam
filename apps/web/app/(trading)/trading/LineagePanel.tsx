// app/(trading)/trading/LineagePanel.tsx — 이 「롱」이 어디서 나왔나
//
// 사용자 지시 2026-09-29: 「어떤 AI모델이 어떤 데이터를 참조해서 어떻게 물었는지
// 그리고 어떻게 답이 나와서 결론적으로 화면에 뭘로 표시 하는지」
//
// **AI 줄을 눈에 띄게 가른다.** 여덟 걸음 중 모델이 답하는 것은 한 줄뿐이고 나머지는
// 같은 입력이면 같은 답이 나오는 코드다. 그 사실이 색으로 읽혀야 「AI 가 이상한 소리를
// 했나」와 「우리 코드가 잘못 셌나」를 사람이 가를 수 있다.

import { GitBranch } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import type { Lineage, LineageStep } from '@/lib/trading/judge/lineage'
import { LINEAGE_ACTOR_LABEL } from '@/lib/trading/judge/lineage'
import type { JevStatus } from '@/lib/trading/overview-shape'
import { seoulTimeText } from '@/lib/trading/position-labels'
import JevPanel from './JevPanel'
import styles from './LineagePanel.module.css'

function Step({ step }: { step: LineageStep }) {
  const isAi = step.actor === 'ai'
  return (
    <li className={`${styles.step} ${isAi ? styles.aiStep : ''} ${styles[step.tone]}`}>
      <div className={styles.rail}>
        <span className={styles.no}>{step.no}</span>
      </div>
      <div className={styles.who}>
        <span className={`${styles.kind} ${styles[`kind-${step.actor}`]}`}>{LINEAGE_ACTOR_LABEL[step.actor]}</span>
        <span className={styles.name}>{step.name}</span>
        <span className={styles.where}>{step.where}</span>
      </div>
      <dl className={styles.detail}>
        <div className={styles.line}>
          <dt>참조</dt>
          <dd>{step.referenced}</dd>
        </div>
        <div className={styles.line}>
          <dt>한 것</dt>
          <dd>{step.did}</dd>
        </div>
        <div className={styles.line}>
          <dt>낸 것</dt>
          <dd className={styles.produced}>{step.produced}</dd>
        </div>
        {/* 물음과 답은 원문 그대로. 줄바꿈을 살려야 무엇을 보냈는지가 읽힌다 */}
        {step.detail && <pre className={styles.slab}>{step.detail}</pre>}
      </dl>
    </li>
  )
}

export default function LineagePanel({ lineage, jev }: { lineage: Lineage; jev: JevStatus }) {
  return (
    <>
      {/*
        **AI 가 왜 안 도는지는 이 칸의 일이다.** 따로 칸을 세우면 같은 주제가 두 곳에
        생기고, 화면은 그만큼 길어진다. 켜져 있으면 아무것도 안 그린다
      */}
      <JevPanel jev={jev} />
      <section className={`card ${styles.panel}`}>
      <div className={styles.head}>
        <h2 className={styles.title}>이 예측이 어디서 나왔나</h2>
        {lineage.barAt && (
          <span className={styles.meta}>
            {`${seoulTimeText(lineage.barAt)} 봉 · ${lineage.model} · ${lineage.promptVersion}`}
          </span>
        )}
      </div>
      {/*
        **여덟 걸음 중 AI 는 한 줄뿐이라는 것을 먼저 말한다.**
        그것을 모르면 화면 전체가 「AI 가 한 일」로 읽힌다
      */}
      <p className={styles.note}>
        가장 최근 판단 한 건을 걸음마다 폈습니다. 이 중 AI 가 답한 것은 한 줄뿐이고,
        나머지는 같은 값을 넣으면 늘 같은 답이 나오는 코드입니다
      </p>
      {lineage.unavailable
        ? (
          <EmptyState
            icon={<GitBranch size={28} />}
            title="아직 펼칠 판단이 없습니다"
            description={lineage.unavailable}
          />
        )
        : <ol className={styles.chain}>{lineage.steps.map((s) => <Step key={s.no} step={s} />)}</ol>}
      </section>
    </>
  )
}
