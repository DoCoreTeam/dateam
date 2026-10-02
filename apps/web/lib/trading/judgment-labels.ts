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

/**
 * 판단기 이름 — **무엇을 하는 것인지로 부른다.**
 *
 * 「Jev」는 이 저장소가 AI 판단기에 붙인 이름인데, 공급자 목록에도 같은 낱말이 있다
 * (Vercel 관문). 화면에 그 낱말만 찍으면 읽는 사람은 그것이 모델 이름인지 회사 이름인지
 * 판단기 이름인지 알 수 없다 (사용자 질문 2026-09-28).
 */
export const JUDGE_LABEL: Record<string, string> = {
  rule: '규칙 판단',
  ml: '학습 모델',
  jev: 'AI 판단',
}

/** 모델을 못 적은 옛 줄. **지어내지 않는다** — 실측 2026-09-30 그런 줄이 25건 있었다 */
export const NO_MODEL_TEXT = '모델 기록 없음'

/**
 * 어느 판단기가, **어느 모델로** 판단했나.
 *
 * 사용자 지시 2026-09-30: 「AI 판단이 어떤 모델이 한 판단인지 정확히 적어」.
 * 표에는 「AI 판단」만 있었는데, 그 이름은 무엇이 답했는지를 안 말한다 —
 * 모델을 바꿔 가며 쓰는 판에서 어제 것과 오늘 것이 같은 글자로 보인다.
 *
 * **규칙 판단에는 모델을 안 적는다.** 그 줄에도 `jev_model_version` 값이 들어 있지만
 * (실측 2026-09-30 rule 45줄 전부) 규칙은 AI 가 아니다 — 있는 값을 그대로 찍으면
 * 규칙이 그 모델로 판단한 것처럼 읽힌다.
 */
export function judgeWithModel(
  judge: string,
  modelVersion: string | null | undefined,
): { name: string; model: string | null } {
  const name = JUDGE_LABEL[judge] ?? judge
  if (judge !== 'jev') return { name, model: null }
  const model = (modelVersion ?? '').trim()
  return { name, model: model === '' ? NO_MODEL_TEXT : model }
}

/**
 * 어느 쪽으로 기울었나 한 줄로.
 *
 * `hold` 가 가장 높으면 관망이다(§7.4) — 롱과 숏 중 큰 쪽만 보면
 * 「관망이 60%인데 롱 25%」를 롱으로 읽는다.
 */
export type Leaning = 'long' | 'short' | 'hold'

export const LEANING_LABEL: Record<Leaning, string> = {
  long: '롱',
  short: '숏',
  hold: '관망',
}

/**
 * 어느 쪽으로 얼마나 기울었나 — **글자가 아니라 값으로.**
 *
 * 화면 여럿이 같은 판단을 다르게 읽지 않게 여기서 한 번만 고른다.
 * 글자가 필요한 자리는 `leaningLabel` 이 이것을 감싼다.
 */
export function leaningOf(raw: Record<string, number> | null): { direction: Leaning; prob: number } | null {
  if (!raw) return null
  const long = raw.p_long ?? 0
  const short = raw.p_short ?? 0
  const hold = raw.p_hold ?? 0
  const top = Math.max(long, short, hold)
  if (!Number.isFinite(top)) return null
  const direction: Leaning = top === hold ? 'hold' : top === long ? 'long' : 'short'
  return { direction, prob: top }
}

export function leaningLabel(raw: Record<string, number> | null): string {
  const leaning = leaningOf(raw)
  if (!leaning) return '—'
  return `${LEANING_LABEL[leaning.direction]} ${(leaning.prob * 100).toFixed(0)}%`
}

/* ── 왜 판단이 안 남았나 ──────────────────────────────── */

/**
 * 판단 기록의 실패 사유를 **사람 말로 읽는다.**
 *
 * 사용자 지적 2026-09-28: 「정상 동작 하고 있는건지 모르겠네」 — 표에 `call_failed:jev_http_403`
 * 이 열여섯 줄 찍혀 있었다. 그것은 고칠 때 쓰라고 남긴 글자이지 읽으라고 남긴 것이 아니다.
 * 읽는 사람은 **무엇을 하면 되는지**를 알아야 하는데 화면은 표식을 보여 주고 해석을 떠넘겼다.
 *
 * 운영 화면의 `lib/trading/operator/run-reason.ts` 와 같은 규칙이다 —
 * **모르는 표식은 버리지 않고** 원문을 그대로 돌려준다.
 */
export interface JudgmentIssue {
  text: string
  /** 사람이 손대야 풀리나 (`blocked`), 기다리면 풀리나 (`waiting`) */
  tone: 'blocked' | 'waiting'
  /** 못 알아본 표식인가. 화면이 원문을 함께 보여 줄지 정한다 */
  known: boolean
}

/** 증권사·관문 응답 번호를 사람 말로. 넷의 조치가 서로 다르다 */
function httpIssue(status: number): JudgmentIssue {
  if (status === 403) {
    return { text: 'AI 가 그 모델을 거절했습니다. 이름이 맞는지, 그 계정에 권한이 있는지 보세요', tone: 'blocked', known: true }
  }
  if (status === 401) return { text: 'AI 키가 거절됐습니다. 키를 다시 등록해 주세요', tone: 'blocked', known: true }
  if (status === 429) return { text: 'AI 호출 한도에 걸렸습니다. 잠시 뒤 다시 돕니다', tone: 'waiting', known: true }
  if (status === 404) return { text: 'AI 가 모르는 모델 이름입니다. 모델을 다시 선택해 주세요', tone: 'blocked', known: true }
  if (status >= 500) return { text: 'AI 쪽 서버 오류입니다. 잠시 뒤 다시 돕니다', tone: 'waiting', known: true }
  return { text: `AI 호출이 실패했습니다 (${status})`, tone: 'blocked', known: true }
}

export function judgmentIssue(abstainReason: string | null | undefined): JudgmentIssue | null {
  const raw = (abstainReason ?? '').trim()
  if (raw === '') return null

  const http = raw.match(/_http_(\d{3})\b/)
  if (http) return httpIssue(Number(http[1]))

  const timeout = raw.match(/^timeout:(\d+)ms$/)
  if (timeout) {
    const seconds = Math.round(Number(timeout[1]) / 1000)
    return {
      text: `AI 가 ${seconds}초 안에 답을 안 줘서 건너뛰었습니다. 설정의 판단 대기 시간을 늘리거나 더 빠른 모델을 고르세요`,
      tone: 'blocked',
      known: true,
    }
  }
  if (raw.startsWith('budget_denied')) {
    return { text: '오늘 AI 호출 한도를 다 써서 안 불렀습니다', tone: 'waiting', known: true }
  }
  if (raw.startsWith('unreadable')) {
    return { text: 'AI 답을 못 읽었습니다. 다른 모델을 선택하면 풀리는 경우가 많습니다', tone: 'blocked', known: true }
  }
  if (raw.startsWith('call_failed')) {
    return { text: 'AI 호출이 실패했습니다', tone: 'blocked', known: true }
  }
  if (raw === 'atr_zero') {
    return { text: '변동폭이 0 이라 판단할 수 없었습니다', tone: 'waiting', known: true }
  }
  if (raw === 'no_model') {
    return { text: '학습 모델이 아직 없습니다', tone: 'waiting', known: true }
  }
  // 모르는 표식은 버리지 않는다 — 원문을 그대로 돌려주고 「모른다」고 표시한다
  return { text: raw, tone: 'blocked', known: false }
}

/**
 * 같은 실패가 이어지나 — **표만 보고 「정상인가」를 사람이 세지 않게.**
 *
 * 맨 위 줄이 세어 주지 않으면 사람은 스무 줄을 눈으로 세야 하고, 대개 안 센다.
 */
export interface JudgmentStreak {
  /** 가장 최근부터 이어서 실패한 판단 수 */
  count: number
  judge: string
  issue: JudgmentIssue
}

export function failingStreak(
  rows: readonly { judge: string; status: string; abstainReason: string | null }[],
): JudgmentStreak | null {
  const isBad = (r: { status: string }): boolean => r.status === 'failed' || r.status === 'abstain'

  /**
   * **지금도 못 하고 있을 때만 말한다.**
   *
   * 실측 2026-09-28: 가장 최근 실패만 찾아 세었더니, 그 뒤에 성공한 판단이 쌓인 뒤에도
   * 「2번 이어서 못 했습니다」가 계속 떠 있었다. 이미 풀린 일을 경고로 두면
   * 사람은 그 자리를 안 믿게 되고, 진짜로 막힌 날의 같은 줄도 같이 흘려보낸다.
   *
   * 그래서 **판단기별로 가장 최근 줄**을 보고, 그것이 실패일 때만 센다.
   */
  const judges = [...new Set(rows.map((r) => r.judge))]
  for (const judge of judges) {
    const mine = rows.filter((r) => r.judge === judge)
    if (mine.length === 0 || !isBad(mine[0])) continue
    const issue = judgmentIssue(mine[0].abstainReason)
    if (!issue) continue

    let count = 0
    for (const r of mine) {
      if (!isBad(r)) break
      const it = judgmentIssue(r.abstainReason)
      // **같은 종류의 실패만** 센다. 다른 이유가 섞이면 「N번 이어서」가 거짓말이 된다
      if (!it || it.text !== issue.text) break
      count += 1
    }
    if (count >= 2) return { count, judge, issue }
  }
  return null
}

export function streakLine(streak: JudgmentStreak): string {
  return `${JUDGE_LABEL[streak.judge] ?? streak.judge}이 ${streak.count}번 이어서 못 했습니다 · ${streak.issue.text}`
}
