// Groq — 오픈소스 모델을 남의 GPU 에서 아주 빠르게 돌려 주는 곳.
//
// 조직에 이미 키가 있다. 「음성 인식」 카드에서 넣은 그 키이고(META stt_api_key),
// lib/ci/ai/meta.ts 는 그 키를 LLM 폴백으로 이미 읽고 있었다 —
// 키 하나가 두 일을 하는데 화면은 한 일만 말하고 있었던 것이 이 파일이 생긴 이유다.

import { createOpenAiCompatibleProvider, byOutputModality } from './openai-compatible.ts'

export const groqProvider = createOpenAiCompatibleProvider({
  id: 'groq',
  // Groq 은 모델마다 무엇을 뱉는지 알려 준다. 이름으로 짐작하지 않는다.
  // 예전엔 이름 맨 앞을 보는 규칙이라 groq/compound 와 allam-2-7b 를 버리고 있었다
  // (실측 2026-09-14: 14개 중 5개만 통과). 폴백 규칙은 그 답이 없을 때만 쓴다.
  selectChatModel: byOutputModality(/^(llama|mixtral|gemma|qwen|deepseek|kimi|moonshot|allam|openai\/|groq\/|meta-llama\/)/i),
})
