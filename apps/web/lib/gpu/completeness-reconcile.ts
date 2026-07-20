// 완전성 게이트 SSOT (v0.7.351 재설계 §4) — "추출 결과"가 아니라 "원본 스냅샷"을 기준으로 검증.
//   스냅샷에서 통화 동반 금액 토큰을 결정론 전수스캔 → 각 토큰이 추출 성분에 담겼는지 커버리지 검사.
//   미커버 = 은폐 금지, 명시 노출 → 자동확정 차단·검수큐가 **목표 동작**.
//   ⚠️ 현재 상태: 이 모듈은 아직 어떤 라우트에도 결선되지 않았다(v0.7.351 차수에서 리네임만 수행).
//   따라서 위 차단 효과는 아직 발생하지 않는다. 결선 전까지 이 파일을 '동작 중인 게이트'로 신뢰하지 말 것.
//   결선 태스크: docs/2026-07-20-v0.7.351-gpu-market-lossless-redesign/05-scope-revision.md 후속 항목.
//   오탐 억제: 통화기호 동반 금액만(640GB·400Gbps·7日 등 스펙숫자 제외).

// 통화기호(円/¥/￥/₩/$/€) 앞뒤로 붙은 금액만 스캔. "30,000円", "¥2,500,000", "7.2円/1分".
const MONEY_TOKEN_RE = /(?:[¥￥$₩€]\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?)|(?:\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:円|원))/g

/** 스냅샷 원문에서 금액 토큰(정규화된 숫자값) 집합 추출. GB/Gbps/日 등 비통화 숫자는 제외(정규식이 통화기호 요구). */
export function scanMoneyTokens(snapshot: string): number[] {
  const found: number[] = []
  const matches = snapshot.match(MONEY_TOKEN_RE) ?? []
  for (const m of matches) {
    const num = m.match(/\d{1,3}(?:,\d{3})*(?:\.\d+)?/)
    if (!num) continue
    const v = parseFloat(num[0].replace(/,/g, ''))
    if (Number.isFinite(v) && v > 0) found.push(v)
  }
  return found
}

export interface ReconcileResult {
  sourceAmounts: number[]     // 원본에서 발견한 금액 토큰
  coveredAmounts: number[]    // 추출 성분이 담은 금액
  uncovered: number[]         // 원본엔 있으나 추출엔 없는 금액(누락 후보 — 명시 노출)
  complete: boolean           // 미커버 0이면 완전
}

/**
 * 원본 스냅샷 금액 ↔ 추출된 성분 금액 커버리지 대조.
 *   extractedAmounts: 추출된 모든 성분의 amount(원본 통화 기준, 무손실 저장값).
 *   같은 값 중복은 개수까지 대조(멀티셋) — 2,500,000이 원본 1회인데 추출 0회면 미커버.
 */
export function reconcile(snapshot: string, extractedAmounts: number[]): ReconcileResult {
  const source = scanMoneyTokens(snapshot)
  const remaining = new Map<number, number>()
  for (const a of extractedAmounts) remaining.set(a, (remaining.get(a) ?? 0) + 1)
  const covered: number[] = []
  const uncovered: number[] = []
  for (const s of source) {
    const c = remaining.get(s) ?? 0
    if (c > 0) { covered.push(s); remaining.set(s, c - 1) }
    else uncovered.push(s)
  }
  return { sourceAmounts: source, coveredAmounts: covered, uncovered, complete: uncovered.length === 0 }
}
