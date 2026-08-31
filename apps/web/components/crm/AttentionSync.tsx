'use client'

// components/crm/AttentionSync.tsx — 서버에서 센 숫자를 다시 세게 만드는 자리
//
// 사이드바 「오늘 N」은 `(crm)/layout.tsx` 가 **서버에서** 센다.
// 레이아웃은 클라이언트 이동으로는 다시 그려지지 않아서, 할 일을 끝내도 숫자가 그대로였다.
// `router.refresh()` 가 그 레이아웃까지 다시 받아 오는 유일한 방법이다.
//
// **몰아치지 않게 잠깐 모은다** — 목록에서 여러 건을 연달아 처리하면 신호가 그만큼 오는데,
// 그때마다 서버를 부르면 화면이 깜빡이고 서버도 그만큼 맞는다.

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAttentionChanged } from '@/lib/crm/ui/attention-signal'

/** 연달아 온 신호를 이만큼 모았다가 한 번에 처리한다 */
const COALESCE_MS = 400

export default function AttentionSync() {
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onChange = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => router.refresh(), COALESCE_MS)
  }, [router])

  useAttentionChanged(onChange)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return null
}
