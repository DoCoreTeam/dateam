'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Upload, ListChecks } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { extractItems, type AnalyzeExtractResult } from './actions'
import ItemReviewList, { type ReviewItem } from './ItemReviewList'
import AnalysisResults from './AnalysisResults'
import type { AnalysisLens } from './actions'

type Step = 'input' | 'review' | 'results'

const ACCEPT =
  'image/png,image/jpeg,image/webp,.xlsx,.pptx,.docx,.pdf,.md,.txt,.csv,.html,.htm,.json'

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export default function AnalyzeClient() {
  const [step, setStep] = useState<Step>('input')
  const [pastedText, setPastedText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [truncatedWarning, setTruncatedWarning] = useState(false)

  const [items, setItems] = useState<ReviewItem[]>([])
  const [parsedCount, setParsedCount] = useState(0)
  const [restoredCount, setRestoredCount] = useState(0)
  const [sourceText, setSourceText] = useState('')

  const [lens, setLens] = useState<AnalysisLens>('summary')
  const [customInstruction, setCustomInstruction] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleExtract() {
    if (!pastedText.trim() && !file) {
      setExtractError('텍스트를 붙여넣거나 파일을 첨부하세요')
      return
    }
    setExtracting(true)
    setExtractError(null)

    const formData = new FormData()
    if (file) {
      formData.set('file', file)
    } else {
      formData.set('text', pastedText)
    }

    let result: AnalyzeExtractResult
    try {
      result = await extractItems(formData)
    } catch {
      result = { ok: false, error: '추출 중 오류가 발생했습니다' }
    }
    setExtracting(false)

    if (!result.ok) {
      setExtractError(result.error)
      return
    }

    setItems(
      result.items.map((it) => ({
        id: makeId(),
        text: it.text,
        recovered: it.recovered,
        selected: true,
      })),
    )
    setParsedCount(result.parsedCount)
    setRestoredCount(result.restoredCount)
    setSourceText(result.sourceText)
    setTruncatedWarning(result.truncated)
    setStep('review')
  }

  function resetAll() {
    setStep('input')
    setPastedText('')
    setFile(null)
    setExtractError(null)
    setTruncatedWarning(false)
    setItems([])
    setParsedCount(0)
    setRestoredCount(0)
    setSourceText('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div>
      {/* 페이지 헤더 표준(§2-3) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-4)',
          flexWrap: 'wrap',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Link
            href="/ai-chat"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              fontSize: 'var(--fs-sm)',
              color: 'var(--text-muted)',
              textDecoration: 'none',
              marginBottom: 'var(--space-2)',
            }}
          >
            <ArrowLeft size={14} />
            AI 채팅으로
          </Link>
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--fs-2xl)',
              fontWeight: 700,
              letterSpacing: '-0.03em',
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            <ListChecks size={22} color="var(--brand)" />
            목록 심층분석
          </h1>
          <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            자료를 붙여넣거나 파일을 올리면 목록 항목을 전부 추출해 검수 후 항목별로 심층 분석합니다.
          </p>
        </div>
      </div>

      {step === 'input' && (
        <div className="card" style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <label className="label" htmlFor="analyze-paste">자료 붙여넣기</label>
            <textarea className="input-field"
              id="analyze-paste"
              rows={10}
              value={pastedText}
              disabled={!!file}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="다른 곳에서 나온 답변·자료를 여기 붙여넣으세요. 번호·기호·문장형 목록을 모두 인식합니다."
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>또는</span>
            <div style={{ flex: 1, height: 'var(--hairline)', background: 'var(--border-color)' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <label className="label" htmlFor="analyze-file">파일 첨부</label>
            <input ref={fileInputRef} className="input-field"
              id="analyze-file"
              type="file"
              accept={ACCEPT}
              disabled={!!pastedText.trim()}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>
              이미지(png/jpg/webp) · 엑셀(xlsx) · PPT(pptx) · 워드(docx) · PDF · HTML · 마크다운/텍스트/CSV
            </span>
          </div>

          {extractError && (
            <p role="alert" style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>
              {extractError}
            </p>
          )}

          <div>
            <NbButton
              onClick={handleExtract}
              disabled={extracting || (!pastedText.trim() && !file)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44 }}
            >
              {extracting ? <AXDotLoader size={5} color="currentColor" /> : <Upload size={16} />}
              {extracting ? '항목 추출 중…' : '항목 추출'}
            </NbButton>
          </div>
        </div>
      )}

      {step === 'review' && (
        <ItemReviewList
          items={items}
          setItems={setItems}
          parsedCount={parsedCount}
          restoredCount={restoredCount}
          truncatedWarning={truncatedWarning}
          lens={lens}
          setLens={setLens}
          customInstruction={customInstruction}
          setCustomInstruction={setCustomInstruction}
          onBack={resetAll}
          onProceed={() => setStep('results')}
        />
      )}

      {step === 'results' && (
        <AnalysisResults
          items={items.filter((i) => i.selected)}
          contextText={sourceText}
          lens={lens}
          customInstruction={customInstruction}
          onBack={() => setStep('review')}
          onStartOver={resetAll}
        />
      )}
    </div>
  )
}
