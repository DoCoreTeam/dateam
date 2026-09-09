// 프로바이더 표시 라벨 (파생)
//
// 원본은 lib/ai/provider-catalog.ts 의 명세다. 이 파일은 그것을 화면이 쓰기 좋은 표로 바꿔 둘 뿐이다.
// 서버 컴포넌트와 클라이언트 컴포넌트가 함께 쓰므로 leaf 모듈로 남긴다
// ('use client' 파일에서 export 하면 RSC 경계 위반이 난다).
import { AI_PROVIDERS, deriveLabels } from '../ai/provider-catalog.ts'
import type { AiChatProviderId } from '@/types/database'

export const PROVIDER_LABELS: Record<AiChatProviderId, string> = deriveLabels(AI_PROVIDERS)
