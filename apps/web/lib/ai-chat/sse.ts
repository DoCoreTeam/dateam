// SSE 라인 파서 (순수 함수 — 서버 프로바이더 + 클라 훅 공용 SSOT, 04 §5-3)
// db-chat/route.ts:161-216의 인라인 파싱 로직을 순수 함수로 승격 (재사용·단일구현 정책).
// 규칙: '\n' 분리 → 마지막 미완 라인은 버퍼 이월 → 'data: ' 접두 라인만 JSON.parse, malformed는 skip.

export interface SseParser {
  push(chunk: string): unknown[] // 파싱 성공한 JSON 이벤트 배열 (malformed는 skip)
  flush(): unknown[] // 잔여 버퍼 처리
}

export function createSseParser(): SseParser {
  let buf = ''

  function drain(lines: string[]): unknown[] {
    const events: unknown[] = []
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const jsonStr = line.slice(6).trim()
      if (!jsonStr) continue
      try {
        events.push(JSON.parse(jsonStr))
      } catch {
        // malformed chunk skip
      }
    }
    return events
  }

  return {
    push(chunk: string): unknown[] {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop() ?? '' // 마지막 미완 라인 버퍼 이월
      return drain(lines)
    },
    flush(): unknown[] {
      if (!buf) return []
      const lines = buf.split('\n')
      buf = ''
      return drain(lines)
    },
  }
}
