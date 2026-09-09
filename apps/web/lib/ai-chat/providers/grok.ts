// Grok (x.ai) — 최신 사건을 묻는 데 강하다. 시장 동향과 경쟁사 조사에 쓴다.

import { createOpenAiCompatibleProvider } from './openai-compatible.ts'

export const grokProvider = createOpenAiCompatibleProvider({
  id: 'grok',
  chatModelPattern: /^grok/i,
})
