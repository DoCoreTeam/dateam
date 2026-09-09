// OpenAI — 범용으로 고르게 잘한다. 다른 공급자가 막혔을 때 받아 주는 자리이기도 하다.
//
// 어댑터 본체는 openai-compatible 팩토리에 있다. Groq 과 Grok 이 같은 말을 쓰기 때문에
// 여기 있던 구현을 그리로 옮겼다 — 세 벌이던 것이 한 벌이 됐다.

import { createOpenAiCompatibleProvider } from './openai-compatible.ts'

export { toOpenAiMessages } from './openai-messages.ts'

export const openaiProvider = createOpenAiCompatibleProvider({
  id: 'openai',
  chatModelPattern: /^(gpt|o\d|chatgpt)/i,
})
