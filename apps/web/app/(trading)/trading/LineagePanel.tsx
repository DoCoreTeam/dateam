// app/(trading)/trading/LineagePanel.tsx — 이 판단이 어디서 나왔나
//
// 사용자 지시 2026-09-29: 「어떤 AI모델이 어떤 데이터를 참조해서 어떻게 물었는지
// 그리고 어떻게 답이 나와서 결론적으로 화면에 뭘로 표시 하는지」
//
// 사용자 지적 2026-09-30: 「이거 무슨말인지 하나도 모르겠네 AI 스럽게 또 이야기 하네
// 참 답답하네 그리고 자리 너무 많이 차지해 로그는 접었다폈다 할 수 있어야 하고
// 이 부분 자체를 하나의 박스에서 다 보여지게 해줘 내용도 축약하고 실제 명령은 접었다 폈다」
//
// ## 그래서 한 걸음이 한 줄이다
//
// 전에는 걸음마다 「참조 / 한 것 / 낸 것」 세 줄에 물음 원문까지 펼쳐 놓아, 여덟 걸음이
// 화면 여러 장을 먹었다. 늘 펼쳐져 있는 글은 **아무도 안 읽는다** — 읽을 것과 안 읽을 것을
// 사람이 매번 골라내야 하기 때문이다.
//
// 지금은 한 줄에 **번호 · 종류 · 이름 · 낸 것**만 있다. 나머지(무엇을 봤나 · 무엇을 했나 ·
// 어느 파일 · 물음 원문)는 그 줄을 펴야 나온다. 원문은 기본이 닫힘이다.
//
// **AI 줄은 색으로 가른다.** 여덟 걸음 중 모델이 답하는 것은 한 줄뿐이고 나머지는
// 같은 입력이면 같은 답이 나오는 코드다. 그 사실이 안 보이면 화면 전체가 「AI 가 한 일」로
// 읽히고, 그때는 「AI 가 이상한 소리를 했나」와 「우리 코드가 잘못 셌나」를 가를 수 없다.

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
      {/* 한 줄 — 번호 · 종류 · 이름 · 낸 것. 여기까지가 훑어 읽는 분량이다 */}
      <span className={styles.no}>{step.no}</span>
      <span className={`${styles.kind} ${styles[`kind-${step.actor}`]}`}>{LINEAGE_ACTOR_LABEL[step.actor]}</span>
      <span className={styles.name}>{step.name}</span>
      <span className={styles.produced}>{step.produced}</span>
      {/*
        **나머지는 펴야 나온다.** 늘 펼쳐 두면 화면이 길어지고, 긴 화면은 안 읽힌다.
        물음 원문(`detail`)은 이 안에서도 한 겹 더 접는다 — 수십 줄이라 펴는 순간
        걸음 목록이 다시 사라지기 때문이다.
      */}
      <details className={styles.more}>
        <summary className={styles.summary}>자세히</summary>
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
            <dt>어디</dt>
            <dd className={styles.where}>{step.where}</dd>
          </div>
        </dl>
        {step.detail && (
          <details className={styles.raw}>
            <summary className={styles.summary}>실제 보낸 글 보기</summary>
            {/* 줄바꿈을 살려야 무엇을 보냈는지가 읽힌다 */}
            <pre className={styles.slab}>{step.detail}</pre>
          </details>
        )}
      </details>
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
          <h2 className={styles.title}>이 판단이 어떻게 나왔나</h2>
          {lineage.barAt && (
            <span className={styles.meta}>
              {`${seoulTimeText(lineage.barAt)} 봉 · ${lineage.model}`}
            </span>
          )}
        </div>
        {/*
          **여덟 걸음 중 AI 는 한 줄뿐이라는 것을 먼저 말한다.**
          그것을 모르면 화면 전체가 「AI 가 한 일」로 읽힌다
        */}
        <p className={styles.note}>AI 가 답한 것은 한 줄뿐이고 나머지는 계산입니다. 각 줄을 펴면 무엇을 보고 했는지가 나옵니다</p>
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
