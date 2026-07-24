'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import TiptapEditor from '@/components/ui/TiptapEditor'
import { htmlToMarkdown } from '@/lib/ai-chat/html-to-markdown'
import { extractSourceText } from './actions'
import { getAnalysisSession } from './session-persist-actions'
import { listAnalysisSessions, type AnalysisSessionSummary } from './session-list-actions'
import { analyzeDocument, regroupSession, type GroupingOk } from './grouping-actions'
import AnalysisResults from './AnalysisResults'
import AnalyzePageHeader from './AnalyzePageHeader'
import RecentSessionsList from './RecentSessionsList'
import GroupsResultView from './GroupsResultView'
import ItemConversePanel from './ItemConversePanel'
import type { InitialItem } from './useAnalysisStream'

type Step = 'input' | 'groups' | 'converse' | 'results'

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
    // 빠른 재개용 최근 소수만 — 전체는 "이전 원문" 탭(페이지네이션)이 담당(페이지 스크롤 팽창 방지).
    listAnalysisSessions({ limit: 5 }).then((r) => {
      if (r.ok) setSessions(r.sessions)
    })
  }, [])

  // 리치에디터는 HTML을 담는다 → 마크다운 정규화본(표=파이프표)이 실제 붙여넣기 유무 판단·AI 입력의 SSOT.
  const pastedMd = htmlToMarkdown(pastedText).trim()
  const isRich = pastedText.includes('<') // 리치에디터 산출(태그 포함) 여부

  /** 문서+지시 → ①~④ 그룹핑 실행. 명령과 실행이 한 덩어리(검수 단계 없음, §A). */
  async function handleAnalyze(): Promise<void> {
    if (!pastedMd && !file) {
      setRunError('텍스트를 붙여넣거나 파일을 첨부하세요')
      return
    }
    setRunning(true)
    setRunError(null)

    // 붙여넣기 경로: 마크다운 정규화본을 AI·그룹핑에, 원본 HTML은 무손실 보존(R1-2).
    let sourceText = pastedMd
    let sourceHtml: string | undefined = isRich && pastedText.trim() ? pastedText : undefined

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
      sourceHtml = undefined
    }

    const result = await analyzeDocument(sourceText, command, sourceHtml)
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

  /** 완전 대화형(④) — 항목별 지시·대화 단계로 진입. 세션은 이미 영속됨. */
  function handleConverse(): void {
    if (!groupingResult) return
    setStep('converse')
  }

  /** 대화 종합 완료 → 결과 화면(단일 문서). 항목은 대화로 done 처리되어 폴링이 결과·종합을 로드한다. */
  function handleConverseSynthesized(): void {
    if (!groupingResult) return
    setInitialItems(
      groupingResult.groups.map((g, idx) => ({ idx, text: g.title, status: 'done' as const, resultText: null })),
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
            {file ? (
              <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
                파일이 첨부되어 있어요. 붙여넣기로 입력하려면 첨부를 먼저 지워주세요.
              </p>
            ) : (
              <TiptapEditor
                value={pastedText}
                onChange={setPastedText}
                enableTable
                minHeight={220}
                placeholder="문서 원문을 여기 붙여넣으세요. 표·헤딩·번호·목록 구조를 그대로 인식합니다."
              />
            )}
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
              disabled={!!pastedMd}
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
              disabled={running || (!pastedMd && !file)}
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
            onConverse={handleConverse}
            onStartOver={resetAll}
          />
          {runError && (
            <p role="alert" style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>
              {runError}
            </p>
          )}
        </>
      )}

      {step === 'converse' && groupingResult && (
        <ItemConversePanel
          sessionId={groupingResult.sessionId}
          items={groupingResult.groups.map((g, idx) => ({ idx, title: g.title }))}
          onSynthesized={handleConverseSynthesized}
          onBack={() => setStep('groups')}
        />
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
