// Jev (Vercel AI Gateway) — 모델을 만들지 않고 **여러 벤더 앞에 서는 관문**.
//
// 키 하나로 뒤에 있는 모델 아무거나 부른다(2026-09-26 실측 390개). 그래서 이름 규칙으로
// 「우리 모델인가」를 가릴 수 없다 — 이름이 `openai/…`·`anthropic/…`·`google/…` 로 남의 것이다.
// 관문이 말해 주는 출력 종류를 그대로 믿고, 안 말해 주면 글자를 뱉는 계열만 남긴다.
//
// AI 트레이딩의 판단 모델(Jev)도 이 키를 쓴다 — 키를 두 군데서 관리하지 않으려고 같은 공급자다.

import { createOpenAiCompatibleProvider, byOutputModality } from './openai-compatible.ts'

export const jevProvider = createOpenAiCompatibleProvider({
  id: 'jev',
  // 관문 모델 이름은 `벤더/모델` 꼴이다. 그림·소리 전용은 출력 종류로 걸러진다
  selectChatModel: byOutputModality(/^[a-z0-9-]+\//i),
})
