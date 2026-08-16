'use client'

// 레코드 타임라인 (dacrm T1-04, 구현명세 §6.2 중앙 열)
//
// 회사·인물·딜 상세가 **같은 타임라인**을 쓴다. 붙는 대상만 다르다.
// 화면마다 만들면 어디는 노트를 남길 수 있고 어디는 없는데 생김새는 같아진다(§2-5).
//
// 상단에 인라인 입력을 둔다 — "기록하려면 어디로 가야 하지"를 없애는 게 이 칸의 목적이다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Phone, StickyNote, Users, Mail, Settings2, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import EmptyState from '@/components/ui/EmptyState'
import AXDotLoader from '@/components/ui/AXDotLoader'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import styles from './timeline.module.css'

export interface ActivityItem {
  id: string
  type: string
  occurredAt: string
  title: string
  body: string | null
  source: string
}

/** 붙일 대상 — 정확히 하나만 준다 */
export interface TimelineScope {
  companyId?: string
  personId?: string
  dealId?: string
}

const TYPE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  NOTE: { label: '노트', icon: <StickyNote size={14} /> },
  CALL: { label: '통화', icon: <Phone size={14} /> },
  MEETING: { label: '미팅', icon: <Users size={14} /> },
  EMAIL: { label: '메일', icon: <Mail size={14} /> },
  SYSTEM: { label: '시스템', icon: <Settings2 size={14} /> },
}

/** 사람이 남길 수 있는 종류 — 서비스의 MANUAL_TYPES 와 같은 목록이다 */
const MANUAL_VALUES: ReadonlySet<string> = new Set(['NOTE', 'CALL', 'MEETING'])

const MANUAL: { value: string; label: string }[] = [
  { value: 'NOTE', label: '노트' },
  { value: 'CALL', label: '통화' },
  { value: 'MEETING', label: '미팅' },
]

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: '전체' },
  ...MANUAL,
  { value: 'EMAIL', label: '메일' },
  { value: 'SYSTEM', label: '시스템' },
]

function scopeQuery(scope: TimelineScope): string {
  const sp = new URLSearchParams()
  if (scope.companyId) sp.set('companyId', scope.companyId)
  if (scope.personId) sp.set('personId', scope.personId)
  if (scope.dealId) sp.set('dealId', scope.dealId)
  return sp.toString()
}

export default function Timeline({ scope }: { scope: TimelineScope }) {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [before, setBefore] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [draft, setDraft] = useState('')
  const [draftType, setDraftType] = useState('NOTE')
  const [saving, setSaving] = useState(false)

  const base = useMemo(() => scopeQuery(scope), [scope])

  const load = useCallback(async (append: boolean, cursor: string | null) => {
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams(base)
      if (typeFilter) sp.set('types', typeFilter)
      if (cursor) sp.set('before', cursor)
      sp.set('limit', '20')

      const res = await fetch(`/api/crm/activities?${sp.toString()}`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '기록을 불러오지 못했습니다.'); return }
      setItems((prev) => (append ? [...prev, ...body.items] : body.items))
      setBefore(body.nextBefore)
    } catch {
      setError('기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [base, typeFilter])

  useEffect(() => { void load(false, null) }, [load])

  async function submit() {
    if (!draft.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...scope, type: draftType, title: draft.trim() }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '남기지 못했습니다.'); return }
      setDraft('')
      void load(false, null)
    } catch {
      setError('남기지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setError(null)
    try {
      const res = await fetch(`/api/crm/activities/${id}?mode=trash`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error?.message ?? '지우지 못했습니다.')
        return
      }
      void load(false, null)
    } catch {
      setError('지우지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  return (
    <div className={styles.wrap}>
      <FormErrorBanner message={error} />

      <div className={styles.composer}>
        <label className="label" htmlFor="crm-activity-type">종류</label>
        <select
          id="crm-activity-type" className="input-field" value={draftType}
          onChange={(e) => setDraftType(e.target.value)}
        >
          {MANUAL.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <label className="label" htmlFor="crm-activity-title">기록</label>
        <input
          id="crm-activity-title" className="input-field" value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="무슨 일이 있었나요?"
        />
        <NbButton onClick={() => void submit()} disabled={saving || !draft.trim()}>
          {saving ? '남기는 중…' : '남기기'}
        </NbButton>
      </div>

      <div className={styles.filters} role="group" aria-label="활동 종류">
        {FILTERS.map((f) => (
          <button
            key={f.value || 'all'}
            type="button"
            className={`${styles.filter}${typeFilter === f.value ? ` ${styles.filterOn}` : ''}`}
            aria-pressed={typeFilter === f.value}
            onClick={() => setTypeFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && items.length === 0 ? (
        <AXDotLoader />
      ) : items.length === 0 ? (
        <EmptyState
          title={typeFilter ? '이 종류의 기록이 없어요' : '아직 기록된 활동이 없어요'}
          description={typeFilter
            ? '다른 종류를 골라 보세요.'
            : '통화·미팅을 남기면 여기에 시간 순으로 쌓입니다.'}
        />
      ) : (
        <ol className={styles.list}>
          {items.map((a) => {
            const meta = TYPE_META[a.type] ?? { label: a.type, icon: null }
            return (
              <li key={a.id} className={styles.item}>
                <div className={styles.itemHead}>
                  <span className={styles.type}>{meta.icon}{meta.label}</span>
                  <time className={styles.at}>{formatKstDateTimeShort(a.occurredAt)}</time>
                  {/* 사람이 남길 수 있는 종류만 지울 수 있다 — 서버 판정과 같은 기준이다.
                      다르면 지우기 버튼을 눌렀는데 서버가 거절하는 화면이 된다 */}
                  {MANUAL_VALUES.has(a.type) && (
                    <button
                      type="button" className={styles.remove}
                      aria-label={`${a.title} 지우기`}
                      onClick={() => void remove(a.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <div className={styles.title}>{a.title}</div>
                {a.body && <div className={styles.body}>{a.body}</div>}
              </li>
            )
          })}
        </ol>
      )}

      {before && (
        <NbButton variant="ghost" onClick={() => void load(true, before)} disabled={loading}>
          {loading ? '불러오는 중…' : '이전 기록 더 보기'}
        </NbButton>
      )}
    </div>
  )
}
