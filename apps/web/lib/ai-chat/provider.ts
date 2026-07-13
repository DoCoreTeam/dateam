import type { AiChatProviderId } from '@/types/database'

// 공통 타입 (서버/클라 공용, 순수 타입 — 04-implementation-contract §4)
// 확정 스타일 = 콜백+Promise (AsyncIterable 금지). 확장은 옵션 필드 추가로만.

export type ProviderId = AiChatProviderId // 'gemini' | 'claude' | 'openai'

// ── 첨부 (세션2에서 소비 — 세션1은 필드 선언만) ──
export interface AttachmentInput {
  kind: 'image' | 'pdf' | 'document'
  mime: string
  filename: string
  dataBase64: string // 서버가 Storage download → base64
}

// ── 턴 (세션1 기본 + attachments 옵셔널 선언) ──
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  attachments?: AttachmentInput[] // 세션2 — user 턴에만
}

export interface ChatUsage {
  promptTokens: number
  outputTokens: number
  totalTokens: number
}

export interface StreamChatParams {
  apiKey: string
  model: string
  system?: string
  turns: ChatTurn[] // 마지막 원소 = 이번 사용자 발화
  maxOutputTokens?: number // 미지정 시 capabilities.defaultMaxOutputTokens
  signal: AbortSignal // 필수 — Stop/클라 이탈 전파
  onDelta: (text: string) => void
  onThinking?: (text: string) => void // Claude summarized thinking 전용
}

export interface StreamChatResult {
  text: string // 누적 전체 응답
  thinking: string | null
  usage: ChatUsage // 미보고 시 0
  stopped: boolean // signal abort로 중단됨
}

// capabilities는 세션1부터 4필드 전부 선언(04 §4 확정) — vision·tools는 선언만, 소비는 세션2·3
export interface ProviderCapabilities {
  vision: boolean
  tools: boolean
  thinking: boolean
  defaultMaxOutputTokens: number
}

export interface ChatProvider {
  id: ProviderId
  label: string // 'Gemini' | 'Claude' | 'OpenAI'
  capabilities: ProviderCapabilities
  streamChat(params: StreamChatParams): Promise<StreamChatResult>
  listModels(apiKey: string): Promise<string[]>
}
