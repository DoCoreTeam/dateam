'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Pencil, Trash2, X, FolderOpen } from 'lucide-react'
import type { AiChatProject } from '@/types/database'
import { useEscClose } from '@/lib/use-esc-close'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import NbButton from '@/components/ui/nb/NbButton'
import { createProject, updateProject, softDeleteProject, listProjects } from '../actions'

interface Props {
  initialProjects: AiChatProject[]
}

const NAME_MAX = 100
const INSTRUCTIONS_MAX = 4000

export default function ProjectsClient({ initialProjects }: Props) {
  const [projects, setProjects] = useState<AiChatProject[]>(initialProjects)
  const [editing, setEditing] = useState<AiChatProject | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  async function reload() {
    const r = await listProjects()
    if (r.ok && r.items) setProjects(r.items)
  }

  function openCreate() {
    setEditing(null)
    setModalOpen(true)
  }
  function openEdit(p: AiChatProject) {
    setEditing(p)
    setModalOpen(true)
  }

  return (
    <div>
      {/* 페이지 헤더 — 표준(§2-3): fs-2xl / 700 / -0.03em / --text */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-6)' }}>
        <div style={{ minWidth: 0 }}>
          <Link
            href="/ai-chat"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', textDecoration: 'none', marginBottom: 'var(--space-2)' }}
          >
            <ArrowLeft size={14} />
            AI 채팅으로
          </Link>
          <h1 style={{ margin: 0, fontSize: 'var(--fs-2xl)', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' }}>
            프로젝트
          </h1>
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            지시문과 지식을 묶어 대화에 컨텍스트로 주입합니다.
          </p>
        </div>
        <NbButton onClick={openCreate} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', minHeight: 44 }}>
          <Plus size={16} />
          새 프로젝트
        </NbButton>
      </div>

      {/* 목록 / 빈 상태 */}
      {projects.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-8) var(--space-6)', textAlign: 'center' }}>
          <FolderOpen size={32} color="var(--text-faint)" style={{ margin: '0 auto var(--space-3)' }} />
          <p style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)' }}>
            아직 프로젝트가 없습니다.
          </p>
          <p style={{ margin: 'var(--space-1) 0 var(--space-4)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            첫 프로젝트를 만들어 지식과 지시문을 정리하세요.
          </p>
          <NbButton onClick={openCreate} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', minHeight: 44 }}>
            <Plus size={16} />
            새 프로젝트
          </NbButton>
        </div>
      ) : (
        <div className="responsive-grid-cols-3" style={{ gap: 'var(--space-4)' }}>
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onEdit={() => openEdit(p)} onDeleted={reload} />
          ))}
        </div>
      )}

      {modalOpen && (
        <ProjectModal
          project={editing}
          onClose={() => setModalOpen(false)}
          onSaved={async () => {
            setModalOpen(false)
            await reload()
          }}
        />
      )}
    </div>
  )
}

// ── 프로젝트 카드 (삭제 확인 단계 내장) ──
function ProjectCard({ project, onEdit, onDeleted }: { project: AiChatProject; onEdit: () => void; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function doDelete() {
    setBusy(true)
    setError(null)
    const r = await softDeleteProject(project.id)
    setBusy(false)
    if (!r.ok) {
      setError(r.error ?? '삭제 실패')
      return
    }
    await onDeleted()
  }

  return (
    <article className="card" style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <Link
          href={`/admin/ai-chat/projects/${project.id}`}
          style={{ minWidth: 0, fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)', textDecoration: 'none', letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {project.name}
        </Link>
        <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0 }}>
          <button type="button" className="ai-chat-icon-btn" onClick={onEdit} aria-label="프로젝트 이름·지시문 수정">
            <Pencil size={14} />
          </button>
          <button type="button" className="ai-chat-icon-btn" data-danger="true" onClick={() => setConfirming(true)} aria-label="프로젝트 삭제">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {project.instructions && (
        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {project.instructions}
        </p>
      )}

      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          수정 {formatKstDateTimeShort(project.updated_at)}
        </span>
        <Link
          href={`/admin/ai-chat/projects/${project.id}`}
          style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--brand)', textDecoration: 'none' }}
        >
          열기 →
        </Link>
      </div>

      {confirming && (
        <div role="alertdialog" aria-label="삭제 확인" style={{ borderTop: 'var(--hairline) solid var(--border-color)', paddingTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>이 프로젝트를 삭제할까요?</span>
          {error && <span role="alert" style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}>{error}</span>}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <NbButton variant="danger" onClick={doDelete} disabled={busy} style={{ fontSize: 'var(--fs-sm)' }}>
              {busy ? '삭제중…' : '삭제'}
            </NbButton>
            <NbButton variant="ghost" onClick={() => { setConfirming(false); setError(null) }} disabled={busy} style={{ fontSize: 'var(--fs-sm)' }}>
              취소
            </NbButton>
          </div>
        </div>
      )}
    </article>
  )
}

// ── 생성/편집 모달 (모달 표준 §2-2) ──
function ProjectModal({ project, onClose, onSaved }: { project: AiChatProject | null; onClose: () => void; onSaved: () => void }) {
  useEscClose(onClose)
  const [name, setName] = useState(project?.name ?? '')
  const [instructions, setInstructions] = useState(project?.instructions ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('프로젝트 이름을 입력하세요')
      return
    }
    setBusy(true)
    setError(null)
    const r = project
      ? await updateProject(project.id, { name: trimmed, instructions })
      : await createProject(trimmed, instructions)
    setBusy(false)
    if (!r.ok) {
      setError(r.error ?? '저장 실패')
      return
    }
    onSaved()
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--modal-backdrop)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}
    >
      <div style={{ width: '100%', maxWidth: 480, background: 'var(--color-surface)', borderRadius: 'var(--radius)', padding: 'var(--space-6)', boxShadow: 'var(--shadow-modal)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>{project ? '프로젝트 수정' : '새 프로젝트'}</h3>
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <label className="label" htmlFor="project-name">이름</label>
          <input className="input-field" id="project-name"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
            placeholder="예: 제품 매뉴얼 Q&A"
            autoFocus
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <label className="label" htmlFor="project-instructions">지시문 (선택)</label>
          <textarea className="input-field" id="project-instructions"
            value={instructions}
            maxLength={INSTRUCTIONS_MAX}
            onChange={(e) => setInstructions(e.target.value)}
            rows={5}
            placeholder="이 프로젝트의 모든 대화에 공통 적용할 지시를 입력하세요."
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
          <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', textAlign: 'right' }}>
            {instructions.length}/{INSTRUCTIONS_MAX}
          </span>
        </div>

        {error && <p role="alert" style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-5)', justifyContent: 'flex-end' }}>
          <NbButton variant="ghost" onClick={onClose} disabled={busy}>취소</NbButton>
          <NbButton onClick={save} disabled={busy}>{busy ? '저장중…' : '저장'}</NbButton>
        </div>
      </div>
    </div>
  )
}
