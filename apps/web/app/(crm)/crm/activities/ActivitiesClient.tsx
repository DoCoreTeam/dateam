'use client'

/**
 * 활동 목록 (P0105 I05)
 *
 * 이 화면이 답하는 것: **「이번 달 누가 어디에 몇 번 기록을 남겼나」**
 *
 * 왜 생겼나 (실측 2026-10-02): `crm_activity` 에 421건이 쌓여 있는데 목록으로 보는 자리가
 * 없었다. 딜·회사·인물 **상세 안쪽**의 타임라인이 유일한 길이라, 대상을 먼저 정하지
 * 않으면 아무것도 볼 수 없었다. 그래서 「지난주에 접촉이 몇 건이었나」처럼 **대상을
 * 모르고 묻는 질문**에 답할 자리가 아예 없었다.
 *
 * **조건은 주소에 싣는다.** 화면이 따로 들고 있으면 새로고침에 날아가고 링크로 못 보낸다.
 * 서버가 조건을 해석하는 규칙(모르는 값은 기본값)과 같은 규칙을 화면도 쓴다.
 *
 * **몇 건 중 몇 건인지 말한다.** 상한에 걸린 것을 조용히 자르면 사람은 그것이 전부라고
 * 읽고 보고서에 쓴다(리포트가 같은 이유로 「못 센 것」을 늘 적는다).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { StickyNote, Phone, Users, Mail, Settings2, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import DateField from '@/components/ui/DateField'
import RecordPickerField, { type RecordOption } from '@/components/ui/RecordPicker'
import BulkDeleteConfirm from '@/components/ui/crm/BulkDeleteConfirm'
import InlineError from '@/components/ui/InlineError'
import { hereNow, linkWithBack } from '@/lib/crm/nav/back-link'
import { navLabelOf } from '@/lib/crm/nav/groups'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import {
  ACTION, ENTITY, FILTER_ALL, count, countOnly,
  ACTIVITY_TYPE_LABEL, ACTIVITY_TYPE_ORDER, ACTIVITY_NO_ANCHOR,
  ACTIVITY_AUTHOR, ACTIVITY_TYPE_FIELD, ACTIVITY_MORE, ACTIVITY_MANUAL_TYPES,
  type ActivityTypeKey,
} from '@/lib/terms'
import { REPORT } from '@/lib/terms/report'
import styles from './activities.module.css'

interface ActivityRow {
  id: string
  type: string
  occurredAt: string
  title: string
  body: string | null
  companyId: string | null
  personId: string | null
  dealId: string | null
  source: string
  createdById: string | null
}

interface Payload {
  items: ActivityRow[]
  nextBefore: string | null
  total: number | null
}

/** 종류마다 그림 하나. 이름은 용어집이 든다 — 타임라인과 같은 그림을 쓴다 */
const TYPE_ICON: Record<string, React.ReactNode> = {
  NOTE: <StickyNote size={12} />,
  CALL: <Phone size={12} />,
  MEETING: <Users size={12} />,
  EMAIL: <Mail size={12} />,
  SYSTEM: <Settings2 size={12} />,
}

/** 한 번에 받는 수. 넘으면 「더 보기」로 이어 읽고, 몇 건 중 몇 건인지는 화면이 말한다 */
const PAGE = 50

export default function ActivitiesClient() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState<ActivityRow[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  /** 지우려는 줄. 확인창은 **목록 표준과 같은 부품**을 쓴다(§2-5) */
  const [pending, setPending] = useState<ActivityRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [gone, setGone] = useState<string[]>([])

  /** 돌아올 곳 — 조건까지 실어야 「그 줄이 어디 있었는지」로 되돌아온다 */
  const here = hereNow(pathname, sp, navLabelOf('/crm/activities'))

  const type = sp.get('type') ?? ''
  const createdById = sp.get('createdById') ?? ''
  const createdByName = sp.get('createdByName') ?? ''
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''

  /** 고른 것만 주소에 바꿔 넣는다. 빈 값은 지운다 — 기본값이 주소에 남으면 링크가 길어진다 */
  const set = useCallback((patch: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    router.replace(next.toString() ? `${pathname}?${next}` : pathname, { scroll: false })
  }, [router, pathname, sp])

  const query = useMemo(() => {
    const q = new URLSearchParams({ limit: String(PAGE), withTotal: '1' })
    if (type) q.set('types', type)
    if (createdById) q.set('createdById', createdById)
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    return q.toString()
  }, [type, createdById, from, to])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setMore([])
    fetch(`/api/crm/activities?${query}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!alive) return
        // 오류 봉투는 `{error:{code,message}}` 다. 객체를 그대로 넣으면 화면이 통째로 죽는다
        if (!res.ok) { setError(body?.error?.message ?? '활동을 불러오지 못했습니다.'); return }
        setData(body as Payload)
      })
      .catch(() => { if (alive) setError('활동을 불러오지 못했습니다.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [query])

  const items = useMemo(
    () => [...(data?.items ?? []), ...more].filter((a) => !gone.includes(a.id)),
    [data, more, gone],
  )
  const nextBefore = more.length > 0 ? lastBefore(more) : data?.nextBefore ?? null

  const loadMore = useCallback(async () => {
    if (!nextBefore) return
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/crm/activities?${query}&before=${encodeURIComponent(nextBefore)}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) { setError(body?.error?.message ?? '활동을 불러오지 못했습니다.'); return }
      setMore((prev) => [...prev, ...((body as Payload).items ?? [])])
    } catch {
      setError('활동을 불러오지 못했습니다.')
    } finally {
      setLoadingMore(false)
    }
  }, [nextBefore, query])

  /**
   * 담당자 후보. **구성원 목록을 한 번 받아 안에서 고른다** — 사람 수만큼이라
   * 글자마다 창구를 부를 만큼 많지 않고, 창구를 아끼면 고르는 동안 화면이 안 멈춘다.
   */
  const searchMembers = useCallback(async (q: string): Promise<RecordOption[]> => {
    const res = await fetch('/api/crm/members')
    if (!res.ok) return []
    const body = await res.json().catch(() => null)
    const rows = (body?.items ?? body ?? []) as { id: string; displayName?: string; name?: string }[]
    const needle = q.trim().toLowerCase()
    return rows
      .map((m) => ({ id: m.id, name: m.displayName ?? m.name ?? m.id }))
      .filter((m) => !needle || m.name.toLowerCase().includes(needle))
  }, [])

  /**
   * 한 건 휴지통으로.
   *
   * **사람이 남긴 것만 지울 수 있다**(서버가 종류로 판정한다). 화면도 그 종류에만
   * 단추를 그리지만, 그것은 보기 좋게 하려는 것이고 **막는 것은 서버다** —
   * 단추를 감추는 것으로 권한 검증을 대신하지 않는다(정책 F-N).
   */
  const remove = useCallback(async (row: ActivityRow) => {
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/crm/activities/${row.id}?mode=trash`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setDeleteError(body?.error?.message ?? '삭제하지 못했습니다.')
        return
      }
      // 지운 줄만 화면에서 내린다. 전부 다시 받으면 「더 보기」로 읽던 자리가 날아간다
      setGone((prev) => [...prev, row.id])
      setPending(null)
    } catch {
      setDeleteError('삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setDeleting(false)
    }
  }, [])

  if (loading && !data) return <AXDotLoader />
  if (error) return <ErrorState message={error} onRetry={() => set({})} />

  const total = data?.total ?? null
  const shown = items.length

  return (
    <div>
      <div className={styles.filters}>
        <div className={styles.field}>
          <span className="label">{ACTIVITY_TYPE_FIELD}</span>
          <div className={styles.types} role="group" aria-label={ACTIVITY_TYPE_FIELD}>
            <button
              type="button"
              className={`${styles.type}${type === '' ? ` ${styles.typeOn}` : ''}`}
              onClick={() => set({ type: '' })}
              aria-pressed={type === ''}
            >
              {FILTER_ALL}
            </button>
            {ACTIVITY_TYPE_ORDER.map((t) => (
              <button
                key={t} type="button"
                className={`${styles.type}${type === t ? ` ${styles.typeOn}` : ''}`}
                onClick={() => set({ type: t })}
                aria-pressed={type === t}
              >
                {ACTIVITY_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label className="label" htmlFor="ac-owner">{ACTIVITY_AUTHOR}</label>
          <RecordPickerField
            id="ac-owner"
            noun={ACTIVITY_AUTHOR}
            value={createdById}
            valueName={createdByName}
            onChange={(opt) => set({ createdById: opt?.id ?? '', createdByName: opt?.name ?? '' })}
            search={searchMembers}
          />
        </div>

        <div className={styles.field}>
          <span className="label">{REPORT.period}</span>
          <div className={styles.dates}>
            <DateField
              aria-label="시작 날짜"
              value={from}
              onValueChange={(v) => set({ from: v })}
              hideToday
            />
            <span aria-hidden>~</span>
            <DateField
              aria-label="끝 날짜"
              value={to}
              onValueChange={(v) => set({ to: v })}
              hideToday
            />
          </div>
        </div>

        {(type || createdById || from || to) && (
          <div className={styles.field}>
            <NbButton
              variant="ghost"
              onClick={() => set({ type: '', createdById: '', createdByName: '', from: '', to: '' })}
            >
              {ACTION.clear}
            </NbButton>
          </div>
        )}
      </div>

      {/*
        **몇 건 중 몇 건인지 말한다.** 상한에 걸린 것을 조용히 자르면 사람은 그것이
        전부라고 읽는다. 전체를 못 센 경우(`null`)에는 0 이라고 쓰지 않는다.
      */}
      <p className={styles.count}>
        {total === null
          ? count('activity', shown)
          : `${count('activity', total)} 중 ${countOnly('activity', shown)} 보는 중`}
      </p>

      {items.length === 0 ? (
        <EmptyState
          title="조건에 맞는 활동이 없어요"
          description={`${ACTIVITY_TYPE_FIELD}·${ACTIVITY_AUTHOR}·${REPORT.period}을 넓혀 보세요. 활동은 회사·인물·딜 상세에서 남깁니다.`}
        />
      ) : (
        <ol className={styles.list}>
          {items.map((a) => {
            const label = ACTIVITY_TYPE_LABEL[a.type as ActivityTypeKey] ?? a.type
            const anchors = anchorsOf(a, here)
            return (
              <li key={a.id} className={styles.item}>
                <div className={styles.head}>
                  <span className={styles.kind}>{TYPE_ICON[a.type] ?? null}{label}</span>
                  <span className={styles.title}>{a.title}</span>
                </div>
                <div className={styles.rowRight}>
                  <time className={styles.at} dateTime={a.occurredAt}>{formatKstDateTimeShort(a.occurredAt)}</time>
                  {(ACTIVITY_MANUAL_TYPES as readonly string[]).includes(a.type) && (
                    <button
                      type="button"
                      className={styles.del}
                      onClick={() => { setPending(a); setDeleteError(null) }}
                      aria-label={`${a.title} ${ACTION.delete}`}
                      title={ACTION.delete}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  )}
                </div>
                {a.body && <p className={styles.body}>{a.body}</p>}
                <div className={styles.anchors}>
                  {anchors.length === 0
                    ? <span className={styles.noAnchor}>{ACTIVITY_NO_ANCHOR}</span>
                    : anchors.map((x) => (
                      <a key={x.href} className={styles.anchor} href={x.href}>{x.label}</a>
                    ))}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {/* 놓치면 안 되는 오류다 — 지우려 눌렀는데 아무 일도 안 일어난 것으로 보이면 다시 누른다 */}
      <InlineError banner spaced>{deleteError}</InlineError>

      {pending && (
        <BulkDeleteConfirm
          entity={ENTITY.activity.label}
          names={[pending.title]}
          busy={deleting}
          onConfirm={() => void remove(pending)}
          onClose={() => setPending(null)}
        />
      )}

      {nextBefore && (
        <div className={styles.more}>
          <NbButton variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
            {ACTIVITY_MORE}
          </NbButton>
        </div>
      )}
    </div>
  )
}

/** 다음 쪽의 기준 시각 — 받은 마지막 줄의 일어난 시각 */
function lastBefore(rows: ActivityRow[]): string | null {
  const last = rows[rows.length - 1]
  return last ? last.occurredAt : null
}

/**
 * 어디에 붙은 기록인지.
 *
 * **id 만 들고 이름은 없다.** 이름을 그리려면 줄마다 회사·인물·딜을 다시 물어야 하고
 * (목록 50줄이면 왕복 150번) 그중 하나만 실패해도 그 줄이 빈 채로 남는다. 그래서
 * 개체 이름(「회사」·「인물」·「딜」)으로 가는 길만 만든다. 이름은 가면 보인다.
 */
function anchorsOf(a: ActivityRow, here: ReturnType<typeof hereNow>): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = []
  if (a.companyId) out.push({ href: linkWithBack(`/crm/companies/${a.companyId}`, here), label: ENTITY.company.label })
  if (a.personId) out.push({ href: linkWithBack(`/crm/people/${a.personId}`, here), label: ENTITY.person.label })
  if (a.dealId) out.push({ href: linkWithBack(`/crm/deals/${a.dealId}`, here), label: ENTITY.deal.label })
  return out
}
