/**
 * 워크포워드 구간 나누기 — **학습은 언제나 검증보다 앞이다** (명세 §13.3)
 *
 * ## 왜 한 번 나누고 끝이 아닌가
 *
 * 전체를 학습·검증으로 한 번만 가르면 검증 구간은 딱 한 장(場)이다. 그 장에서 잘 됐다는
 * 것과 앞으로 잘 된다는 것은 다른 이야기다. 구간을 굴리며 여러 번 재야
 * 「어떤 장에서는 되고 어떤 장에서는 안 되는가」가 보인다.
 *
 * ## 순서가 뒤집히면 미래를 배운다
 *
 * 학습 구간이 검증 구간보다 뒤에 있으면 그 모델은 **답을 보고 문제를 푼 것**이다.
 * 이것은 실수로 일어난다 — 날짜를 거꾸로 정렬하거나, 마지막 구간을 학습으로 두거나.
 * 그래서 만들 때마다 확인한다.
 *
 * ## 모자라면 줄이지 않고 거부한다
 *
 * 구간이 모자랄 때 접는 수를 조용히 줄이면, 한 바퀴만 돌고도 「워크포워드를 했다」가 된다.
 * 모자라면 **왜 모자란지**를 말하고 멈춘다.
 */

export interface Fold {
  index: number
  trainFrom: string
  trainTo: string
  validateFrom: string
  validateTo: string
}

export interface WalkForwardPlan {
  folds: Fold[]
  /** 개발 구간(학습·검증이 도는 자리) */
  developFrom: string
  developTo: string
  /** 최종 검증 구간. 개발 구간과 안 겹친다 */
  lockboxFrom: string
  lockboxTo: string
}

export type WindowRejection = { reason: string; userMessage: string }

export interface WalkForwardInput {
  /** 거래일 목록, 오름차순. 달력 날이 아니라 **실제 거래일**이다 */
  tradeDates: readonly string[]
  /** 접는 수 */
  foldCount: number
  /** 한 접기의 검증 구간 길이(거래일) */
  validateDays: number
  /** 최소 학습 거래일 */
  minTrainDays: number
  /** Lockbox 로 떼어 둘 마지막 거래일 수 */
  lockboxDays: number
}

/**
 * 구간을 나눈다.
 *
 * 마지막 `lockboxDays` 를 떼어 Lockbox 로 두고, 나머지 안에서 접기를 만든다.
 * 각 접기의 학습은 **그 접기의 검증 시작 직전까지**다 — 늘어나는 창(expanding window)이라
 * 뒤로 갈수록 학습 자료가 많아진다.
 */
export function planWalkForward(
  input: WalkForwardInput,
): { plan: WalkForwardPlan } | { rejection: WindowRejection } {
  /**
   * **들어온 그대로가 오름차순인지** 본다.
   *
   * 정렬한 사본과 비교하지 않으면 거꾸로 들어온 목록이 그대로 통과한다 —
   * 그리고 거꾸로 정렬은 미래를 배우는 가장 흔한 경로다(마지막 구간이 학습이 된다).
   */
  const dates = [...input.tradeDates]
  const sorted = [...dates].sort()
  const outOfOrder = dates.some((d, i) => d !== sorted[i])
  const duplicated = sorted.some((d, i) => i > 0 && d === sorted[i - 1])
  if (outOfOrder || duplicated) {
    return {
      rejection: {
        reason: 'dates_not_unique_sorted',
        userMessage: duplicated
          ? '거래일 목록에 같은 날이 두 번 있습니다'
          : '거래일 목록이 오름차순이 아닙니다. 거꾸로 들어오면 마지막 구간이 학습이 되어 미래를 배웁니다',
      },
    }
  }
  if (input.foldCount < 1) {
    return { rejection: { reason: 'fold_count_below_one', userMessage: '접는 수는 1 이상이어야 합니다' } }
  }

  const needed = input.lockboxDays + input.minTrainDays + input.foldCount * input.validateDays
  if (dates.length < needed) {
    return {
      rejection: {
        reason: `not_enough_days:${dates.length}<${needed}`,
        userMessage: `거래일이 ${dates.length}일뿐입니다. `
          + `${input.foldCount}겹 워크포워드에는 최소 ${needed}일이 필요합니다 `
          + `(Lockbox ${input.lockboxDays} + 학습 ${input.minTrainDays} + 검증 ${input.foldCount}×${input.validateDays})`,
      },
    }
  }

  const developEnd = dates.length - input.lockboxDays
  const folds: Fold[] = []
  for (let i = 0; i < input.foldCount; i += 1) {
    /**
     * 뒤에서부터 검증 구간을 떼어 낸다. 마지막 접기의 검증이 개발 구간의 끝에 붙고,
     * 그 앞으로 하나씩 당겨진다.
     */
    const validateEnd = developEnd - (input.foldCount - 1 - i) * input.validateDays
    const validateStart = validateEnd - input.validateDays
    if (validateStart < input.minTrainDays) {
      return {
        rejection: {
          reason: `fold_${i}_train_too_short:${validateStart}<${input.minTrainDays}`,
          userMessage: `${i + 1}번째 접기의 학습 구간이 ${validateStart}일뿐입니다 (최소 ${input.minTrainDays}일)`,
        },
      }
    }
    folds.push({
      index: i,
      trainFrom: dates[0],
      trainTo: dates[validateStart - 1],
      validateFrom: dates[validateStart],
      validateTo: dates[validateEnd - 1],
    })
  }

  return {
    plan: {
      folds,
      developFrom: dates[0],
      developTo: dates[developEnd - 1],
      lockboxFrom: dates[developEnd],
      lockboxTo: dates[dates.length - 1],
    },
  }
}

/**
 * 순서가 맞나 — **만들 때마다 확인한다.**
 *
 * 학습이 검증보다 앞이고, Lockbox 가 개발 구간과 안 겹쳐야 한다.
 * 이 함수가 실패를 돌려주는 계획은 어디에도 넘기지 않는다.
 */
export function checkOrder(plan: WalkForwardPlan): WindowRejection | null {
  for (const fold of plan.folds) {
    if (fold.trainTo >= fold.validateFrom) {
      return {
        reason: `fold_${fold.index}_train_not_before_validate`,
        userMessage: `${fold.index + 1}번째 접기의 학습이 검증보다 뒤에 있습니다. 그 모델은 답을 보고 푼 것입니다`,
      }
    }
    if (fold.validateFrom > fold.validateTo) {
      return { reason: `fold_${fold.index}_validate_reversed`, userMessage: '검증 구간이 뒤집혀 있습니다' }
    }
  }
  if (plan.lockboxFrom <= plan.developTo) {
    return {
      reason: 'lockbox_overlaps_develop',
      userMessage: '최종 검증 구간이 개발 구간과 겹칩니다. 이미 본 자료로 마지막 확인을 하게 됩니다',
    }
  }
  return null
}
