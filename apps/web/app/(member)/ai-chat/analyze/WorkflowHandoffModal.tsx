'use client'

// 목록 심층분석 — §FR-11-3 업무 흐름 연계 대상 선택 모달(배출 경로 3/4).
// 대상 선택 → sessionStorage에 적재(lib/ai-chat/workflow-handoff.ts) → 해당 생성 화면으로 이동해 프리필.
// 자동 등록 금지: 여기서 하는 일은 "폼에 미리 채워 넣기"까지다. 실제 저장은 각 화면에서 사용자가 직접 확정한다.
// 모달 표준(§2-2) 준수: useEscClose·X닫기·tape-title·boxShadow(var(--shadow-modal))·backdrop(var(--modal-backdrop)).

import { CalendarClock, ClipboardList, FolderKanban, NotebookPen, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEscClose } from '@/lib/use-esc-close'
import { setWorkflowHandoff, type WorkflowTarget } from '@/lib/ai-chat/workflow-handoff'

interface Props {
  title: string
  bodyMd: string
  onClose: () => void
}

interface TargetDef {
  key: WorkflowTarget
  label: string
  desc: string
  href: string
  icon: typeof CalendarClock
}

const TARGETS: TargetDef[] = [
  {
    key: 'weekly-report',
    label: '주간보고',
    desc: '작성 화면 첫 항목에 내용이 미리 채워집니다',
    href: '/weekly-report?handoff=1',
    icon: CalendarClock,
  },
  {
    key: 'dept-task',
    label: '부서업무',
    desc: '새 업무 등록 폼에 내용이 미리 채워집니다',
    href: '/dept-tasks?handoff=1',
    icon: ClipboardList,
  },
  {
    key: 'project',
    label: '프로젝트',
    desc: '새 프로젝트 이름에 제목이 미리 채워집니다(본문은 프로젝트에 자유 서술 필드가 없어 제목만 전달)',
    href: '/work/projects?handoff=1',
    icon: FolderKanban,
  },
  {
    key: 'meeting-note',
    label: '회의노트',
    desc: '새 회의노트 본문에 내용이 미리 채워집니다',
    href: '/meeting-notes/new?handoff=1',
    icon: NotebookPen,
  },
]

export default function WorkflowHandoffModal({ title, bodyMd, onClose }: Props) {
  useEscClose(onClose)
  const router = useRouter()

  function pick(target: TargetDef) {
    setWorkflowHandoff(target.key, { title, bodyMd })
    onClose()
    router.push(target.href)
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--modal-backdrop)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}
    >
      <div style={{ width: '100%', maxWidth: 460, background: 'var(--color-surface)', borderRadius: 'var(--radius)', padding: 'var(--space-6)', boxShadow: 'var(--shadow-modal)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>업무 흐름으로 전달</h3>
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>
        <p style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          대상을 고르면 생성 화면으로 이동해 내용을 미리 채워줍니다. 저장은 그 화면에서 직접 확인 후 진행하세요.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {TARGETS.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => pick(t)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', textAlign: 'left',
                  padding: 'var(--space-3)', minHeight: 44, borderRadius: 'var(--radius)',
                  border: 'var(--hairline) solid var(--border-color)', background: 'var(--surface-bg)', cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--brand)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)' }}
              >
                <Icon size={18} color="var(--brand)" style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text)' }}>{t.label}</span>
                  <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>{t.desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
