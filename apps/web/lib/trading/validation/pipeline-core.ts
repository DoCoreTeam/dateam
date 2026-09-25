/**
 * 검증 파이프라인의 **순서** — 순수 함수 (명세 §13)
 *
 * ## 왜 순서가 규칙의 전부인가
 *
 * 1-B 의 부품은 각자 맞아도 **순서가 틀리면 전부 거짓**이 된다.
 *   · 보정을 검증 구간 자료로 맞추면 그 검증은 자기 답을 보고 푸는 것이다
 *   · 기대값표를 전체 구간으로 만들면 같은 일이 한 번 더 일어난다
 *   · Lockbox 를 먼저 열면 마지막 확인이라는 뜻이 사라진다
 *
 * 그 순서를 여기 한 곳에 적고, **시험이 그 순서를 지킨다.**
 * 실제 DB 와 KIS 를 붙인 자리(`pipeline.ts`)는 이 계획을 그대로 따라 돌기만 한다.
 */

import type { Fold, WalkForwardPlan } from '../backtest/windows.ts'

export type StepKind =
  | 'backtest_train'
  | 'calibrate'
  | 'build_ev'
  | 'backtest_validate'
  | 'compare_judges'
  | 'evaluate_gate'

export interface PipelineStep {
  kind: StepKind
  /** 몇 번째 접기인가. 접기와 무관한 단계는 null */
  foldIndex: number | null
  /** 이 단계가 읽어도 되는 구간 */
  windowFrom: string
  windowTo: string
  /** 사람이 읽을 한 줄 */
  label: string
}

/**
 * 계획을 단계 목록으로 편다.
 *
 * 접기마다 **학습 → 보정 → 기대값표 → 검증** 넷이 이 순서로 돈다.
 * 보정과 기대값표가 학습 백테스트 **뒤**이고 검증 백테스트 **앞**인 것이 핵심이다 —
 * 뒤집히면 검증 구간을 보고 만든 모델로 그 검증 구간을 평가하게 된다.
 */
export function planSteps(plan: WalkForwardPlan): PipelineStep[] {
  const steps: PipelineStep[] = []
  for (const fold of plan.folds) {
    steps.push(
      step('backtest_train', fold, fold.trainFrom, fold.trainTo, `${fold.index + 1}겹 학습 백테스트`),
      step('calibrate', fold, fold.trainFrom, fold.trainTo, `${fold.index + 1}겹 보정`),
      step('build_ev', fold, fold.trainFrom, fold.trainTo, `${fold.index + 1}겹 기대값표`),
      step('backtest_validate', fold, fold.validateFrom, fold.validateTo, `${fold.index + 1}겹 검증 백테스트`),
    )
  }
  steps.push({
    kind: 'compare_judges', foldIndex: null,
    windowFrom: plan.developFrom, windowTo: plan.developTo, label: '판단기 비교',
  })
  steps.push({
    kind: 'evaluate_gate', foldIndex: null,
    windowFrom: plan.developFrom, windowTo: plan.developTo, label: '관문 판정',
  })
  return steps
}

function step(kind: StepKind, fold: Fold, from: string, to: string, label: string): PipelineStep {
  return { kind, foldIndex: fold.index, windowFrom: from, windowTo: to, label }
}

export type OrderRejection = { reason: string; userMessage: string }

/**
 * 이 순서가 맞나 — **돌리기 전에** 확인한다.
 *
 * 한 번이라도 어긋난 순서로 돌면 그 결과가 DB 에 남고, 나중에 그 숫자를 보는 사람은
 * 어긋났다는 사실을 알 길이 없다.
 */
export function checkStepOrder(steps: readonly PipelineStep[]): OrderRejection | null {
  const byFold = new Map<number, PipelineStep[]>()
  for (const s of steps) {
    if (s.foldIndex === null) continue
    const list = byFold.get(s.foldIndex) ?? []
    list.push(s)
    byFold.set(s.foldIndex, list)
  }

  for (const [index, foldSteps] of byFold) {
    const kinds = foldSteps.map((s) => s.kind)
    const want: StepKind[] = ['backtest_train', 'calibrate', 'build_ev', 'backtest_validate']
    if (kinds.length !== want.length || kinds.some((k, i) => k !== want[i])) {
      return {
        reason: `fold_${index}_step_order:${kinds.join('>')}`,
        userMessage: `${index + 1}겹의 단계 순서가 틀렸습니다. `
          + `보정과 기대값표는 학습 뒤, 검증 앞이어야 합니다`,
      }
    }

    const train = foldSteps.filter((s) => s.kind !== 'backtest_validate')
    const validate = foldSteps.find((s) => s.kind === 'backtest_validate')
    if (!validate) continue
    for (const t of train) {
      if (t.windowTo >= validate.windowFrom) {
        return {
          reason: `fold_${index}_window_overlap:${t.kind}`,
          userMessage: `${index + 1}겹의 ${t.label} 구간이 검증 구간과 겹칩니다. `
            + `검증 구간을 보고 만든 모델로 그 검증 구간을 평가하게 됩니다`,
        }
      }
    }
  }

  // 관문은 맨 뒤다. 앞에 있으면 아직 안 만든 것으로 판정한다
  const gateAt = steps.findIndex((s) => s.kind === 'evaluate_gate')
  if (gateAt !== steps.length - 1) {
    return { reason: 'gate_not_last', userMessage: '관문 판정이 마지막이 아닙니다' }
  }
  return null
}

/** 이 단계가 읽어도 되는 구간인가. 파이프라인이 한 발짝마다 묻는다 */
export function stepMayRead(step: PipelineStep, tradeDate: string): boolean {
  return tradeDate >= step.windowFrom && tradeDate <= step.windowTo
}

export interface PipelineProgress {
  total: number
  done: number
  currentLabel: string | null
  failed: { label: string; reason: string }[]
}

export function initialProgress(steps: readonly PipelineStep[]): PipelineProgress {
  return { total: steps.length, done: 0, currentLabel: steps[0]?.label ?? null, failed: [] }
}
