'use client'

// app/(ci)/ci/assets/AssetsView.tsx — P04 자료
//
// 설계 결정 3가지
//  1) 원본은 우리 서버에 쌓지 않는다 — 파일은 구글드라이브, 링크는 주소만.
//  2) 목록은 전량 로드하지 않는다 — 검색 + "더 보기"(커서)로 필요한 만큼만.
//  3) 보기 방식은 사용자가 고른다 — 카드(썸네일 확인용) / 목록(정보 밀도).

import { useCallback, useEffect, useRef, useState } from 'react'
import { LayoutGrid, List, Search, Link2, Upload, Trash2 } from 'lucide-react'
import type { ApiResponse, ApiMeta } from '@/lib/ci/contracts'
import type { CiAssetItem } from '@/lib/ci/queries/assets'
import { EmptyState, ErrorState, RowSkeleton } from '@/components/ci/states'

type ViewMode = 'card' | 'list'
type Filter = 'all' | 'file' | 'link'

interface Props {
  workspaceId: string
  initialItems: CiAssetItem[]
  initialCursor: string | null
  total: number
  driveConnected: boolean
  driveEmail: string | null
}

/** 검색어를 다 칠 때까지 기다린다 — 글자마다 서버를 때리지 않는다. */
const SEARCH_DEBOUNCE_MS = 350

export default function AssetsView({
  workspaceId, initialItems, initialCursor, total, driveConnected, driveEmail,
}: Props) {
  const [items, setItems] = useState<CiAssetItem[]>(initialItems)
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [count, setCount] = useState(total)
  const [view, setView] = useState<ViewMode>('card')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  /** 같은 조건의 응답을 재요청하지 않도록 세션 동안 들고 있는 캐시. */
  const cacheRef = useRef(new Map<string, { items: CiAssetItem[]; cursor: string | null; total: number }>())
  /** 뒤늦게 도착한 이전 요청이 최신 결과를 덮지 않게 하는 세대 번호. */
  const genRef = useRef(0)

  const load = useCallback(async (opts: { q: string; f: Filter; cursor?: string | null; append?: boolean }) => {
    const params = new URLSearchParams()
    if (opts.q.trim()) params.set('q', opts.q.trim())
    if (opts.f !== 'all') params.set('sourceKind', opts.f)
    if (opts.cursor) params.set('cursor', opts.cursor)

    const key = params.toString()
    const cached = !opts.append ? cacheRef.current.get(key) : undefined
    if (cached) {
      setItems(cached.items); setCursor(cached.cursor); setCount(cached.total)
      return
    }

    const gen = ++genRef.current
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/ci/assets?${key}`, {
        headers: { 'X-CI-Workspace': workspaceId },
      }).then((r) => r.json() as Promise<ApiResponse<CiAssetItem[]> & { meta?: ApiMeta }>)

      if (gen !== genRef.current) return // 더 최신 요청이 이미 떠났다
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }

      const nextCursor = (res.meta?.cursor as string | null) ?? null
      const nextTotal = (res.meta?.total as number | undefined) ?? res.data.length

      if (opts.append) {
        setItems((prev) => [...prev, ...res.data])
      } else {
        setItems(res.data)
        cacheRef.current.set(key, { items: res.data, cursor: nextCursor, total: nextTotal })
      }
      setCursor(nextCursor)
      setCount(nextTotal)
    } catch {
      if (gen === genRef.current) setError({ code: 'INTERNAL', message: '자료를 불러오지 못했습니다' })
    } finally {
      if (gen === genRef.current) setLoading(false)
    }
  }, [workspaceId])

  // 검색어·필터가 바뀌면 첫 장부터 다시
  useEffect(() => {
    if (!query && filter === 'all') {
      // 초기 상태로 복귀 — 서버가 이미 준 첫 장을 재사용한다
      setItems(initialItems); setCursor(initialCursor); setCount(total)
      return
    }
    const t = setTimeout(() => { void load({ q: query, f: filter }) }, query ? SEARCH_DEBOUNCE_MS : 0)
    return () => clearTimeout(t)
  }, [query, filter, load, initialItems, initialCursor, total])

  /** 목록을 갈아엎지 않고 지금 조건으로 다시 읽는다(캐시 무효화 포함). */
  function invalidateAndReload() {
    cacheRef.current.clear()
    void load({ q: query, f: filter })
  }

  /**
   * 링크 등록.
   * `override`를 받는 이유: Enter로 보낼 때 state가 아직 최신이 아닐 수 있어
   * 입력칸의 현재 값을 직접 넘긴다(실측: Enter가 빈 값으로 조기 반환됐다).
   */
  async function addLink(override?: string) {
    const url = (override ?? linkUrl).trim()
    if (!url) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/ci/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ sourceKind: 'link', url }),
      }).then((r) => r.json() as Promise<ApiResponse<{ title: string; note: string | null }>>)

      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setLinkUrl('')
      setNotice(res.data.note ? `등록했습니다 · ${res.data.note}` : `등록했습니다: ${res.data.title}`)
      invalidateAndReload()
    } finally { setBusy(false) }
  }

  async function upload(file: File) {
    setBusy(true); setError(null); setNotice(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/ci/assets/upload', {
        method: 'POST', headers: { 'X-CI-Workspace': workspaceId }, body: form,
      }).then((r) => r.json() as Promise<ApiResponse<{ fileName: string }>>)

      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setNotice(`드라이브에 올렸습니다: ${res.data.fileName}`)
      invalidateAndReload()
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function remove(id: string) {
    await fetch(`/api/ci/assets?id=${id}`, {
      method: 'DELETE', headers: { 'X-CI-Workspace': workspaceId },
    })
    setItems((prev) => prev.filter((a) => a.id !== id))
    setCount((c) => Math.max(0, c - 1))
    cacheRef.current.clear()
  }

  return (
    <>
      {/* 등록 — 링크가 먼저다. 큰 영상은 드라이브에 두고 주소만 남기는 게 기본 동선이다 */}
      <section className="ci-asset-intake">
        <div className="ci-asset-intake-row">
          <div style={{ flex: 1, minWidth: '260px' }}>
            <label className="label" htmlFor="a-link">영상·자료 링크</label>
            <input className="input-field" id="a-link" type="url" value={linkUrl}
              placeholder="유튜브·드라이브 등 주소를 붙여넣으세요"
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addLink((e.target as HTMLInputElement).value)
              }}
              disabled={busy}
            />
          </div>
          <button type="button" className="btn-primary" onClick={() => void addLink()} disabled={busy || !linkUrl.trim()}>
            <Link2 size={16} /> 링크 등록
          </button>
        </div>

        <div className="ci-asset-intake-row">
          <div style={{ flex: 1, minWidth: '260px' }}>
            <label className="label" htmlFor="a-file">파일 올리기 (구글드라이브에 저장)</label>
            <input className="input-field" id="a-file" type="file" ref={fileRef}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }}
              disabled={busy || !driveConnected}
            />
          </div>
          <span className="ci-basis">
            {driveConnected
              ? <><Upload size={12} /> 드라이브 {driveEmail}에 보관됩니다</>
              : '구글드라이브가 연결되어 있지 않아 파일 업로드가 꺼져 있습니다'}
          </span>
        </div>
      </section>

      {notice && <p className="ci-status ci-status-ok" style={{ marginBottom: 'var(--space-3)', display: 'inline-flex' }}>{notice}</p>}
      {error && <div style={{ marginBottom: 'var(--space-4)' }}><ErrorState code={error.code} message={error.message} /></div>}

      {/* 조건 바 — 검색 · 종류 · 보기 방식 */}
      <div className="ci-asset-toolbar">
        <div className="ci-asset-search">
          <Search size={16} aria-hidden />
          <label className="label" htmlFor="a-q" style={{ position: 'absolute', left: '-9999px' }}>자료 검색</label>
          <input className="input-field" id="a-q" type="search" value={query}
            placeholder="제목·파일명·주소로 검색"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div role="tablist" aria-label="자료 종류" style={{ display: 'flex', gap: 'var(--space-1)' }}>
          {([['all', '전체'], ['file', '파일'], ['link', '링크']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" className="ci-metric"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-1)', marginLeft: 'auto', alignItems: 'center' }}>
          <span className="ci-basis">{count.toLocaleString('ko-KR')}건</span>
          <button type="button" className="ci-metric" aria-pressed={view === 'card'}
            title="카드로 보기" onClick={() => setView('card')}><LayoutGrid size={16} /></button>
          <button type="button" className="ci-metric" aria-pressed={view === 'list'}
            title="목록으로 보기" onClick={() => setView('list')}><List size={16} /></button>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <RowSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          title={query ? '검색 결과가 없습니다' : '아직 등록된 자료가 없습니다'}
          description={query
            ? '다른 말로 찾아보세요. 제목·파일명·주소를 함께 훑습니다.'
            : '위에 링크를 붙여넣거나 파일을 올려 보세요. 파일 원본은 구글드라이브에 보관되고, 우리는 분석에 필요한 정보만 갖습니다.'}
        />
      ) : view === 'card' ? (
        <div className="ci-card-grid">
          {items.map((a) => (
            <article key={a.id} className="ci-content-card">
              {a.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="ci-thumb" src={a.thumbnailUrl} alt="" loading="lazy" width={320} height={180} />
              ) : (
                <div className="ci-thumb ci-thumb-empty">{a.sourceKind === 'link' ? '링크' : '파일'}</div>
              )}
              <div className="ci-card-body">
                <h3 className="ci-card-title">{a.title}</h3>
                <div className="ci-card-meta">
                  {a.providerLabel && <span>{a.providerLabel}</span>}
                  <span>{a.kind === 'source' ? '원본' : '산출물'}</span>
                  {a.sizeText && <span>{a.sizeText}</span>}
                  <span>{a.createdAtText}</span>
                </div>
                <div className="ci-card-badges">
                  <span className={`ci-status ${a.sourceKind === 'link' ? 'ci-status-info' : 'ci-status-neutral'}`}>
                    {a.sourceKind === 'link' ? '링크' : a.storageProvider === 'drive' ? '드라이브' : '구 저장분'}
                  </span>
                </div>
                <div className="ci-card-actions">
                  {a.openUrl && (
                    <a className="btn-ghost" href={a.openUrl} target="_blank" rel="noreferrer">열기</a>
                  )}
                  <button type="button" className="btn-ghost" onClick={() => remove(a.id)}>
                    <Trash2 size={14} /> 삭제
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <table className="table-base table-card">
          <thead>
            <tr><th>제목</th><th>종류</th><th>보관</th><th>형식</th><th>크기</th><th>등록</th><th>작업</th></tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td className="card-header">
                  {a.openUrl
                    ? <a href={a.openUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--text)', fontWeight: 600 }}>{a.title}</a>
                    : <span style={{ fontWeight: 600 }}>{a.title}</span>}
                </td>
                <td data-label="종류">{a.sourceKind === 'link' ? '링크' : '파일'}</td>
                <td data-label="보관">
                  {a.sourceKind === 'link' ? '미보관(원본 링크)' : a.storageProvider === 'drive' ? '구글드라이브' : '구 저장분'}
                </td>
                <td data-label="형식">{a.mime ?? '—'}</td>
                <td data-label="크기">{a.sizeText ?? '—'}</td>
                <td data-label="등록" className="card-hide">{a.createdAtText}</td>
                <td className="card-actions">
                  <button type="button" className="btn-ghost" onClick={() => remove(a.id)}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 더 보기 — 목록을 무한히 펼치지 않고 사용자가 요청한 만큼만 늘린다 */}
      {cursor && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-4)' }}>
          <button type="button" className="btn-ghost" disabled={loading}
            onClick={() => void load({ q: query, f: filter, cursor, append: true })}>
            {loading ? '불러오는 중…' : '더 보기'}
          </button>
        </div>
      )}
    </>
  )
}
