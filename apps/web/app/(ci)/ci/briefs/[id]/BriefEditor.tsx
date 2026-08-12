'use client'

// app/(ci)/ci/briefs/[id]/BriefEditor.tsx — P02 기획안 편집기 + P03 편집안
// AI 결과는 미리보기 → 사용자 확인 → 저장. 자동 확정 저장 금지(CLAUDE.md §5-3 생성형 패턴).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ApiResponse } from '@/lib/ci/contracts'
import type { BriefDraft } from '@/lib/ci/ai/brief'
import ErrorState from '@/components/ui/ErrorState'
import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import { useListQuery } from '@/lib/ui/use-list-query'
import type { ListDefaults } from '@/lib/ui/list-query'

type Field = keyof BriefDraft

const FIELD_LABEL: Record<Field, string> = {
  titleOptions: '제목 시안',
  hook: '첫 3초 훅',
  script: '대본 개요',
  caption: '캡션',
  tags: '해시태그',
  thumbnailIdeas: '썸네일 시안',
}

interface BriefState extends BriefDraft {
  id: string
  ideaId: string
  version: number
  status: 'draft' | 'ready'
}

interface EditPlan {
  id: string
  label: string
  timecodes: { start: string; end?: string; note: string }[]
  exportStatus: string
}

// 편집안은 한 기획안에 몇 건뿐이라 검색·페이지가 필요 없다.
// 표만 표준 부품으로 그린다 — 빈 상태를 화면이 다시 만들지 않게.
const PLAN_DEFAULTS: ListDefaults = { sort: { key: 'label', dir: 'asc' }, view: 'table', size: 100 }

export default function BriefEditor({
  workspaceId, brief, versions, editPlans,
}: {
  workspaceId: string
  brief: BriefState
  versions: { id: string; version: number }[]
  editPlans: EditPlan[]
}) {
  const router = useRouter()
  // 편집안 표도 목록 부품을 쓴다 — 정렬·검색이 없으니 보기 값만 읽는다
  const { query: planQuery } = useListQuery(PLAN_DEFAULTS)
  const [state, setState] = useState<BriefState>(brief)
  const [preview, setPreview] = useState<{ draft: BriefDraft; fields: Field[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // 편집안 입력
  const [planLabel, setPlanLabel] = useState('')
  const [tcStart, setTcStart] = useState('')
  const [tcNote, setTcNote] = useState('')
  const [tcList, setTcList] = useState<{ start: string; note: string }[]>([])

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  async function save(patch: Partial<BriefDraft> & { status?: 'draft' | 'ready' }) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/ci/briefs/${state.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify(patch),
      }).then((r) => r.json() as Promise<ApiResponse<{ status: 'draft' | 'ready' }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      flash('저장했습니다')
      router.refresh()
    } finally { setBusy(false) }
  }

  async function regenerate(fields: Field[]) {
    setBusy(true); setError(null); setPreview(null)
    try {
      const res = await fetch(`/api/ci/briefs/${state.id}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ fields }),
      }).then((r) => r.json() as Promise<ApiResponse<{ preview: BriefDraft; fields: Field[] }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setPreview({ draft: res.data.preview, fields: res.data.fields })
    } finally { setBusy(false) }
  }

  function applyPreview() {
    if (!preview) return
    const patch: Partial<BriefDraft> = {}
    for (const f of preview.fields) {
      // 타입별로 안전하게 옮긴다
      if (f === 'titleOptions' || f === 'tags' || f === 'thumbnailIdeas') patch[f] = preview.draft[f]
      else patch[f] = preview.draft[f]
    }
    setState((s) => ({ ...s, ...patch }))
    save(patch)
    setPreview(null)
  }

  async function createPlan() {
    if (tcList.length === 0) { setError({ code: 'VALIDATION_FAILED', message: '타임코드를 하나 이상 넣어 주세요' }); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/ci/edit-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({
          briefId: state.id,
          variantLabel: planLabel.trim() || undefined,
          timecodes: tcList,
        }),
      }).then((r) => r.json() as Promise<ApiResponse<{ id: string }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setPlanLabel(''); setTcList([])
      flash('편집안을 만들었습니다')
      router.refresh()
    } finally { setBusy(false) }
  }

  function exportPlan(plan: EditPlan) {
    const lines = [
      `# ${plan.label}`,
      '',
      ...plan.timecodes.map((t) => `${t.start}${t.end ? `–${t.end}` : ''}  ${t.note}`),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${plan.label}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const ALL_FIELDS: Field[] = ['titleOptions', 'hook', 'script', 'caption', 'tags', 'thumbnailIdeas']

  // 편집안은 몇 건짜리 목록이라 검색·페이지가 필요 없다.
  // 그래도 표는 ListSurface 한 벌로 그린다 — 빈 상태까지 부품이 책임진다.
  const planColumns: ColumnDef<EditPlan>[] = [
    { key: 'label', header: '안', primary: true, cell: (p) => <strong>{p.label}</strong> },
    {
      key: 'timecodes', header: '구간',
      cell: (p) => (
        <>
          {p.timecodes.map((t, i) => (
            <div key={i} className="ci-card-meta">
              <span className="ci-num">{t.start}</span><span>{t.note}</span>
            </div>
          ))}
        </>
      ),
    },
    {
      key: 'actions', header: '작업', align: 'right',
      cell: (p) => (
        <button type="button" className="btn-ghost" onClick={() => exportPlan(p)}>내보내기</button>
      ),
    },
  ]

  return (
    <>
      {toast && <p className="ci-status ci-status-ok" style={{ marginBottom: 'var(--space-3)', display: 'inline-flex' }}>{toast}</p>}
      {error && <div style={{ marginBottom: 'var(--space-4)' }}><ErrorState code={error.code} message={error.message} helpHref="/ci/settings" /></div>}

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        <button type="button" className="btn-primary" onClick={() => regenerate(ALL_FIELDS)} disabled={busy}>
          AI로 전체 다시 만들기
        </button>
        <button type="button" className="btn-ghost"
          onClick={() => save({ status: state.status === 'ready' ? 'draft' : 'ready' })} disabled={busy}>
          {state.status === 'ready' ? '작성 중으로 되돌리기' : '완료로 표시'}
        </button>
        {versions.length > 1 && (
          <span className="ci-basis" style={{ alignSelf: 'center' }}>
            버전 {versions.map((v) => v.version).join(', ')} 중 {state.version} 보는 중
          </span>
        )}
      </div>

      {preview && (
        <section className="card" style={{
          padding: 'var(--space-4)', borderColor: 'var(--brand)', marginBottom: 'var(--space-4)',
        }}>
          <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
            AI 제안 미리보기
          </h2>
          <p className="ci-basis" style={{ marginBottom: 'var(--space-3)' }}>
            확인하고 반영하세요. 반영하기 전에는 저장되지 않습니다.
          </p>
          {preview.fields.map((f) => (
            <div key={f} style={{ marginBottom: 'var(--space-3)' }}>
              <p className="label">{FIELD_LABEL[f]}</p>
              <p style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--fs-sm)' }}>
                {Array.isArray(preview.draft[f])
                  ? (preview.draft[f] as string[]).join(' / ')
                  : String(preview.draft[f] ?? '')}
              </p>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button type="button" className="btn-primary" onClick={applyPreview}>반영하기</button>
            <button type="button" className="btn-ghost" onClick={() => setPreview(null)}>버리기</button>
          </div>
        </section>
      )}

      {/* 제목 시안 */}
      <section style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label className="label" htmlFor="b-titles">{FIELD_LABEL.titleOptions}</label>
          <button type="button" className="ci-metric" onClick={() => regenerate(['titleOptions'])} disabled={busy}>
            이 항목만 다시
          </button>
        </div>
        <textarea className="input-field" id="b-titles" rows={4}
          value={state.titleOptions.join('\n')}
          onChange={(e) => setState((s) => ({ ...s, titleOptions: e.target.value.split('\n') }))}
          onBlur={() => save({ titleOptions: state.titleOptions.filter((t) => t.trim()) })}
          placeholder="한 줄에 하나씩" />
      </section>

      {/* 훅 */}
      <section style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label className="label" htmlFor="b-hook">{FIELD_LABEL.hook}</label>
          <button type="button" className="ci-metric" onClick={() => regenerate(['hook'])} disabled={busy}>
            이 항목만 다시
          </button>
        </div>
        <textarea className="input-field" id="b-hook" rows={2}
          value={state.hook}
          onChange={(e) => setState((s) => ({ ...s, hook: e.target.value }))}
          onBlur={() => save({ hook: state.hook })} />
      </section>

      {/* 대본 */}
      <section style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label className="label" htmlFor="b-script">{FIELD_LABEL.script}</label>
          <button type="button" className="ci-metric" onClick={() => regenerate(['script'])} disabled={busy}>
            이 항목만 다시
          </button>
        </div>
        <textarea className="input-field" id="b-script" rows={10}
          value={state.script}
          onChange={(e) => setState((s) => ({ ...s, script: e.target.value }))}
          onBlur={() => save({ script: state.script })} />
      </section>

      {/* 캡션 */}
      <section style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label className="label" htmlFor="b-caption">{FIELD_LABEL.caption}</label>
          <button type="button" className="ci-metric" onClick={() => regenerate(['caption'])} disabled={busy}>
            이 항목만 다시
          </button>
        </div>
        <textarea className="input-field" id="b-caption" rows={4}
          value={state.caption}
          onChange={(e) => setState((s) => ({ ...s, caption: e.target.value }))}
          onBlur={() => save({ caption: state.caption })} />
        <button type="button" className="ci-metric" style={{ marginTop: 'var(--space-1)' }}
          onClick={() => { navigator.clipboard?.writeText(state.caption); flash('캡션을 복사했습니다') }}>
          캡션 복사
        </button>
      </section>

      {/* 태그 */}
      <section style={{ marginBottom: 'var(--space-6)' }}>
        <label className="label" htmlFor="b-tags">{FIELD_LABEL.tags}</label>
        <input className="input-field" id="b-tags"
          value={state.tags.join(', ')}
          onChange={(e) => setState((s) => ({ ...s, tags: e.target.value.split(',').map((t) => t.trim()) }))}
          onBlur={() => save({ tags: state.tags.filter(Boolean) })}
          placeholder="쉼표로 구분" />
      </section>

      {/* 썸네일 시안 */}
      <section style={{ marginBottom: 'var(--space-8)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label className="label" htmlFor="b-thumbs">{FIELD_LABEL.thumbnailIdeas}</label>
          <button type="button" className="ci-metric" onClick={() => regenerate(['thumbnailIdeas'])} disabled={busy}>
            이 항목만 다시
          </button>
        </div>
        <textarea className="input-field" id="b-thumbs" rows={3}
          value={state.thumbnailIdeas.join('\n')}
          onChange={(e) => setState((s) => ({ ...s, thumbnailIdeas: e.target.value.split('\n') }))}
          onBlur={() => save({ thumbnailIdeas: state.thumbnailIdeas.filter((t) => t.trim()) })}
          placeholder="한 줄에 하나씩" />
      </section>

      {/* 편집안 (P03) */}
      <section>
        <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>편집안</h2>

        <div className="card" style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label className="label" htmlFor="p-label">안 이름</label>
              <input className="input-field" id="p-label" value={planLabel}
                onChange={(e) => setPlanLabel(e.target.value)} placeholder="예: 숏폼용" />
            </div>
            <div>
              <label className="label" htmlFor="p-start">타임코드</label>
              <input className="input-field" id="p-start" value={tcStart}
                onChange={(e) => setTcStart(e.target.value)} placeholder="00:12" />
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label className="label" htmlFor="p-note">설명</label>
              <input className="input-field" id="p-note" value={tcNote}
                onChange={(e) => setTcNote(e.target.value)} placeholder="이 구간에서 할 것" />
            </div>
            <button type="button" className="btn-ghost"
              onClick={() => {
                if (!tcStart.trim() || !tcNote.trim()) return
                setTcList((l) => [...l, { start: tcStart.trim(), note: tcNote.trim() }])
                setTcStart(''); setTcNote('')
              }}>
              구간 추가
            </button>
          </div>

          {tcList.length > 0 && (
            <ul style={{ marginTop: 'var(--space-3)' }}>
              {tcList.map((t, i) => (
                <li key={i} className="ci-card-meta">
                  <span className="ci-num">{t.start}</span><span>{t.note}</span>
                  <button type="button" className="ci-metric"
                    onClick={() => setTcList((l) => l.filter((_, j) => j !== i))}>빼기</button>
                </li>
              ))}
            </ul>
          )}

          <button type="button" className="btn-primary" style={{ marginTop: 'var(--space-3)' }}
            onClick={createPlan} disabled={busy || tcList.length === 0}>
            편집안 만들기
          </button>
        </div>

        <ListSurface
          rows={editPlans}
          columns={planColumns}
          query={planQuery}
          rowKey={(p) => p.id}
          empty={{
            title: '아직 편집안이 없어요',
            description: '위에서 구간을 넣고 만들면 여기에 쌓입니다. 여러 안을 만들어 비교할 수 있습니다.',
          }}
        />
      </section>

      <p style={{ marginTop: 'var(--space-6)' }}>
        <Link href="/ci/publish" className="btn-primary">게시 준비로 보내기</Link>
      </p>
    </>
  )
}
