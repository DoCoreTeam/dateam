import 'server-only'

/**
 * 설정 도우미를 실제로 부르는 자리
 *
 * 판정과 프롬프트는 `setting-help.ts` 에 있고 그 모듈은 순수하다 — 쓰는 일이 없기 때문이다.
 * 여기가 유일하게 DB 를 만지는데, 만지는 표는 **지식 카드 하나**다.
 * 설정 표는 안 만진다: 설명하는 일과 고치는 일을 한 모듈에 두면 언젠가 섞인다.
 */

import { callKnowledge } from './ai-call.ts'
import { saveCardDraft } from './cards.ts'
import { tradingSetting } from '../settings/registry.ts'
import { buildSettingHelpPrompt, checkHelp, normalizeHelp } from './setting-help.ts'

export type SettingHelpResult =
  | { made: true; topic: string }
  | { made: false; reason: string; userMessage: string }

/** 도우미 카드의 주제 이름. 설정 키로 짝을 지어 같은 설정에 두 장이 안 쌓인다 */
export function helpTopic(settingKey: string): string {
  return `setting-help:${settingKey}`
}

/**
 * 설정 하나에 도우미를 붙인다.
 *
 * 도우미도 **지식 카드**로 쌓는다. 표를 하나 더 만들지 않는 이유: 카드는 이미
 * `available_at` 과 판 쌓기와 근거 강제를 지키고, 도우미에도 그 셋이 다 필요하다.
 */
export async function makeSettingHelp(
  settingKey: string, model?: string | null,
): Promise<SettingHelpResult> {
  const spec = tradingSetting(settingKey)
  if (!spec) return { made: false, reason: 'unknown_key', userMessage: '모르는 설정입니다' }

  const call = await callKnowledge({
    purpose: 'setting_help',
    prompt: buildSettingHelpPrompt(spec),
    model,
    json: false,
    maxOutputTokens: 1024,
  })
  if (!call.ok) return { made: false, reason: call.reason, userMessage: call.userMessage }

  const body = normalizeHelp(call.text)
  const bad = checkHelp(body)
  if (bad) return { made: false, ...bad }

  /**
   * 카드로 넣는다. **AI 를 다시 부르지 않는다** — 글은 위에서 이미 받았다.
   * `makeCard` 를 쓰면 같은 글을 만들려고 한 번 더 부르고 예산이 두 배로 나간다.
   *
   * 근거는 레지스트리 자체다. 그 설정이 근거이고 지어낸 것이 아니다.
   */
  const topic = helpTopic(settingKey)
  const saved = await saveCardDraft(
    {
      topic,
      title: `${spec.label} 풀이`,
      body,
      sources: [{
        kind: 'observation',
        ref: `setting:${settingKey}`,
        note: `${spec.source} · 기본값 ${JSON.stringify(spec.defaultValue)}`,
      }],
    },
    call.model,
    'setting-help-v1',
  )
  if (!saved.made) return { made: false, reason: saved.reason, userMessage: saved.userMessage }
  return { made: true, topic }
}
