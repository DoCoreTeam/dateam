// 일일 AI 추출 품질 평가(순수·결정적). 자가학습 거버넌스의 "품질 신호" + golden-set 평가에 공용.
//   GPU는 items.length===0(추출실패)이 신호였지만, 일일은 항상 무언가 반환 → 과분할·저신뢰를 신호로 본다.

export interface DailyExtractItem {
  status?: string
  confidence?: number
}

export interface DailyQuality {
  /** 항목당 평균 글자수 — 작을수록 과분할 의심 */
  charsPerItem: number
  /** 평균 신뢰도(0~1) */
  avgConfidence: number
  itemCount: number
  /** 품질 양호 여부(결정적 임계) */
  ok: boolean
  reasons: string[]
}

// 임계값(결정적): 항목이 3개 이상이면서 항목당 평균 글자수가 15 미만 = 과분할 의심.
//   (항목 1~2개는 과분할로 보지 않음 — 짧은 단일/소량 입력 오판 방지)
const MIN_ITEMS_FOR_FRAG = 3
const MIN_CHARS_PER_ITEM = 15
const CONF_MIN = 0.6

/** 입력 텍스트 + 추출 항목 → 결정적 품질 평가. degraded(=ok:false) 시 자가합성 트리거 신호로 사용. */
export function evalDailyExtraction(input: string, items: DailyExtractItem[]): DailyQuality {
  const len = Math.max(1, input.trim().length)
  const itemCount = items.length
  const charsPerItem = itemCount > 0 ? Math.round((len / itemCount) * 10) / 10 : len
  const confs = items.map((i) => (typeof i.confidence === 'number' ? i.confidence : 1))
  const avgConfidence = confs.length > 0 ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 100) / 100 : 1

  const reasons: string[] = []
  // 완전 추출 실패: 충분히 긴 입력인데 0건 → 프롬프트 고장 신호(GPU의 items===0과 동등)
  if (itemCount === 0 && len > 30) reasons.push('추출 0건(입력 있음) — 프롬프트 고장 의심')
  if (itemCount >= MIN_ITEMS_FOR_FRAG && charsPerItem < MIN_CHARS_PER_ITEM) {
    reasons.push(`과분할 의심(항목당 ${charsPerItem}자 < ${MIN_CHARS_PER_ITEM}, ${itemCount}개)`)
  }
  if (itemCount > 0 && avgConfidence < CONF_MIN) reasons.push(`평균 신뢰도 낮음(${avgConfidence} < ${CONF_MIN})`)

  return { charsPerItem, avgConfidence, itemCount, ok: reasons.length === 0, reasons }
}

// golden-set: "이 입력은 N개 이하로 추출돼야 한다" 식의 결정적 기대치(과분할 회귀 감지용 단위테스트).
export interface DailyGoldenCase {
  name: string
  input: string
  /** 기대 최대 항목 수(과분할 아님 기준) */
  maxItems: number
}

export const DAILY_GOLDEN: DailyGoldenCase[] = [
  { name: '단일 연속업무는 1개', input: 'A사 미팅 준비하고 제안서 정리함', maxItems: 1 },
  { name: '별개 2업무는 2개', input: 'B사 계약 검토 완료. C사 신규 제안 발송 예정', maxItems: 2 },
  { name: '짧은 단일 메모', input: '오늘 사내 교육 수강', maxItems: 1 },
]

/** golden 기대치 대비 항목 수가 과분할인지(테스트·평가용). over=과분할. */
export function isOverFragmented(goldenMaxItems: number, actualItems: number): boolean {
  return actualItems > goldenMaxItems
}
