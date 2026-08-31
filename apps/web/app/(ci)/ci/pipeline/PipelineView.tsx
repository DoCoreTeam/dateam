'use client'

// app/(ci)/ci/pipeline/PipelineView.tsx — P01 파이프라인 보드
// 4열 칸반. 드래그 = 상태 전이(설계서 §7.5). 뒤로 이동도 허용한다.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ApiResponse, CiIdeaCard } from '@/lib/ci/contracts'
import { CI_PIPELINE_STAGES, CI_STAGE_LABEL, type CiPipelineStage } from '@/lib/ci/types'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import FormulaNote from '@/components/ci/FormulaNote'
import { isEnterKey } from '@/lib/ui/ime'
import ConfirmDeleteDialog from '@/components/ui/ConfirmDeleteDialog'
import { useCiDelete } from '@/lib/ci/use-delete'

const COLUMN_HINT: Record<CiPipelineStage, string> = {
  idea: '보드나 트렌드에서 가져오기',
  brief: '기획안 작성 중',
  edit: '편집안, 내보내기',
  ready: '게시로 보내기',
}

interface Props {
  workspaceId: string
  ideas: CiIdeaCard[]
  seed: {
    contentId: string
    title: string
    /** 영상을 읽어 뽑은 "따라 만든다면" 한 줄. 없으면 null */
    formula?: string | null
    whyItWorks?: string | null
    hookMessage?: string | null
  } | null
}

/**
 * 근거 콘텐츠에서 읽은 것을 아이디어 메모로 옮긴다.
 * 없는 항목은 줄 자체를 만들지 않는다 — 빈 라벨만 남으면 읽는 사람이 혼란스럽다.
 */
function seedNote(seed: Props['seed']): string {
  if (!seed) return ''
  const lines: string[] = []
  if (seed.formula) lines.push(`따라 만든다면 — ${seed.formula}`)
  if (seed.whyItWorks) lines.push(`통한 이유 — ${seed.whyItWorks}`)
  if (seed.hookMessage) lines.push(`원본의 첫 3초 — "${seed.hookMessage}"`)
  if (seed.title) lines.push(`원본 — ${seed.title}`)
  return lines.join('\n')
}

export default function PipelineView({ workspaceId, ideas, seed }: Props) {
  const router = useRouter()
  const del_ = useCiDelete(workspaceId, () => router.refresh())
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
          // 영상에서 읽은 것을 메모로 이어붙인다 — 빈 아이디어 카드 앞에서
          // 사용자가 "왜 이걸 담았더라"를 다시 떠올리지 않아도 되게.
          note: seedNote(seed) || undefined,
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
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <p className="ci-status ci-status-info" style={{ display: 'inline-flex' }}>
            근거를 이어받았습니다 — 만들면 어디서 왔는지 카드에 남습니다
          </p>
          {/* 영상을 읽어 둔 것이 있으면 그대로 보여준다. 이것이 "영상을 읽는다"가
              기획으로 이어지는 지점이다 — 제목만 넘기면 사용자는 다시 생각해야 한다.
              상세 시트와 **같은 부품**을 쓴다(§0: 두 번째 사용처가 생기면 이미 늦다). */}
          <div style={{ marginTop: 'var(--space-2)' }}>
            <FormulaNote formula={seed.formula} why={seed.whyItWorks} />
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <ErrorState code={error.code} message={error.message} helpHref="/ci/settings" />
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
                    className="card"
                    draggable
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => setDragId(null)}
                    style={{
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
                      {/* 접은 아이디어를 없앤다. 예전엔 단계만 옮길 수 있어
                          안 할 아이디어가 보드에 계속 쌓였다.
                          이 아이디어로 만든 기획·편집안도 함께 사라진다(대화상자가 미리 알려 준다). */}
                      <button type="button" className="ci-metric"
                        onClick={() => del_.ask({ kind: 'idea', id: card.id, title: '이 아이디어를 삭제할까요?' })}
                        title="삭제">삭제</button>
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

      {del_.pending && (
        <ConfirmDeleteDialog
          title={del_.pending.title}
          impact={del_.impact}
          loading={del_.loading}
          busy={del_.busy}
          errorMessage={del_.errorMessage}
          onConfirm={del_.confirm}
          onClose={del_.close}
        />
      )}
    </>
  )
}
