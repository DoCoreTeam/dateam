'use client'

// components/ci/ReviewGroups.tsx — 검토를 «판정 묶음» 카드로 그린다
//
// 왜 표가 아니라 카드인가(2026-08-27 실측):
//   검토 대기 634건 중 629건이 채널 하나였고, 634건 전부가 같은 사유·같은 후보였다.
//   표는 634줄을 늘어놓고 줄마다 드롭다운을 줬다 — 같은 답을 634번 하라는 화면이었다.
//   게다가 표는 칸이 7개라 좁은 화면에서 가로로 잘렸다(가로 스크롤 표는 금지, §반응형).
//
//   카드 한 장 = 답해야 할 질문 하나. 답하면 묶음 전체가 서버에서 한 번에 정리된다.
//   영상이 몇만 개인 채널이 들어와도 카드 수는 판정의 종류만큼만 늘어난다.
//
// 다만 묶음은 «같은 판정»끼리 모은 것이지 «같은 내용»끼리 모은 것이 아니다.
// 한 채널 안에도 서로 다른 주제가 많다 — 실측 「장사의 신」 645건은
// 인물·블로그 506 · 음식 102 · 엔터 30 · 교육 4 · 이슈 2로 갈렸다.
// 그래서 카드는 **게시물을 하나씩 빼고 답할 수 있어야** 한다(사용자 지적:
// "같은 채널에 같은 주제가 아닌게 엄청 많아"). 보이지 않는 것은 뺄 수도 없으므로 목록을 보여준다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { isEnterKey } from '@/lib/ui/ime'
import type { ReviewGroup } from '@/lib/ci/queries/review-groups'
import type { ApiResponse } from '@/lib/ci/contracts'
import s from './review-groups.module.css'

interface Props {
  workspaceId: string
  /** 주제를 바꿔 답할 수 있게 — 갈린 둘 말고 제3의 답도 낼 수 있어야 한다 */
  topics: { id: string; name: string }[]
}

interface ResolveResult {
  resolved: number
  topicName: string
  remembered: string | null
}

export default function ReviewGroups({ workspaceId, topics }: Props) {
  const router = useRouter()
  const [groups, setGroups] = useState<ReviewGroup[] | null>(null)
  // 주제는 이 화면에서 **만들 수도** 있다 — 만든 즉시 다른 카드에서도 고를 수 있어야 한다.
  //
  // 여기서 만든 것만 따로 들고 렌더할 때 합친다. 서버 목록을 state 로 복사해
  // useEffect 로 동기화하면 안 된다 — props 배열은 렌더마다 새 참조라
  // «effect → setState → 렌더 → effect»가 돌아 화면이 멈춘다(실제로 멈췄다).
  const [extraTopics, setExtraTopics] = useState<{ id: string; name: string }[]>([])
  const topicList = useMemo(() => {
    const seen = new Set(topics.map((t) => t.id))
    return [...topics, ...extraTopics.filter((t) => !seen.has(t.id))]
  }, [topics, extraTopics])
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [done, setDone] = useState<string[]>([])

  const load = useCallback(() => {
    setError(null)
    // no-store 가 없으면 답한 직후 다시 읽을 때 **옛 응답**이 온다 —
    // 화면은 방금 정리한 건수를 그대로 들고 있어 «눌렸나?»가 된다(실측).
    fetch('/api/ci/review/groups', {
      cache: 'no-store',
      headers: { 'X-CI-Workspace': workspaceId },
    })
      .then((r) => r.json() as Promise<ApiResponse<{ groups: ReviewGroup[] }>>)
      .then((res) => {
        if (res.success) setGroups(res.data.groups)
        else setError({ code: res.error.code, message: res.error.message })
      })
      .catch((e: unknown) => setError({
        code: 'NETWORK',
        message: e instanceof Error ? e.message : '검토할 것을 불러오지 못했습니다.',
      }))
  }, [workspaceId])

  useEffect(load, [load])

  /**
   * @param contentIds 고른 게시물만 확정한다. 비면 묶음 전부(보이지 않는 것 포함).
   *   이 구분이 화면에 그대로 보여야 한다 — 「전부」와 「고른 것만」은 다른 일이다.
   */
  async function resolve(g: ReviewGroup, topicId: string, remember: boolean, contentIds?: string[]) {
    setBusyKey(g.key)
    try {
      const res = await fetch('/api/ci/review/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({
          groupKey: g.key, topicId, rememberForChannel: remember,
          ...(contentIds && contentIds.length > 0 ? { contentIds } : {}),
        }),
      }).then((r) => r.json() as Promise<ApiResponse<ResolveResult>>)

      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }

      // 무슨 일이 일어났는지 말한다 — 사라지기만 하면 눌린 건지 알 수 없다
      const d = res.data
      setDone((prev) => [
        `${g.channelName} · ${d.resolved}건을 '${d.topicName}'으로 정리했습니다`
        + (d.remembered ? ` — 앞으로 이 채널은 묻지 않습니다` : ''),
        ...prev,
      ])
      // 일부만 확정했으면 묶음은 남아 있다 — 목록에서 지우면 남은 것이 사라진 것처럼 보인다.
      // 서버가 진실이므로 그때는 다시 읽는다.
      if (contentIds && contentIds.length > 0) load()
      else setGroups((prev) => prev?.filter((x) => x.key !== g.key) ?? null)
      router.refresh()   // 사이드바 뱃지·탭 건수도 함께 줄어야 한다
    } finally {
      setBusyKey(null)
    }
  }

  /** 없는 주제는 여기서 만든다 — 만들러 다른 화면에 다녀오게 하지 않는다 */
  async function createTopic(name: string): Promise<{ id: string; name: string } | null> {
    const res = await fetch('/api/ci/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
      body: JSON.stringify({ name }),
    }).then((r) => r.json() as Promise<ApiResponse<{ id: string; name: string }>>)
      .catch(() => null)
    if (!res || !res.success) {
      setError(res && !res.success
        ? { code: res.error.code, message: res.error.message }
        : { code: 'NETWORK', message: '주제를 만들지 못했습니다.' })
      return null
    }
    setExtraTopics((prev) => [...prev, res.data])
    return res.data
  }

  if (error) return <ErrorState message={error.message} code={error.code} onRetry={load} />
  if (!groups) return <SkelList rows={3} />

  return (
    <div className={s.list}>

      {done.length > 0 && (
        <div className={`ci-status ci-status-ok ${s.notice}`} role="status">
          {done.map((m) => <div key={m}><Check size={14} style={{ verticalAlign: '-2px' }} /> {m}</div>)}
        </div>
      )}

      {groups.length === 0 && (
        <EmptyState
          title="검토할 것이 없습니다"
          description="AI가 정한 주제가 갈린 게시물이 생기면 여기에 묶여서 올라옵니다."
        />
      )}

      {groups.map((g) => (
        <ReviewCard
          key={g.key} g={g} topics={topicList}
          busy={busyKey === g.key}
          disabled={busyKey != null && busyKey !== g.key}
          onResolve={resolve}
          onCreateTopic={createTopic}
        />
      ))}
    </div>
  )
}

function ReviewCard({ g, topics, busy, disabled, onResolve, onCreateTopic }: {
  g: ReviewGroup
  topics: { id: string; name: string }[]
  busy: boolean
  disabled: boolean
  onResolve: (g: ReviewGroup, topicId: string, remember: boolean, contentIds?: string[]) => void
  onCreateTopic: (name: string) => Promise<{ id: string; name: string } | null>
}) {
  // 기본은 **꺼짐**이다. 채널 안에도 서로 다른 주제가 많다 —
  // 실측 「장사의 신」 645건은 인물·블로그 506 · 음식 102 · 엔터 30 · 교육 4 · 이슈 2로 갈렸다.
  // 이것을 기본 켜짐으로 두면 그 다양성을 없애는 쪽이 기본이 된다.
  // (사용자 지적 원문: "같은 채널에 같은 주제가 아닌게 엄청 많아")
  const [remember, setRemember] = useState(false)
  // 기본은 전부 선택이다. 사용자가 «다른 것»을 발견했을 때 빼는 방식이라
  // 하나씩 고르게 하지 않으면서도 하나씩 뺄 수 있다.
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const shown = g.samples
  const hidden = Math.max(0, g.count - shown.length)
  const picked = shown.filter((x) => !excluded.has(x.id))
  const partial = excluded.size > 0
  // 하나도 안 뺐으면 «묶음 전부»(보이지 않는 것 포함), 뺐으면 «고른 것만».
  // 이 구분을 화면이 숨기면 사용자는 안 보이는 것에 무슨 일이 났는지 모른다.
  const targetIds = partial ? picked.map((x) => x.id) : undefined
  const targetCount = partial ? picked.length : g.count

  function toggle(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function createAndResolve() {
    const name = (newName ?? '').trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const t = await onCreateTopic(name)
      if (t) { setNewName(null); onResolve(g, t.id, remember, targetIds) }
    } finally { setCreating(false) }
  }

  const question = g.altTopicName
    ? `${g.channelName} — 이 게시물들은 「${g.topicName}」인가요, 「${g.altTopicName}」인가요?`
    : `${g.channelName} — 이 게시물들을 「${g.topicName}」으로 볼까요?`

  const lock = busy || disabled

  return (
    <article className={`card ${s.card}`} data-idle={disabled ? 'true' : 'false'}>
      <div className={s.head}>
        <div className={s.headMain}>
          <h3 className={s.question}>{question}</h3>
          <p className={`ci-basis ${s.sub}`}>
            게시물 {g.count}건{g.channelWide ? ' · 이 채널의 대부분입니다' : ''}
          </p>
        </div>
        <span className={`${g.count >= 50 ? 'ci-status ci-status-warn' : 'ci-status ci-status-neutral'} ${s.count}`}>
          {g.count}건
        </span>
      </div>

      {/* 왜 물어보는지 — 이유 없이 뜬 질문은 사용자가 답할 수 없다 */}
      {g.reason && <p className={s.reason}>{g.reason}</p>}

      {/* 무엇이 묶였는지. 체크를 풀면 그 게시물은 이번 답에서 빠진다 */}
      {shown.length > 0 && (
        <ul className={s.samples}>
          {shown.map((sample) => (
            <li key={sample.id}>
              <label className={s.pick}>
                <input
                  type="checkbox"
                  checked={!excluded.has(sample.id)} disabled={lock}
                  onChange={() => toggle(sample.id)}
                />
                <span className={excluded.has(sample.id) ? s.dropped : undefined}>
                  {sample.title ?? '제목 없음'}
                </span>
              </label>
            </li>
          ))}
          {hidden > 0 && (
            <li className={`ci-basis ${s.hidden}`}>
              {partial
                ? `여기 보이는 것만 답합니다 — 나머지 ${hidden}건은 그대로 남습니다`
                : `외 ${hidden}건도 함께 확정됩니다`}
            </li>
          )}
        </ul>
      )}

      <div className={s.actions}>
        <button type="button" className="btn-primary" disabled={lock || targetCount === 0}
          onClick={() => onResolve(g, g.topicId, remember, targetIds)}>
          {busy ? '정리하는 중…' : `「${g.topicName}」으로 확정 (${targetCount}건)`}
        </button>

        {g.altTopicId && (
          <button type="button" className="btn-ghost" disabled={lock || targetCount === 0}
            onClick={() => onResolve(g, g.altTopicId!, remember, targetIds)}>
            「{g.altTopicName}」으로 확정
          </button>
        )}

        {/* 갈린 둘 다 아닐 수 있다 — 그 길이 없으면 사용자는 틀린 답을 고르게 된다.
            그리고 **맞는 주제가 아예 없을 수도** 있다. 그래서 여기서 만든다. */}
        <label className={`label ${s.srOnly}`} htmlFor={`t-${g.key}`}>다른 주제로 확정</label>
        <select id={`t-${g.key}`} className={`input-field ${s.other}`} value="" disabled={lock || targetCount === 0}
          onChange={(e) => {
            const v = e.target.value
            if (v === '__new__') { setNewName(''); return }
            if (v) onResolve(g, v, remember, targetIds)
          }}>
          <option value="">다른 주제…</option>
          {topics.filter((t) => t.id !== g.topicId && t.id !== g.altTopicId)
            .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          <option value="__new__">+ 새 주제 만들기…</option>
        </select>
      </div>

      {/* 만드는 자리를 접었다 폈다 하지 않고 고른 순간 바로 연다 — 한 단계라도 줄인다 */}
      {newName !== null && (
        <div className={s.create}>
          <label className={`label ${s.srOnly}`} htmlFor={`n-${g.key}`}>새 주제 이름</label>
          <input
            id={`n-${g.key}`} className="input-field" value={newName} autoFocus
            placeholder="예: 자영업" maxLength={40} disabled={creating || lock}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              // 맨손 Enter 금지 — 한글은 조합 확정도 Enter 로 올라온다(lib/ui/ime SSOT)
              if (isEnterKey(e)) { e.preventDefault(); void createAndResolve() }
              if (e.key === 'Escape') setNewName(null)
            }}
          />
          <button type="button" className="btn-primary" disabled={creating || lock || !newName.trim()}
            onClick={() => void createAndResolve()}>
            {creating ? '만드는 중…' : `만들고 ${targetCount}건 확정`}
          </button>
          <button type="button" className="btn-ghost" disabled={creating}
            onClick={() => setNewName(null)}>취소</button>
        </div>
      )}

      {g.channelId && (
        <label className={s.remember}>
          <input type="checkbox" checked={remember} disabled={lock || partial}
            onChange={(e) => setRemember(e.target.checked)} />
          앞으로 이 채널의 게시물은 묻지 않고 같은 주제로 넣기
          {partial && <span className="ci-basis"> — 일부만 고르면 굳히지 않습니다</span>}
        </label>
      )}
    </article>
  )
}
