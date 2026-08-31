'use client'

import { useSearchParams } from 'next/navigation'

// 할 일 목록 (dacrm F2 뒤끝)
//
// **왜 이 화면이 필요한가**: 미팅에서 "8월 25일까지 보안 문서 보내기"를 뽑아
// 사람이 인박스에서 승인하면 할 일이 만들어진다. 그런데 그걸 볼 화면이 없으면
// 할 일은 DB 에만 쌓이고 아무도 하지 않는다 — 만든 적 없는 것과 같다.
//
// 그래서 이 화면이 답해야 하는 것은 하나다: **"내가 지금 뭘 해야 하나."**
// 그래서 기본이 "안 끝난 것"이고, 마감이 가까운 순이다.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckSquare, Square, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import DateField from '@/components/ui/DateField'
import { ACTION, confirmDelete, failedTo } from '@/lib/terms'
import { kstTodayKey, kstDateKey, formatKstDateTimeShort } from '@/lib/datetime/kst'
import { isEnterKey } from '@/lib/ui/ime'
import { useAskDialog } from '@/components/ui/useAskDialog'
import styles from './tasks.module.css'

interface Task {
  id: string
  title: string
  status: string
  dueAt: string | null
  dealId: string | null
  companyId: string | null
  personId: string | null
  /** 붙어 있는 것의 **이름**. id 만 있으면 「어느 건이지」를 매번 눌러 봐야 한다 */
  dealName: string | null
  companyName: string | null
  personName: string | null
  completedAt: string | null
  createdAt: string
}

const SCOPES = [
  { value: 'open', label: '할 일' },
  { value: 'all', label: '전부' },
] as const

/** 마감이 언제인지 사람 말로 — 날짜만 보여 주면 급한지 아닌지 매번 계산해야 한다 */
function due(dueAt: string | null): { text: string; late: boolean } | null {
  if (!dueAt) return null
  const key = kstDateKey(dueAt)
  const today = kstTodayKey()
  if (key === today) return { text: '오늘까지', late: false }
  if (key < today) return { text: `${key} · 지났어요`, late: true }
  return { text: `${key}까지`, late: false }
}

export default function TasksClient() {
  const [items, setItems] = useState<Task[]>([])
  const [scope, setScope] = useState<'open' | 'all'>('open')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /**
   * 검색어. **서버가 이미 받고 있었는데 화면에 칸이 없었다** —
   * 「수원시 건 할 일이 뭐였지」를 찾을 길이 아예 없는 상태였다.
   * 서버는 제목뿐 아니라 회사·딜·인물 이름까지 훑는다.
   */
  const [q, setQ] = useState('')
  const { ask, dialog } = useAskDialog()
  const [title, setTitle] = useState('')
  /**
   * 캘린더에서 날짜를 눌러 들어오면 그 날이 마감일이다(`?due=`).
   *
   * 안 받으면 사용자는 8월 30일을 눌러 놓고 **오늘 마감인 할 일**을 만든다 —
   * 눌러서 들어온 화면이 그 날을 모르는 것이 문제였다(§2-6 "URL이 진실").
   */
  const dueParam = useSearchParams().get('due') ?? ''
  const [dueDate, setDueDate] = useState(/^\d{4}-\d{2}-\d{2}$/.test(dueParam) ? dueParam : '')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams({ scope, limit: '50' })
      if (q.trim()) sp.set('q', q.trim())
      const res = await fetch(`/api/crm/tasks?${sp.toString()}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '할 일을 불러오지 못했습니다.'); return }
      setItems(body.items ?? [])
    } catch {
      setError('할 일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [scope, q])

  useEffect(() => { void load() }, [load])

  async function toggle(t: Task) {
    setBusy(t.id)
    setError(null)
    try {
      const res = await fetch(`/api/crm/tasks/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: t.status === 'DONE' ? 'TODO' : 'DONE' }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        setError(b?.error?.message ?? '바꾸지 못했습니다.')
        return
      }
      await load()
    } catch {
      setError('바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  /**
   * 지울 길이 없었다 — `DELETE /api/crm/tasks/:id` 는 있는데 **화면이 안 불렀다**(§2-5(3)).
   * 캘린더에서 할 일을 만들 수 있게 해 놓고 지울 수 없으면, 잘못 만든 것이 영원히 남는다.
   *
   * 휴지통이라 되돌릴 수 있지만(30일) 확인은 받는다 — 목록에서 사라지는 건 같다.
   */
  async function remove(t: Task) {
    if (!await ask.confirm({
      title: confirmDelete('task', 1, { stays: '딜과 미팅 기록은 그대로 남아요.' }),
      confirmLabel: ACTION.delete, danger: true,
    })) return
    setBusy(t.id)
    setError(null)
    try {
      const res = await fetch(`/api/crm/tasks/${t.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        setError(b?.error?.message ?? failedTo('할 일', '삭제'))
        return
      }
      await load()
    } catch {
      setError(failedTo('할 일', '삭제', '잠시 후 다시 시도해 주세요.'))
    } finally {
      setBusy(null)
    }
  }

  async function add() {
    if (!title.trim()) { setError('무엇을 할지 적어 주세요.'); return }
    setBusy('new')
    setError(null)
    try {
      const res = await fetch('/api/crm/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // 날짜만 받았으면 그날 끝까지다 — KST 벽시계로 보내고 서버가 UTC 로 적재한다
        body: JSON.stringify({ title: title.trim(), dueAt: dueDate ? `${dueDate}T23:59:00+09:00` : null }),
      })
      const b = await res.json()
      if (!res.ok) { setError(b?.error?.message ?? '만들지 못했습니다.'); return }
      setTitle('')
      setDueDate('')
      await load()
    } catch {
      setError('만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <FormErrorBanner message={error} />

      <div className={styles.toolbar}>
        <SegmentedTabs
          tabs={SCOPES.map((s) => ({ id: s.value, label: s.label }))}
          ariaLabel="할 일 범위"
          activeId={scope}
          onSelect={(id) => setScope(id as 'open' | 'all')}
        />
        {/*
          **회사·딜·인물 이름으로도 찾는다.** 제목만 훑으면 제목에 회사명이 안 적힌
          할 일은 영영 못 찾는다 — 그게 대부분이다.
        */}
        <input
          className={`input-field ${styles.search}`}
          value={q}
          placeholder="할 일·회사·딜·인물로 검색"
          onChange={(e) => setQ(e.target.value)}
          aria-label="할 일 검색"
        />
      </div>

      <div className={styles.add}>
        <input
          className="input-field"
          value={title}
          placeholder="무엇을 할까요 (예: 보안 아키텍처 문서 보내기)"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (isEnterKey(e)) void add() }}
          aria-label="할 일"
        />
        {/* 선택 항목이라 기본값을 넣지 않는다 — '마감 없음'과 '오늘 마감'은 다른 뜻이다. */}
        <DateField value={dueDate} onValueChange={setDueDate} aria-label="마감일" />
        <NbButton onClick={() => void add()} disabled={busy === 'new'}>
          {busy === 'new' ? '만드는 중…' : '추가'}
        </NbButton>
      </div>

      {loading && items.length === 0 ? <AXDotLoader />
        : items.length === 0 ? (
          <EmptyState
            title={scope === 'open' ? '지금 할 일이 없어요' : '할 일이 아직 없어요'}
            description="미팅을 정리하면 '다음에 할 일'이 인박스로 오고, 반영하면 여기 쌓입니다."
            icon={<CheckSquare size={28} />}
          />
        ) : (
          <ul className={styles.list}>
            {items.map((t) => {
              const d = due(t.dueAt)
              const done = t.status === 'DONE' || t.status === 'CANCELED'
              return (
                <li key={t.id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.check}
                    onClick={() => void toggle(t)}
                    disabled={busy === t.id}
                    aria-pressed={done}
                    aria-label={done ? '안 한 것으로 되돌리기' : '했다고 표시'}
                  >
                    {done ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                  <span className={styles.main}>
                    <span className={done ? styles.titleDone : styles.title}>{t.title}</span>
                    {/*
                      **무엇에 딸린 할 일인지 제목 아래에 적는다.**
                      예전엔 「딜」이라는 글자 링크 하나뿐이라 «어느» 딜인지 알 수 없었다
                      (사용자 지적: 「이거 너는 어떤 딜인지 알겠니? 왜 친절하지가 않아?」).
                      이름이 곧 링크다 — 「딜」을 눌러야 이름을 아는 구조를 되돌리지 않는다.
                    */}
                    {(t.dealName || t.companyName || t.personName) && (
                      <span className={styles.rel}>
                        {t.dealId && t.dealName && (
                          <Link href={`/crm/deals/${t.dealId}`} className={styles.relLink}>
                            {t.dealName}
                          </Link>
                        )}
                        {t.companyId && t.companyName && (
                          <Link href={`/crm/companies/${t.companyId}`} className={styles.relLink}>
                            {t.companyName}
                          </Link>
                        )}
                        {t.personId && t.personName && (
                          <Link href={`/crm/people/${t.personId}`} className={styles.relLink}>
                            {t.personName}
                          </Link>
                        )}
                      </span>
                    )}
                  </span>
                  {d && (
                    <NbBadge status={d.late ? 'blocker' : 'planned'}>{d.text}</NbBadge>
                  )}
                  {done && t.completedAt && (
                    <span className={styles.at}>{formatKstDateTimeShort(t.completedAt)}</span>
                  )}
                  <button
                    type="button"
                    className={styles.remove}
                    onClick={() => void remove(t)}
                    disabled={busy === t.id}
                    aria-label={`${t.title} ${ACTION.delete}`}
                    title={ACTION.delete}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

      {/* 대화상자는 렌더해야 뜬다 — 안 그리면 물어도 안 나오고 그대로 멈춘다 */}
      {dialog}
    </>
  )
}
