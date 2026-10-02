'use client'

import { useEffect, useState } from 'react'
import { liveWindowAt } from '@/lib/trading/live-window'
import { parseLivePricePayload } from '@/lib/trading/bars/live-price-core'

export type LivePriceConnection = 'idle' | 'connecting' | 'live' | 'retrying'

interface LivePriceValue {
  price: number
  observedAt: string
}

/**
 * 보이는 장중 탭만 현재가 스트림을 쥔다. 숨은 탭은 연결을 끊고, 돌아오면 새로 연다.
 * EventSource 의 자동 재연결 대신 우리가 닫고 2초 뒤 다시 여는 이유는 장 마감과 탭 숨김을
 * 같은 자리에서 제어하기 위해서다.
 */
export function useLivePrice(initial: LivePriceValue | null): {
  price: LivePriceValue | null
  connection: LivePriceConnection
} {
  const [price, setPrice] = useState<LivePriceValue | null>(initial)
  const [connection, setConnection] = useState<LivePriceConnection>('idle')

  // 전체 현황 새로고침이 더 최근 값을 가져왔다면 스트림 상태에도 합친다.
  useEffect(() => {
    if (!initial) return
    setPrice((current) => !current || Date.parse(initial.observedAt) > Date.parse(current.observedAt)
      ? initial
      : current)
  }, [initial])

  useEffect(() => {
    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let sessionCheck: ReturnType<typeof setInterval> | null = null
    let disposed = false

    const close = (): void => {
      source?.close()
      source = null
      if (retry) clearTimeout(retry)
      retry = null
    }
    const connect = (): void => {
      close()
      if (disposed || document.hidden || !liveWindowAt(new Date()).live) {
        setConnection('idle')
        return
      }
      setConnection('connecting')
      const next = new EventSource('/api/trading/price/stream')
      source = next
      next.onopen = () => setConnection('live')
      next.addEventListener('price', (event) => {
        try {
          const parsed = parseLivePricePayload(JSON.parse((event as MessageEvent<string>).data))
          if (!parsed) return
          setPrice({ price: parsed.price, observedAt: parsed.observedAt })
          setConnection('live')
        } catch {
          // 깨진 한 이벤트는 버리고 연결은 유지한다. 다음 정상 가격이 화면을 회복시킨다.
        }
      })
      next.addEventListener('status', () => setConnection('retrying'))
      next.onerror = () => {
        next.close()
        if (source === next) source = null
        if (disposed || document.hidden) return
        setConnection('retrying')
        retry = setTimeout(connect, 2_000)
      }
    }
    const onVisibility = (): void => connect()

    connect()
    document.addEventListener('visibilitychange', onVisibility)
    // 장 시작·마감을 넘긴 채 탭을 열어 둔 경우를 다시 판정한다.
    sessionCheck = setInterval(connect, 60_000)
    return () => {
      disposed = true
      close()
      if (sessionCheck) clearInterval(sessionCheck)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return { price, connection }
}
