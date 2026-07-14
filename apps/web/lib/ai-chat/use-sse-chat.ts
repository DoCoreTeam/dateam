'use client'

import { useCallback, useRef, useState } from 'react'
import { createSseParser } from './sse.ts'
import type { AiChatCitation } from '@/types/database'

// 스트림 요청 봉투 (04 §5-1 — 세션1은 send만, mode 생략형).
// 세션2/3 확장 필드는 옵셔널로 선언(상위 호환).
export interface StreamBody {
  conversationId: string
  content?: string
  mode?: 'send' | 'regenerate' | 'edit'
  attachmentIds?: string[]
  editedMessageId?: string
  tools?: { webSearch?: boolean } // S3 §4-3 — web_search 요청 단위 전달(저장 안 함)
}

// SSE 이벤트 핸들러 (04 §5-3 — 세션1 필드. 세션3가 onCitation/onToolStatus 추가 — 옵셔널).
export interface SseChatEvents {
  onDelta(text: string): void
  onThinking(text: string): void
  onDone(payload: { messageId: string }): void
  onError(message: string): void
  onCitation?(c: AiChatCitation): void // S3 — web_search 출처(스트림 중 수신)
  onToolStatus?(status: 'searching' | 'done'): void // S3 — "웹 검색 중…" 인디케이터
}

interface SseEnvelope {
  delta?: string
  thinking?: string
  done?: boolean
  messageId?: string
  error?: string
  citation?: AiChatCitation // S3
  toolStatus?: 'searching' | 'done' // S3
}

export interface UseSseChat {
  send(body: StreamBody, ev: SseChatEvents): Promise<void>
  stop(): void
  streaming: boolean
}

export function useSseChat(): UseSseChat {
  const [streaming, setStreaming] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  const stop = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  const send = useCallback(async (body: StreamBody, ev: SseChatEvents) => {
    const controller = new AbortController()
    controllerRef.current = controller
    setStreaming(true)

    try {
      const res = await fetch('/api/admin/ai-chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string }
        ev.onError(errJson.error ?? `요청 실패 (${res.status})`)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      const parser = createSseParser()

      // 종료(done/error) 이벤트 수신 여부 — 미수신 종료 시 끊김으로 처리 (DC-REV 견고성)
      let terminated = false
      const dispatch = (events: unknown[]) => {
        for (const raw of events) {
          const e = raw as SseEnvelope
          if (typeof e.delta === 'string') ev.onDelta(e.delta)
          else if (typeof e.thinking === 'string') ev.onThinking(e.thinking)
          else if (e.citation && typeof e.citation.url === 'string') ev.onCitation?.(e.citation)
          else if (e.toolStatus === 'searching' || e.toolStatus === 'done') ev.onToolStatus?.(e.toolStatus)
          else if (e.done) {
            terminated = true
            if (e.error) ev.onError(e.error)
            else ev.onDone({ messageId: e.messageId ?? '' })
          }
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        dispatch(parser.push(decoder.decode(value, { stream: true })))
      }
      dispatch(parser.flush())

      // reader 루프가 정상 종료했으나 done/error 이벤트가 없었던 경우 = 연결 끊김.
      // (사용자 Stop=AbortError는 catch로 빠지므로 여기 도달하지 않음)
      if (!terminated) ev.onError('연결이 끊겼습니다')
    } catch (err) {
      // AbortError = 사용자 Stop → 서버가 부분 저장, 클라는 로컬 누적분 유지(에러 아님)
      if (!(err instanceof Error && err.name === 'AbortError')) {
        ev.onError(err instanceof Error ? err.message : '네트워크 오류가 발생했습니다')
      }
    } finally {
      setStreaming(false)
      controllerRef.current = null
    }
  }, [])

  return { send, stop, streaming }
}
