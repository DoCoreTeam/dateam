/**
 * 판단 계보 — **이 「롱」이 어디서 나왔나**
 *
 * 사용자 지시 2026-09-29: 「어떤 AI모델이 어떤 데이터를 참조해서 어떻게 물었는지
 * 그리고 어떻게 답이 나와서 결론적으로 화면에 뭘로 표시 하는지」.
 *
 * ## 물음을 저장하지 않고 되살린다
 *
 * `buildJevPrompt` 는 같은 입력이면 늘 같은 문장을 만든다. 그러니 긴 글자를 표에 쌓을
 * 것이 아니라 **그 봉의 지표로 다시 조립하면** 같은 문장이 나온다. 같은 사실을 두 곳에
 * 쌓으면 둘이 갈리는 날이 오고, 그날 어느 쪽이 진짜인지 아무도 모른다.
 *
 * ## 뒤 봉을 안 섞는다
 *
 * 지표는 **그 판단의 봉까지만** 본다(`planBaseAt` 과 같은 규칙). 지금 봉으로 다시 조립하면
 * 그때 세울 수 없던 물음이 화면에 뜨고, 그것은 기록이 아니라 지어낸 것이다.
 *
 * ## 여덟 걸음 중 AI 는 한 줄이다
 *
 * 나머지는 전부 같은 입력이면 같은 답이 나오는 코드다. 그 사실이 화면에서 갈려야
 * 「AI 가 이상한 소리를 했나」와 「우리 코드가 잘못 셌나」를 사람이 가를 수 있다.
 */

import { computeIndicators, requiredBarCount, evaluateTriggers, type TriggerParams } from './indicators.ts'
import { buildJevPrompt, JEV_PROMPT_VERSION } from './jev-prompt.ts'
import { leaningOf, LEANING_LABEL } from '../judgment-labels.ts'
import type { MinuteBarInput } from '../bars/confirm.ts'
import type { JudgeInput } from './types.ts'

/** 누가 한 걸음인가. 코드와 AI 를 색으로 가르는 것이 이 칸의 핵심이다 */
export type LineageActor = 'code' | 'ai' | 'view'

/**
 * 걸음의 주인을 사람 말로. **화면 파일이 아니라 여기 둔다** —
 * 라벨 표가 화면에 있으면 같은 개념이 화면마다 다른 말이 된다(용어집 §00)
 */
export const LINEAGE_ACTOR_LABEL: Record<LineageActor, string> = {
  code: '코드',
  ai: 'AI 모델',
  view: '화면',
}

export interface LineageStep {
  no: number
  actor: LineageActor
  /** 사람이 읽을 이름 */
  name: string
  /** 어느 파일이 한 일인가. 고칠 곳을 짚어 준다 */
  where: string
  /** 무엇을 보고 */
  referenced: string
  /** 무엇을 했나 */
  did: string
  /** 무엇을 냈나. 못 냈으면 왜 못 냈는지 */
  produced: string
  /** 여러 줄짜리 원문 (물음·답). 없으면 null */
  detail: string | null
  /** 이 걸음이 정상인가 */
  tone: 'ok' | 'blocked' | 'waiting'
}

export interface LineageInput {
  /** 오래된 것부터. 판단 봉과 그 앞이 들어 있어야 한다 */
  bars: readonly MinuteBarInput[]
  /** 가장 최근 AI 판단. 없으면 null */
  jev: {
    id: string
    barCloseAt: string
    status: string
    rawScore: Record<string, number> | null
    abstainReason: string | null
    modelVersion: string | null
    promptVersion: string | null
    requestAt: string | null
    responseAt: string | null
  } | null
  /** 같은 봉의 규칙 판단. 없으면 null */
  rule: { rawScore: Record<string, number> | null } | null
  /** 지표·조건 설정 */
  params: TriggerParams
  /** 세션이 열린 시각(ISO). 경과 분을 세는 기준. 모르면 null */
  sessionOpenAt: string | null
  /** 설정에 적힌 모델 이름. 기록이 비었을 때 대신 쓴다 */
  configuredModel: string
  /** 설정에 적힌 생각 깊이 */
  reasoningEffort: string
  /** 대기 상한(ms) */
  timeoutMs: number
  /** 신호가 어디서 막혔나. 안 막혔으면 null */
  blocked: { step: number; total: number; reason: string } | null
  /** 화면이 실제로 그린 값 */
  shown: { direction: string; prob: number | null; plan: string | null } | null
}

export interface Lineage {
  /** 이 계보가 어느 봉의 것인가 (ISO). 못 세면 null */
  barAt: string | null
  judgmentId: string | null
  model: string
  promptVersion: string
  steps: LineageStep[]
  /** 계보를 못 세운 이유. 세웠으면 null */
  unavailable: string | null
}

const MINUTE_MS = 60_000

/** 숫자 한 줄. 못 읽으면 물음표 — 지어내지 않는다 */
function num(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '?' : value.toFixed(digits)
}

function empty(reason: string): Lineage {
  return { barAt: null, judgmentId: null, model: '', promptVersion: JEV_PROMPT_VERSION, steps: [], unavailable: reason }
}

/**
 * 한 판단의 계보를 세운다.
 *
 * 못 세우면 **빈 계보와 사유**를 돌려준다 — 조용히 빈 칸을 그리면 화면이 죽은 것처럼 보인다.
 */
export function buildLineage(input: LineageInput): Lineage {
  if (!input.jev) return empty('아직 AI 판단이 없습니다')
  const closeAt = Date.parse(input.jev.barCloseAt)
  if (!Number.isFinite(closeAt)) return empty('판단 시각을 읽지 못했습니다')

  const index = input.bars.findIndex((b) => b.startAt.getTime() === closeAt - MINUTE_MS)
  if (index < 0) return empty('그 판단의 봉을 차트에서 못 찾았습니다')

  const bar = input.bars[index]
  // 그 봉까지만. 뒤 봉을 섞으면 그때 세울 수 없던 물음이 된다
  const seen = input.bars.slice(0, index + 1)
  const need = requiredBarCount(input.params)
  const model = input.jev.modelVersion?.trim() || input.configuredModel
  const promptVersion = input.jev.promptVersion?.trim() || JEV_PROMPT_VERSION

  const steps: LineageStep[] = []
  const add = (s: Omit<LineageStep, 'no'>) => { steps.push({ no: steps.length + 1, ...s }) }

  add({
    actor: 'code',
    name: '봉 수집',
    where: 'jobs/tick.ts',
    referenced: 'trading_bars 1분봉 확정분',
    did: '판단 봉이 닫힌 것을 확인하고 앞 봉들을 꺼냄',
    produced: `봉 ${seen.length}개 (지표에 최소 ${need}개 필요)`,
    detail: null,
    tone: seen.length >= need ? 'ok' : 'blocked',
  })

  const indicators = seen.length >= need ? computeIndicators(seen, input.params) : null
  add({
    actor: 'code',
    name: '지표 계산',
    where: 'judge/indicators.ts',
    referenced: `위 봉 ${seen.length}개 — 그 봉까지만, 뒤 봉은 안 봄`,
    did: `ATR(${input.params.atrPeriod}) · 이동평균(${input.params.smaFastPeriod}/${input.params.smaSlowPeriod}) · 최근범위(${input.params.breakoutPeriod})`,
    produced: indicators
      ? `ATR ${num(indicators.atr)} · 단기 ${num(indicators.smaFast)} · 장기 ${num(indicators.smaSlow)} · 고 ${num(indicators.recentHigh)} · 저 ${num(indicators.recentLow)}`
      : '봉이 모자라 못 구했습니다',
    detail: null,
    tone: indicators ? 'ok' : 'blocked',
  })

  const trigger = indicators ? evaluateTriggers(seen, indicators, input.params) : null
  add({
    actor: 'code',
    name: '진입 조건',
    where: 'judge/indicators.ts',
    referenced: '위 지표',
    did: '이평 교차·돌파 두 조건을 검사',
    produced: trigger
      ? `${trigger.id} (${LEANING_LABEL[trigger.direction] ?? trigger.direction})`
      : '하나도 안 걸렸습니다 — 그러면 AI 를 아예 안 부릅니다',
    detail: null,
    tone: trigger ? 'ok' : 'waiting',
  })

  const ruleLean = leaningOf(input.rule?.rawScore ?? null)
  add({
    actor: 'code',
    name: '규칙 판단기',
    where: 'judge/rule.ts',
    referenced: '위 지표와 조건',
    did: '정해진 식으로 원점수를 냄 — AI 아님',
    produced: ruleLean
      ? `${LEANING_LABEL[ruleLean.direction]} ${Math.round(ruleLean.prob * 100)}%`
      : '규칙 판단 기록이 없습니다',
    detail: null,
    tone: ruleLean ? 'ok' : 'waiting',
  })

  let prompt: string | null = null
  if (indicators && trigger) {
    const minutesSinceOpen = input.sessionOpenAt && Number.isFinite(Date.parse(input.sessionOpenAt))
      ? Math.max(0, Math.floor((bar.startAt.getTime() - Date.parse(input.sessionOpenAt)) / MINUTE_MS))
      : 0
    const judgeInput: JudgeInput = {
      asOf: new Date(closeAt),
      contractCode: '',
      decisionTf: '1m',
      bars: seen,
      trigger,
      minutesSinceOpen,
      indicators,
    }
    prompt = buildJevPrompt(judgeInput).text
  }
  add({
    actor: 'code',
    name: '물음 조립',
    where: `judge/jev-prompt.ts · ${promptVersion}`,
    referenced: '위 지표와 마지막 종가 20개',
    did: '전부 ATR 배수 상대값으로 바꿈 — 절대 가격과 날짜는 뺌',
    produced: prompt ? '아래 문장을 관문으로 보냄' : '재료가 모자라 못 만들었습니다',
    detail: prompt,
    tone: prompt ? 'ok' : 'blocked',
  })

  const answered = input.jev.status === 'completed' && input.jev.rawScore !== null
  const took = input.jev.requestAt && input.jev.responseAt
    ? Date.parse(input.jev.responseAt) - Date.parse(input.jev.requestAt)
    : null
  const jevLean = leaningOf(input.jev.rawScore)
  add({
    actor: 'ai',
    /*
      **「Jev」라고 안 쓴다.** 그 낱말은 이 저장소가 AI 판단기에 붙인 이름인데
      공급자 목록에도 같은 낱말이 있어, 화면에 그것만 찍으면 읽는 사람은 그것이
      모델 이름인지 회사 이름인지 판단기 이름인지 알 수 없다
      (사용자 질문 2026-09-28, 다시 2026-09-30 「AI 스럽게 또 이야기 하네」).
      판단 기록 표가 쓰는 말과 같게 둔다 — 두 화면이 같은 것을 다르게 부르면 안 된다.
    */
    name: 'AI 판단기',
    where: model,
    referenced: '위 물음 그것뿐 — 봉도 DB 도 우리 코드도 못 봅니다',
    did: took !== null && Number.isFinite(took)
      ? `생각 깊이 ${input.reasoningEffort || '미지정'} · ${(took / 1000).toFixed(1)}초 (상한 ${Math.round(input.timeoutMs / 1000)}초)`
      : `생각 깊이 ${input.reasoningEffort || '미지정'}`,
    produced: answered
      ? (jevLean ? `${LEANING_LABEL[jevLean.direction]} ${Math.round(jevLean.prob * 100)}%` : '답은 왔는데 방향을 못 읽었습니다')
      : `답이 안 왔습니다 — ${input.jev.abstainReason ?? input.jev.status}`,
    detail: answered ? JSON.stringify(input.jev.rawScore, null, 2) : null,
    tone: answered ? 'ok' : 'blocked',
  })

  const agreed = ruleLean && jevLean && trigger
    && ruleLean.direction === jevLean.direction && jevLean.direction === trigger.direction
  add({
    actor: 'code',
    name: '합의 판정',
    where: 'signal/models-core.ts',
    referenced: [
      ruleLean ? `규칙 ${LEANING_LABEL[ruleLean.direction]}` : '규칙 없음',
      jevLean ? `AI ${LEANING_LABEL[jevLean.direction]}` : 'AI 없음',
      trigger ? `조건 ${LEANING_LABEL[trigger.direction] ?? trigger.direction}` : '조건 없음',
    ].join(' · '),
    did: '셋이 같은 방향인지 맞춰 봄',
    produced: agreed
      ? `합의됨 — ${LEANING_LABEL[jevLean.direction]}`
      : '갈렸습니다 — 갈리면 신호를 안 냅니다',
    detail: null,
    tone: agreed ? 'ok' : 'waiting',
  })

  /** 화면이 실제로 그리는 방향. 안 넘어오면 위에서 꺼낸 AI 판단을 쓴다 */
  const shownDirection = input.shown?.direction
    ?? (jevLean ? LEANING_LABEL[jevLean.direction] : null)

  add({
    /*
      **이름을 화면과 맞춘다.** 화면은 이 칸을 더 이상 「지금 예측」이라 부르지 않는다 —
      판단은 매분 안 나고 진입 조건이 걸린 분에만 나기 때문이다
      (사용자 지적 2026-09-30 「이거 실시간으로 왜 안움직여?」). 계보가 옛 이름을 쓰면
      읽는 사람이 화면에서 그 칸을 못 찾는다.

      점수도 안 적는다 — 화면에서 뺀 값을 계보만 적으면 두 자리가 다른 말을 한다
      (사용자 지시 2026-09-30 「점수를 보여주는게 뭐가 중요해」).
    */
    actor: 'view',
    name: '마지막 판단',
    where: 'ChartPanel.tsx',
    referenced: '가장 최근 판단 (신호가 있으면 신호가 이깁니다)',
    did: '방향을 꺼내고, 그 봉으로 진입·손절·목표를 셈함',
    /*
      **화면이 그리고 있는 것을 적는다.** 부르는 쪽이 `shown` 을 안 넘기면 위에서 이미
      꺼낸 판단을 쓴다 — 실측 2026-09-30 그 값이 안 넘어와서, 화면에는 「롱」이 크게 떠 있는데
      계보만 「화면에 그릴 값이 없습니다」라고 적고 있었다. 계보가 화면과 다른 말을 하면
      계보를 읽을 이유가 없어진다.
    */
    produced: shownDirection ?? '화면에 그릴 값이 없습니다',
    detail: input.shown?.plan ?? null,
    tone: input.blocked ? 'waiting' : 'ok',
  })

  if (input.blocked) {
    add({
      actor: 'code',
      name: '안전 관문',
      where: 'signal/emit.ts',
      referenced: '게이트 상태와 신호 규칙',
      did: `${input.blocked.total}단계를 순서대로 물음`,
      produced: `${input.blocked.step}단계에서 멈춤 — 신호로는 안 나갔습니다`,
      detail: input.blocked.reason || null,
      tone: 'blocked',
    })
  }

  return {
    barAt: bar.startAt.toISOString(),
    judgmentId: input.jev.id,
    model,
    promptVersion,
    steps,
    unavailable: null,
  }
}
