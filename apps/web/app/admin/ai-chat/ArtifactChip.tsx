'use client'

// 세션 3 §2-3 — 메시지 본문 내 artifact 승격 펜스 자리표시 칩.
// MarkdownMessage(허브 소유)가 이 칩으로 펜스를 치환하고, 클릭 시 허브가 ArtifactPanel을 연다.
// 순수 프레젠테이션 — 상태는 허브가 관리.

import { Code2, FileText, Globe, Image as ImageIcon, Workflow } from 'lucide-react'
import type { ArtifactType } from '@/lib/ai-chat/artifacts'

interface Props {
  title: string
  type: ArtifactType
  onClick: () => void
}

const ICON: Record<ArtifactType, typeof Code2> = {
  html: Globe,
  svg: ImageIcon,
  markdown: FileText,
  code: Code2,
  mermaid: Workflow,
}

const TYPE_LABEL: Record<ArtifactType, string> = {
  html: 'HTML',
  svg: 'SVG',
  markdown: '문서',
  code: '코드',
  mermaid: '다이어그램',
}

export default function ArtifactChip({ title, type, onClick }: Props) {
  const Icon = ICON[type]
  return (
    <button
      type="button"
      className="artifact-chip"
      onClick={onClick}
      aria-label={`${TYPE_LABEL[type]} 아티팩트 열기: ${title}`}
    >
      <span className="artifact-chip-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="artifact-chip-body">
        <span className="artifact-chip-title">{title}</span>
        <span className="artifact-chip-type">{TYPE_LABEL[type]} · 열기</span>
      </span>
    </button>
  )
}
