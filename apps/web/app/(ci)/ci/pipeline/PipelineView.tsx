'use client'

// app/(ci)/ci/pipeline/PipelineView.tsx — P01 파이프라인 보드
// 4열 칸반. 드래그 = 상태 전이(설계서 §7.5). 뒤로 이동도 허용한다.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ApiResponse, CiIdeaCard } from '@/lib/ci/contracts'
import { CI_PIPELINE_STAGES, CI_STAGE_LABEL, type CiPipelineStage } from '@/lib/ci/types'
import { EmptyState, ErrorState } from '@/components/ci/states'
import { isEnterKey } from '@/lib/ui/ime'

const COLUMN_HINT: Record<CiPipelineStage, string> = {
  idea: '보드나 트렌드에서 가져오기',
  brief: '기획안 작성 중',
  edit: '편집안, 내보내기',
  ready: '게시로 보내기',
}

interface Props {
  workspaceId: string
  ideas: CiIdeaCard[]
  seed: { contentId: string; title: string } | null
}

export default function PipelineView({ workspaceId, ideas, seed }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)

  // 트렌드에서 넘어왔으면 제목을 미리 채워 흐름이 끊기지 않게 한다
  useEffect(() => { if (seed?.title) setTitle(seed.title) }, [seed])

  async function create() {
    if (!title.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/ci/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({
          title: title.trim(),
          evidence: seed ? [{ sourceType: 'content', sourceId: seed.contentId }] : [],
        }),
      }).then((r) => r.json() as Promise<ApiResponse<{ id: string }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setTitle('')
      router.replace('/ci/pipeline')
      router.refresh()
    } catch {
      setError({ code: 'INTERNAL', message: '아이디어를 만들지 못했습니다' })
    } finally {
      setBusy(false)
    }
  }

  /** 기획안 만들기 — 이미 있으면 그 편집기로, 없으면 AI 초안을 만들어 연다. */
  async function makeBrief(ideaId: string) {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/ci/briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ ideaId, useAi: true }),
      }).then((r) => r.json() as Promise<ApiResponse<{ id: string; aiNote: string | null }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      router.push(`/ci/briefs/${res.data.id}`)
    } finally { setBusy(false) }
  }

  async function move(id: string, stage: CiPipelineStage) {
    await fetch(`/api/ci/ideas/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
      body: JSON.stringify({ stage }),
    })
    router.refresh()
  }

  const byStage = (s: CiPipelineStage) => ideas.filter((i) => i.stage === s)

  return (
    <>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <label className="label" htmlFor="ci-idea-title" style={{ position: 'absolute', left: '-9999px' }}>
          아이디어 제목
        </label>
        <input className="input-field" id="ci-idea-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (isEnterKey(e)) { e.preventDefault(); create() } }}
          placeholder={seed ? '이 콘텐츠를 근거로 만들 아이디어 제목' : '새 아이디어 제목'}
          disabled={busy}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn-primary" onClick={create} disabled={busy || !title.trim()}>
          {busy ? '만드는 중…' : '아이디어 추가'}
        </button>
      </div>

      {seed && (
        <p className="ci-status ci-status-info" style={{ marginBottom: 'var(--space-4)', display: 'inline-flex' }}>
          근거를 이어받았습니다 — 만들면 어디서 왔는지 카드에 남습니다
        </p>
      )}

      {error && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <ErrorState code={error.code} message={error.message} />
        </div>
      )}

      {ideas.length === 0 ? (
        <EmptyState
          title="아직 제작 중인 아이디어가 없습니다"
          description="트렌드의 떡상에서 '아이디어 만들기'를 누르면 근거와 함께 여기에 쌓입니다."
          action={{ label: '트렌드로 이동', href: '/ci/trends?tab=outliers' }}
        />
      ) : (
        <div className="ci-board">
          {CI_PIPELINE_STAGES.map((stage) => {
            const cards = byStage(stage)
            return (
              <section
                key={stage}
                className="ci-board-col"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragId) { move(dragId, stage); setDragId(null) }
                }}
                aria-label={`${CI_STAGE_LABEL[stage]} 열`}
              >
                <header className="ci-board-col-head">
                  <span>{CI_STAGE_LABEL[stage]}</span>
                  <span className="ci-count">{cards.length}</span>
                </header>
                <p className="ci-basis">{COLUMN_HINT[stage]}</p>

                {cards.map((card) => (
                  <article
                    key={card.id}
                    draggable
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => setDragId(null)}
                    style={{
                      background: 'var(--color-surface)',
                      border: 'var(--border-w-2) solid var(--border-color)',
                      borderRadius: 'var(--radius)',
                      padding: 'var(--space-3)',
                      cursor: 'grab',
                      display: 'flex', flexDirection: 'column', gap: 'var(--space-1)',
                    }}
                  >
                    <strong style={{ fontSize: 'var(--fs-sm)' }}>{card.title}</strong>
                    {card.evidenceBadge && (
                      <span className="ci-status ci-status-info" style={{ alignSelf: 'flex-start' }}>
                        근거: {card.evidenceBadge}
                      </span>
                    )}
                    <span className="ci-basis">{card.daysInStage}일째</span>

                    <div style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-1)', flexWrap: 'wrap' }}>
                      <button type="button" className="ci-metric ci-metric-strong"
                        onClick={() => makeBrief(card.id)} disabled={busy}>
                        기획안
                      </button>
                      {CI_PIPELINE_STAGES.filter((s) => s !== stage).map((s) => (
                        <button
                          key={s}
                          type="button"
                          className="ci-metric"
                          onClick={() => move(card.id, s)}
                          title={`${CI_STAGE_LABEL[s]}(으)로 이동`}
                        >
                          {CI_STAGE_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </section>
            )
          })}
        </div>
      )}

      <p className="ci-basis" style={{ marginTop: 'var(--space-4)' }}>
        카드를 끌어다 놓거나 카드 안의 버튼으로 단계를 옮길 수 있습니다. 뒤로 되돌리는 것도 됩니다.
      </p>
    </>
  )
}
