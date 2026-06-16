'use client'

// 임시저장 키 네임스페이스용 사용자 id — 공용PC에서 타 사용자 draft 노출 방지(필수).
// 모듈 캐시로 1회만 조회. id 확정 전에는 null → 호출 훅이 저장/복원을 보류(anon 키 쓰기 금지).
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

let cached: string | null = null
let inflight: Promise<string | null> | null = null

export function useDraftUserId(): string | null {
  const [uid, setUid] = useState<string | null>(cached)
  useEffect(() => {
    if (cached) { setUid(cached); return }
    let alive = true
    inflight = inflight ?? createClient().auth.getUser().then(({ data }) => { cached = data.user?.id ?? null; return cached })
    inflight.then((id) => { if (alive) setUid(id) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return uid
}
