'use client'

/**
 * 접근권한 화면 — **표면 하나를 펼쳐 그 자리에서 허용하거나 차단한다**
 *
 * ## 왜 표면이 목록이고 부여가 그 안인가
 *
 * 관리자가 하는 질문은 언제나 「이 화면을 누가 보나」다. 그 반대(「이 사람이 무엇을 보나」)는
 * 이미 `decideAccess` 가 사람마다 답하고 있고, 여기서 또 답하면 두 벌이 된다.
 * 그래서 축은 **표면 하나**이고 부여는 그 표면에 딸린다.
 *
 * ## 왜 탭이 아니라 접기인가
 *
 * 부여는 표면에서 **나온 것**이지 표면과 형제가 아니다(§2-3-6 P-1).
 * 형제 자리에 세우면 「어느 표면의 부여인가」를 화면이 한 번 더 말해야 한다.
 * 접기는 `<details>` 로 한다 — 키보드·스크린리더 규약이 브라우저에 이미 있고,
 * **닫혀 있으면 본문을 아예 그리지 않는다**(표면 26개의 폼을 전부 들고 있지 않게).
 *
 * ## 왜 미리보기 숫자가 필요한가
 *
 * 조직에 열면 그 아래 사람 전부에게 열린다. 저장하기 전에 **몇 명인지** 모르면
 * 관리자는 열어 놓고 확인을 나중으로 미루게 되고, 그 「나중」은 대개 오지 않는다.
 * 세는 규칙은 `orgOptions`(actions.ts) 한 곳이고 그것은 `appliesToMe` 와 같은 규칙이다 —
 * 하위 포함이면 조상 사슬, 아니면 직접 소속.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import {
  ACCESS,
  ACCESS_AUDIENCE_LABEL, ACCESS_AUDIENCE_STATUS,
  ACCESS_EFFECT_LABEL, ACCESS_EFFECT_ORDER, ACCESS_EFFECT_STATUS,
  ACCESS_SUBJECT_LABEL, ACCESS_SUBJECT_ORDER,
  ACCESS_EMPTY_TITLE, ACCESS_EMPTY_HINT, ACCESS_DESCENDANTS_HINT,
  ACCESS_PRESET_LABEL, ACCESS_PRESET_ORDER, ACCESS_PRESET_NONE,
  ACTION, failedTo, progress,
  accessGrantCount, accessOrphanLine, accessPeopleCount, accessSurfaceCount, accessSyncedLine,
} from '@/lib/terms'
import type { AccessAdminData, GrantRow, OrgOption, SurfaceRow } from './actions'
import { PRESET_DENIES, actionKey, type AccessPreset } from '@/lib/access/actions'

type SubjectKind = 'user' | 'org'
type Effect = 'allow' | 'deny'

interface Draft {
  kind: SubjectKind
  subjectId: string
  effect: Effect
  includeDescendants: boolean
  /** 부여를 걸 자리. 빈 값이면 표면 전체다 */
  zoneKey: string
  /** 어디까지 할 수 있나. 빈 값이면 동작을 안 가린다 */
  preset: '' | AccessPreset
}

/** 조직이 기본이다 — 사람 한 명씩 여는 것은 예외이고, 예외를 기본으로 두면 부여가 금세 낡는다 */
const EMPTY_DRAFT: Draft = { kind: 'org', subjectId: '', effect: 'allow', includeDescendants: true, zoneKey: '', preset: '' }

const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap',
}

export default function AccessClient({ surfaces, grants, people, orgs, justSynced, orphans }: AccessAdminData) {
  const router = useRouter()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const orgById = useMemo(() => new Map(orgs.map((o) => [o.id, o])), [orgs])
  const nameOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of people) m.set(p.id, p.name)
    for (const o of orgs) m.set(o.id, o.name)
    return m
  }, [people, orgs])

  const bySurface = useMemo(() => {
    const m = new Map<string, GrantRow[]>()
    for (const g of grants) m.set(g.surface_key, [...(m.get(g.surface_key) ?? []), g])
    return m
  }, [grants])

  /** 표면만 목록에 세우고, 자리는 그 표면을 펼쳤을 때 안에서 다룬다 */
  const tops = useMemo(() => surfaces.filter((s) => s.kind === 'surface'), [surfaces])
  const zonesOf = useMemo(() => {
    const m = new Map<string, SurfaceRow[]>()
    // 동작 줄은 안 그린다 — 프리셋이 대신 고르게 하고, 줄로 세우면 표면 하나가 열 줄이 된다
    for (const s of surfaces) {
      if (s.kind !== 'zone' || s.parent_key === null) continue
      m.set(s.parent_key, [...(m.get(s.parent_key) ?? []), s])
    }
    return m
  }, [surfaces])
  const labelOfKey = useMemo(() => new Map(surfaces.map((s) => [s.key, s.label])), [surfaces])

  /** 이 부여가 실제로 걸리는 사람 수. 고르기 전에는 0 이고, 0 이면 저장할 것이 없다 */
  const previewCount = ((): number => {
    if (!draft.subjectId) return 0
    if (draft.kind === 'user') return 1
    const org: OrgOption | undefined = orgById.get(draft.subjectId)
    if (!org) return 0
    return draft.includeDescendants ? org.subtreeCount : org.directCount
  })()

  function toggle(key: string) {
    setOpenKey((prev) => (prev === key ? null : key))
    setDraft(EMPTY_DRAFT)
    setError(null)
  }

  async function send(url: string, init: RequestInit, verb: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, init)
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(body.error ?? failedTo(ACCESS.grant, verb))
        return false
      }
      router.refresh()
      return true
    } catch {
      setError(failedTo(ACCESS.grant, verb))
      return false
    } finally {
      setBusy(false)
    }
  }

  /**
   * 프리셋은 **차단의 묶음**이다(`lib/access/actions.ts` 의 `PRESET_DENIES`).
   *
   * 「보기만」을 고르면 바탕 부여 한 줄 뒤에 쓰기·내보내기 차단 두 줄이 더 간다.
   * 창구는 한 번에 한 줄만 받는다 — 묶음을 창구가 알게 하면 창구와 화면 둘 다
   * 프리셋 표를 갖게 되고, 둘이 갈리는 날이 온다.
   */
  async function save(surfaceKey: string) {
    const denies = draft.preset ? PRESET_DENIES[draft.preset] : []
    const ok = await send(
      '/api/admin/access',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surfaceKey,
          subjectKind: draft.kind,
          subjectId: draft.subjectId,
          effect: draft.effect,
          // 사람 부여에는 뜻이 없는 값이라 조직일 때만 화면의 선택을 보낸다
          includeDescendants: draft.kind === 'org' ? draft.includeDescendants : true,
        }),
      },
      '저장하지',
    )
    if (!ok) return
    for (const action of denies) {
      const done = await send(
        '/api/admin/access',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            surfaceKey: actionKey(surfaceKey, action),
            subjectKind: draft.kind,
            subjectId: draft.subjectId,
            effect: 'deny',
            includeDescendants: draft.kind === 'org' ? draft.includeDescendants : true,
          }),
        },
        '저장하지',
      )
      if (!done) return
    }
    setDraft(EMPTY_DRAFT)
  }

  async function remove(id: string) {
    await send(`/api/admin/access?id=${encodeURIComponent(id)}`, { method: 'DELETE' }, '삭제하지')
  }

  return (
    <div>
      {/* 등재 상태 — 사본이 코드를 못 따라간 자리를 화면이 먼저 말한다 */}
      <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
        <div style={{ ...ROW, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text)' }}>{accessSurfaceCount(surfaces.length)}</strong>
          <span>{accessSyncedLine(justSynced)}</span>
          {orphans.length > 0 && <span style={{ color: 'var(--danger)' }}>{accessOrphanLine(orphans)}</span>}
        </div>
      </div>

      <div className="card">
        {tops.map((s) => {
          const zones = zonesOf.get(s.key) ?? []
          // 자리에 걸린 부여도 이 표면 줄에서 함께 본다 — 따로 두면 어느 표면의 자리인지 못 읽는다
          const under = [s.key, ...zones.map((z) => z.key)]
          const mine = [...under, ...under.flatMap((k) => [actionKey(k, 'write'), actionKey(k, 'export')])]
            .flatMap((k) => bySurface.get(k) ?? [])
          const audience = s.default_audience === 'admin' ? 'admin' : 'all'
          const open = openKey === s.key

          return (
            <details
              key={s.key}
              open={open}
              style={{ borderTop: 'var(--hairline) solid var(--border-color)' }}
            >
              <summary
                onClick={(e) => { e.preventDefault(); toggle(s.key) }}
                style={{ ...ROW, cursor: 'pointer', padding: 'var(--space-3) 0', listStyle: 'none' }}
              >
                {open ? <ChevronDown size={14} color="var(--text-muted)" /> : <ChevronRight size={14} color="var(--text-muted)" />}
                <span style={{ fontWeight: 700, color: 'var(--text)' }}>{s.label}</span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{s.href}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
                  <NbBadge status={ACCESS_AUDIENCE_STATUS[audience]} title={ACCESS.defaultAudience}>
                    {ACCESS_AUDIENCE_LABEL[audience]}
                  </NbBadge>
                  {mine.length > 0 && <NbBadge>{accessGrantCount(mine.length)}</NbBadge>}
                </span>
              </summary>

              {/* 닫혀 있으면 본문을 그리지 않는다 — <details> 는 닫아도 자식을 문서에 둔다 */}
              {open && (
                <div style={{ padding: '0 0 var(--space-4)' }}>
                  {mine.length === 0 ? (
                    <EmptyState title={ACCESS_EMPTY_TITLE} description={ACCESS_EMPTY_HINT} />
                  ) : (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {mine.map((g) => (
                        <li key={g.id} style={{ ...ROW, padding: 'var(--space-2) 0' }}>
                          <NbBadge status={ACCESS_EFFECT_STATUS[g.effect]}>
                            {ACCESS_EFFECT_LABEL[g.effect]}
                          </NbBadge>
                          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                            {ACCESS_SUBJECT_LABEL[g.subject_kind]}
                          </span>
                          <span style={{ color: 'var(--text)' }}>{nameOf.get(g.subject_id) ?? g.subject_id}</span>
                          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)' }}>
                            {g.surface_key === s.key ? ACCESS.wholeSurface : labelOfKey.get(g.surface_key) ?? g.surface_key}
                          </span>
                          {g.subject_kind === 'org' && g.include_descendants && (
                            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
                              {ACCESS.includeDescendants}
                            </span>
                          )}
                          <span style={{ marginLeft: 'auto' }}>
                            <NbButton variant="danger-ghost" disabled={busy} onClick={() => remove(g.id)}>
                              <Trash2 size={14} />
                              {ACTION.delete}
                            </NbButton>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* 새 부여 — 카드 단위 저장(§2-5 (4)). 표면마다 따로 저장한다 */}
                  <div style={{ ...ROW, alignItems: 'flex-end', marginTop: 'var(--space-3)' }}>
                    {zones.length > 0 && (
                      <div>
                        <label className="label" htmlFor={`zone-${s.key}`}>{ACCESS.zone}</label>
                        <select
                          id={`zone-${s.key}`}
                          className="input-field"
                          value={draft.zoneKey}
                          onChange={(e) => setDraft({ ...draft, zoneKey: e.target.value })}
                        >
                          <option value="">{ACCESS.wholeSurface}</option>
                          {zones.map((z) => <option key={z.key} value={z.key}>{z.label}</option>)}
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="label" htmlFor={`kind-${s.key}`}>{ACCESS.subject}</label>
                      <select
                        id={`kind-${s.key}`}
                        className="input-field"
                        value={draft.kind}
                        onChange={(e) => setDraft({ ...EMPTY_DRAFT, zoneKey: draft.zoneKey, kind: e.target.value as SubjectKind })}
                      >
                        {ACCESS_SUBJECT_ORDER.map((k) => (
                          <option key={k} value={k}>{ACCESS_SUBJECT_LABEL[k]}</option>
                        ))}
                      </select>
                    </div>

                    <div style={{ minWidth: '14rem' }}>
                      <label className="label" htmlFor={`who-${s.key}`}>
                        {ACCESS_SUBJECT_LABEL[draft.kind]}
                      </label>
                      <select
                        id={`who-${s.key}`}
                        className="input-field"
                        value={draft.subjectId}
                        onChange={(e) => setDraft({ ...draft, subjectId: e.target.value })}
                      >
                        <option value="" />
                        {draft.kind === 'user'
                          ? people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)
                          : orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="label" htmlFor={`preset-${s.key}`}>{ACCESS.canDo}</label>
                      <select
                        id={`preset-${s.key}`}
                        className="input-field"
                        value={draft.preset}
                        onChange={(e) => setDraft({ ...draft, preset: e.target.value as '' | AccessPreset })}
                      >
                        <option value="">{ACCESS_PRESET_NONE}</option>
                        {ACCESS_PRESET_ORDER.map((p) => (
                          <option key={p} value={p}>{ACCESS_PRESET_LABEL[p]}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="label" htmlFor={`effect-${s.key}`}>{ACCESS.effect}</label>
                      <select
                        id={`effect-${s.key}`}
                        className="input-field"
                        value={draft.effect}
                        onChange={(e) => setDraft({ ...draft, effect: e.target.value as Effect })}
                      >
                        {ACCESS_EFFECT_ORDER.map((v) => (
                          <option key={v} value={v}>{ACCESS_EFFECT_LABEL[v]}</option>
                        ))}
                      </select>
                    </div>

                    {draft.kind === 'org' && (
                      <label className="label" title={ACCESS_DESCENDANTS_HINT} style={{ ...ROW, gap: 'var(--space-1)' }}>
                        <input
                          type="checkbox"
                          checked={draft.includeDescendants}
                          onChange={(e) => setDraft({ ...draft, includeDescendants: e.target.checked })}
                        />
                        {ACCESS.includeDescendants}
                      </label>
                    )}

                    {/* 저장하기 전에 몇 명인지 말한다 — 열어 놓고 확인을 미루지 않게 */}
                    {draft.subjectId !== '' && (
                      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                        {accessPeopleCount(previewCount)}
                      </span>
                    )}

                    <NbButton
                      disabled={busy || !draft.subjectId}
                      onClick={() => save(draft.zoneKey || s.key)}
                    >
                      {busy ? progress(ACTION.save) : ACTION.save}
                    </NbButton>
                  </div>

                  {error && (
                    <p role="alert" style={{ marginTop: 'var(--space-2)', color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
                      {error}
                    </p>
                  )}
                </div>
              )}
            </details>
          )
        })}
      </div>
    </div>
  )
}
