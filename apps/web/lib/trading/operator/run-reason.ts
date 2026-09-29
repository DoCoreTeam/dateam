/**
 * 실행 기록의 사유를 **사람 말로 읽는다**
 *
 * 크론 한 판은 `bar_not_ready|bar_retry=2/2,still_missing|fills_failed:kis:kis_APAC0071|broker=failed`
 * 같은 줄을 남긴다. 이 줄은 고칠 때 쓰라고 만든 것이지 읽으라고 만든 것이 아니다.
 * 그런데 운영 화면이 그것을 그대로 찍고 있었다 — 읽는 사람은 「무엇이 막혔나」를 알아야 하는데
 * 화면은 표식을 보여 주고 해석을 사람에게 떠넘겼다. 게다가 이 줄은 띄어쓰기가 없어
 * 줄바꿈 자리가 없고, 그래서 카드가 가로로 터졌다 (실측 2026-09-28).
 *
 * ## 규칙 셋
 *
 * 1 **버리지 않는다.** 못 알아본 표식은 `unknown` 으로 남고 원문은 `raw` 로 통째로 남는다.
 *   사람 말로 못 바꿨다고 사실을 지우면 화면이 거짓말을 한다.
 * 2 **한 줄을 고른다.** 판마다 표식이 열 개씩 붙는다. 전부 문장으로 펴면 카드 스무 개가
 *   이백 줄이 된다. 그래서 가장 심각한 한 줄(`headline`)을 앞에 두고 나머지는 접는다.
 * 3 **순수하다.** 읽기도 시각도 없다 — 같은 글자를 넣으면 늘 같은 답이 나온다.
 */

import { NOT_MEASURED } from '../../terms/index.ts'
import { DIRECTION_LABEL } from '../signal-labels.ts'
import { emitProgressOf, knowledgeProgressOf } from '../overview-shape.ts'
import { withJosa, eulReul } from '../../ui/josa.ts'
import { kisCodeMeaning, BROKER_CALL_LABEL } from '../broker/kis-codes.ts'

/**
 * 이 줄이 무엇을 말하나.
 *
 * `blocked` 는 **사람이 손대야 풀리는 것**이고 `waiting` 은 기다리면 풀리는 것이다.
 * 둘을 같은 색으로 그리면 사람은 매분 뜨는 「봉이 아직 안 닫혔습니다」에 익숙해져
 * 그 옆의 「증권사 조회가 실패했습니다」도 같이 흘려보낸다.
 */
export type RunReasonTone = 'blocked' | 'waiting' | 'ok'

export interface RunReasonLine {
  text: string
  tone: RunReasonTone
}

export interface RunReasonView {
  /** 카드에 접힌 채로 보일 한 줄. 사유가 비었으면 null */
  headline: RunReasonLine | null
  /** 알아본 표식을 사람 말로 편 것. 나온 순서를 지킨다 (순서가 곧 판의 진행이다) */
  lines: RunReasonLine[]
  /** 못 알아본 표식. **버리지 않고 접어 둔다** */
  unknown: string[]
  /** 기계 원문 그대로 */
  raw: string
}

/** 실행 상태를 사람 말로. 표를 화면에 두지 않는다 */
const STATUS_LABEL: Record<string, string> = {
  running: '도는 중',
  done: '정상',
  failed: '실패',
  skipped: '건너뜀',
}

export function runStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status
}

export function runStatusTone(status: string): RunReasonTone {
  if (status === 'failed') return 'blocked'
  if (status === 'running' || status === 'skipped') return 'waiting'
  return 'ok'
}

/**
 * 괄호 안은 안 쪼갠다.
 *
 * `gate(broker_fail=0,since_run=1)` 을 쉼표로 그냥 쪼개면 관문 한 덩어리가
 * 표식 여섯 개로 흩어지고, 그 여섯은 저마다 뜻을 잃는다.
 */
function splitTop(text: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let buf = ''
  for (const ch of text) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === sep && depth === 0) { out.push(buf); buf = ''; continue }
    buf += ch
  }
  out.push(buf)
  return out.map((s) => s.trim()).filter((s) => s !== '')
}

type Say = (m: RegExpMatchArray) => RunReasonLine[]

interface Rule { re: RegExp; say: Say }

const line = (text: string, tone: RunReasonTone): RunReasonLine[] => [{ text, tone }]

/** 증권사 응답 번호를 사람 말로. 500대는 저쪽 탓이고 400대는 우리 요청이 문제다 */
function httpText(status: number): RunReasonLine[] {
  if (status >= 500) return line(`증권사 서버가 오류로 답했습니다 (${status})`, 'blocked')
  if (status === 429) return line('증권사 조회 횟수 제한에 걸렸습니다', 'blocked')
  if (status >= 400) return line(`증권사가 조회를 거절했습니다 (${status})`, 'blocked')
  return line(`증권사 응답이 정상이 아닙니다 (${status})`, 'blocked')
}

/**
 * 관문 점검은 **걸린 것만** 말한다.
 *
 * 여섯에서 아홉 가지를 재는데 그것을 다 펴면 한 판이 아홉 줄이 된다.
 * 걸린 것이 없으면 그 사실 한 줄이면 족하다.
 */
function gateLines(inner: string): RunReasonLine[] {
  const hit: string[] = []
  let worst: RunReasonTone = 'ok'
  for (const part of splitTop(inner, ',')) {
    const [key, value = ''] = part.split('=')
    if (key === 'broker_fail' && Number(value) > 0) { hit.push(`증권사 조회가 연속 ${value}번 실패`); worst = 'blocked' }
    else if (key === 'since_run' && value === 'unknown') { hit.push('직전 실행 시각을 모름'); worst = worst === 'blocked' ? worst : 'waiting' }
    else if (key === 'calib' && value === 'false') { hit.push('보정 모델 없음'); worst = 'blocked' }
    else if (key === 'spec' && value === 'false') { hit.push('판단 명세 없음'); worst = 'blocked' }
    else if (key === 'margin_tight' && value === 'true') { hit.push('증거금이 빠듯함'); worst = 'blocked' }
    else if (key === 'ai_budget_out' && value === 'true') { hit.push('AI 한도를 다 씀'); worst = 'blocked' }
    else if (key === 'bar_late' && value === 'true') { hit.push('가격 봉이 늦음'); worst = worst === 'blocked' ? worst : 'waiting' }
    else if (key === 'spread_wide' && value === 'true') { hit.push('호가 폭이 평소보다 넓음'); worst = worst === 'blocked' ? worst : 'waiting' }
    else if (key === 'market_abnormal' && value === 'true') { hit.push('시장이 정상 범위 밖'); worst = 'blocked' }
    else if (key === 'unmeasured') { hit.push(`${NOT_MEASURED}인 것 ${value.split('+').length}가지`); worst = 'blocked' }
  }
  if (hit.length === 0) return line('관문 점검에 걸린 것이 없습니다', 'ok')
  return line(`관문 점검에 걸렸습니다: ${hit.join(', ')}`, worst)
}

/**
 * 표식 하나를 문장 하나로.
 *
 * **위에서부터 먼저 맞는 것을 쓴다** — 좁은 것이 위에 있어야 한다.
 * `position=none` 이 `position=(.+)` 아래 있으면 영영 안 불린다.
 */
const RULES: Rule[] = [
  // ── 이 분에 무엇을 했나 ──────────────────────────────
  { re: /^already_running$/, say: () => line('앞 실행이 아직 도는 중이라 건너뛰었습니다', 'waiting') },
  { re: /^threw:([\s\S]+)$/, say: (m) => line(`실행 도중 오류가 났습니다: ${m[1]}`, 'blocked') },
  { re: /^day_config_frozen$/, say: () => line('오늘 굳혀 둔 설정 그대로 돌았습니다', 'ok') },
  { re: /^logic_changed:(.+)$/, say: () => line('전략 판이 바뀌어 오늘 설정을 다시 굳혔습니다', 'ok') },
  { re: /^night_collected$/, say: () => line('야간장이라 봉만 모으고 판단은 안 했습니다', 'ok') },
  { re: /^not_continuous_trading$/, say: () => line('접속매매 시간이 아니라 판단을 안 했습니다', 'ok') },

  /**
   * **장이 안 열린 것은 고장이 아니다** (사용자 지적 2026-09-28
   * 「장이 안 열렸다는 거 뻔히 아는데 봉을 못 불러왔다 무슨 뜻인지?」).
   *
   * 그래서 tone 이 ok 다. 매일 아침 45분 동안 빨간 줄이 뜨면 사람은 빨간색을 안 믿게 되고,
   * 정작 진짜 고장이 난 날 그 줄도 같이 흘려보낸다.
   */
  { re: /^market_closed=before_open$/, say: () => line('장이 아직 안 열렸습니다', 'ok') },
  { re: /^market_closed=after_close$/, say: () => line('오늘 장이 끝났습니다', 'ok') },
  { re: /^market_closed=auction$/, say: () => line('단일가 구간이라 판단을 안 했습니다', 'ok') },
  { re: /^market_closed=(.+)$/, say: () => line('지금은 장 시간이 아닙니다', 'ok') },
  { re: /^market=auction$/, say: () => line('단일가 구간입니다 — 그 봉으로는 판단하지 않습니다', 'ok') },

  // ── 가격 봉 ─────────────────────────────────────────
  { re: /^bar_not_ready$/, say: () => line('가격 봉이 아직 안 닫혔습니다', 'waiting') },
  { re: /^bar_missing:(.+)$/, say: () => line('그 분 가격 봉이 안 들어왔습니다', 'blocked') },
  { re: /^bar_retry=0\((.+)\)$/, say: () => line('봉을 다시 묻지 않도록 되어 있습니다', 'waiting') },
  {
    re: /^bar_retry=(\d+)\/(\d+),still_missing$/,
    say: (m) => line(`봉을 ${m[2]}번까지 다시 물었지만 안 들어왔습니다`, 'blocked'),
  },
  {
    re: /^bar_retry=(\d+)\/(\d+),confirmed$/,
    say: (m) => line(`봉을 ${m[1]}번 다시 물어 받았습니다`, 'ok'),
  },
  { re: /^bar_retry=(\d+)\/(\d+)$/, say: (m) => line(`봉을 ${m[1]}번 다시 물었습니다 (최대 ${m[2]}번)`, 'waiting') },
  { re: /^still_missing$/, say: () => line('다시 물어도 봉이 안 들어왔습니다', 'blocked') },
  { re: /^confirmed$/, say: () => line('다시 물어 봉을 받았습니다', 'ok') },
  { re: /^rollup=(.+)$/, say: (m) => line(`봉을 모아 ${m[1].split('+').join(', ')} 봉을 만들었습니다`, 'ok') },
  { re: /^side_failed=(.+)$/, say: (m) => line(`곁가지 조회 ${m[1].split('+').length}가지가 실패했습니다`, 'blocked') },
  { re: /^not_enough_bars:(\d+)$/, say: (m) => line(`지표를 내기에 봉이 모자랍니다 (${m[1]}개)`, 'waiting') },

  // ── 증권사 ──────────────────────────────────────────
  { re: /^broker=ok$/, say: () => line('증권사 조회는 정상입니다', 'ok') },
  { re: /^broker=failed$/, say: () => line('증권사 조회가 실패했습니다', 'blocked') },
  { re: /^no_credential$/, say: () => line('증권사 앱키가 등록되지 않았습니다', 'blocked') },
  { re: /^http_(\d+)(?::no_body)?(?::[a-zA-Z]+)?$/, say: (m) => httpText(Number(m[1])) },
  {
    /**
     * `http_500:minuteChart:kis_EGW00201` — **상태 코드보다 증권사 코드가 먼저다.**
     *
     * 실측 2026-09-29: 이 꼴이 화면에 통째로 떴다. 「500」은 우리 쪽이 잘못한 것처럼
     * 읽히지만 실제 뜻은 「초당 거래건수를 초과했다」였고, 할 일이 완전히 다르다.
     */
    re: /^http_\d+(?::([a-zA-Z]+))?:kis_([A-Z0-9]+)$/,
    say: (m) => {
      const meaning = kisCodeMeaning(m[2])
      const where = m[1] ? `${BROKER_CALL_LABEL[m[1]] ?? m[1]} ` : ''
      if (!meaning) return line(`${where}조회가 거절됐습니다 (증권사 코드 ${m[2]})`, 'blocked')
      return line(`${where}조회가 거절됐습니다 — ${meaning.why} · ${meaning.how}`, meaning.tone)
    },
  },
  { re: /^fills=no_account$/, say: () => line('계좌가 연결되지 않아 체결을 못 읽었습니다', 'blocked') },
  {
    /**
     * **증권사 코드를 그대로 안 찍는다** (사용자 지적 2026-09-28 「에러인듯?」).
     * `kis:kis_APAC0071` 은 고칠 때 쓰라고 만든 글자다 — 읽는 사람은 무엇이 문제인지,
     * 어디서 고치는지 알 수 없다. 뜻을 아는 코드는 그 뜻과 할 일을 말한다.
     */
    /*
      **뒤에 붙는 조회 이름까지 받는다.** 규칙은 `$` 로 끝나 있었고, 사유에 조회 이름을
      붙이는 판(v0.10.683)이 `:fills` 를 덧붙이자 이 줄이 **조용히 안 걸리게** 됐다.
      번역은 만들어 배포까지 했는데 화면에는 사흘 내내 `kis:kis_APAC0071:fills` 가 떴다.
    */
    re: /^fills_failed:kis:kis_([A-Z0-9]+)(?::[a-zA-Z]+)?$/,
    say: (m) => {
      const meaning = kisCodeMeaning(m[1])
      // 뜻을 모르면 **코드를 그대로 보여 준다.** 접어 버리면 고칠 실마리까지 사라진다
      if (!meaning) return line(`체결 조회가 거절됐습니다 (증권사 코드 ${m[1]})`, 'blocked')
      return line(`체결 조회가 거절됐습니다 — ${meaning.why} · ${meaning.how}`, meaning.tone)
    },
  },
  { re: /^fills_failed:(.+)$/, say: (m) => line(`체결 조회가 실패했습니다: ${m[1]}`, 'blocked') },

  // ── 포지션 ──────────────────────────────────────────
  { re: /^position=(?:none|flat)$/, say: () => line('들고 있는 포지션이 없습니다', 'ok') },
  {
    re: /^position=(long|short)x(\d+)$/,
    say: (m) => line(`${DIRECTION_LABEL[m[1] as 'long' | 'short']} ${m[2]}계약을 들고 있습니다`, 'ok'),
  },
  { re: /^position_failed:(.+)$/, say: () => line('포지션을 세지 못했습니다', 'blocked') },
  { re: /^closed=0$/, say: () => line('오늘 닫은 거래가 없습니다', 'ok') },
  { re: /^closed=(\d+)$/, say: (m) => line(`오늘 닫은 거래 ${m[1]}건`, 'ok') },
  { re: /^plan=signal_not_found$/, say: () => line('포지션을 연 신호를 못 찾아 손절가를 모릅니다', 'blocked') },
  { re: /^plan=manual_trade$/, say: () => line('손으로 든 포지션이라 손절가를 모릅니다', 'waiting') },
  { re: /^plan_failed:(.+)$/, say: () => line('손절 계획을 못 읽었습니다', 'blocked') },
  { re: /^protection_failed:(.+)$/, say: () => line('손절 보호 상태를 못 읽었습니다', 'blocked') },

  // ── 관문 ────────────────────────────────────────────
  { re: /^gate\(([\s\S]*)\)$/, say: (m) => gateLines(m[1]) },

  // ── 계좌 감시 ───────────────────────────────────────
  { re: /^watch=off$/, say: () => line('계좌 감시가 꺼져 있습니다', 'waiting') },
  { re: /^watch=no_account$/, say: () => line('계좌가 없어 감시를 안 했습니다', 'waiting') },
  { re: /^watch=none$/, say: () => line('이번 분에 돌릴 감시가 없었습니다', 'ok') },
  { re: /^watch=(.+)$/, say: (m) => line(`계좌 감시 ${m[1].split('+').length}가지를 돌렸습니다`, 'ok') },
  { re: /^watch_failed:(.+)$/, say: () => line('계좌 감시가 실패했습니다', 'blocked') },
  { re: /^deferred=(.+)$/, say: (m) => line(`한도에 걸려 미룬 감시 ${m[1].split('+').length}가지`, 'waiting') },

  // ── 판단과 신호 ─────────────────────────────────────
  { re: /^no_trigger$/, say: () => line('진입 조건이 안 걸렸습니다', 'ok') },
  { re: /^judged$/, say: () => line('판단을 돌렸습니다', 'ok') },
  { re: /^judged:jev_off\((.+)\)$/, say: () => line('AI 판단을 못 불러 규칙으로만 판단했습니다', 'waiting') },
  { re: /^emit=skipped$/, say: () => line('진입 조건이 안 걸려 신호를 안 냈습니다', 'ok') },
  { re: /^emit_failed:(.+)$/, say: () => line('신호 발행이 실패했습니다', 'blocked') },
  {
    /**
     * 쉼표가 붙은 꼴(`emit:judge:…,event=…`)은 **여기서 안 받는다** —
     * 통째로 받으면 뒤에 붙은 일정 표식이 사람 말로 안 펴지고 원문에만 남는다
     */
    re: /^emit:([^,]+)$/,
    say: (m) => {
      const progress = emitProgressOf(`emit:${m[1]}`)
      if (!progress) return []
      return line(`신호 발행이 ${progress.total}단계 중 ${progress.step}단계에서 멈췄습니다`, 'waiting')
    },
  },
  { re: /^event=(.+)$/, say: (m) => line(`오늘은 일정이 있어 신호를 내지 않았습니다 (${m[1]})`, 'waiting') },
  { re: /^event_failed:(.+)$/, say: () => line('오늘 일정을 못 읽었습니다', 'blocked') },
  { re: /^roll=(.+)$/, say: () => line('만기 이월 중이라 신호를 내지 않았습니다', 'waiting') },

  // ── 자동 주문 ───────────────────────────────────────
  { re: /^order=no_account$/, say: () => line('계좌가 없어 주문을 안 냈습니다', 'waiting') },
  { re: /^order=not_armed$/, say: () => line('자동 주문이 무장되지 않아 주문을 안 냈습니다', 'ok') },
  { re: /^order=nothing_to_do$/, say: () => line('낼 주문이 없었습니다', 'ok') },
  { re: /^order=entry_exit_split$/, say: () => line('진입과 청산이 갈려 주문을 안 냈습니다', 'waiting') },
  { re: /^order=resolved_unknown:(.+)$/, say: (m) => line(`나갔는지 모르던 주문 ${m[1]}건을 확인했습니다`, 'ok') },
  { re: /^order_failed:(.+)$/, say: () => line('자동 주문이 실패했습니다', 'blocked') },

  // ── AI 운영자 ───────────────────────────────────────
  { re: /^operator=off$/, say: () => line('AI 운영자가 꺼져 있습니다', 'waiting') },
  {
    re: /^operator=checked:(\d+),attention:(\d+)$/,
    say: (m) => line(
      Number(m[2]) > 0 ? `점검 ${m[1]}가지 중 손볼 것이 ${m[2]}개입니다` : `점검 ${m[1]}가지에 손볼 것이 없습니다`,
      Number(m[2]) > 0 ? 'waiting' : 'ok',
    ),
  },
  { re: /^operator_failed:(.+)$/, say: () => line('AI 운영자 점검이 실패했습니다', 'blocked') },

  // ── 지식 ────────────────────────────────────────────
  {
    re: /^knowledge=([\s\S]+)$/,
    say: (m) => {
      const progress = knowledgeProgressOf(`knowledge=${m[1]}`)
      if (!progress) return []
      const done = progress.outcome.startsWith('done') || progress.outcome === '완료'
      return line(
        `${withJosa(progress.label, eulReul)} ${done ? '마쳤습니다' : '못 했습니다'}`,
        done ? 'ok' : 'waiting',
      )
    },
  },
  { re: /^knowledge_failed:(.+)$/, say: () => line('지식 일감이 실패했습니다', 'blocked') },
]

const TONE_RANK: Record<RunReasonTone, number> = { blocked: 0, waiting: 1, ok: 2 }

function sayOf(part: string): RunReasonLine[] | null {
  for (const rule of RULES) {
    const m = part.match(rule.re)
    if (!m) continue
    const said = rule.say(m)
    // 규칙은 맞았는데 할 말이 없으면(꼴이 예상과 다르면) 접는 쪽으로 보낸다
    return said.length > 0 ? said : null
  }
  return null
}

/**
 * 기계 사유를 읽는다.
 *
 * `|` 로 먼저 나누고, 덩어리 하나가 통째로 안 맞으면 `,` 로 한 번 더 나눈다.
 * 두 번 나누는 이유: `bar_retry=2/2,still_missing` 은 한 덩어리로 읽어야 「두 번 물었는데
 * 안 왔다」가 되고, `position=flat,closed=0` 은 나눠 읽어야 둘 다 말이 된다.
 */
export function readRunReason(reason: string | null | undefined): RunReasonView {
  const raw = (reason ?? '').trim()
  if (raw === '') return { headline: null, lines: [], unknown: [], raw: '' }

  const lines: RunReasonLine[] = []
  const unknown: string[] = []

  for (const segment of splitTop(raw, '|')) {
    const whole = sayOf(segment)
    if (whole) { lines.push(...whole); continue }

    const parts = splitTop(segment, ',')
    // 쉼표가 없는데 못 알아봤으면 그대로 접는다 (같은 것을 두 번 시도하지 않는다)
    if (parts.length <= 1) { unknown.push(segment); continue }
    for (const part of parts) {
      const said = sayOf(part)
      if (said) lines.push(...said)
      else unknown.push(part)
    }
  }

  const headline = [...lines].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])[0]
    ?? (unknown.length > 0 ? { text: '사유를 사람 말로 못 읽었습니다', tone: 'waiting' as const } : null)

  return { headline, lines, unknown, raw }
}
