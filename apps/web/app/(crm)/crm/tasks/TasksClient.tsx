'use client'

import { useRouter, useSearchParams } from 'next/navigation'

// 할 일 목록 (dacrm F2 뒤끝)
//
// **왜 이 화면이 필요한가**: 미팅에서 "8월 25일까지 보안 문서 보내기"를 뽑아
// 사람이 인박스에서 승인하면 할 일이 만들어진다. 그런데 그걸 볼 화면이 없으면
// 할 일은 DB 에만 쌓이고 아무도 하지 않는다 — 만든 적 없는 것과 같다.
//
// 그래서 이 화면이 답해야 하는 것은 하나다: **"내가 지금 뭘 해야 하나."**
// 그래서 기본이 "안 끝난 것"이고, 마감이 가까운 순이다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckSquare, Square, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import DateField from '@/components/ui/DateField'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import { ACTION, confirmDelete, failedTo } from '@/lib/terms'
import { kstTodayKey, kstDateKey, formatKstDateTimeShort } from '@/lib/datetime/kst'
import { isEnterKey } from '@/lib/ui/ime'
import { useAskDialog } from '@/components/ui/useAskDialog'
import styles from './tasks.module.css'
import { emitAttentionChanged } from '@/lib/crm/ui/attention-signal'

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

/** 범위 — 기본은 «안 끝난 것». 이 화면이 답하는 질문이 「내가 지금 뭘 해야 하나」다 */
const SCOPE_FILTER = {
  key: 'scope',
  label: '범위',
  // 「할 일」과 「전부」가 이미 전 범위다 — 「범위 전체」를 더하면 뜻이 겹친다
  noAll: true,
  options: [
    { value: 'open', label: '할 일' },
    { value: 'all', label: '전부' },
  ],
}

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
  /**
   * **URL 이 진실이다**(§2-6 (1)).
   *
   * 예전엔 검색어·범위를 `useState` 로 들고 있어서 **새로고침하면 조건이 날아갔고**,
   * 링크를 공유하면 받는 사람이 다른 화면을 봤다. 목록 조건은 주소에 산다.
   */
  const { query, set, queryKey } = useListQuery({
    view: 'table', size: 20, sort: { key: 'dueAt', dir: 'asc' }, mode: 'more',
    filterKeys: ['scope'],
  })
  const [items, setItems] = useState<Task[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const router = useRouter()
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

  const scope = (query.filters?.scope ?? 'open') as 'open' | 'all'
  const q = query.q ?? ''

  const load = useCallback(async (append = false, next: string | null = null) => {
    // 기본값으로 되돌리는 조작은 주소가 그대로라 개별 필드로는 안 보인다 — queryKey 만 안다
    void queryKey
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams({ scope, limit: String(query.size) })
      if (q.trim()) sp.set('q', q.trim())
      if (next) sp.set('cursor', next)
      const res = await fetch(`/api/crm/tasks?${sp.toString()}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '할 일을 불러오지 못했습니다.'); return }
      setItems((prev) => (append ? [...prev, ...(body.items ?? [])] : (body.items ?? [])))
      setCursor(body.nextCursor ?? null)
    } catch {
      setError('할 일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [queryKey, scope, q, query.size])

  // 조건이 바뀌면 처음부터 — 커서를 이어 쓰면 조건이 섞인다
  useEffect(() => { void load(false, null) }, [load])

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
      await load(false, null)
      // 사이드바 배지·알림 벨도 같은 사실을 센다 — 알려 주지 않으면 그 둘만 옛 숫자로 남는다
      emitAttentionChanged()
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
      await load(false, null)
      // 사이드바 배지·알림 벨도 같은 사실을 센다 — 알려 주지 않으면 그 둘만 옛 숫자로 남는다
      emitAttentionChanged()
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
      await load(false, null)
      // 사이드바 배지·알림 벨도 같은 사실을 센다 — 알려 주지 않으면 그 둘만 옛 숫자로 남는다
      emitAttentionChanged()
    } catch {
      setError('만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  /**
   * 컬럼 한 벌로 표와 카드를 함께 그린다(§2-6 (2)).
   *
   * 체크·삭제 칸은 **전파를 막는다** — 안 그러면 버튼을 눌렀는데 행이 열린다(§2-3-1).
   */
  const columns = useMemo<ColumnDef<Task>[]>(() => [
    {
      key: 'done',
      header: '',
      noLabel: true,
      width: '44px',
      cell: (t) => {
        const done = t.status === 'DONE' || t.status === 'CANCELED'
        return (
          <button
            type="button"
            className={styles.check}
            onClick={(e) => { e.stopPropagation(); void toggle(t) }}
            disabled={busy === t.id}
            aria-pressed={done}
            aria-label={done ? '안 한 것으로 되돌리기' : '했다고 표시'}
          >
            {done ? <CheckSquare size={18} /> : <Square size={18} />}
          </button>
        )
      },
    },
    {
      key: 'title',
      header: '할 일',
      primary: true,
      cell: (t) => {
        const done = t.status === 'DONE' || t.status === 'CANCELED'
        return (
          <span className={styles.main}>
            <span className={done ? styles.titleDone : styles.title}>{t.title}</span>
            {/*
              **무엇에 딸린 할 일인지 제목 아래에 적는다.**
              「딜」이라는 글자 링크뿐이면 «어느» 딜인지 눌러 봐야 안다
              (사용자 지적: 「이거 너는 어떤 딜인지 알겠니?」).
            */}
            {(t.dealName || t.companyName || t.personName) && (
              <span className={styles.rel} onClick={(e) => e.stopPropagation()}>
                {t.dealId && t.dealName && (
                  <Link href={`/crm/deals/${t.dealId}`} className={styles.relLink}>{t.dealName}</Link>
                )}
                {t.companyId && t.companyName && (
                  <Link href={`/crm/companies/${t.companyId}`} className={styles.relLink}>{t.companyName}</Link>
                )}
                {t.personId && t.personName && (
                  <Link href={`/crm/people/${t.personId}`} className={styles.relLink}>{t.personName}</Link>
                )}
              </span>
            )}
          </span>
        )
      },
    },
    {
      key: 'dueAt',
      header: '마감',
      cell: (t) => {
        const d = due(t.dueAt)
        return d
          ? <NbBadge status={d.late ? 'blocker' : 'planned'}>{d.text}</NbBadge>
          : <span className={styles.at}>—</span>
      },
    },
    {
      key: 'completedAt',
      header: '끝낸 때',
      hideOnCard: true,
      cell: (t) => (t.completedAt
        ? <span className={styles.at}>{formatKstDateTimeShort(t.completedAt)}</span>
        : <span className={styles.at}>—</span>),
    },
    {
      key: 'actions',
      header: '',
      noLabel: true,
      align: 'right',
      cell: (t) => (
        <button
          type="button"
          className={styles.remove}
          onClick={(e) => { e.stopPropagation(); void remove(t) }}
          disabled={busy === t.id}
          aria-label={`${t.title} ${ACTION.delete}`}
          title={ACTION.delete}
        >
          <Trash2 size={15} />
        </button>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [busy])

  return (
    <>
      <FormErrorBanner message={error} />

      {/*
        **목록 표준(§2-6)을 쓴다.** 예전엔 도구 줄·목록·페이지를 이 화면이 자작했고,
        그래서 새로고침하면 조건이 날아가고 링크를 공유해도 같은 화면이 안 나왔다.
      */}
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="할 일·회사·딜·인물로 검색"
        views={['table', 'card']}
        filters={[SCOPE_FILTER]}
      />

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

      <ListSurface
        rows={items}
        columns={columns}
        query={query}
        onChange={set}
        rowKey={(t) => t.id}
        /*
          **할 일에는 상세 화면이 없다.** 그 할 일의 «맥락»은 붙어 있는 딜·회사·인물에 있으므로
          행을 누르면 그리로 간다 — 행이 죽어 있으면 사용자는 「눌러도 아무 일이 없다」를 먼저 겪는다(§2-3-1).
          아무것도 안 붙은 할 일은 갈 곳이 없다. 그때는 움직이지 않는다 —
          없는 화면으로 보내는 것보다 낫다.
        */
        onRowClick={(t) => {
          const to = t.dealId ? `/crm/deals/${t.dealId}`
            : t.companyId ? `/crm/companies/${t.companyId}`
              : t.personId ? `/crm/people/${t.personId}`
                : null
          if (to) router.push(to)
        }}
        loading={loading && items.length === 0}
        error={error ? { message: error, onRetry: () => void load(false, null) } : null}
        empty={{
          title: q
            ? '조건에 맞는 할 일이 없어요'
            : scope === 'open' ? '지금 할 일이 없어요' : '할 일이 아직 없어요',
          description: q
            ? '검색어를 바꾸거나 범위를 「전부」로 바꿔 보세요.'
            : "미팅을 정리하면 '다음에 할 일'이 인박스로 오고, 반영하면 여기 쌓입니다.",
        }}
      />

      <ListPager
        query={query}
        loaded={items.length}
        hasMore={Boolean(cursor)}
        loading={loading}
        onChange={() => void load(true, cursor)}
      />

      {dialog}
    </>
  )
}
