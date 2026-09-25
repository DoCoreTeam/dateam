/**
 * 브리핑 셈 — **아무 일도 없던 날에도 숫자로 말한다**
 *
 * ## 왜 빈 브리핑을 안 만드나
 *
 * 「오늘 특별한 일 없었습니다」만 적으면, 정말 없었던 날과 **수집이 죽어서 아무것도
 * 못 본 날**이 똑같아 보인다. 둘은 정반대인데. 그래서 아무 일 없던 날에도
 * 봉 몇 개를 봤고 판단이 몇 번 돌았는지를 적는다 — 0이면 0이 적힌다.
 *
 * ## 왜 숫자를 AI 가 안 만드나
 *
 * 「신호 세 건이 나갔습니다」를 모델이 쓰면 그 3이 센 값인지 모른다. 그리고 그 브리핑을
 * 매일 읽는 사람은 그 숫자를 믿게 된다.
 */

export interface BriefingInput {
  tradeDate: string
  barsCollected: number
  judgments: number
  signals: number
  notificationsSent: number
  notificationsPending: number
  /** 점검 결과 요약 */
  checksOk: number
  checksWarn: number
  checksFail: number
  checksUnknown: number
  /** AI 가 스스로 한 조치와 사람에게 넘긴 것 */
  actionsApplied: number
  actionsHandedOff: number
  /** 오늘 실현 손익(원). 체결 연결 전에는 null */
  realizedPnlKrw: number | null
}

export interface BriefingMetrics extends BriefingInput {
  /** 손볼 것이 있나 */
  needsAttention: number
  /** 아무 일도 안 일어났나. **수집까지 0이면 그것도 일이다** */
  quiet: boolean
  /** 수집이 아예 안 돌았나 — 조용한 것과 다르다 */
  silent: boolean
}

export function computeBriefing(input: BriefingInput): BriefingMetrics {
  const needsAttention = input.checksWarn + input.checksFail + input.checksUnknown
  return {
    ...input,
    needsAttention,
    // 조용한 날: 신호도 조치도 없었지만 **수집은 돌았다**
    quiet: input.signals === 0 && input.actionsApplied === 0 && input.actionsHandedOff === 0
      && input.barsCollected > 0,
    // 죽은 날: 봉이 한 개도 안 모였다. 조용한 것이 아니라 안 돈 것이다
    silent: input.barsCollected === 0,
  }
}

function won(value: number | null): string {
  if (value === null) return '아직 없음'
  return `${value >= 0 ? '+' : ''}${Math.round(value).toLocaleString('ko-KR')}원`
}

/**
 * 사람이 읽을 줄. **AI 에게 이 줄들을 준다** — 원자료를 주면 AI 가 다시 센다.
 *
 * 0 도 적는다. 「신호 0건」과 「신호 이야기가 없음」은 다르다.
 */
export function briefingLines(m: BriefingMetrics): string[] {
  return [
    `거래일 ${m.tradeDate}`,
    `수집: 봉 ${m.barsCollected}개, 판단 ${m.judgments}번`,
    `신호: ${m.signals}건, 알림 보냄 ${m.notificationsSent}건, 안 나간 것 ${m.notificationsPending}건`,
    `점검: 정상 ${m.checksOk}, 경고 ${m.checksWarn}, 실패 ${m.checksFail}, 모름 ${m.checksUnknown}`,
    `조치: AI ${m.actionsApplied}건, 사람에게 넘김 ${m.actionsHandedOff}건`,
    `실현 손익: ${won(m.realizedPnlKrw)}`,
    m.silent
      ? '봉이 한 개도 안 모였습니다. 조용한 날이 아니라 수집이 안 돈 날입니다'
      : m.quiet
        ? '신호도 조치도 없었습니다. 수집은 돌았습니다'
        : `손볼 것 ${m.needsAttention}건`,
  ]
}

export function buildBriefingPrompt(lines: readonly string[]): string {
  return [
    '너는 하루치 트레이딩 기록을 짧게 전하는 사람이다.',
    '',
    '규칙',
    '- 아래 표에 **있는 숫자만** 쓴다. 새로 계산하지 않는다',
    '- 예측하지 않는다. 「내일은」 같은 말을 쓰지 않는다',
    '- 설정을 바꾸라고 말하지 않는다',
    '- 봉이 0개면 조용한 날이 아니라 안 돈 날이라고 말한다',
    '- 세 문장 이내',
    '',
    '오늘',
    ...lines.map((l) => `- ${l}`),
  ].join('\n')
}
