// 프로바이더 표시 라벨 SSOT(leaf 모듈 — 무거운 의존성 없음).
// 서버 컴포넌트(page.tsx)와 클라이언트 컴포넌트가 공유하므로, 'use client' 파일(AiChatClient)에서
// export하면 RSC 경계 위반("Could not find module ... in React Client Manifest")이 난다 → 여기 둔다.
import type { AiChatProviderId } from '@/types/database'

export const PROVIDER_LABELS: Record<AiChatProviderId, string> = {
  gemini: 'Gemini',
  claude: 'Claude',
  openai: 'OpenAI',
}
