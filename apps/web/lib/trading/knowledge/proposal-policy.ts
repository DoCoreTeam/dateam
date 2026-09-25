/**
 * 스펙 후보 — **AI 는 제안만 하고 적용은 사람이 한다** (명세 §15.2 · §15.3)
 *
 * ## 왜 AI 가 설정을 못 바꾸나
 *
 * 설정 하나가 돈의 크기를 정한다. 일일 손실 한도를 올리면 더 잃을 수 있고,
 * 안전 게이트 기준을 낮추면 깨진 데이터로 신호가 나간다. 그리고 그 변경은
 * **화면에서 아무 일도 안 일어난 것처럼 보인다** — 다음 날 손실로만 드러난다.
 *
 * 그래서 명세가 「AI 가 절대 바꿀 수 없는 것」 목록을 못 박았고, 여기서는 그 목록에 든 키를
 * **후보로도 안 올린다.** 후보로 올리면 사람이 누를 단추가 생기고, 단추는 언젠가 눌린다.
 *
 * ## 왜 다음 거래일부터인가 (§15.2)
 *
 * 장중에 전략이 바뀌면 그날 성과가 무엇의 성과인지 모른다. 즉시 적용은
 * **신호를 막는 쪽만** — 끄는 것은 위험을 줄이므로 기다릴 이유가 없다.
 */

/**
 * AI 가 절대 바꿀 수 없는 것 (§15.3).
 *
 * 명세의 목록을 키로 옮긴 것이다. 「비슷한 이름은 막겠지」로 두지 않는다 —
 * 목록에 있는 것만 막으면 새 키가 생겼을 때 조용히 열린다. 그래서 **접두사**로도 막는다.
 */
export const AI_FORBIDDEN_KEYS: readonly string[] = [
  // 소유자·권한
  'owner_user_id',
  // KIS·AI 자격증명
  'kis_env', 'kis_account_product_code', 'jev_model',
  // 일일 손실 한도 올리기 (내리는 것은 아래에서 따로 본다)
  'daily_loss_limit_krw',
  // 안전선·실행 방식
  'notify_enabled',
  // Lockbox 와 관문
  'validation_lockbox_days',
]

/** 이 접두사로 시작하는 키는 통째로 막는다 — 새 키가 생겨도 조용히 안 열린다 */
export const AI_FORBIDDEN_PREFIXES: readonly string[] = [
  // 안전 게이트 기준값 전부
  'gate_',
  // 알림 켜고 끄기와 그 관문
  'notify_',
  // 증권사 연결
  'kis_',
  // 손절 보호 정책
  'protection_',
  // AI 개입 수준 자체. **AI 가 자기 권한을 못 넓힌다** (§15.3)
  'ai_intervention_',
  // AI 운영자를 켜고 끄는 일도 사람 몫이다
  'operator_',
]

export interface Proposal {
  settingKey: string
  currentValue: unknown
  proposedValue: unknown
  rationale: string
  /** 무엇을 보고 제안했나. 비면 제안이 아니다 */
  evidence: { kind: string; ref: string; note: string }[]
}

export type ProposalRejection = { reason: string; userMessage: string }

/**
 * AI 가 이 키를 건드려도 되나.
 *
 * **막는 쪽이 기본이다.** 모르는 키는 막는다 — 새 설정이 생겼을 때 기본이 「허용」이면
 * 그 키는 아무도 검토하지 않은 채로 AI 에게 열린다.
 */
export function aiMayPropose(settingKey: string): ProposalRejection | null {
  const key = settingKey.trim()
  if (key === '') {
    return { reason: 'empty_key', userMessage: '어떤 설정인지가 비어 있습니다' }
  }
  if (AI_FORBIDDEN_KEYS.includes(key)) {
    return {
      reason: `forbidden_key:${key}`,
      userMessage: 'AI 가 바꿀 수 없는 설정입니다. 사람이 직접 고쳐 주세요',
    }
  }
  const prefix = AI_FORBIDDEN_PREFIXES.find((p) => key.startsWith(p))
  if (prefix) {
    return {
      reason: `forbidden_prefix:${prefix}`,
      userMessage: 'AI 가 바꿀 수 없는 갈래의 설정입니다. 사람이 직접 고쳐 주세요',
    }
  }
  return null
}

export function validateProposal(p: Proposal): ProposalRejection | null {
  const forbidden = aiMayPropose(p.settingKey)
  if (forbidden) return forbidden
  if (p.rationale.trim() === '') {
    return { reason: 'no_rationale', userMessage: '왜 바꾸는지가 없어 후보로 올리지 않았습니다' }
  }
  if (p.evidence.length === 0) {
    return { reason: 'no_evidence', userMessage: '근거가 없어 후보로 올리지 않았습니다' }
  }
  if (p.proposedValue === undefined || p.proposedValue === null) {
    return { reason: 'no_value', userMessage: '바꿀 값이 없습니다' }
  }
  if (JSON.stringify(p.proposedValue) === JSON.stringify(p.currentValue)) {
    return { reason: 'same_value', userMessage: '지금 값과 같습니다' }
  }
  return null
}

// ── 언제부터 적용하나 (§15.2) ────────────────────────────

export type ApplyTiming =
  /** 다음 거래일부터. 전략에 영향을 주는 변경 전부 */
  | { when: 'next_trade_day'; reason: string }
  /** 오늘부터. **신호를 막는 쪽만** */
  | { when: 'today'; reason: string }

/**
 * 이 변경이 신호를 막는 쪽인가.
 *
 * 막는 쪽이면 오늘 적용해도 된다 — 기다릴 이유가 없다. 푸는 쪽이면 다음 거래일부터다.
 * **모르면 다음 거래일**이다. 모르는 것을 오늘 적용하면 그날 성과가 무엇의 성과인지 모른다.
 */
export function applyTiming(
  settingKey: string, currentValue: unknown, proposedValue: unknown,
): ApplyTiming {
  const cur = typeof currentValue === 'number' ? currentValue : null
  const next = typeof proposedValue === 'number' ? proposedValue : null

  // 신호를 덜 내게 하는 방향인가
  const TIGHTENS_WHEN_LOWER = ['signal_max_per_day']
  const TIGHTENS_WHEN_HIGHER = [
    'signal_min_net_ev_r', 'signal_min_enter_now_prob', 'signal_min_target_cost_multiple',
    'signal_opening_block_minutes', 'signal_closing_block_minutes',
    'signal_cooldown_minutes', 'signal_same_direction_gap_minutes',
  ]

  if (cur !== null && next !== null) {
    if (TIGHTENS_WHEN_LOWER.includes(settingKey) && next < cur) {
      return { when: 'today', reason: 'tightens_signal' }
    }
    if (TIGHTENS_WHEN_HIGHER.includes(settingKey) && next > cur) {
      return { when: 'today', reason: 'tightens_signal' }
    }
  }
  return { when: 'next_trade_day', reason: 'strategy_change' }
}

/** 서울 기준 다음 날. 주말·휴일은 캘린더가 따로 보므로 여기서는 하루 뒤다 */
export function nextTradeDate(today: string): string {
  const d = new Date(`${today}T00:00:00+09:00`)
  d.setUTCDate(d.getUTCDate() + 1)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d)
}

export function effectiveDateFor(timing: ApplyTiming, today: string): string {
  return timing.when === 'today' ? today : nextTradeDate(today)
}

/** AI 응답을 후보로 읽는다. 모르는 꼴이면 지어내지 않고 버린다 */
export function parseProposals(raw: unknown): Proposal[] {
  if (typeof raw !== 'object' || raw === null) return []
  const list = (raw as Record<string, unknown>).proposals
  if (!Array.isArray(list)) return []
  return list.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const o = item as Record<string, unknown>
    const settingKey = typeof o.setting_key === 'string' ? o.setting_key.trim() : ''
    if (settingKey === '') return []
    const evidence = Array.isArray(o.evidence) ? o.evidence : []
    return [{
      settingKey,
      currentValue: o.current_value ?? null,
      proposedValue: o.proposed_value ?? null,
      rationale: typeof o.rationale === 'string' ? o.rationale.trim() : '',
      evidence: evidence.flatMap((e) => {
        if (typeof e !== 'object' || e === null) return []
        const r = e as Record<string, unknown>
        const ref = typeof r.ref === 'string' ? r.ref.trim() : ''
        if (ref === '') return []
        return [{
          kind: typeof r.kind === 'string' ? r.kind : 'unknown',
          ref,
          note: typeof r.note === 'string' ? r.note : '',
        }]
      }),
    }]
  })
}

export function buildProposalPrompt(
  allowedKeys: readonly { key: string; label: string; current: unknown; min?: number; max?: number }[],
  reportLines: readonly string[],
): string {
  return [
    '너는 선물 트레이딩 설정을 검토하는 사람이다.',
    '',
    '규칙',
    '- 아래 「바꿀 수 있는 설정」에 **있는 키만** 제안한다. 없는 키를 쓰면 버려진다',
    '- 아래 「성과표」에 있는 숫자만 근거로 쓴다. 새로 계산하지 않는다',
    '- 근거 없이 제안하지 않는다. evidence 가 비면 그 제안은 버려진다',
    '- 지금 값과 같은 값을 제안하지 않는다',
    '- 확신이 없으면 아무것도 제안하지 않는다. 빈 배열이 정답일 때가 많다',
    '',
    '바꿀 수 있는 설정',
    ...allowedKeys.map((k) => {
      const range = k.min !== undefined || k.max !== undefined ? ` (${k.min ?? '-'}~${k.max ?? '-'})` : ''
      return `- ${k.key}: ${k.label}, 지금 ${JSON.stringify(k.current)}${range}`
    }),
    '',
    '성과표',
    ...reportLines.map((l) => `- ${l}`),
    '',
    'JSON 으로만 답한다:',
    '{"proposals": [{"setting_key": "...", "current_value": ..., "proposed_value": ..., '
    + '"rationale": "...", "evidence": [{"kind": "pattern_report", "ref": "...", "note": "..."}]}]}',
  ].join('\n')
}
