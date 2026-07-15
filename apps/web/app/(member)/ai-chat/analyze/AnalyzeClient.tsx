'use client'

import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
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
import CommandPresetPanel from './CommandPresetPanel'
import AnalysisResults from './AnalysisResults'
import AnalyzePageHeader from './AnalyzePageHeader'
import RecentSessionsList from './RecentSessionsList'
import type { InitialItem } from './useAnalysisStream'

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
  const [sourceKind, setSourceKind] = useState('text')

  const [lens, setLens] = useState<AnalysisLens>('summary')
  const [command, setCommand] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  // §G 영속 저장 — 분석 착수 시 생성되는 세션 id, "이전 분석" 이어하기 시 미리 채워짐
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [initialItems, setInitialItems] = useState<InitialItem[]>([])
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
    setTruncatedWarning(result.truncated)
    setSessionId(null)
    setInitialItems([])
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
    setCommand('')
    setLens('summary')
    setSaveError(null)
    setSessionId(null)
    setInitialItems([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleSelectLens(id: AnalysisLens, instruction: string): void {
    setLens(id)
    setCommand(instruction)
  }

  /** 검수 완료 → 분석 착수: 세션+항목을 먼저 영속화(유실0)한 뒤 결과 화면으로 진입(§ 관전자 —
   *  실제 분석은 결과 화면에서 서버 SSE 스트림 POST로 착수된다, 여기서는 저장만 한다). */
  async function handleProceedToResults(): Promise<void> {
    const selected = items.filter((i) => i.selected)
    if (selected.length === 0) return
    setProceeding(true)
    setSaveError(null)
    const r = await saveAnalysisSession({
      sourceText,
      lens,
      sourceKind,
      command,
      items: selected.map((i) => ({ text: i.text })),
    })
    setProceeding(false)
    if (!r.ok) {
      setSaveError(r.error)
      return
    }
    setSessionId(r.sessionId)
    setInitialItems(
      selected.map((i, idx) => ({ idx, text: i.text, status: 'pending' as const, resultText: null })),
    )
    setStep('results')
  }

  /** "이전 분석" 이어하기 — 세션 상세를 불러와 검수 단계를 건너뛰고 결과 화면으로 바로 진입. */
  async function handleResumeSession(id: string): Promise<void> {
    setLoadingSession(true)
    const r = await getAnalysisSession(id)
    setLoadingSession(false)
    if (!r.ok) return

    setSourceText(r.session.sourceText)
    setSourceKind(r.session.sourceKind)
    setLens(r.session.lens)
    setSessionId(r.session.id)
    setInitialItems(
      r.session.items.map((it) => ({ idx: it.idx, text: it.text, status: it.status, resultText: it.resultText })),
    )
    setStep('results')
  }

  return (
    <div>
      <AnalyzePageHeader />

      {step === 'input' && <RecentSessionsList sessions={sessions} loading={loadingSession} onResume={handleResumeSession} />}

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <CommandPresetPanel lens={lens} command={command} onSelectLens={handleSelectLens} onCommandChange={setCommand} />
          <ItemReviewList
            items={items}
            setItems={setItems}
            parsedCount={parsedCount}
            restoredCount={restoredCount}
            truncatedWarning={truncatedWarning}
            onBack={resetAll}
            onProceed={handleProceedToResults}
            proceeding={proceeding}
          />
          {saveError && (
            <p role="alert" style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>
              {saveError}
            </p>
          )}
        </div>
      )}

      {step === 'results' && sessionId && (
        <AnalysisResults
          sessionId={sessionId}
          initialItems={initialItems}
          onBack={() => setStep('review')}
          onStartOver={resetAll}
        />
      )}
    </div>
  )
}
