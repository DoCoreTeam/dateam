'use client'

// lib/ui/use-list-query.ts — 목록 상태 ↔ URL 동기화 훅
// 화면은 값을 읽고 patch만 보낸다. 주소 갱신·페이지 리셋·개인설정 저장/복원은 여기서 한다.
//
// 우선순위는 list-query.ts와 같다: URL > 저장된 개인 설정 > 화면 기본값.
// 서버 컴포넌트 화면은 `loadListPrefs()`로 첫 렌더부터 값을 갖고 오면 되고,
// 클라이언트 전용 화면은 `persistKey`만 주면 이 훅이 마운트 때 한 번 복원한다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import {
  resolveListQuery, listQueryToParams, savedFromQuery, shouldResetPage, sanitizeSavedPrefs,
  type ListDefaults, type ListQuery, type SavedListPrefs,
} from './list-query'

interface Options {
  /** 서버에서 미리 읽어온 개인 설정(서버 컴포넌트 화면) */
  saved?: SavedListPrefs | null
  /** 주면 view·size·sort를 이 키로 저장하고, 클라이언트 화면이면 마운트 때 복원한다(라우트 경로 권장) */
  persistKey?: string
}

/** URL에 목록 파라미터가 하나라도 있으면 그게 사용자의 의도다 — 저장 설정으로 덮지 않는다 */
const URL_KEYS = ['view', 'size', 'sort', 'dir'] as const

export function useListQuery(defaults: ListDefaults, options: Options = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [restored, setRestored] = useState<SavedListPrefs | null>(options.saved ?? null)
  const restoreDone = useRef(Boolean(options.saved))

  const query = useMemo(
    () => resolveListQuery(searchParams, defaults, restored),
    // defaults는 화면 상수다(값이 매 렌더 같다) — 주소와 복원값만 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, restored],
  )

  useEffect(() => {
    if (restoreDone.current || !options.persistKey) return
    restoreDone.current = true
    if (URL_KEYS.some((k) => searchParams.get(k))) return

    let alive = true
    // 복원 실패는 조용히 넘어간다 — 기본값으로 도는 게 목록을 못 보는 것보다 낫다
    fetch(`/api/ui-preferences?scopeKey=${encodeURIComponent(options.persistKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (alive && body?.value) setRestored(sanitizeSavedPrefs(body.value)) })
      .catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.persistKey])

  const set = useCallback((patch: Partial<ListQuery>) => {
    const next: ListQuery = {
      ...query,
      ...patch,
      filters: patch.filters ? { ...query.filters, ...patch.filters } : query.filters,
      page: shouldResetPage(patch) ? 1 : (patch.page ?? query.page),
    }
    // 목록이 소유하지 않은 파라미터(`tab` 등)는 그대로 둔다 — 표준이 남의 상태를 부수면 아무도 안 쓴다.
    router.replace(`${pathname}?${listQueryToParams(next, defaults, searchParams)}`, { scroll: false })

    if (!options.persistKey) return
    // 저장 실패가 화면 조작을 막으면 안 된다 — 다음 변경에서 다시 시도된다
    void fetch('/api/ui-preferences', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scopeKey: options.persistKey, value: savedFromQuery(next) }),
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, pathname, router, searchParams, options.persistKey])

  return { query, set }
}
