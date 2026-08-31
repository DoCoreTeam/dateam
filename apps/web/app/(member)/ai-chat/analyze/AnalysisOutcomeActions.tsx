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
import InlineError from '@/components/ui/InlineError'
import { withSubmitGuard } from '@/lib/forms/submit-guard'

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
    await withSubmitGuard(async () => {
      setError(null)
      const r = await createDocument({ sessionId, title, bodyMd: bodyMd ?? '', docType })
      setSaving(false)
      if (!r.ok) { setError(r.error); return }
      setSavedId(r.id)
    }, { onError: setError, onDone: () => setSaving(false) })
  }

  // 종합 패널 상단 액션 줄에 인라인으로 배치(다운로드/복사와 한 곳). 카드 래퍼·헤더 없음.
  return (
    <>
      {savedId ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--fs-sm)', color: 'var(--success)' }}>
          <CheckCircle2 size={16} /> 저장됨 —{' '}
          <Link href="/ai-chat/analyze?tab=documents" style={{ color: 'var(--brand)', textDecoration: 'underline' }}>
            문서함
          </Link>
        </span>
      ) : (
        <NbButton variant="secondary" onClick={handleSave} disabled={saving} style={{ fontSize: 'var(--fs-sm)', minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <FolderPlus size={14} /> {saving ? '저장 중…' : '문서함에 저장'}
        </NbButton>
      )}

      <NbButton variant="ghost" onClick={() => setShowHandoff(true)} style={{ fontSize: 'var(--fs-sm)', minHeight: 36, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Share2 size={14} /> 업무로 전달
      </NbButton>

      <InlineError>{error}</InlineError>

      {showHandoff && (
        <WorkflowHandoffModal title={title} bodyMd={bodyMd} onClose={() => setShowHandoff(false)} />
      )}
    </>
  )
}
