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
import { LayoutGrid, List as ListIcon, Plus, Sparkles } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import ErrorState from '@/components/ui/ErrorState'
import EmptyState from '@/components/ui/EmptyState'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import DealBoard, { type BoardPipeline } from './DealBoard'
import DealTableView from './DealTableView'
import DealFormModal from './DealFormModal'
import QuickCreateBar from './QuickCreateBar'
import styles from './deals-client.module.css'

type Mode = 'board' | 'list'

export default function DealsClient() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const mode: Mode = searchParams.get('mode') === 'list' ? 'list' : 'board'
  const [pipelines, setPipelines] = useState<BoardPipeline[]>([])
  /**
   * 어느 파이프라인을 보고 있나 — **URL 이 기억한다**(§2-6 (1)).
   *
   * 예전엔 화면 상태로만 들고 있어서 **새로고침하면 기본 파이프라인으로 돌아갔다.**
   * 「전체」로 훑던 사람이 뒤로 갔다 오면 한 파이프라인만 보고 있게 되는데,
   * 화면은 아무 말도 하지 않아 딜이 사라진 것처럼 보인다.
   *
   * 규칙: 주소에 `pipeline` 이 없으면 기본 파이프라인, `all` 이면 전체, 그 밖이면 그 파이프라인.
   */
  const pipelineParam = searchParams.get('pipeline')
  const [defaultPipelineId, setDefaultPipelineId] = useState('')
  const pipelineId = pipelineParam === 'all' ? '' : (pipelineParam ?? defaultPipelineId)

  function setPipelineId(next: string) {
    const sp = new URLSearchParams(searchParams.toString())
    // 「전체」는 빈 문자열이 아니라 `all` 로 적는다 — 빈 값은 «지정 안 함»과 구분이 안 된다
    sp.set('pipeline', next === '' ? 'all' : next)
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
  }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  // 저장하면 두 뷰가 함께 다시 읽는다 — 표에서 만든 딜이 보드에 안 보이면 사용자는 저장이 안 된 줄 안다
  const [reloadKey, setReloadKey] = useState(0)
  // 붙여넣기 입력이 펼쳐졌나 — 트리거가 도구 줄에 있으므로 상태도 여기 있다
  const [quickOpen, setQuickOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/pipelines')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '파이프라인을 불러오지 못했습니다.'); return }
      const items: BoardPipeline[] = body.items ?? []
      setPipelines(items)
      setDefaultPipelineId(items.find((p) => p.isDefault)?.id || items[0]?.id || '')
    } catch {
      setError('파이프라인을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /**
   * 이 워크스페이스에 딜이 몇 건인가.
   *
   * 파이프라인 목록이 단계별 개수를 이미 주므로 따로 묻지 않는다 —
   * 화면 하나에 조회가 늘면 첫 그리기가 느려진다.
   */
  const dealCount = pipelines.reduce(
    (n, p) => n + p.stages.reduce((m, s) => m + (s.dealCount ?? 0), 0), 0)

  /*
    딜이 한 건도 없으면 붙여넣기를 펼쳐 둔다 — 이 제품에서 가장 강한 기능인데
    접혀 있으면 처음 온 사람은 그게 뭔지 모르고 지나간다.
    **불러오기가 끝난 뒤에** 판단한다 — 처음 렌더에는 파이프라인이 비어 있어
    건수가 0으로 보이므로, 그때 열면 딜이 있는 워크스페이스에서도 열린다.
  */
  useEffect(() => {
    if (!loading && pipelines.length > 0 && dealCount === 0) setQuickOpen(true)
  }, [loading, pipelines.length, dealCount])

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
      {/*
        도구는 **한 줄**이다.
        예전엔 붙여넣기 한 줄 · 보기 탭 한 줄 · 파이프라인+추가 한 줄로 세 줄을 먹었고,
        위의 표면 탭까지 더하면 내용이 시작되기 전에 네 줄이 지나갔다
        (사용자 지적: 「쓸데없는 공간 너무 많고」).
        왼쪽은 **무엇을 어떻게 보나**(보기·파이프라인), 오른쪽은 **무엇을 하나**(등록·추가)다 — §2-3-2 L-1.
      */}
      <div className={styles.toolbar}>
        <SegmentedTabs
          tabs={[
            { id: 'board', label: '보드', icon: <LayoutGrid size={14} /> },
            { id: 'list', label: '표', icon: <ListIcon size={14} /> },
          ]}
          ariaLabel="딜 보기 방식"
          activeId={mode}
          onSelect={(id) => setMode(id as Mode)}
        />

        {/* 파이프라인은 보드에서만 고른다 — 표는 자기 필터를 갖는다 */}
        {mode === 'board' && pipelines.length > 1 && (
          <select
            id="crm-board-pipeline"
            className="input-field"
            aria-label="파이프라인"
            value={pipelineId}
            onChange={(e) => setPipelineId(e.target.value)}
            style={{ minWidth: 180, width: 'auto' }}
          >
            <option value="">파이프라인 전체 ({pipelines.length}개)</option>
            {pipelines.map((p) => {
              const n = p.stages.reduce((a, st) => a + (st.dealCount ?? 0), 0)
              return <option key={p.id} value={p.id}>{p.name} ({n})</option>
            })}
          </select>
        )}

        <div className={styles.toolbarRight}>
          <NbButton variant="ghost" onClick={() => setQuickOpen((v) => !v)} aria-expanded={quickOpen}>
            <Sparkles size={16} /> 붙여넣기로 등록
          </NbButton>
          <NbButton onClick={() => setFormOpen(true)}><Plus size={16} /> 딜 추가</NbButton>
        </div>
      </div>

      <QuickCreateBar
        pipelines={pipelines}
        pipelineId={pipelineId}
        onDone={() => setReloadKey((k) => k + 1)}
        open={quickOpen}
        onOpenChange={setQuickOpen}
      />

      {mode === 'board' ? (
        <DealBoard
          pipelines={pipelines}
          pipelineId={pipelineId}
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
