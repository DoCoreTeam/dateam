// Groq — 오픈소스 모델을 남의 GPU 에서 아주 빠르게 돌려 주는 곳.
//
// 조직에 이미 키가 있다. 「음성 인식」 카드에서 넣은 그 키이고(META stt_api_key),
// lib/ci/ai/meta.ts 는 그 키를 LLM 폴백으로 이미 읽고 있었다 —
// 키 하나가 두 일을 하는데 화면은 한 일만 말하고 있었던 것이 이 파일이 생긴 이유다.

import { createOpenAiCompatibleProvider } from './openai-compatible.ts'

export const groqProvider = createOpenAiCompatibleProvider({
  id: 'groq',
  // 목록에 whisper 전사 모델과 임베딩이 섞여 나온다. 채팅 계열만 고른다
  chatModelPattern: /^(llama|mixtral|gemma|qwen|deepseek|kimi|moonshot|openai\/)/i,
})
