/**
 * 말로 설정 바꾸기 — **미리보기까지만, 저장은 사람이** (명세 §15.2 · §15.3 · M6 · M7 · M8)
 *
 * ## 왜 이 자리가 필요했나
 *
 * 설정이 101개다. 「ATR 기간」 「SR-01 최소 기대값」 「판단 봉」을 아는 사람만 쓸 수 있는
 * 화면은 설정이 아니라 시험이다 (사용자 지적 2026-09-27 「설정 도저히 나같은 수준에서는
 * 쓸 수가 없이 복잡하고 뭘 이야기 하는지 모르겠네」).
 *
 * ## 규정을 안 비켜 간다
 *
 *   · 금지 목록(§15.3)에 걸리는 키는 **후보로도 안 올린다** — `aiMayPropose` 가 정한다
 *   · 레지스트리에 없는 키, 범위 밖 값, 지금과 같은 값은 여기서 걸러진다
 *   · **사람이 승인하기 전에는 아무 값도 안 바뀐다.** 이 파일은 저장을 아예 못 한다
 *   · 저장은 기존 창구를 그대로 지나 다음 거래일부터 듣는다 (M7)
 *   · 리스크 산술이 안 맞는 값은 저장 창구가 거절한다 (M6)
 *
 * 이 파일에 DB 도 AI 도 없다. 받아 온 글을 규정에 비추는 일만 한다 —
 * 그래야 규정이 맞는지를 시험이 실제로 돌려 확인할 수 있다.
 */

import { TRADING_SETTINGS, validateSetting, type TradingSettingValue } from './registry.ts'
import { aiMayPropose } from '../knowledge/proposal-policy.ts'
import { editableHere, whyElsewhere } from './editable.ts'

/** 한 줄의 제안. **지금 값과 바꿀 값과 왜가 전부 있어야** 미리보기에 오른다 */
export interface SettingChange {
  key: string
  label: string
  currentValue: TradingSettingValue
  nextValue: TradingSettingValue
  /** 왜 바꾸나. 비면 후보가 아니다 */
  why: string
}

export interface RejectedChange {
  key: string
  reason: string
  userMessage: string
}

export interface AssistantPlan {
  changes: SettingChange[]
  /** 왜 못 올렸나. **안 보여 주면 「AI 가 무시했다」로 읽힌다** */
  rejected: RejectedChange[]
}

/** AI 가 돌려줄 꼴. 이것 말고는 안 받는다 */
export interface RawChange {
  key?: unknown
  value?: unknown
  why?: unknown
}

/**
 * 설정 도우미에게 보낼 질문.
 *
 * **비밀은 안 싣는다.** 키·계좌번호는 설정이 아니라 자격증명이고 레지스트리에 없다(S3).
 * 값의 뜻과 지금 값과 범위만 준다 — 그래야 AI 가 범위 밖 숫자를 덜 낸다.
 */
export function buildAssistantPrompt(
  ask: string,
  values: Readonly<Record<string, TradingSettingValue>>,
): string {
  const rows = TRADING_SETTINGS
    .filter((s) => editableHere(s.key) && !aiMayPropose(s.key))
    .map((s) => {
      const range = [
        s.type === 'choice' ? `고를 값: ${(s.choices ?? []).join('|')}` : null,
        s.min !== undefined ? `최소 ${s.min}` : null,
        s.max !== undefined ? `최대 ${s.max}` : null,
      ].filter(Boolean).join(' · ')
      return `- ${s.key} (${s.label}) = ${JSON.stringify(values[s.key] ?? s.defaultValue)}${range ? ` [${range}]` : ''} :: ${s.help}`
    })
  return [
    '너는 선물 트레이딩 설정을 바꾸는 도우미다.',
    '',
    '규칙',
    '- 아래 목록에 있는 키만 쓴다. 없는 키를 지어내지 않는다',
    '- 값은 적힌 범위 안이어야 한다',
    '- 바꿀 이유가 없는 값은 아예 넣지 않는다. 적게 바꾸는 쪽이 낫다',
    '- 각 줄에 why 를 한 문장으로 적는다. 없으면 그 줄은 버려진다',
    '- JSON 으로만 답한다',
    '',
    '바꿀 수 있는 값',
    ...rows,
    '',
    `요청: ${ask}`,
    '',
    '형식: {"changes":[{"key":"...","value":123,"why":"..."}]}',
  ].join('\n')
}

/** 글자로 온 값을 레지스트리의 형으로. 못 읽으면 null 이다 — 지어내지 않는다 */
function coerce(key: string, raw: unknown): TradingSettingValue | null {
  const spec = TRADING_SETTINGS.find((s) => s.key === key)
  if (!spec) return null
  if (spec.type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw)
    return Number.isFinite(n) ? n : null
  }
  if (spec.type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    if (raw === 'true') return true
    if (raw === 'false') return false
    return null
  }
  return typeof raw === 'string' ? raw : null
}

/**
 * AI 가 낸 줄들을 규정에 비춘다.
 *
 * **막는 쪽이 기본이다.** 통과하지 못한 줄은 버리지 않고 사유와 함께 돌려준다 —
 * 조용히 사라지면 사람은 「AI 가 무시했다」로 읽고 같은 말을 또 한다.
 */
export function planChanges(
  raws: readonly RawChange[],
  values: Readonly<Record<string, TradingSettingValue>>,
): AssistantPlan {
  const changes: SettingChange[] = []
  const rejected: RejectedChange[] = []
  const seen = new Set<string>()

  for (const raw of raws) {
    const key = typeof raw.key === 'string' ? raw.key.trim() : ''
    const spec = TRADING_SETTINGS.find((s) => s.key === key)
    if (!spec) {
      rejected.push({ key: key || '(빈 키)', reason: 'unknown_key', userMessage: '그런 설정이 없습니다' })
      continue
    }
    if (seen.has(key)) {
      rejected.push({ key, reason: 'duplicate', userMessage: '같은 설정이 두 번 나와 뒤의 것을 버렸습니다' })
      continue
    }
    // §15.3 — AI 가 건드릴 수 없는 것은 **후보로도 안 올린다**
    const forbidden = aiMayPropose(key)
    if (forbidden) { rejected.push({ key, ...forbidden }); continue }
    // 여기서 못 바꾸는 값(자격증명 등)도 마찬가지다
    if (!editableHere(key)) {
      rejected.push({
        key, reason: 'elsewhere',
        userMessage: whyElsewhere(key) ?? '이 화면에서 바꾸는 값이 아닙니다',
      })
      continue
    }
    const why = typeof raw.why === 'string' ? raw.why.trim() : ''
    if (why === '') {
      rejected.push({ key, reason: 'no_why', userMessage: '왜 바꾸는지가 없어 올리지 않았습니다' })
      continue
    }
    const next = coerce(key, raw.value)
    if (next === null) {
      rejected.push({ key, reason: 'bad_value', userMessage: '값을 읽지 못했습니다' })
      continue
    }
    const invalid = validateSetting(key, next)
    if (invalid) {
      rejected.push({ key, reason: 'out_of_range', userMessage: invalid.userMessage })
      continue
    }
    const current = values[key] ?? spec.defaultValue
    if (JSON.stringify(current) === JSON.stringify(next)) {
      rejected.push({ key, reason: 'same_value', userMessage: '지금 값과 같습니다' })
      continue
    }
    seen.add(key)
    changes.push({ key, label: spec.label, currentValue: current, nextValue: next, why })
  }
  return { changes, rejected }
}

/** AI 가 돌려준 글에서 줄들을 꺼낸다. 못 읽으면 빈 배열이다 — 산문을 숫자로 만들지 않는다 */
export function parseAssistantResponse(text: string): RawChange[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return []
    try { value = JSON.parse(match[0]) } catch { return [] }
  }
  if (!value || typeof value !== 'object') return []
  const list = (value as { changes?: unknown }).changes
  return Array.isArray(list) ? (list as RawChange[]) : []
}
