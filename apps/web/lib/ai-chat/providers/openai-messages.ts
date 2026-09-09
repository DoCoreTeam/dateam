// OpenAI 호환 메시지 조립 (순수 함수)
//
// openai.ts 안에 있던 것을 꺼냈다 — Groq 과 Grok 어댑터가 같은 조립을 쓰는데
// 공급자 어댑터끼리 서로를 import 하면 어느 쪽이 원본인지 알 수 없게 된다.

import type { ChatTurn } from '../provider.ts'
import { toOpenAiContent } from '../attachments.ts'

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ReturnType<typeof toOpenAiContent>
}

/** system 을 첫 원소로, 이어서 턴. system 없으면 미포함. 첨부 있으면 멀티모달 파트 */
export function toOpenAiMessages(
  system: string | undefined,
  turns: ChatTurn[],
): OpenAiMessage[] {
  const out: OpenAiMessage[] = []
  if (system) out.push({ role: 'system', content: system })
  for (const t of turns) {
    out.push({ role: t.role, content: t.attachments?.length ? toOpenAiContent(t) : t.content })
  }
  return out
}
