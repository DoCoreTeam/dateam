import type { AiChatProviderId, AiChatCitation } from '@/types/database'

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

export interface ChatToolsOption {
  webSearch?: boolean // S3 — v1은 web_search만
}

export interface StreamChatParams {
  apiKey: string
  model: string
  system?: string
  turns: ChatTurn[] // 마지막 원소 = 이번 사용자 발화
  maxOutputTokens?: number // 미지정 시 capabilities.defaultMaxOutputTokens
  signal: AbortSignal // 필수 — Stop/클라 이탈 전파
  tools?: ChatToolsOption // S3 — capabilities.tools=false 프로바이더에 지정 시 서버 400
  onDelta: (text: string) => void
  onThinking?: (text: string) => void // Claude summarized thinking 전용
  onCitation?: (c: AiChatCitation) => void // S3 — web_search 출처(중복 url dedupe는 호출측)
  onToolStatus?: (s: 'searching' | 'done') => void // S3 — "웹 검색 중…" 인디케이터
}

export interface StreamChatResult {
  text: string // 누적 전체 응답
  thinking: string | null
  usage: ChatUsage // 미보고 시 0
  stopped: boolean // signal abort로 중단됨
  citations?: AiChatCitation[] // S3 — 수집분(저장용, url dedupe)
}

// capabilities는 세션1부터 4필드 전부 선언(04 §4 확정) — vision·tools는 선언만, 소비는 세션2·3
export interface ProviderCapabilities {
  vision: boolean
  tools: boolean
  thinking: boolean
  defaultMaxOutputTokens: number
}

export interface ProbeModelResult {
  usable: boolean
}

export interface ChatProvider {
  id: ProviderId
  label: string // 'Gemini' | 'Claude' | 'OpenAI'
  capabilities: ProviderCapabilities
  streamChat(params: StreamChatParams): Promise<StreamChatResult>
  listModels(apiKey: string): Promise<string[]>
  // 옵셔널 — listModels가 노출해도 현재 키/요금제로 실제 전송 불가한 모델(404 삭제·429 할당량0)을
  // 걸러내기 위한 실사용 프로브. 미구현 프로바이더는 refreshModelCatalog가 스킵(기존 동작 유지).
  probeModel?(apiKey: string, model: string): Promise<ProbeModelResult>
}
