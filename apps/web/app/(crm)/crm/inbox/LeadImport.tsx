'use client'

// 리드 큐 (v0.7.540 재설계)
//
// **예전 화면이 왜 안 됐나** — 실측으로 확인한 것 셋:
//   ① 380건 중 20건만 보이고 그 다음을 볼 방법이 없었다(offset 없음)
//   ② 큐에서 나가는 길이 "한 건씩 옮기기" 하나뿐이었다.
//      회사 이름조차 없는 리드는 영원히 남는다 → **끝낼 수 없는 큐**
//   ③ 불러오는 중에 남은 개수가 0 이라 "다 옮겼어요"라고 먼저 말했다(거짓 표시)
//
// 사용자 지적: "인박스에 있는 1500개를 하나하나 어떻게 사람이 보고 작업을 하나".
// 맞다. 그래서 **고르고 · 미리 보고 · 한 번에 처리하는** 화면으로 바꿨다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Sensitive from '@/components/crm/Sensitive'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { kstDateKey } from '@/lib/datetime/kst'
import styles from './inbox.module.css'

interface Plan {
  ok: boolean
  reason?: string
  companyName?: string
  personName?: string | null
  dealName?: string | null
  amountMinor?: string | null
}

interface LeadRow {
  id: string
  createdAt: string
  status: string
  fitScore: number | null
  skippedAt: string | null
  skipReason: string | null
  plan: Plan
  parsed: { deal_description?: string | null; fit_score?: number | null } | null
}

interface Preview {
  total: number
  importable: number
  blocked: number
  blockedReasons: { reason: string; count: number }[]
  newCompanies: number
  existingCompanies: number
  newPersons: number
  deals: number
  totalAmountMinor: string
}

type View = 'queue' | 'skipped' | 'migrated'

const VIEW_TABS: { id: View; label: string }[] = [
  { id: 'queue', label: '옮길 것' },
  { id: 'skipped', label: '내린 것' },
  { id: 'migrated', label: '옮긴 것' },
]

const PAGE = 20

/** 원(minor) → 사람이 읽는 금액. 억 단위가 기본이다 — 자릿수를 세게 하지 않는다 */
function formatAmount(minor: string): string {
  const n = Number(minor)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 100_000_000) return `${(n / 100_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억 원`
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만 원`
  return `${n.toLocaleString('ko-KR')}원`
}

export default function LeadImport() {
  const [items, setItems] = useState<LeadRow[]>([])
  const [total, setTotal] = useState(0)
  const [pending, setPending] = useState(0)
  const [migrated, setMigrated] = useState(0)
  const [skipped, setSkipped] = useState(0)
  const [bulkMax, setBulkMax] = useState(100)

  const [view, setView] = useState<View>('queue')
  const [offset, setOffset] = useState(0)
  const [q, setQ] = useState('')
  const [queryText, setQueryText] = useState('')
  const [sort, setSort] = useState<'fit' | 'recent'>('fit')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({
        view, sort, limit: String(PAGE), offset: String(offset),
      })
      if (q) p.set('q', q)
      const res = await fetch(`/api/crm/lead-import?${p.toString()}`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '리드를 불러오지 못했습니다.'); return }
      setItems(body.items ?? [])
      setTotal(body.total ?? 0)
      setPending(body.pending ?? 0)
      setMigrated(body.migrated ?? 0)
      setSkipped(body.skipped ?? 0)
      setBulkMax(body.bulkMax ?? 100)
    } catch {
      setError('리드를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [view, sort, offset, q])

  useEffect(() => { if (open) void load() }, [open, load])

  /**
   * **남은 게 없으면 이 카드는 그리지 않는다.**
   *
   * 사용자 지적(2026-08-27): *"옛리드도 계속 있는건 아니니깐 안맞는거지 —
   * 일시적인게 아니라 항상 있는거 같자나"*.
   * 옛 시스템에서 옮겨오는 일은 **한 번 하고 끝나는 일**이다. 다 옮긴 뒤에도 인박스 맨 위에
   * 남아 있으면 그때부터는 장식이고, 장식이 위에 있으면 정작 확인할 제안이 아래로 밀린다.
   *
   * 그래서 열지 않아도 **처음에 한 번은 세어 본다**. 예전엔 펼쳐야 세기 시작해서
   * 뱃지가 영원히 「세는 중…」이었다(실화면). 세어 보고 0건이면 사라진다 —
   * 이관이 끝나는 날 이 카드도 저절로 없어진다.
   */
  const [counted, setCounted] = useState(false)
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch('/api/crm/lead-import?view=queue&limit=1&offset=0')
        const body = await res.json()
        if (!alive || !res.ok) return
        setPending(body.pending ?? 0)
        setMigrated(body.migrated ?? 0)
        setSkipped(body.skipped ?? 0)
      } catch {
        // 세지 못했으면 카드를 띄우지 않는다 — 있는지 모르는 것을 있다고 말하지 않는다
      } finally {
        if (alive) setCounted(true)
      }
    })()
    return () => { alive = false }
  }, [])

  // 조건이 바뀌면 1페이지로 — 3페이지에서 검색하면 빈 화면이 된다
  useEffect(() => { setOffset(0); setSelected(new Set()) }, [view, sort, q])

  /**
   * **못 옮기는 리드도 고를 수 있어야 한다.**
   *
   * 처음엔 `plan.ok` 인 것만 선택하게 했다. 실브라우저에서 확인해 보니
   * 회사 이름이 없는 2건은 체크박스가 아예 없어서 **큐에서 내릴 수도 없었다** —
   * 옮길 수도 없고 내릴 수도 없으니 그 2건이 큐에 영원히 남는다.
   * 고치려던 "끝낼 수 없는 큐"를 축소판으로 다시 만든 셈이다.
   *
   * 옮기기는 서버가 알아서 건너뛰고 실패 목록으로 돌려준다. 선택은 막지 않는다.
   */
  const pageIds = useMemo(() => items.map((i) => i.id), [items])
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allPageSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })
  }

  /** 미리보기 — 고른 게 없으면 큐 전체를 미리 본다(가장 먼저 알고 싶은 숫자다) */
  async function loadPreview() {
    setBusy('preview')
    setError(null)
    try {
      const p = new URLSearchParams({ preview: '1', view })
      if (selected.size > 0) p.set('leadIds', Array.from(selected).join(','))
      const res = await fetch(`/api/crm/lead-import?${p.toString()}`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '미리보기를 만들지 못했습니다.'); return }
      setPreview(body.preview)
      setPreviewOpen(true)
    } catch {
      setError('미리보기를 만들지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }

  async function post(payload: Record<string, unknown>, label: string) {
    setBusy(label)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/crm/lead-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '처리하지 못했습니다.'); return null }
      setSelected(new Set())
      setPreviewOpen(false)
      await load()
      return body
    } catch {
      setError('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
      return null
    } finally {
      setBusy(null)
    }
  }

  async function moveOne(leadId: string, createDeal: boolean) {
    await post({ leadId, createDeal }, leadId)
  }

  async function moveSelected(createDeal: boolean) {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    const body = await post({ leadIds: ids, createDeal }, 'bulk')
    if (!body) return
    const parts = [`${body.imported ?? 0}건 옮겼어요`]
    if (body.companiesCreated) parts.push(`회사 ${body.companiesCreated}개 새로 생김`)
    if (body.companiesReused) parts.push(`기존 회사 ${body.companiesReused}개에 붙임`)
    if (body.dealsCreated) parts.push(`딜 ${body.dealsCreated}개`)
    if (body.alreadyMigrated) parts.push(`이미 옮긴 ${body.alreadyMigrated}건은 건너뜀`)
    if (body.failed?.length) parts.push(`${body.failed.length}건 실패 — ${body.failed[0].message}`)
    setResult(parts.join(' · '))
  }

  async function skipSelected() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    const body = await post({ action: 'skip', leadIds: ids, reason: '사용자가 큐에서 내림' }, 'skip')
    if (body) setResult(`${body.skipped ?? 0}건을 큐에서 내렸어요. '내린 것' 탭에서 되돌릴 수 있어요.`)
  }

  async function unskipSelected() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    const body = await post({ action: 'unskip', leadIds: ids }, 'unskip')
    if (body) setResult(`${body.restored ?? 0}건을 큐로 되돌렸어요.`)
  }

  // 다 끝났으면 카드 자체를 숨긴다. 단 **불러오는 중에는 판단하지 않는다** —
  // 예전에는 loading 중 pending=0 이라 "다 옮겼어요"를 먼저 띄웠다(거짓 표시).
  if (!loading && pending === 0 && migrated === 0 && skipped === 0) return null

  const pageCount = Math.max(1, Math.ceil(total / PAGE))
  const page = Math.floor(offset / PAGE) + 1

  // 세기 전에는 아무것도 안 보여 준다 — 있다가 사라지면 그게 더 어수선하다.
  // 다 옮겼으면(펼쳐 보는 중이 아닌 한) 카드 자체가 없다.
  if (!counted || (pending === 0 && !open)) return null

  return (
    <section className={`card ${styles.leadCard}`}>
      <div className={styles.leadHead}>
        <h2 className={styles.leadTitle}>옛 리드 옮기기</h2>
        <NbBadge status={pending === 0 ? 'done' : 'planned'}>
          {pending === 0 ? '다 정리했어요' : `${pending.toLocaleString('ko-KR')}건 남음`}
        </NbBadge>
        <NbButton variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? '접기' : '보기'}
        </NbButton>
      </div>

      <p className={styles.leadHint}>
        예전 프로젝트관리에 쌓인 리드입니다. 여러 건을 골라 한 번에 옮기거나, 옮길 값어치가 없으면 큐에서 내리세요.
        옮긴 것은 회사·담당자로 들어가고 원문은 활동에 남습니다.
        {migrated > 0 && ` 지금까지 ${migrated.toLocaleString('ko-KR')}건 옮겼어요.`}
        {skipped > 0 && ` ${skipped.toLocaleString('ko-KR')}건은 내렸어요.`}
      </p>

      <FormErrorBanner message={error} />
      {result && <p className={styles.leadResult}>{result}</p>}

      {!open ? null : (
        <>
          <div className={styles.leadTabs}>
            <SegmentedTabs
              tabs={VIEW_TABS.map((t) => ({
                id: t.id,
                label: t.id === 'queue' ? `${t.label} ${pending}`
                  : t.id === 'skipped' ? `${t.label} ${skipped}`
                    : `${t.label} ${migrated}`,
              }))}
              ariaLabel="리드 큐 보기"
              activeId={view}
              onSelect={(id: string) => setView(id as View)}
            />
          </div>

          <div className={styles.leadToolbar}>
            <div className={styles.leadSearch}>
              <label className="label" htmlFor="lead-q">회사·담당자 검색</label>
              <input
                id="lead-q"
                className="input-field"
                value={queryText}
                placeholder="예: 업스테이지"
                onChange={(e) => setQueryText(e.target.value)}
                onKeyDown={(e) => {
                  // 한글 조합 중 엔터를 실행으로 받지 않는다 — "삼성" 치다가 검색되면 안 된다
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) setQ(queryText.trim())
                }}
              />
            </div>
            <NbButton variant="ghost" onClick={() => setQ(queryText.trim())}>검색</NbButton>
            <div className={styles.leadSelect}>
              <label className="label" htmlFor="lead-sort">정렬</label>
              <select
                id="lead-sort"
                className="input-field"
                value={sort}
                onChange={(e) => setSort(e.target.value === 'recent' ? 'recent' : 'fit')}
              >
                <option value="fit">적합도 높은 순</option>
                <option value="recent">최근 들어온 순</option>
              </select>
            </div>
            <NbButton variant="ghost" disabled={busy === 'preview'} onClick={() => void loadPreview()}>
              {selected.size > 0 ? `고른 ${selected.size}건 미리보기` : '큐 전체 미리보기'}
            </NbButton>
          </div>

          {previewOpen && preview && (
            <div className={styles.leadPreview}>
              <div className={styles.leadPreviewGrid}>
                <div className={styles.leadStat}>
                  <span className={styles.leadStatValue}>{preview.importable.toLocaleString('ko-KR')}</span>
                  <span className={styles.leadStatLabel}>옮길 수 있음</span>
                </div>
                <div className={styles.leadStat}>
                  <span className={styles.leadStatValue}>{preview.newCompanies.toLocaleString('ko-KR')}</span>
                  <span className={styles.leadStatLabel}>새로 생길 회사</span>
                </div>
                <div className={styles.leadStat}>
                  <span className={styles.leadStatValue}>{preview.existingCompanies.toLocaleString('ko-KR')}</span>
                  <span className={styles.leadStatLabel}>기존 회사에 붙음</span>
                </div>
                <div className={styles.leadStat}>
                  <span className={styles.leadStatValue}>{preview.newPersons.toLocaleString('ko-KR')}</span>
                  <span className={styles.leadStatLabel}>담당자</span>
                </div>
                <div className={styles.leadStat}>
                  <span className={styles.leadStatValue}>{preview.deals.toLocaleString('ko-KR')}</span>
                  <span className={styles.leadStatLabel}>딜(선택 시)</span>
                </div>
                <div className={styles.leadStat}>
                  <span className={styles.leadStatValue}><Sensitive>{formatAmount(preview.totalAmountMinor)}</Sensitive></span>
                  <span className={styles.leadStatLabel}>딜 금액 합계</span>
                </div>
              </div>
              {preview.blocked > 0 && (
                <>
                  <p className={styles.leadStatLabel}>
                    못 옮기는 {preview.blocked.toLocaleString('ko-KR')}건 —
                  </p>
                  <ul className={styles.leadBlockedList}>
                    {preview.blockedReasons.map((b) => (
                      <li key={b.reason}>{b.reason} ({b.count.toLocaleString('ko-KR')}건)</li>
                    ))}
                  </ul>
                </>
              )}
              <NbButton variant="ghost" onClick={() => setPreviewOpen(false)}>미리보기 닫기</NbButton>
            </div>
          )}

          {selected.size > 0 && (
            <div className={styles.leadBulkBar}>
              <span className={styles.leadBulkCount}>{selected.size}건 골랐어요</span>
              {view === 'queue' && (
                <>
                  <NbButton
                    variant="ghost"
                    disabled={busy !== null || selected.size > bulkMax}
                    onClick={() => void moveSelected(false)}
                  >
                    회사·담당자만 옮기기
                  </NbButton>
                  <NbButton
                    disabled={busy !== null || selected.size > bulkMax}
                    onClick={() => void moveSelected(true)}
                  >
                    딜까지 만들기
                  </NbButton>
                  <NbButton variant="ghost" disabled={busy !== null} onClick={() => void skipSelected()}>
                    큐에서 내리기
                  </NbButton>
                </>
              )}
              {view === 'skipped' && (
                <NbButton disabled={busy !== null} onClick={() => void unskipSelected()}>
                  큐로 되돌리기
                </NbButton>
              )}
              <NbButton variant="ghost" onClick={() => setSelected(new Set())}>선택 해제</NbButton>
              {selected.size > bulkMax && (
                <span className={styles.leadStatLabel}>
                  한 번에 {bulkMax}건까지예요. 나눠서 눌러 주세요.
                </span>
              )}
            </div>
          )}

          {loading ? (
            <AXDotLoader />
          ) : items.length === 0 ? (
            <EmptyState
              title={q ? '검색 결과가 없어요' : view === 'queue' ? '옮길 리드가 없어요' : '여기엔 아직 없어요'}
              description={q ? '다른 이름으로 찾아보세요.' : '예전 리드를 모두 정리했습니다.'}
            />
          ) : (
            <>
              {pageIds.length > 0 && (
                <label className={styles.leadCheck}>
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={toggleAllOnPage}
                  />
                  <span>이 페이지 {pageIds.length}건 모두 선택</span>
                </label>
              )}

              <ul className={styles.leadList}>
                {items.map((l) => {
                  const on = selected.has(l.id)
                  return (
                    <li key={l.id} className={`${styles.leadItem} ${on ? styles.leadItemSelected : ''}`}>
                      <div className={styles.leadMain}>
                        <input
                          type="checkbox"
                          checked={on}
                          aria-label={`${l.plan.companyName ?? '리드'} 선택`}
                          onChange={() => toggle(l.id)}
                        />
                        <span className={styles.leadName}>
                          {l.plan.ok ? l.plan.companyName : '(회사 이름 없음)'}
                        </span>
                        {l.plan.personName && <span className={styles.leadSub}>· {l.plan.personName}</span>}
                        {typeof l.fitScore === 'number' && (
                          <span className={styles.leadFitBadge}>적합도 {l.fitScore}</span>
                        )}
                        <span className={styles.leadDate}>{kstDateKey(l.createdAt)}</span>
                      </div>

                      {l.parsed?.deal_description && (
                        <p className={styles.leadDesc}>{l.parsed.deal_description}</p>
                      )}

                      {l.skipReason && <p className={styles.leadBlocked}>내린 이유: {l.skipReason}</p>}

                      {!l.plan.ok ? (
                        <p className={styles.leadBlocked}>{l.plan.reason}</p>
                      ) : view === 'queue' ? (
                        <div className={styles.leadActions}>
                          <NbButton variant="ghost" disabled={busy === l.id} onClick={() => void moveOne(l.id, false)}>
                            회사만 옮기기
                          </NbButton>
                          {l.plan.dealName && (
                            <NbButton disabled={busy === l.id} onClick={() => void moveOne(l.id, true)}>
                              딜까지 만들기
                            </NbButton>
                          )}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>

              {total > PAGE && (
                <div className={styles.leadPager}>
                  <NbButton
                    variant="ghost"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE))}
                  >
                    이전
                  </NbButton>
                  <span>{page} / {pageCount} 쪽 · 전체 {total.toLocaleString('ko-KR')}건</span>
                  <NbButton
                    variant="ghost"
                    disabled={offset + PAGE >= total}
                    onClick={() => setOffset(offset + PAGE)}
                  >
                    다음
                  </NbButton>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
