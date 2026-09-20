'use client'

// app/(ci)/ci/settings/SettingsView.tsx — 설정
//
// 설계 결정
//  1) 탭으로 나눈다. 22개를 한 줄로 세우면 아래로 계속 스크롤해야 하고 뭘 봤는지 잊는다.
//  2) 입력 위젯은 레지스트리가 정한다(control). 화면이 판정하면 새 설정이 텍스트로 떨어진다.
//     — 목록은 칩으로, 시각은 시각 입력으로, 선택지는 셀렉트로. JSON을 손으로 쓰게 하지 않는다.
//  3) 레지스트리로 표현되지 않는 것(계정·연동·멤버)은 '개요' 탭에서 따로 보여준다.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, X, ExternalLink, Plus } from 'lucide-react'
import type { ApiResponse } from '@/lib/ci/contracts'
import type { CiControl } from '@/lib/ci/settings/registry'
import ErrorState from '@/components/ui/ErrorState'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import { isEnterKey } from '@/lib/ui/ime'
import SettingsCard from '@/components/ui/settings/SettingsCard'
import SettingsRow from '@/components/ui/settings/SettingsRow'
import SettingsToggle from '@/components/ui/settings/SettingsToggle'
import StatusPill from '@/components/ui/settings/StatusPill'
import FieldNote from '@/components/ui/settings/FieldNote'
import SettingsPanel, { SettingsList } from '@/components/ui/settings/SettingsPanel'
import { CONNECTION } from '@/lib/terms'

interface SettingItem {
  key: string
  scope: 'system' | 'workspace' | 'user'
  group: string
  label: string
  help: string
  value: unknown
  defaultValue: unknown
  origin: string
  isSecret: boolean
  destructive: boolean
  version: number
  control: CiControl
}

interface Overview {
  account: { name: string | null; email: string | null; appRole: string | null; workspaceRole: string }
  workspace: { name: string; createdAt: string | null; memberCount: number }
  members: { userId: string; role: string; name: string | null; email: string | null }[]
  integrations: { id: string; label: string; connected: boolean; detail: string; settingsHref: string }[]
}

const GROUP_LABEL: Record<string, string> = {
  overview: '개요',
  account: '내 계정',
  workspace: '워크스페이스',
  alert: '알림',
  data: '데이터와 수집',
  topic: '주제',
  analysis: '분석 기준',
  ai: 'AI',
  publish: '게시 기본값',
  system: '운영자',
}

const GROUP_ORDER = [
  'overview', 'account', 'workspace', 'alert', 'data',
  'topic', 'analysis', 'ai', 'publish', 'system',
]

const ORIGIN_LABEL: Record<string, string> = {
  user: '내 설정', workspace: '워크스페이스 설정', system: '시스템 설정', default: '기본값',
}

const ROLE_LABEL: Record<string, string> = {
  owner: '소유자', admin: '관리자', editor: '편집자', viewer: '보기 전용',
}

export default function SettingsView({ workspaceId }: { workspaceId: string }) {
  const [items, setItems] = useState<SettingItem[] | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [tab, setTab] = useState('overview')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [s, o] = await Promise.all([
        fetch('/api/ci/settings', { headers: { 'X-CI-Workspace': workspaceId } })
          .then((r) => r.json() as Promise<ApiResponse<{ items: SettingItem[] }>>),
        fetch('/api/ci/settings/overview', { headers: { 'X-CI-Workspace': workspaceId } })
          .then((r) => r.json() as Promise<ApiResponse<Overview>>),
      ])
      if (!s.success) { setError({ code: s.error.code, message: s.error.message }); return }
      setItems(s.data.items)
      if (o.success) setOverview(o.data)
    } catch {
      setError({ code: 'INTERNAL', message: '설정을 불러오지 못했습니다' })
    }
  }, [workspaceId])

  useEffect(() => { void load() }, [load])

  async function save(item: SettingItem, value: unknown) {
    setSavingKey(item.key); setError(null)
    try {
      const res = await fetch('/api/ci/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        // ⚠️ scope는 **필수**다. 안 보내면 서버가 전부 422로 막아
        //    설정이 하나도 저장되지 않는다(실브라우저 확인 v0.7.507에서 발견).
        //    저장 후 되읽기(load)까지 하므로 화면은 조용히 실패하지 않지만,
        //    이 필드가 빠지면 "저장을 눌렀는데 아무 일도 안 나는" 상태가 된다.
        body: JSON.stringify({ key: item.key, scope: item.scope, value, version: item.version }),
      }).then((r) => r.json() as Promise<ApiResponse<unknown>>)

      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setToast(`${item.label} 저장했습니다`)
      setTimeout(() => setToast(null), 2000)
      await load()
    } finally { setSavingKey(null) }
  }

  /**
   * 이 설정만 기본값으로 되돌린다.
   * 저장한 값을 지우면 상위 기본값이 다시 적용된다 — 되돌릴 수 있는 일이라 확인창을 두지 않는다.
   * (시스템 설정은 서버가 거부한다)
   */
  async function revert(item: SettingItem) {
    setSavingKey(item.key); setError(null)
    try {
      const res = await fetch(
        `/api/ci/settings?key=${encodeURIComponent(item.key)}&scope=${item.scope}`,
        { method: 'DELETE', headers: { 'X-CI-Workspace': workspaceId } },
      ).then((r) => r.json() as Promise<ApiResponse<unknown>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setToast(`${item.label} 기본값으로 되돌렸습니다`)
      setTimeout(() => setToast(null), 2000)
      await load()
    } finally { setSavingKey(null) }
  }

  /** 검색 중에는 탭을 무시하고 전체에서 찾는다 — 어느 탭에 있는지 모를 때가 검색을 쓰는 때다. */
  const visible = useMemo(() => {
    if (!items) return []
    const q = query.trim().toLowerCase()
    if (q) {
      return items.filter((i) =>
        i.label.toLowerCase().includes(q) || i.help.toLowerCase().includes(q) || i.key.includes(q))
    }
    return items.filter((i) => i.group === tab)
  }, [items, query, tab])

  const groupsWithItems = useMemo(() => {
    const present = new Set(items?.map((i) => i.group) ?? [])
    return GROUP_ORDER.filter((g) => g === 'overview' || present.has(g))
  }, [items])

  if (error && !items) return <ErrorState code={error.code} message={error.message} helpHref="/ci/settings" />
  if (!items) return <SkelList rows={5} />

  /** 분류와 무관한 것 — 저장 알림과 오류는 탭을 바꿔도 그대로 보여야 한다 */
  const notice = (
    <>
      {toast && <p role="status"><StatusPill tone="ok">{toast}</StatusPill></p>}
      {error && <ErrorState code={error.code} message={error.message} helpHref="/ci/settings" />}
    </>
  )

  // 개요는 레지스트리 항목이 아니라 검색 대상이 아니다 — 검색 중에는 결과 쪽을 그린다
  const showOverview = !query.trim() && tab === 'overview'

  return (
    <SettingsPanel
      groups={groupsWithItems.map((g) => ({ id: g, label: GROUP_LABEL[g] ?? g }))}
      activeId={tab}
      onSelect={setTab}
      query={query}
      onQueryChange={setQuery}
      isEmpty={!showOverview && visible.length === 0}
      notice={notice}
    >
      {showOverview ? (
        <OverviewPanel overview={overview} />
      ) : (
        <SettingsList>
          {visible.map((item) => (
            <SettingRow key={item.key} item={item} saving={savingKey === item.key}
              onSave={(v) => void save(item, v)}
              onRevert={item.scope === 'system' ? undefined : () => void revert(item)} />
          ))}
        </SettingsList>
      )}
    </SettingsPanel>
  )
}

/** 개요 — 계정·연동·멤버. 레지스트리로 표현되지 않지만 사용자가 가장 먼저 찾는 것들. */
function OverviewPanel({ overview }: { overview: Overview | null }) {
  if (!overview) return <SkelList rows={3} />

  return (
    <>
      <SettingsCard title="내 계정" headingLevel={2}>
        <dl className="ci-creative-grid">
          <div className="ci-creative-row">
            <dt className="field-note">이름</dt><dd>{overview.account.name ?? '—'}</dd>
          </div>
          <div className="ci-creative-row">
            <dt className="field-note">이메일</dt><dd>{overview.account.email ?? '—'}</dd>
          </div>
          <div className="ci-creative-row">
            <dt className="field-note">이 워크스페이스</dt>
            <dd>{ROLE_LABEL[overview.account.workspaceRole] ?? overview.account.workspaceRole}</dd>
          </div>
          <div className="ci-creative-row">
            <dt className="field-note">사내 권한</dt><dd>{overview.account.appRole ?? '—'}</dd>
          </div>
        </dl>
        <FieldNote>이름·비밀번호는 사내 업무 화면의 내 정보에서 바꿉니다.</FieldNote>
      </SettingsCard>

      <SettingsCard
        title="연동"
        headingLevel={2}
        description="키는 회사 계정 한 곳에서만 관리합니다. 여기서는 상태만 보여드립니다."
      >
        <SettingsList as="ul">
          {overview.integrations.map((it) => (
            <SettingsRow
              key={it.id}
              as="li"
              lead={
                <StatusPill tone={it.connected ? 'ok' : 'warn'}>
                  {it.connected ? <Check size={12} /> : <X size={12} />}
                  {it.connected ? CONNECTION.connected : CONNECTION.notConnected}
                </StatusPill>
              }
              action={<Link href={it.settingsHref} className="btn-ghost">설정 <ExternalLink size={12} /></Link>}
            >
              <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{it.label}</p>
              <FieldNote>{it.detail}</FieldNote>
            </SettingsRow>
          ))}
        </SettingsList>
      </SettingsCard>

      <SettingsCard
        title={`워크스페이스 · ${overview.workspace.name}`}
        headingLevel={2}
        description={`멤버 ${overview.workspace.memberCount}명`}
      >
        <SettingsList as="ul">
          {overview.members.map((m) => (
            <SettingsRow
              key={m.userId}
              as="li"
              lead={<StatusPill tone="neutral">{ROLE_LABEL[m.role] ?? m.role}</StatusPill>}
            >
              <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{m.name ?? '이름 없음'}</p>
              <FieldNote>{m.email ?? '—'}</FieldNote>
            </SettingsRow>
          ))}
        </SettingsList>
      </SettingsCard>
    </>
  )
}

/** 설정 한 줄 — 컨트롤은 레지스트리가 정한 대로 그린다. */
function SettingRow({ item, saving, onSave, onRevert }: {
  item: SettingItem; saving: boolean; onSave: (v: unknown) => void
  /** 기본값으로 되돌리기. 시스템 설정처럼 되돌릴 수 없는 것은 넘기지 않는다 */
  onRevert?: () => void
}) {
  return (
    <SettingsCard
      title={item.label}
      description={item.help}
      headerAction={
        <span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <FieldNote>{ORIGIN_LABEL[item.origin] ?? item.origin}</FieldNote>
          {onRevert && (
            <button type="button" className="btn-ghost" onClick={onRevert} disabled={saving}
              title="저장한 값을 지워 기본값으로 되돌립니다">기본값으로</button>
          )}
        </span>
      }
    >
      <Control item={item} disabled={saving} onCommit={onSave} />
    </SettingsCard>
  )
}

function Control({ item, disabled, onCommit }: {
  item: SettingItem; disabled: boolean; onCommit: (v: unknown) => void
}) {
  const c = item.control
  const id = `set-${item.key}`

  if (c.type === 'toggle') {
    const on = Boolean(item.value)
    return (
      <SettingsToggle
        on={on}
        disabled={disabled}
        ariaLabel={item.label}
        label={on ? '켬' : '끔'}
        onToggle={(next) => onCommit(next)}
      />
    )
  }

  if (c.type === 'select') {
    return (
      <select className="input-field" id={id} style={{ width: 'auto' }} disabled={disabled}
        value={String(item.value ?? '')} onChange={(e) => onCommit(e.target.value)}>
        {c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }

  if (c.type === 'number') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {/* ⚠️ `key`가 없으면 값이 바뀌어도 화면이 안 바뀐다.
            `defaultValue`는 **처음 한 번만** 읽히는 비제어 입력이라,
            "기본값으로"를 눌러 서버가 24로 되돌려도 칸에는 12가 그대로 남는다
            (실브라우저 확인 v0.7.507에서 발견 — DB는 지워졌는데 화면만 거짓말을 했다).
            값이 바뀌면 리마운트해 새 값을 다시 읽게 한다. */}
        <input className="input-field" id={id} type="number" style={{ width: '160px' }}
          key={`${id}-${String(item.value)}`}
          defaultValue={Number(item.value ?? 0)} disabled={disabled}
          min={c.min} max={c.max} step={c.step ?? 1}
          onBlur={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n) && n !== Number(item.value)) onCommit(n)
          }} />
        {c.unit && <span className="field-note">{c.unit}</span>}
      </span>
    )
  }

  if (c.type === 'time') {
    return (
      <input className="input-field" id={id} type="time" style={{ width: '160px' }}
        key={`${id}-${String(item.value)}`}
        defaultValue={String(item.value ?? '')} disabled={disabled}
        onChange={(e) => { if (e.target.value) onCommit(e.target.value) }} />
    )
  }

  if (c.type === 'chips') {
    return <ChipsControl id={id} value={Array.isArray(item.value) ? item.value.map(String) : []}
      placeholder={c.placeholder} disabled={disabled} onCommit={onCommit} />
  }

  if (c.type === 'quiet_hours') {
    const v = (item.value ?? {}) as { enabled?: boolean; start?: string; end?: string }
    return (
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <SettingsToggle
          on={Boolean(v.enabled)}
          disabled={disabled}
          ariaLabel="방해 금지 사용"
          label={v.enabled ? '사용' : '사용 안 함'}
          onToggle={(next) => onCommit({ ...v, enabled: next })}
        />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <label className="label" htmlFor={`${id}-s`} style={{ margin: 0 }}>시작</label>
          <input className="input-field" id={`${id}-s`} type="time" style={{ width: '130px' }}
            key={`${id}-${String(v.start ?? '22:00')}`}
            defaultValue={v.start ?? '22:00'} disabled={disabled}
            onChange={(e) => onCommit({ ...v, start: e.target.value })} />
          <label className="label" htmlFor={`${id}-e`} style={{ margin: 0 }}>끝</label>
          <input className="input-field" id={`${id}-e`} type="time" style={{ width: '130px' }}
            key={`${id}-${String(v.end ?? '08:00')}`}
            defaultValue={v.end ?? '08:00'} disabled={disabled}
            onChange={(e) => onCommit({ ...v, end: e.target.value })} />
        </span>
      </div>
    )
  }

  if (c.type === 'text' && c.multiline) {
    return (
      <textarea className="input-field" id={id} rows={3} placeholder={c.placeholder}
        key={`${id}-${String(String(item.value ?? ''))}`}
        defaultValue={String(item.value ?? '')} disabled={disabled}
        onBlur={(e) => { if (e.target.value !== item.value) onCommit(e.target.value) }} />
    )
  }

  if (c.type === 'json') {
    return (
      <>
        <textarea className="input-field" id={id} rows={5}
          key={`${id}-${String(JSON.stringify(item.value, null, 2))}`}
          defaultValue={JSON.stringify(item.value, null, 2)} disabled={disabled}
          onBlur={(e) => {
            try { onCommit(JSON.parse(e.target.value)) }
            catch { /* 형식이 깨지면 저장하지 않는다 — 아래 안내가 이유를 말한다 */ }
          }} />
        <p className="field-note">JSON 형식입니다. 형식이 맞지 않으면 저장되지 않습니다.</p>
      </>
    )
  }

  return (
    <input className="input-field" id={id} type="text" placeholder={c.type === 'text' ? c.placeholder : undefined}
      key={`${id}-${String(String(item.value ?? ''))}`}
      defaultValue={String(item.value ?? '')} disabled={disabled}
      onBlur={(e) => { if (e.target.value !== item.value) onCommit(e.target.value) }} />
  )
}

/** 목록 입력 — JSON을 손으로 쓰게 하지 않는다. */
function ChipsControl({ id, value, placeholder, disabled, onCommit }: {
  id: string; value: string[]; placeholder?: string; disabled: boolean; onCommit: (v: unknown) => void
}) {
  const [draft, setDraft] = useState('')

  function add(raw: string) {
    const v = raw.trim()
    if (!v || value.includes(v)) { setDraft(''); return }
    onCommit([...value, v])
    setDraft('')
  }

  return (
    <div>
      <div className="ci-card-badges" style={{ marginBottom: 'var(--space-2)' }}>
        {value.length === 0 && <span className="field-note">비어 있습니다</span>}
        {value.map((v) => (
          <span key={v} className="status-pill status-pill-neutral">
            {v}
            <button type="button" aria-label={`${v} 제거`} disabled={disabled}
              style={{ all: 'unset', cursor: 'pointer', marginLeft: '4px' }}
              onClick={() => onCommit(value.filter((x) => x !== v))}>
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
        <input className="input-field" id={id} type="text" value={draft} placeholder={placeholder}
          disabled={disabled} style={{ width: '220px' }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (isEnterKey(e)) { e.preventDefault(); add((e.target as HTMLInputElement).value) }
          }} />
        <button type="button" className="btn-ghost" disabled={disabled || !draft.trim()}
          onClick={() => add(draft)}>
          <Plus size={14} /> 추가
        </button>
      </span>
    </div>
  )
}
