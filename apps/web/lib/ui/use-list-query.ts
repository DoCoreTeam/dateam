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

/**
 * 복원한 개인 설정을 탭이 살아 있는 동안 들고 있는다.
 *
 * 왜: 목록 화면을 옮길 때마다 `/api/ui-preferences`를 새로 물었다.
 *   그 요청 하나가 **DB 왕복 1회 + 인증 서버 왕복 1회**다(실측).
 *   개인 설정은 이 탭에서만 바뀌고, 바뀔 때 우리가 직접 쓰므로 서버에 다시 물을 이유가 없다.
 *   (근거: docs/2026-08-16-performance-audit/PLAN.md §2-2)
 *
 * 탭 메모리라 새로고침하면 사라진다 — 다른 기기에서 바꾼 설정을 영원히 못 보는 일은 없다.
 */
const prefsCache = new Map<string, SavedListPrefs | null>()

export function useListQuery(defaults: ListDefaults, options: Options = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [restored, setRestored] = useState<SavedListPrefs | null>(options.saved ?? null)
  const restoreDone = useRef(Boolean(options.saved))
  /**
   * "조건을 다시 확정했다"를 세는 수.
   *
   * 왜 필요한가(v0.7.574 실측): `listQueryToParams` 는 **기본값과 같은 값을 주소에 쓰지 않는다**
   * (주소를 짧게 유지하려는 의도된 설계). 그래서 기본값으로 되돌리는 조작은 주소가 그대로고,
   * `router.replace` 가 같은 주소로 가면 `searchParams` 도 안 바뀌어 **재조회가 아예 안 일어난다.**
   *
   * 실측: 회사 목록에서 '더 보기'로 60행을 쌓은 뒤 "20개씩"(=기본값)을 고르면
   * 행 수가 60 그대로였다. `mode:'pages'` 목록들이 멀쩡해 보였던 것은 `shouldResetPage` 가
   * `page` 를 함께 바꿔 주소가 우연히 달라졌기 때문이지, 이 구멍이 없어서가 아니다.
   */
  const [revision, setRevision] = useState(0)

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

    const key = options.persistKey
    if (prefsCache.has(key)) {
      const hit = prefsCache.get(key) ?? null
      if (hit) setRestored(hit)
      return
    }

    let alive = true
    // 복원 실패는 조용히 넘어간다 — 기본값으로 도는 게 목록을 못 보는 것보다 낫다
    fetch(`/api/ui-preferences?scopeKey=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const value = body?.value ? sanitizeSavedPrefs(body.value) : null
        // 없다는 사실도 캐시한다 — 안 그러면 설정을 한 번도 안 바꾼 화면은 매번 다시 묻는다
        prefsCache.set(key, value)
        if (alive && value) setRestored(value)
      })
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
    /**
     * 주소가 실제로 달라지는지 **먼저 본다.**
     *
     * 같은 함수로 양쪽을 만들어 비교한다 — 주소에 적힌 순서로 비교하면
     * 순서만 다른 같은 조건을 "달라졌다"고 오판한다.
     */
    const nextParams = listQueryToParams(next, defaults).toString()
    const nowParams = listQueryToParams(query, defaults).toString()

    // 목록이 소유하지 않은 파라미터(`tab` 등)는 그대로 둔다 — 표준이 남의 상태를 부수면 아무도 안 쓴다.
    router.replace(`${pathname}?${listQueryToParams(next, defaults, searchParams)}`, { scroll: false })

    /**
     * 주소가 안 바뀌면 `searchParams` 도 안 바뀌고, 화면은 아무 일도 없었다고 읽는다.
     * 그때만 리비전을 올려 **"조건을 다시 확정했다"는 사실 자체를 신호로** 만든다.
     */
    if (nextParams === nowParams) setRevision((r) => r + 1)

    if (!options.persistKey) return
    // 방금 쓴 값을 캐시에도 반영한다 — 안 하면 다음 방문에 옛 값으로 되돌아간다
    prefsCache.set(options.persistKey, savedFromQuery(next))
    // 저장 실패가 화면 조작을 막으면 안 된다 — 다음 변경에서 다시 시도된다
    void fetch('/api/ui-preferences', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scopeKey: options.persistKey, value: savedFromQuery(next) }),
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, pathname, router, searchParams, options.persistKey])

  /**
   * **화면이 조회 의존성으로 쓸 값 하나.**
   *
   * 화면이 `query.size`·`query.q` 를 개별로 나열하면 ① 새 필터를 더할 때 빠뜨리고
   * ② 기본값 되돌리기(위 revision)를 통째로 못 본다. 문자열 하나로 주면 둘 다 안 생긴다.
   *
   * 주소에 남는 파라미터만 담는다 — 남의 파라미터(`tab` 등)가 바뀔 때까지 목록을 다시 부르지 않는다.
   */
  const queryKey = useMemo(() => {
    const params = listQueryToParams(query, defaults)
    // 표/카드 전환은 **같은 데이터를 다르게 그리는 것**이라 서버에 다시 물을 이유가 없다.
    // 빼지 않으면 보기만 바꿔도 목록 조회가 한 번 더 나간다.
    params.delete('view')
    return `${params.toString()}#${revision}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, revision])

  return { query, set, queryKey }
}
