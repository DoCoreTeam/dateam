'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronUp, ChevronDown, ChevronsUpDown, Search, Download } from 'lucide-react'
import {
  type DayDetail,
  type EntryType,
  type SortKey,
  type SortDir,
  formatKstDateTime,
} from '@/lib/admin/daily-monitoring'
import type { DayLogFilters } from '@/lib/admin/daily-monitoring-queries'
import { buildUrl } from './url'

/** entry_type 라벨 + 아이콘 (색은 .badge[data-status] CSS 토큰에서 — 하드코딩 금지) */
const ENTRY_LABELS: Record<EntryType, { label: string; icon: string }> = {
  done: { label: '완료', icon: '✅' },
  doing: { label: '진행중', icon: '🔄' },
  planned: { label: '예정', icon: '📋' },
  blocker: { label: '블로커', icon: '🚫' },
  note: { label: '메모', icon: '📌' },
}
const ENTRY_VALUES: EntryType[] = ['done', 'doing', 'planned', 'blocker', 'note']

const SORTABLE: { key: SortKey; label: string }[] = [
  { key: 'logged_at', label: '작성일시' },
  { key: 'name', label: '멤버' },
  { key: 'department', label: '부서' },
  { key: 'entry_type', label: '타입' },
]

interface Props {
  detail: DayDetail
  departments: { id: string; name: string }[]
  month: string
  sort: SortKey
  dir: SortDir
  filters: DayLogFilters
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown size={13} style={{ opacity: 0.35 }} />
  return dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />
}

export default function DayDetailPanel({ detail, departments, month, sort, dir, filters }: Props) {
  const router = useRouter()
  const [q, setQ] = useState(filters.q ?? '')
  // URL의 q가 외부에서 바뀌면 입력창 동기화(stale 방지)
  useEffect(() => setQ(filters.q ?? ''), [filters.q])

  // 필터 변경 시 보존할 공통 파라미터(검색 외 컨텍스트)
  const ctx: Record<string, string> = { month, date: detail.date }

  function pushFilters(overrides: Record<string, string | undefined>) {
    router.push(buildUrl(ctx, { sort, dir, page: undefined, ...currentFilterParams(), ...overrides }))
  }

  function currentFilterParams(): Record<string, string | undefined> {
    return {
      q: filters.q || undefined,
      dept: filters.departmentId || undefined,
      type: filters.entryType || undefined,
      kind: filters.taskKind || undefined,
      blocker: filters.blockerOnly ? '1' : undefined,
    }
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    pushFilters({ q: q.trim() || undefined })
  }

  function toggleSort(key: SortKey) {
    const nextDir: SortDir = sort === key && dir === 'asc' ? 'desc' : 'asc'
    router.push(buildUrl(ctx, { sort: key, dir: nextDir, page: undefined, ...currentFilterParams() }))
  }

  function goPage(p: number) {
    router.push(
      buildUrl(ctx, { sort, dir, page: String(p), ...currentFilterParams() }),
    )
  }

  const totalPages = Math.max(1, Math.ceil(detail.total / detail.pageSize))
  const pageNumbers = pageWindow(detail.page, totalPages)

  // CSV 내보내기 — 선택일 + 현재 필터(검색 q 포함). export 라우트가 q를 동일 기준으로 반영.
  const exportHref = (() => {
    const sp = new URLSearchParams({ from: detail.date, to: detail.date })
    if (filters.q) sp.set('q', filters.q)
    if (filters.departmentId) sp.set('dept', filters.departmentId)
    if (filters.entryType) sp.set('type', filters.entryType)
    if (filters.taskKind) sp.set('kind', filters.taskKind)
    if (filters.blockerOnly) sp.set('blocker', '1')
    return `/admin/daily-logs/export?${sp.toString()}`
  })()

  return (
    <section className="monitor-panel" aria-label="선택일 상세">
      {/* KPI 요약 줄 */}
      <div className="monitor-kpi">
        <strong className="monitor-kpi-date">{detail.date}</strong>
        <span className="monitor-kpi-item">
          작성 <b>{detail.writerCount}</b>/{detail.totalActiveMembers}명
        </span>
        <span className="monitor-kpi-sep">·</span>
        <span className="monitor-kpi-item">
          미작성 <b>{detail.missingMembers.length}</b>
        </span>
        <span className="monitor-kpi-sep">·</span>
        <span className={`monitor-kpi-item${detail.blockerCount > 0 ? ' is-danger' : ''}`}>
          블로커 <b>{detail.blockerCount}</b>
        </span>
        {filters.q ? (
          <span className="monitor-kpi-hint">작성 현황은 검색어와 무관 · 아래 목록만 “{filters.q}” 검색</span>
        ) : null}
      </div>

      {/* 필터 바 */}
      <form className="monitor-filters" onSubmit={submitSearch}>
        <div className="monitor-search">
          <Search size={14} aria-hidden="true" className="monitor-search-icon" />
          <input type="search" className="input-field monitor-search-input"
            placeholder="내용 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="내용 검색"
          />
        </div>
        <label className="monitor-field">
          <span className="label">부서</span>
          <select className="input-field"
            value={filters.departmentId ?? ''}
            onChange={(e) => pushFilters({ dept: e.target.value || undefined })}
          >
            <option value="">전체 부서</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="monitor-field">
          <span className="label">타입</span>
          <select className="input-field"
            value={filters.entryType ?? ''}
            onChange={(e) => pushFilters({ type: e.target.value || undefined })}
          >
            <option value="">전체 타입</option>
            {ENTRY_VALUES.map((t) => (
              <option key={t} value={t}>
                {ENTRY_LABELS[t].icon} {ENTRY_LABELS[t].label}
              </option>
            ))}
          </select>
        </label>
        <label className="monitor-field">
          <span className="label">구분</span>
          <select className="input-field"
            value={filters.taskKind ?? ''}
            onChange={(e) => pushFilters({ kind: e.target.value || undefined })}
          >
            <option value="">전체</option>
            <option value="personal">개인</option>
            <option value="dept_task">부서</option>
          </select>
        </label>
        <label className="monitor-check">
          <input type="checkbox"
            checked={!!filters.blockerOnly}
            onChange={(e) => pushFilters({ blocker: e.target.checked ? '1' : undefined })}
          />
          <span>블로커만</span>
        </label>
        <button type="submit" className="monitor-search-btn">
          검색
        </button>
        <a href={exportHref} className="monitor-export-btn" download aria-label="선택일 CSV 내보내기">
          <Download size={14} /> CSV
        </a>
      </form>

      {/* 리스트 */}
      {detail.rows.length === 0 ? (
        <div className="monitor-empty">해당 조건의 로그가 없습니다.</div>
      ) : (
        <table className="table-base table-card monitor-table">
          <thead>
            <tr>
              {SORTABLE.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className="monitor-th-sort"
                  aria-sort={sort === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <span className="monitor-th-inner">
                    {c.label} <SortIcon active={sort === c.key} dir={dir} />
                  </span>
                </th>
              ))}
              <th>내용</th>
            </tr>
          </thead>
          <tbody>
            {detail.rows.map((row) => {
              const meta = ENTRY_LABELS[row.entryType] ?? ENTRY_LABELS.note
              return (
                <tr key={row.id}>
                  <td className="card-header" data-label="작성일시">
                    <span className="monitor-time">{formatKstDateTime(row.loggedAt)}</span>
                    {row.isEdited && <span className="monitor-edited">수정됨</span>}
                  </td>
                  <td data-label="멤버">{row.authorName}</td>
                  <td data-label="부서">
                    <span className={row.departmentName ? '' : 'monitor-muted'}>
                      {row.departmentName ?? '—'}
                    </span>
                  </td>
                  <td data-label="타입">
                    <span className="badge" data-status={row.entryType}>
                      {meta.icon} {meta.label}
                    </span>
                  </td>
                  <td data-label="내용">
                    <p className="monitor-content">{row.content}</p>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* 페이지네이션 */}
      {detail.rows.length > 0 && totalPages > 1 && (
        <nav className="monitor-pager" aria-label="페이지">
          <button
            type="button"
            className="monitor-pager-btn"
            onClick={() => goPage(detail.page - 1)}
            disabled={detail.page <= 0}
            aria-label="이전 페이지"
          >
            <ChevronUp size={14} style={{ transform: 'rotate(-90deg)' }} />
          </button>
          {pageNumbers.map((p) => (
            <button
              key={p}
              type="button"
              className={`monitor-pager-btn${p === detail.page ? ' is-active' : ''}`}
              onClick={() => goPage(p)}
              aria-current={p === detail.page ? 'page' : undefined}
            >
              {p + 1}
            </button>
          ))}
          <button
            type="button"
            className="monitor-pager-btn"
            onClick={() => goPage(detail.page + 1)}
            disabled={detail.page >= totalPages - 1}
            aria-label="다음 페이지"
          >
            <ChevronDown size={14} style={{ transform: 'rotate(-90deg)' }} />
          </button>
        </nav>
      )}

      {/* 미작성자 */}
      <div className="monitor-missing">
        {detail.missingMembers.length === 0 ? (
          <span className="monitor-missing-ok">전원 작성 완료</span>
        ) : (
          <>
            <span className="monitor-missing-label">미작성({detail.missingMembers.length})</span>
            <span className="monitor-missing-chips">
              {detail.missingMembers.map((m) => (
                <span key={m.id} className="monitor-missing-chip">
                  {m.name}
                </span>
              ))}
            </span>
          </>
        )}
      </div>
    </section>
  )
}

/** 현재 페이지 주변 최대 5개 번호 윈도우 */
function pageWindow(current: number, total: number): number[] {
  const span = 5
  let start = Math.max(0, current - Math.floor(span / 2))
  const end = Math.min(total, start + span)
  start = Math.max(0, end - span)
  const out: number[] = []
  for (let i = start; i < end; i++) out.push(i)
  return out
}
