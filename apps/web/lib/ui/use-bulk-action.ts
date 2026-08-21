'use client'

// lib/ui/use-bulk-action.ts — 목록에서 고른 여러 건에 같은 일을 시킨다 (§2-6 목록 표준)
//
// **왜 생겼나**(v0.7.574): 회사 목록에서 여러 건을 골라도 할 수 있는 일이 "AI로 채우기"
// 하나뿐이었다. 삭제는 상세 화면에 들어가야만 있어서, 20건을 지우려면 상세를 20번 열어야 했다.
// 호스트에는 이미 `선택 삭제`/`선택 되돌리기` 패턴이 있었는데(ai-chat/analyze) CRM 이 안 썼다.
//
// ## 왜 서버에 bulk 엔드포인트를 새로 만들지 않았나
//
// 만들면 **삭제 규칙이 두 벌이 된다.** 한 건 삭제 경로에는 관계·삭제 계약(R-1~R-6),
// 감사 기록, 소프트 삭제 판정, 워크스페이스 가드가 전부 얹혀 있다. bulk 를 따로 짜면
// 그중 하나를 빠뜨려도 아무도 모르고, 알아챌 때는 이미 여러 건이 그렇게 지워진 뒤다.
//
// 그래서 **이미 있는 한 건짜리 경로를 그대로 여러 번 부른다.** 규칙이 갈릴 여지가 구조적으로 없다.
// 대신 왕복이 늘어나므로 동시 실행으로 시간을 줄이고(아래), 진행률을 화면에 보여 준다.
//
// ## 부분 성공은 정상이다
//
// 20건 중 3건이 실패했을 때 전부 되돌리면 성공한 17건까지 없던 일이 된다.
// 되는 것은 되게 하고, **무엇이 왜 안 됐는지 이름과 함께** 돌려준다.

import { useCallback, useRef, useState } from 'react'
import { runWithConcurrency } from '@/lib/ai-chat/concurrency'

/**
 * 한 번에 보내는 요청 수.
 *
 * 순차면 100건에 100번의 왕복을 사람이 그대로 기다린다. 반대로 크게 열면
 * 브라우저 연결 상한(호스트당 6)에 막혀 오히려 느려지고 DB 잠금 경합만 는다.
 */
const CONCURRENCY = 4

/** 한 번에 고를 수 있는 상한 — 되돌리기 부담이 사람이 감당할 크기를 넘지 않게 */
export const BULK_MAX = 100

export interface BulkFailure {
  id: string
  /** 사용자가 알아볼 이름. 화면이 목록에서 떠서 넘긴다 */
  label: string
  message: string
}

export interface BulkResult {
  ok: number
  failed: BulkFailure[]
}

interface Options {
  /** 이 id 로 무엇을 할지. 성공하면 resolve, 실패하면 사람이 읽을 말로 throw */
  run: (id: string) => Promise<void>
  /** id → 사용자가 알아보는 이름. 실패 줄에 붙는다 */
  labelOf: (id: string) => string
  /**
   * 서버가 아무 말도 안 했을 때 쓸 **완성된 문장**.
   *
   * 어간에 "하지 못했습니다"를 붙이는 방식이면 "되살리기하지 못했습니다"가 나온다 —
   * 한국어는 그렇게 붙지 않는다. 부르는 쪽이 이미 다듬은 말을 준다.
   */
  fallbackMessage: string
  /** 다 끝난 뒤 한 번. 보통 목록 재조회 */
  onDone?: () => void
}

/**
 * 고른 것들에 같은 일을 시키고, 진행률과 부분 실패를 돌려준다.
 *
 * 이름을 **미리 떠 둔다**: 끝나면 목록을 다시 부르는데, 그 사이 지워진 행은
 * 목록에서 사라져 이름을 찾을 수 없다. 그러면 결과 카드에 id 만 남는다.
 */
export function useBulkAction({ run, labelOf, fallbackMessage, onDone }: Options) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [result, setResult] = useState<BulkResult | null>(null)
  const running = useRef(false)

  const start = useCallback(async (ids: readonly string[]) => {
    if (ids.length === 0 || running.current) return
    running.current = true
    setBusy(true)
    setResult(null)
    setDone(0)
    setTotal(ids.length)

    // 목록이 바뀌기 전에 이름을 떠 둔다 — 지워진 뒤에는 못 찾는다
    const labels = new Map(ids.map((id) => [id, labelOf(id)]))

    try {
      const settled = await runWithConcurrency(ids, CONCURRENCY, async (id) => {
        await run(id)
        setDone((n) => n + 1)
      })

      const failed: BulkFailure[] = []
      settled.forEach((s, i) => {
        if (s?.ok) return
        const id = ids[i]
        failed.push({
          id,
          label: labels.get(id) ?? '이름을 알 수 없는 항목',
          message: s?.error instanceof Error ? s.error.message : fallbackMessage,
        })
      })

      setResult({ ok: ids.length - failed.length, failed })
      onDone?.()
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [run, labelOf, fallbackMessage, onDone])

  return {
    start,
    busy,
    /** 지금까지 끝난 건수 / 전체 — 화면이 "3/20"으로 보여 준다 */
    progress: { done, total },
    result,
    clearResult: useCallback(() => setResult(null), []),
  }
}

/**
 * 한 건짜리 CRM 엔드포인트를 부르는 표준 방법.
 *
 * 실패하면 **서버가 준 문장 그대로** 던진다 — 우리 말로 바꾸면 원인이 흐려진다
 * (예: "이 딜은 진행 중이라 지울 수 없습니다"가 "삭제 실패"가 된다).
 */
export async function callCrmRecord(url: string, method: 'DELETE' | 'POST'): Promise<void> {
  const res = await fetch(url, { method })
  if (res.ok) return
  const body = await res.json().catch(() => null)
  throw new Error(body?.error?.message ?? '처리하지 못했습니다.')
}
