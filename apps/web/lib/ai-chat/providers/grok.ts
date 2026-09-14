// Grok (x.ai) — 최신 사건을 묻는 데 강하다. 시장 동향과 경쟁사 조사에 쓴다.

import { createOpenAiCompatibleProvider, byOutputModality } from './openai-compatible.ts'

export const grokProvider = createOpenAiCompatibleProvider({
  id: 'grok',
  // x.ai 가 무엇을 뱉는지 말해 주면 그 답을 쓰고, 아니면 이름으로 고른다
  selectChatModel: byOutputModality(/^grok/i),
})
