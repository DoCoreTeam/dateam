'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Upload, ListChecks, History } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { extractItems, type AnalyzeExtractResult, type AnalysisLens } from './actions'
import {
  saveAnalysisSession,
  listAnalysisSessions,
  getAnalysisSession,
  type AnalysisSessionSummary,
} from './session-actions'
import ItemReviewList, { type ReviewItem } from './ItemReviewList'
import AnalysisResults from './AnalysisResults'

type Step = 'input' | 'review' | 'results'
type ResultState = { status: 'idle' | 'running' | 'done' | 'error'; text?: string; error?: string }

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
  const [sourceKind, setSourceKind] = useState('text')

  const [lens, setLens] = useState<AnalysisLens>('summary')
  const [customInstruction, setCustomInstruction] = useState('')

  // §G 영속 저장 — 분석 착수 시 생성되는 세션 id, "이전 분석" 이어하기 시 미리 채워짐
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [initialResults, setInitialResults] = useState<Record<string, ResultState> | undefined>(undefined)
  const [initialTokens, setInitialTokens] = useState(0)
  const [proceeding, setProceeding] = useState(false)

  // §G "이전 분석" 목록
  const [sessions, setSessions] = useState<AnalysisSessionSummary[]>([])
  const [loadingSession, setLoadingSession] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listAnalysisSessions().then((r) => {
      if (r.ok) setSessions(r.sessions)
    })
  }, [])

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
    setSourceKind(file ? 'file' : 'text')

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
    setInitialTokens(result.usage.totalTokens)
    setTruncatedWarning(result.truncated)
    setSessionId(null)
    setInitialResults(undefined)
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
    setSourceKind('text')
    setSessionId(null)
    setInitialResults(undefined)
    setInitialTokens(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /** 검수 완료 → 분석 착수: 세션+항목을 먼저 영속화(유실0)한 뒤 결과 화면으로 진입. */
  async function handleProceedToResults(): Promise<void> {
    const selected = items.filter((i) => i.selected)
    if (selected.length === 0) return
    setProceeding(true)
    const r = await saveAnalysisSession({
      sourceText,
      lens,
      sourceKind,
      items: selected.map((i) => ({ text: i.text })),
    })
    setProceeding(false)
    setSessionId(r.ok ? r.sessionId : null)
    setStep('results')
  }

  /** "이전 분석" 이어하기 — 세션 상세를 불러와 검수 단계를 건너뛰고 결과 화면으로 바로 진입. */
  async function handleResumeSession(id: string): Promise<void> {
    setLoadingSession(true)
    const r = await getAnalysisSession(id)
    setLoadingSession(false)
    if (!r.ok) return

    const resumedItems: ReviewItem[] = r.session.items.map((it) => ({
      id: makeId(),
      text: it.text,
      recovered: false,
      selected: true,
    }))
    const resumedResults: Record<string, ResultState> = {}
    r.session.items.forEach((it, i) => {
      const id2 = resumedItems[i].id
      if (it.status === 'done' || it.status === 'error') {
        resumedResults[id2] =
          it.status === 'done'
            ? { status: 'done', text: it.resultText ?? '' }
            : { status: 'error', error: '분석에 실패했습니다' }
      }
    })

    setItems(resumedItems)
    setLens(r.session.lens)
    setSourceText(r.session.sourceText)
    setSourceKind(r.session.sourceKind)
    setSessionId(r.session.id)
    setInitialResults(resumedResults)
    setInitialTokens(0)
    setStep('results')
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

      {step === 'input' && sessions.length > 0 && (
        <div className="card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <span className="tape-title" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <History size={14} />
            이전 분석
          </span>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => handleResumeSession(s.id)}
                  disabled={loadingSession}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-2) var(--space-3)',
                    borderRadius: 'var(--radius)',
                    border: `var(--hairline) solid var(--border-color)`,
                    background: 'transparent',
                    cursor: loadingSession ? 'default' : 'pointer',
                    textAlign: 'left',
                    color: 'var(--text)',
                    fontSize: 'var(--fs-sm)',
                  }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>
                    {s.doneCount}/{s.itemCount}개 완료
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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
          onProceed={handleProceedToResults}
          proceeding={proceeding}
        />
      )}

      {step === 'results' && (
        <AnalysisResults
          items={items.filter((i) => i.selected)}
          contextText={sourceText}
          lens={lens}
          customInstruction={customInstruction}
          sessionId={sessionId}
          initialResults={initialResults}
          initialTokens={initialTokens}
          onBack={() => setStep('review')}
          onStartOver={resetAll}
        />
      )}
    </div>
  )
}
