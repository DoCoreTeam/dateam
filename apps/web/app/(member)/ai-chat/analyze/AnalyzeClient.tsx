'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { extractSourceText } from './actions'
import { getAnalysisSession } from './session-persist-actions'
import { listAnalysisSessions, type AnalysisSessionSummary } from './session-list-actions'
import { analyzeDocument, regroupSession, type GroupingOk } from './grouping-actions'
import AnalysisResults from './AnalysisResults'
import AnalyzePageHeader from './AnalyzePageHeader'
import RecentSessionsList from './RecentSessionsList'
import GroupsResultView from './GroupsResultView'
import type { InitialItem } from './useAnalysisStream'

type Step = 'input' | 'groups' | 'results'

const ACCEPT =
  'image/png,image/jpeg,image/webp,.xlsx,.pptx,.docx,.pdf,.md,.txt,.csv,.html,.htm,.json'

export default function AnalyzeClient() {
  const [step, setStep] = useState<Step>('input')
  const [pastedText, setPastedText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [command, setCommand] = useState('')
  const [running, setRunning] = useState(false)
  const [regrouping, setRegrouping] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const [groupingResult, setGroupingResult] = useState<GroupingOk | null>(null)
  const [initialItems, setInitialItems] = useState<InitialItem[]>([])
  // "이전 분석" 이어하기는 grouping-actions 세션 결과를 거치지 않으므로 sessionId를 별도 보관
  const [resumedSessionId, setResumedSessionId] = useState<string | null>(null)

  // §G "이전 분석" 목록
  const [sessions, setSessions] = useState<AnalysisSessionSummary[]>([])
  const [loadingSession, setLoadingSession] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listAnalysisSessions().then((r) => {
      if (r.ok) setSessions(r.sessions)
    })
  }, [])

  /** 문서+지시 → ①~④ 그룹핑 실행. 명령과 실행이 한 덩어리(검수 단계 없음, §A). */
  async function handleAnalyze(): Promise<void> {
    if (!pastedText.trim() && !file) {
      setRunError('텍스트를 붙여넣거나 파일을 첨부하세요')
      return
    }
    setRunning(true)
    setRunError(null)

    let sourceText = pastedText

    // 파일 → 원문 텍스트만 (extractSourceText). extractItems를 쓰면 구 평탄화 파서 + 폐기되는
    // Gemini 호출이 매 업로드마다 돌아 비용이 샌다(🟥 DC-REV HIGH-1).
    if (file) {
      const formData = new FormData()
      formData.set('file', file)
      const extracted = await extractSourceText(formData)
      if (!extracted.ok) {
        setRunning(false)
        setRunError(extracted.error)
        return
      }
      if (!extracted.sourceText.trim()) {
        setRunning(false)
        setRunError('파일에서 원문을 확보하지 못했습니다')
        return
      }
      sourceText = extracted.sourceText
    }

    const result = await analyzeDocument(sourceText, command)
    setRunning(false)
    if (!result.ok) {
      setRunError(result.error)
      return
    }
    setGroupingResult(result)
    setStep('groups')
  }

  function resetAll() {
    setStep('input')
    setPastedText('')
    setFile(null)
    setCommand('')
    setRunError(null)
    setGroupingResult(null)
    setInitialItems([])
    setResumedSessionId(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /** 재지시 루프 — 원문은 그대로, 절단만 재실행(리비전 +1, §B). */
  async function handleRegroup(newCommand: string): Promise<void> {
    if (!groupingResult) return
    setRegrouping(true)
    setRunError(null)
    const result = await regroupSession(groupingResult.sessionId, newCommand)
    setRegrouping(false)
    if (!result.ok) {
      setRunError(result.error)
      return
    }
    setGroupingResult(result)
  }

  /** 심화 실행 — 그룹을 항목으로 승계해 기존 결과 화면(§ 관전자 스트림)으로 진입.
   *  세션·그룹은 analyzeDocument가 이미 영속화했으므로 재저장하지 않는다. */
  function handleDeepRun(): void {
    if (!groupingResult) return
    setInitialItems(
      groupingResult.groups.map((g, idx) => ({ idx, text: g.title, status: 'pending' as const, resultText: null })),
    )
    setStep('results')
  }

  /** "이전 분석" 이어하기 — 세션 상세를 불러와 그룹 단계를 건너뛰고 결과 화면으로 바로 진입. */
  async function handleResumeSession(id: string): Promise<void> {
    setLoadingSession(true)
    const r = await getAnalysisSession(id)
    setLoadingSession(false)
    if (!r.ok) return

    setGroupingResult(null)
    setResumedSessionId(r.session.id)
    setInitialItems(
      r.session.items.map((it) => ({ idx: it.idx, text: it.text, status: it.status, resultText: it.resultText })),
    )
    setStep('results')
  }

  return (
    <div>
      <AnalyzePageHeader onNewAnalysis={step === 'input' ? undefined : resetAll} />

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
              placeholder="문서 원문을 여기 붙여넣으세요. 구조(헤딩·번호·들여쓰기)를 그대로 인식합니다."
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>실행</span>
            <div style={{ flex: 1, height: 'var(--hairline)', background: 'var(--border-color)' }} />
          </div>

          {/* 지시 입력창과 실행 버튼을 한 덩어리로 — 명령↔실행 사이에 검수 단계 없음(§A). */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 280px', minWidth: 0 }}>
              <label className="label" htmlFor="analyze-command">지시(선택)</label>
              <textarea className="input-field"
                id="analyze-command"
                rows={2}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="예: 요구사항 단위로 묶어줘 / 카테고리 단위로 크게 / P2 부분만"
                style={{ resize: 'vertical', fontFamily: 'inherit', width: '100%' }}
              />
            </div>
            <NbButton
              onClick={handleAnalyze}
              disabled={running || (!pastedText.trim() && !file)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, flexShrink: 0 }}
            >
              {running ? <AXDotLoader size={5} color="currentColor" /> : <Sparkles size={16} />}
              {running ? '분석 중…' : '실행'}
            </NbButton>
          </div>

          {runError && (
            <p role="alert" style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>
              {runError}
            </p>
          )}
        </div>
      )}

      {step === 'groups' && groupingResult && (
        <>
          <GroupsResultView
            result={groupingResult}
            regrouping={regrouping}
            onRegroup={handleRegroup}
            onDeepRun={handleDeepRun}
            onStartOver={resetAll}
          />
          {runError && (
            <p role="alert" style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>
              {runError}
            </p>
          )}
        </>
      )}

      {step === 'results' && (groupingResult?.sessionId ?? resumedSessionId) && (
        <AnalysisResults
          sessionId={groupingResult?.sessionId ?? (resumedSessionId as string)}
          initialItems={initialItems}
          docType={groupingResult?.docType ?? null}
          onBack={() => setStep(groupingResult ? 'groups' : 'input')}
          onStartOver={resetAll}
        />
      )}
    </div>
  )
}
