/**
 * 리포트 값을 사람이 읽는 글자로 (사용자 개입)
 *
 * ## 왜 화면에서 떼어 냈나
 *
 * 화면 파일 안에 있으면 `@/` 별칭 때문에 단위 테스트가 못 부른다.
 * 그런데 이 판정은 **화면에 빈칸이 뜨느냐 마느냐**를 정하는 자리라 실행해서 확인해야 한다.
 *
 * ## 값이 있는데 빈칸을 그리지 않는다
 *
 * 모델은 `{amount, unit}` 같은 모양으로도 답한다. 예전에는 이름 칸만 찾다가 못 찾으면
 * 빈 글자를 냈다 — 화면에는 라벨과 근거만 있고 값 자리가 비었다
 * (실측 2026-09-09: 사업 예산 309,969,445원이 빈칸으로 보였다).
 * 「못 찾음」보다 나쁘다. 못 읽겠으면 가진 것을 그대로라도 보여 준다.
 */

import { RFP_REPORT, RFP_COMMON } from '../terms.ts'

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return RFP_REPORT.noValue
  if (typeof v === 'boolean') return v ? RFP_COMMON.yes : RFP_COMMON.no
  if (typeof v === 'number') return v.toLocaleString()
  if (typeof v === 'string') return v.trim() || RFP_REPORT.noValue
  if (Array.isArray(v)) {
    const parts = v.map((x) => formatValue(x)).filter((x) => x && x !== RFP_REPORT.noValue)
    return parts.length > 0 ? parts.join(', ') : RFP_REPORT.noValue
  }
  if (typeof v === 'object') return objectText(v as Record<string, unknown>)
  return String(v)
}

/** 값 객체에서 읽을 글자 — 이름 계열이 먼저, 없으면 수량+단위, 그것도 없으면 통째로 */
function objectText(o: Record<string, unknown>): string {
  for (const key of ['name', 'title', 'code', 'text', 'label']) {
    const v = o[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }

  // 「금액 + 단위」 모양 — 모델이 예산·기간을 이렇게 답한다
  const amount = o.amount ?? o.value ?? o.count
  if (amount !== undefined && amount !== null) {
    const unit = typeof o.unit === 'string' ? o.unit : ''
    const num = typeof amount === 'number' ? amount.toLocaleString() : String(amount)
    return unit ? `${num}${unit}` : num
  }

  // 그래도 못 읽으면 **가진 것을 그대로** 보여 준다. 빈칸보다 낫다
  const pairs = Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
  return pairs.length > 0 ? pairs.join(' · ') : RFP_REPORT.noValue
}
