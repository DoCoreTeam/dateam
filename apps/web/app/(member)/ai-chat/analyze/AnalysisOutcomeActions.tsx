'use client'

// 목록 심층분석 — §FR-11 배출 경로 2(문서 라이브러리 저장)·3(업무 흐름 연계) 진입점.
// AnalysisSynthPanel(경로 1: 파일 내보내기) 아래, 종합 완료 시에만 노출.
// AnalysisResults.tsx의 최소 침습을 위해 저장/전달 로직을 별도 컴포넌트로 분리.

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, FolderPlus, Share2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { createDocument } from './document-actions'
import WorkflowHandoffModal from './WorkflowHandoffModal'

interface Props {
  sessionId: string
  docType: string | null
  title: string
  bodyMd: string | null
  /** 종합(synth) 완료 후에만 저장 가능 — 완성 문서는 synth_text가 조립 결과다. */
  canSave: boolean
}

export default function AnalysisOutcomeActions({ sessionId, docType, title, bodyMd, canSave }: Props) {
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showHandoff, setShowHandoff] = useState(false)

  if (!canSave || !bodyMd) return null

  async function handleSave() {
    setSaving(true)
    setError(null)
    const r = await createDocument({ sessionId, title, bodyMd: bodyMd ?? '', docType })
    setSaving(false)
    if (!r.ok) { setError(r.error); return }
    setSavedId(r.id)
  }

  return (
    <div className="card" style={{ padding: 'var(--space-4)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)' }}>
      <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-muted)' }}>완성 문서 배출</span>

      {savedId ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--fs-sm)', color: 'var(--success)' }}>
          <CheckCircle2 size={16} /> 문서함에 저장됨 —{' '}
          <Link href="/ai-chat/analyze?tab=documents" style={{ color: 'var(--brand)', textDecoration: 'underline' }}>
            내 분석 문서에서 열람
          </Link>
        </span>
      ) : (
        <NbButton variant="secondary" onClick={handleSave} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 40 }}>
          <FolderPlus size={15} /> {saving ? '저장 중…' : '문서함에 저장'}
        </NbButton>
      )}

      <NbButton variant="ghost" onClick={() => setShowHandoff(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 40 }}>
        <Share2 size={15} /> 업무 흐름으로 전달
      </NbButton>

      {error && <p role="alert" style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{error}</p>}

      {showHandoff && (
        <WorkflowHandoffModal title={title} bodyMd={bodyMd} onClose={() => setShowHandoff(false)} />
      )}
    </div>
  )
}
