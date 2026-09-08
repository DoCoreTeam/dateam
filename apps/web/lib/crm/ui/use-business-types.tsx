'use client'

/**
 * 사업 유형 목록을 읽는 공용 훅
 *
 * **왜 훅인가**: 목록을 쓰는 화면이 다섯이다(딜 폼·딜 표·딜 상세·거래 조건·리포트).
 * 화면마다 fetch 를 적으면 ①같은 요청이 다섯 번 나가고 ②한 곳만 고치면 나머지가 안 따라온다.
 *
 * **왜 모듈 수준 캐시인가**: 이 목록은 설정에서만 바뀌고 거의 안 바뀐다.
 * 브라우저 안에서만 사는 캐시라 사용자끼리 섞이지 않는다.
 * 설정 화면이 목록을 고치면 `invalidateBusinessTypes()` 로 비운다 —
 * 안 비우면 유형을 추가하고 딜 폼을 열었을 때 새 유형이 없다.
 */

import { useCallback, useEffect, useState } from 'react'
import type { BusinessTypeRow } from '../domain/business-type.ts'
import { businessTypeLabelOf } from '../domain/business-type.ts'

let cache: BusinessTypeRow[] | null = null
let inFlight: Promise<BusinessTypeRow[]> | null = null
const listeners = new Set<(rows: BusinessTypeRow[]) => void>()

async function load(): Promise<BusinessTypeRow[]> {
  if (cache) return cache
  if (!inFlight) {
    inFlight = (async () => {
      const res = await fetch('/api/crm/business-types')
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error?.message ?? '사업 유형을 불러오지 못했습니다.')
      cache = (body.items ?? []) as BusinessTypeRow[]
      listeners.forEach((fn) => fn(cache as BusinessTypeRow[]))
      return cache
    })().finally(() => { inFlight = null })
  }
  return inFlight
}

/** 목록이 바뀌었다 — 다음에 읽는 쪽은 서버에서 다시 받는다 */
export function invalidateBusinessTypes(next?: BusinessTypeRow[]): void {
  cache = next ?? null
  if (next) listeners.forEach((fn) => fn(next))
  else void load().catch(() => { /* 화면이 각자 오류를 말한다 */ })
}

export interface UseBusinessTypes {
  rows: BusinessTypeRow[]
  loading: boolean
  error: string | null
  /** 저장된 키를 보여 줄 이름으로. 모르는 키는 키 그대로 — 감추지 않는다 */
  labelOf: (key: string | null | undefined) => string | null
}

export function useBusinessTypes(): UseBusinessTypes {
  const [rows, setRows] = useState<BusinessTypeRow[]>(cache ?? [])
  const [loading, setLoading] = useState(cache === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const onChange = (next: BusinessTypeRow[]) => { if (alive) setRows(next) }
    listeners.add(onChange)
    load()
      .then((r) => { if (alive) { setRows(r); setError(null) } })
      .catch((e: Error) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false; listeners.delete(onChange) }
  }, [])

  const labelOf = useCallback(
    (key: string | null | undefined) => businessTypeLabelOf(key, rows), [rows])

  return { rows, loading, error, labelOf }
}
