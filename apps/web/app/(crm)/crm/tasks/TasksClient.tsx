'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import InlineError from '@/components/ui/InlineError'

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
import { CheckSquare, Square, Trash2, Link2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import DateField from '@/components/ui/DateField'
import ListToolbar from '@/components/ui/list/ListToolbar'
import ListSurface from '@/components/ui/list/ListSurface'
import ListPager from '@/components/ui/list/ListPager'
import RowActions from '@/components/ui/list/RowActions'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import {
  TRASH_FILTER, TRASH_FILTER_KEYS, TRASH_EMPTY, isTrashView, useRestore, restoreColumn,
} from '@/components/ui/crm/trash'
import { ACTION, confirmDeleteParts, failedTo } from '@/lib/terms'
import { kstTodayKey, kstDateKey, formatKstDateTimeShort } from '@/lib/datetime/kst'
import { isEnterKey } from '@/lib/ui/ime'
import { useAskDialog } from '@/components/ui/useAskDialog'
import styles from './tasks.module.css'
import { emitAttentionChanged } from '@/lib/crm/ui/attention-signal'
import { initialDueDate, initialStartDate, toStartIso, toDueIso, startsAfterDue } from '@/lib/crm/ui/task-due'
import RecordPickerField, { RecordPickerModal, type RecordOption } from '@/components/ui/RecordPicker'
import { searchDeals, searchHintFromTitle } from '@/lib/crm/ui/record-search'

interface Task {
  id: string
  title: string
  status: string
  startAt: string | null
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
    filterKeys: ['scope', ...TRASH_FILTER_KEYS],
  })
  const [items, setItems] = useState<Task[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /**
   * **목록을 못 불러온 것**만 담는다.
   *
   * 예전엔 `error` 하나로 다 했다 — 그래서 빈 제목으로 「추가」를 누르면
   * 「무엇을 할지 적어 주세요」가 배너와 목록 두 곳에 뜨고, **할 일 목록이 통째로 사라졌다**.
   * 입력을 잘못한 것이 이미 있는 목록을 지울 이유는 없다.
   */
  const [loadError, setLoadError] = useState<string | null>(null)
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
  /*
    **마감은 오늘부터 잡는다**(v0.7.696 · 사용자 지시 「기본적으로 오늘 날짜 부터 잡아야지
    비어 있으면 안되지」). 비어 있으면 사람은 그 칸을 지나치고, 마감 없는 할 일은
    목록 맨 아래로 가라앉아 영원히 안 된다. 판정은 `task-due.ts` 가 한다(SSOT · E-6).
  */
  const [dueDate, setDueDate] = useState(() => initialDueDate(dueParam))
  /* 시작일 — 마감과 같은 이유로 오늘부터다(v0.7.696 · 사용자 지시) */
  const [startDate, setStartDate] = useState(() => initialStartDate(null))
  /**
   * 새로 만들 때 함께 이을 딜.
   *
   * **왜 필요한가**: 여기서 손으로 적은 할 일은 딜이 안 붙는다(실측 2026-09-08 `/crm/tasks` 4건 전부).
   * 그러면 그 할 일은 어느 건의 일인지 모른 채 목록에만 쌓이고, 행을 눌러도 갈 곳이 없다.
   */
  const [newDeal, setNewDeal] = useState<RecordOption | null>(null)
  /** 이미 있는 할 일에 딜을 잇거나 바꾸는 중 — 그 할 일 하나만 잡는다 */
  const [linking, setLinking] = useState<Task | null>(null)

  const scope = (query.filters?.scope ?? 'open') as 'open' | 'all'
  const q = query.q ?? ''
  /**
   * 휴지통 보기.
   *
   * 삭제 확인창이 **「30일 안에 되돌릴 수 있어요」라고 약속한다.** 그런데 이 화면에는
   * 지운 것을 볼 길이 없어서 그 약속이 지켜질 방법이 없었다 — 서버에는 `trash=1` 도
   * 되살리기 API 도 이미 있는데 **화면만 안 불렀다**(§2-5 (3), 삭제와 같은 부류의 결함).
   */
  const trash = isTrashView(query)

  const load = useCallback(async (append = false, next: string | null = null) => {
    // 기본값으로 되돌리는 조작은 주소가 그대로라 개별 필드로는 안 보인다 — queryKey 만 안다
    void queryKey
    setLoading(true)
    setError(null)
    setLoadError(null)
    try {
      const sp = new URLSearchParams({ scope, limit: String(query.size) })
      if (trash) sp.set('trash', '1')
      if (q.trim()) sp.set('q', q.trim())
      if (next) sp.set('cursor', next)
      const res = await fetch(`/api/crm/tasks?${sp.toString()}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) { setLoadError(body?.error?.message ?? failedTo('할 일', '불러오지')); return }
      setItems((prev) => (append ? [...prev, ...(body.items ?? [])] : (body.items ?? [])))
      setCursor(body.nextCursor ?? null)
    } catch {
      setLoadError(failedTo('할 일', '불러오지'))
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
    // 제목은 물음만, 결과는 본문으로 — 한 줄로 넘기면 `.tape-title`(nowrap)이 넘친다
    const c = confirmDeleteParts('task', 1, { stays: '딜과 미팅 기록' })
    if (!await ask.confirm({
      title: c.title, body: c.body,
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

  /**
   * 이미 있는 할 일에 딜을 잇거나 뗀다.
   *
   * `null` 이면 떼는 것이다 — 붙이는 길만 만들면 잘못 이어 놓고 되돌릴 수가 없다(CRUD).
   */
  async function linkDeal(t: Task, deal: RecordOption | null) {
    setLinking(null)
    setBusy(t.id)
    setError(null)
    try {
      const res = await fetch(`/api/crm/tasks/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId: deal?.id ?? null }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        setError(b?.error?.message ?? failedTo('딜', '잇지'))
        return
      }
      await load(false, null)
    } catch {
      setError(failedTo('딜', '잇지'))
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
        body: JSON.stringify({
          title: title.trim(),
          // 시작은 그날 00:00, 마감은 23:59 — 같은 날을 골라도 「시작이 마감보다 늦다」가 안 되게
          startAt: toStartIso(startDate),
          dueAt: toDueIso(dueDate),
          // 서버는 처음부터 받고 있었다 — 화면이 안 보내서 전부 «딜 없음»이 됐다(§2-5(3))
          dealId: newDeal?.id ?? null,
        }),
      })
      const b = await res.json()
      if (!res.ok) { setError(b?.error?.message ?? '만들지 못했습니다.'); return }
      setTitle('')
      // 다음 것을 바로 적을 수 있게 **오늘로 되돌린다** — 빈 칸으로 두면 두 번째부터 마감이 없어진다
      setDueDate(initialDueDate(null))
      setStartDate(initialStartDate(null))
      setNewDeal(null)
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
  const { restore, restoreError } = useRestore('/api/crm/tasks', () => void load(false, null))

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
      /*
        **시작일을 마감 앞에** 둔다(v0.7.696) — 「언제부터 언제까지」가 읽는 순서다.
        안 정한 것은 「—」로 둔다. 마감처럼 늦었다고 표시하지 않는다 —
        시작일이 지난 것은 «늦은 것»이 아니라 «이미 시작했어야 하는 것»이라 뜻이 다르다.
      */
      key: 'startAt',
      header: '시작',
      cell: (t) => {
        const d = t.startAt ? kstDateKey(t.startAt) : null
        return d ? <span className={styles.at}>{d}</span> : <span className={styles.at}>—</span>
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
        <RowActions inline={2} subject={t.title}>
        {/*
          **딜을 이 자리에서 잇는다.** 예전엔 붙일 길이 아예 없어서, 여기서 손으로 적은
          할 일은 영원히 «어느 건인지 모르는 할 일»로 남았다.
          창은 제목에서 뽑은 말로 미리 좁혀 열린다 — 고르는 것은 사람이다(§5-3).
        */}
        <button
          type="button"
          className={styles.remove}
          onClick={(e) => { e.stopPropagation(); setLinking(t) }}
          disabled={busy === t.id}
          aria-label={t.dealId ? `${t.title} 딜 바꾸기` : `${t.title} 딜 잇기`}
          title={t.dealId ? '딜 바꾸기' : '딜 잇기'}
        >
          <Link2 size={15} />
        </button>
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
        </RowActions>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [busy])

  /** 휴지통이면 마지막에 되살리기 칸 — 회사·인물·딜·견적·미팅과 같은 부품이다 */
  const shownColumns = useMemo(
    () => (trash ? [...columns, restoreColumn<Task>((id) => void restore(id))] : columns),
    [trash, columns, restore],
  )

  return (
    <>
      {/* 배너는 **방금 한 조작**의 실패만 — 목록을 못 불러온 것은 목록 자리에서 말한다 */}
      <FormErrorBanner message={error ?? restoreError} />

      {/*
        **목록 표준(§2-6)을 쓴다.** 예전엔 도구 줄·목록·페이지를 이 화면이 자작했고,
        그래서 새로고침하면 조건이 날아가고 링크를 공유해도 같은 화면이 안 나왔다.
      */}
      <ListToolbar
        query={query}
        onChange={set}
        searchPlaceholder="할 일·회사·딜·인물로 검색"
        views={['table', 'card']}
        filters={[SCOPE_FILTER, TRASH_FILTER]}
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
        <DateField value={startDate} onValueChange={setStartDate} aria-label="시작일" />
        <DateField value={dueDate} onValueChange={setDueDate} min={startDate || undefined} aria-label="마감일" />
        {/*
          **어느 건의 일인지 여기서 정한다.** 필수가 아니다 — 딜이 없는 잡무도 있다.
          제목을 적어 두면 그 말로 후보를 좁혀 창이 열린다. 자동으로 고르지는 않는다(§5-3).
        */}
        <RecordPickerField
          noun="딜"
          value={newDeal?.id ?? ''}
          valueName={newDeal?.name}
          onChange={setNewDeal}
          search={searchDeals}
          initialQuery={searchHintFromTitle(title)}
          placeholder="딜 (선택)"
        />
        <NbButton onClick={() => void add()} disabled={busy === 'new'}>
          {busy === 'new' ? '만드는 중…' : '추가'}
        </NbButton>
      </div>

      {/*
        **막지 않고 알린다**(v0.7.696). 마감을 먼저 정하고 시작을 뒤로 미루는 일이 실제로 있고,
        저장을 막으면 적던 것을 잃는다. 사람이 보고 판단하게 한 줄로 말해 준다.
      */}
      {startsAfterDue(startDate, dueDate) && (
        <InlineError>시작일이 마감일보다 늦어요. 그대로 두셔도 되지만 한 번 확인해 주세요.</InlineError>
      )}

      <ListSurface
        rows={items}
        columns={shownColumns}
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
        error={loadError ? { message: loadError, onRetry: () => void load(false, null) } : null}
        empty={trash ? TRASH_EMPTY : {
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

      {/*
        행에서 연 딜 고르기. 이미 이어 둔 것이 있으면 «연결 해제»가 함께 보인다 —
        붙이는 길만 만들면 잘못 이어 놓고 되돌릴 수가 없다.
      */}
      {linking && (
        <RecordPickerModal
          noun="딜"
          selectedId={linking.dealId ?? undefined}
          search={searchDeals}
          initialQuery={linking.dealId ? '' : searchHintFromTitle(linking.title)}
          onPick={(opt) => void linkDeal(linking, opt)}
          onClear={() => void linkDeal(linking, null)}
          onClose={() => setLinking(null)}
        />
      )}

      {dialog}
    </>
  )
}
