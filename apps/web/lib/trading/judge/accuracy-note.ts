/**
 * 「그동안 얼마나 벌었나」가 **무슨 값인지, 왜 그런지**
 *
 * 사용자 지적 2026-09-30: 「근데 그동안 얼마 벌었나는 어떤 근거의 데이터인지 설명 좀
 * 써주고, 그리고 다 마이너스네」.
 *
 * 화면은 「판단대로 매번 들어갔다면 어땠을지를 지난 봉으로 되짚은 값입니다」 한 줄만
 * 적고 있었다. **어떻게 되짚었는지**가 없으면 그 숫자를 믿을 근거가 없고,
 * **왜 마이너스인지**가 없으면 고장인지 정상인지도 모른다.
 *
 * 둘 다 이미 아는 값으로 답할 수 있다. 되짚는 규칙은 설정에 있고, 마이너스인 이유는
 * 손절과 목표 폭이 정한 **본전 적중률**과 지금 적중률을 견주면 나온다.
 *
 * 숫자를 여기서 새로 정하지 않는다 — 전부 설정에서 받아 문장으로만 만든다(M4).
 */

export interface ReplayRule {
  /** 판단 봉이 닫힌 뒤 몇 분에 들어가나 */
  delayMinutes: number
  /** 시장가인가 지정가인가 */
  orderKind: 'market' | 'limit'
  /** 손절 폭 (ATR 배수) */
  stopAtrMultiple: number
  /** 목표 폭 (ATR 배수) */
  targetAtrMultiple: number
  /** 몇 분 지나면 시간청산인가 */
  timeExitMinutes: number
  /** 거래비용을 뺐나 */
  feeIncluded: boolean
}

/** 어떻게 셈한 값인가. 한 줄씩, 읽는 순서가 실제 순서다 */
export function replayLines(rule: ReplayRule): string[] {
  return [
    `판단이 난 봉이 닫히고 ${rule.delayMinutes}분 뒤에 ${rule.orderKind === 'limit' ? '지정가' : '시장가'}로 들어갑니다`,
    `손절은 변동폭의 ${rule.stopAtrMultiple}배, 목표는 ${rule.targetAtrMultiple}배로 잡습니다`,
    `${rule.timeExitMinutes}분이 지나면 그 자리에서 정리하고, 그날 장이 끝나기 전에도 정리합니다`,
    rule.feeIncluded
      ? '수수료와 미끄러짐을 뺀 값입니다'
      : '수수료가 설정에 0원이라 거래비용이 안 빠져 있습니다',
  ]
}

/** 「적중」이 무슨 뜻인가. 이 말을 안 하면 시간청산으로 번 것도 적중으로 읽는다 */
export const HIT_MEANING = '적중은 목표가에 닿아 끝난 것만 셉니다. 시간이 지나 조금 번 것은 적중이 아닙니다'

/** 「못 들어간 것」이 무슨 뜻인가 */
export const UNSCORED_MEANING = '못 들어간 것은 값이 한계가를 넘어가 따라가지 않은 판단입니다'

/**
 * 본전 적중률 — **손절과 목표 폭이 정한다.**
 *
 * 한 번 이기면 `목표`만큼 벌고 한 번 지면 `손절`만큼 잃으므로,
 * 본전이 되는 적중률은 `손절 ÷ (손절 + 목표)` 다.
 * 실측 설정 1.2 와 1.5 면 약 0.444 — 열 번 중 네 번 반은 맞아야 본전이라는 뜻이다.
 */
export function breakEvenHitRate(stopAtrMultiple: number, targetAtrMultiple: number): number | null {
  const stop = Number(stopAtrMultiple)
  const target = Number(targetAtrMultiple)
  if (!Number.isFinite(stop) || !Number.isFinite(target)) return null
  if (stop <= 0 || target <= 0) return null
  return stop / (stop + target)
}

/**
 * 왜 마이너스인가 한 줄. **본전선을 넘었으면 null** —
 * 늘 뜨는 설명은 안 읽히고, 그때는 마이너스인 이유가 이것이 아니다.
 */
export function whyNegativeLine(input: {
  hitRate: number | null
  stopAtrMultiple: number
  targetAtrMultiple: number
}): string | null {
  const breakEven = breakEvenHitRate(input.stopAtrMultiple, input.targetAtrMultiple)
  if (breakEven === null) return null
  const hit = input.hitRate
  // 안 잰 것을 나쁘다고 하지 않는다
  if (hit === null || !Number.isFinite(hit)) return null
  if (hit >= breakEven) return null
  const pct = (v: number): string => `${Math.round(v * 100)}%`
  return `지금 손절과 목표 폭이면 ${pct(breakEven)}는 맞아야 본전인데 ${pct(hit)}입니다.`
    + ' 그래서 합계가 마이너스이고, 검증 관문이 아직 알림을 안 켜 주는 이유도 이것입니다'
}
