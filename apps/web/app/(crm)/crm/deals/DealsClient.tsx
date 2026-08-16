'use client'

// 딜 화면 (dacrm T1-03)
//
// 보드와 표는 **같은 딜을 다른 눈으로 보는 것**이다 — 서로 다른 화면이 아니다.
// 그래서 한 라우트에 두고 SegmentedTabs(탭 렌더러 SSOT)로 전환한다.
// 어느 눈으로 보고 있는지는 URL 이 기억한다 — 링크를 공유하면 같은 눈으로 열린다.
//
// 파이프라인 목록은 여기서 한 번만 불러 두 뷰에 나눠 준다.
// 뷰마다 따로 부르면 전환할 때마다 같은 요청이 다시 나간다.

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { LayoutGrid, List as ListIcon } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import EmptyState from '@/components/ui/EmptyState'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import DealBoard, { type BoardPipeline } from './DealBoard'
import DealTableView from './DealTableView'
import DealFormModal from './DealFormModal'
import QuickCreateBar from './QuickCreateBar'

type Mode = 'board' | 'list'

export default function DealsClient() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const mode: Mode = searchParams.get('mode') === 'list' ? 'list' : 'board'
  const [pipelines, setPipelines] = useState<BoardPipeline[]>([])
  const [pipelineId, setPipelineId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  // 저장하면 두 뷰가 함께 다시 읽는다 — 표에서 만든 딜이 보드에 안 보이면 사용자는 저장이 안 된 줄 안다
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/pipelines')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '파이프라인을 불러오지 못했습니다.'); return }
      const items: BoardPipeline[] = body.items ?? []
      setPipelines(items)
      setPipelineId((cur) => cur || items.find((p) => p.isDefault)?.id || items[0]?.id || '')
    } catch {
      setError('파이프라인을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function setMode(next: Mode) {
    const sp = new URLSearchParams(searchParams.toString())
    if (next === 'board') sp.delete('mode')
    else sp.set('mode', next)
    const qs = sp.toString()
    // 스크롤을 되돌리지 않는다 — 보던 자리에서 눈만 바꾼 것이다
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  if (loading && pipelines.length === 0) return <AXDotLoader />
  if (error) return <ErrorState message={error} onRetry={() => void load()} />
  if (pipelines.length === 0) {
    return (
      <EmptyState
        title="파이프라인이 아직 없어요"
        description="설정에서 파이프라인을 만들면 여기에 단계가 나타납니다."
        action={{ label: '설정 열기', href: '/crm/settings' }}
      />
    )
  }

  return (
    <>
      {/* 붙여넣기 입력은 탭보다 위에 둔다 — 명함을 받고 가장 먼저 하는 일이다 */}
      <QuickCreateBar
        pipelines={pipelines}
        pipelineId={pipelineId}
        onDone={() => setReloadKey((k) => k + 1)}
      />

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <SegmentedTabs
          tabs={[
            { id: 'board', label: '보드', icon: <LayoutGrid size={14} /> },
            { id: 'list', label: '표', icon: <ListIcon size={14} /> },
          ]}
          ariaLabel="딜 보기 방식"
          activeId={mode}
          onSelect={(id) => setMode(id as Mode)}
        />
      </div>

      {mode === 'board' ? (
        <DealBoard
          pipelines={pipelines}
          pipelineId={pipelineId}
          onPipelineChange={setPipelineId}
          onCreate={() => setFormOpen(true)}
          reloadKey={reloadKey}
        />
      ) : (
        <DealTableView
          pipelines={pipelines}
          onCreate={() => setFormOpen(true)}
          reloadKey={reloadKey}
        />
      )}

      {formOpen && (
        <DealFormModal
          pipelines={pipelines}
          initial={{ pipelineId }}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); setReloadKey((k) => k + 1) }}
        />
      )}
    </>
  )
}
