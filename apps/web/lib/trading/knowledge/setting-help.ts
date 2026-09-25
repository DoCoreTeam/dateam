/**
 * 설정 도우미 — **원래 설명을 대체하지 않고 덧붙인다**
 *
 * ## 왜 대체하지 않나
 *
 * 레지스트리의 `help` 는 우리가 쓴 말이고, 도우미는 AI 가 쓴 말이다. 도우미가 원래 설명을
 * 덮으면 **AI 가 죽은 날 화면이 빈다.** 그리고 화면이 빈 설정을 사람이 만진다.
 * 그래서 원래 설명은 늘 그대로 있고, 도우미는 그 아래 붙는다.
 *
 * ## 왜 값을 못 바꾸나
 *
 * 설명하는 자리와 바꾸는 자리를 같은 모듈에 두면 언젠가 「설명하면서 고쳐 주기」가 된다.
 * 여기에는 쓰는 길이 없다 — 가드가 센다.
 *
 * ## 왜 범위를 레지스트리에서 끌어오나
 *
 * 「이 값은 보통 5에서 30 사이입니다」를 AI 가 지어내면, 그 숫자가 실제 `min`·`max` 와
 * 다를 수 있다. 사람은 화면의 두 숫자 중 어느 것이 맞는지 모른다. 그래서 범위와 출처는
 * **레지스트리에서 읽어 프롬프트에 넣고**, AI 는 그것을 풀어 쓰기만 한다.
 */

import { tradingSetting, type TradingSetting } from '../settings/registry.ts'
import { TRADING_GROUP_LABEL, TRADING_USED_FROM_LABEL } from '../settings/labels.ts'

export const MAX_HELP_LENGTH = 600
export const TRUNCATION_MARK = '… (잘림)'

export type HelpRejection = { reason: string; userMessage: string }

/** AI 에게 주는 사실. **여기 없는 것은 프롬프트에 안 들어간다** */
export function settingFactLines(s: TradingSetting): string[] {
  const range = [
    s.min !== undefined ? `최소 ${s.min}` : null,
    s.max !== undefined ? `최대 ${s.max}` : null,
  ].filter(Boolean).join(', ')
  return [
    `이름: ${s.label}`,
    `묶음: ${TRADING_GROUP_LABEL[s.group]}`,
    `우리 설명: ${s.help}`,
    `형: ${s.type}${s.unit ? ` (${s.unit})` : ''}`,
    `기본값: ${JSON.stringify(s.defaultValue)}`,
    range === '' ? '범위: 정해진 것 없음' : `범위: ${range}`,
    `언제부터 쓰나: ${TRADING_USED_FROM_LABEL[s.usedFrom]}`,
    `근거: ${s.source}`,
  ]
}

export function buildSettingHelpPrompt(s: TradingSetting): string {
  return [
    '너는 선물 트레이딩 설정 하나를 처음 보는 사람에게 풀어 설명한다.',
    '',
    '규칙',
    '- 아래 「설정 기록」에 **있는 것만** 쓴다. 범위나 기본값을 지어내지 않는다',
    '- 값을 얼마로 하라고 말하지 않는다. 무엇을 뜻하는지만 말한다',
    '- 이 값을 올리면·내리면 무엇이 달라지는지를 한 문장으로 적는다',
    '- 두세 문장으로 쓴다',
    '',
    '설정 기록',
    ...settingFactLines(s).map((l) => `- ${l}`),
  ].join('\n')
}

/** 값을 권하는 말이 섞였나. 「12로 두세요」는 설명이 아니라 제안이고, 제안은 다른 자리다 */
export const BANNED_PHRASES: readonly string[] = [
  '로 두세요', '으로 두세요', '추천', '권장', '설정하세요', '바꾸세요', '올리세요', '내리세요',
]

export function checkHelp(text: string): HelpRejection | null {
  const body = text.trim()
  if (body === '') return { reason: 'empty', userMessage: 'AI 가 설명을 내지 못했습니다' }
  const hit = BANNED_PHRASES.find((p) => body.includes(p))
  if (hit) {
    return {
      reason: `banned_phrase:${hit}`,
      userMessage: '값을 권하는 말이 있어 싣지 않았습니다. 값 제안은 스펙 후보에서 합니다',
    }
  }
  return null
}

export function normalizeHelp(text: string): string {
  const body = text.trim().replace(/\n{3,}/g, '\n\n')
  if (body.length <= MAX_HELP_LENGTH) return body
  return body.slice(0, MAX_HELP_LENGTH - TRUNCATION_MARK.length) + TRUNCATION_MARK
}

export interface SettingHelp {
  key: string
  /** 우리가 쓴 설명. **늘 있다** */
  original: string
  /** AI 가 덧붙인 말. 없을 수 있다 */
  extra: string | null
}

/**
 * 화면이 그릴 꼴로 만든다.
 *
 * `extra` 가 null 이어도 `original` 은 늘 채워진다 — 그것이 「대체하지 않는다」의 뜻이다.
 */
export function composeHelp(key: string, extra: string | null): SettingHelp | HelpRejection {
  const spec = tradingSetting(key)
  if (!spec) return { reason: 'unknown_key', userMessage: '모르는 설정입니다' }
  return { key, original: spec.help, extra: extra === null ? null : normalizeHelp(extra) }
}
