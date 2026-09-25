/**
 * 판단 기록이 쓰는 말 — **화면 파일 안에 두지 않는다**
 *
 * 라벨 표가 화면에 있으면 같은 개념이 화면마다 다른 말이 된다
 * (`lib/ui/glossary.test.ts` 가 화면 안 라벨 표가 늘어나는 것을 막는다).
 */

export const JUDGMENT_STATUS_LABEL: Record<string, string> = {
  pending: '처리 중',
  completed: '기록됨',
  abstain: '기권',
  failed: '실패',
}

export const JUDGE_LABEL: Record<string, string> = {
  rule: '규칙',
  ml: '학습 모델',
  jev: 'Jev',
}

/**
 * 어느 쪽으로 기울었나 한 줄로.
 *
 * `hold` 가 가장 높으면 관망이다(§7.4) — 롱과 숏 중 큰 쪽만 보면
 * 「관망이 60%인데 롱 25%」를 롱으로 읽는다.
 */
export function leaningLabel(raw: Record<string, number> | null): string {
  if (!raw) return '—'
  const long = raw.p_long ?? 0
  const short = raw.p_short ?? 0
  const hold = raw.p_hold ?? 0
  const top = Math.max(long, short, hold)
  const name = top === hold ? '관망' : top === long ? '롱' : '숏'
  return `${name} ${(top * 100).toFixed(0)}%`
}
