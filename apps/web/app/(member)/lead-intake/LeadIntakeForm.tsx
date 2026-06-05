'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ParsedLeadData } from '@/lib/gemini-lead'
import AXLoadingOverlay from '@/components/ui/AXLoadingOverlay'
import ParsedCard from './ParsedCard'
import BulkImportProgress from './BulkImportProgress'

const BULK_EXTENSIONS = new Set(['xlsx', 'xls'])

type FileItem = {
  file: File
  status: 'pending' | 'processing' | 'done' | 'error'
  parsed?: ParsedLeadData
  intakeId?: string
  error?: string
}

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  start: () => void
}

const MAX_FILE_BYTES = 20 * 1024 * 1024

interface LeadIntakeFormProps {
  brandName?: string
}

const ACCEPTED_TYPES = [
  'image/jpeg,image/png,image/webp,image/gif,image/bmp',
  'image/tiff,image/heic,image/heif,image/avif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain,text/csv',
].join(',')

export default function LeadIntakeForm({ brandName }: LeadIntakeFormProps) {
  const router = useRouter()

  const [rawInput, setRawInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ parsed: ParsedLeadData; intakeId: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [voiceUsed, setVoiceUsed] = useState(false)

  const submittingRef = useRef(false)

  const [files, setFiles] = useState<FileItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [bulkFile, setBulkFile] = useState<File | null>(null)
  const [voiceSupported, setVoiceSupported] = useState(true)
  const [listening, setListening] = useState(false)

  function addFiles(incoming: FileList | File[] | null) {
    if (!incoming) return
    const next: FileItem[] = []
    for (const file of Array.from(incoming)) {
      if (file.size === 0) { setError(`${file.name}: 빈 파일입니다`); continue }
      if (file.size > MAX_FILE_BYTES) { setError(`${file.name}: 파일이 너무 큽니다 (최대 20MB)`); continue }
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      if (BULK_EXTENSIONS.has(ext)) {
        // XLSX/XLS → 대량 업로드 흐름으로 분기(별도 화면 점유)
        setBulkFile(file); setError(''); return
      }
      next.push({ file, status: 'pending' })
    }
    if (next.length) { setFiles(prev => [...prev, ...next]); setError('') }
  }

  // 붙여넣기로 이미지 첨부(통합 입력 — GPU 통합입력과 동일 UX)
  function handlePaste(e: React.ClipboardEvent) {
    const fromClipboard = Array.from(e.clipboardData.files ?? [])
    if (fromClipboard.length) { e.preventDefault(); addFiles(fromClipboard) }
  }

  async function parseTextInput(source: 'prompt' | 'voice') {
    const res = await fetch('/api/leads/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_input: rawInput, source }),
    })
    const data = await res.json() as { parsed?: ParsedLeadData; intake?: { id: string }; error?: string }
    if (!res.ok) { setError(data.error ?? '오류가 발생했습니다'); return }
    setResult({ parsed: data.parsed!, intakeId: data.intake?.id ?? '' })
  }

  async function analyzeFiles() {
    const pending = files.filter(f => f.status === 'pending')
    for (const item of pending) {
      setFiles(prev => prev.map(f => f.file === item.file ? { ...f, status: 'processing' } : f))
      try {
        const fd = new FormData()
        fd.append('file', item.file)
        fd.append('source', 'file')
        const res = await fetch('/api/leads/parse', { method: 'POST', body: fd })
        const data = await res.json() as { parsed?: ParsedLeadData; intake?: { id: string }; error?: string }
        if (!res.ok) throw new Error(data.error ?? '오류가 발생했습니다')
        setFiles(prev => prev.map(f => f.file === item.file ? { ...f, status: 'done', parsed: data.parsed, intakeId: data.intake?.id } : f))
      } catch (err) {
        const msg = err instanceof Error ? err.message : '오류가 발생했습니다'
        setFiles(prev => prev.map(f => f.file === item.file ? { ...f, status: 'error', error: msg } : f))
      }
    }
  }

  // 통합 분석 — 텍스트·파일·음성 무엇이든 한 버튼으로. 둘 다 있으면 둘 다 분석.
  async function handleAnalyze(e?: React.FormEvent) {
    e?.preventDefault()
    if (submittingRef.current) return
    const hasText = rawInput.trim().length > 0
    const hasPendingFiles = files.some(f => f.status === 'pending')
    if (!hasText && !hasPendingFiles) { setError('내용을 입력하거나 파일을 첨부하세요'); return }
    submittingRef.current = true
    setLoading(true); setError(''); setSavedMsg('')
    setResult(null)  // 이전 텍스트 분석 결과 잔존 방지(DC-REV HIGH)
    try {
      if (hasPendingFiles) await analyzeFiles()
      if (hasText) await parseTextInput(voiceUsed ? 'voice' : 'prompt')
    } finally {
      submittingRef.current = false
      setLoading(false)
      router.refresh()
    }
  }

  async function createFromIntakes(intakeIds: string[]): Promise<boolean> {
    const ids = intakeIds.filter(Boolean)
    if (!ids.length) return false
    const res = await fetch('/api/leads/bulk-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intakeIds: ids }),
    })
    if (!res.ok) {
      const data = await res.json() as { error?: string }
      setError(data.error ?? 'CRM 등록 실패')
      return false
    }
    return true
  }

  async function handleCreate() {
    if (!result || submittingRef.current) return
    submittingRef.current = true
    setCreating(true)
    const ok = await createFromIntakes([result.intakeId])
    setCreating(false); submittingRef.current = false
    if (ok) { resetAll(); setSavedMsg('거래처·담당자·영업기회가 CRM에 등록되었습니다'); router.refresh() }
  }

  async function handleFileCreate(item: FileItem) {
    if (!item.intakeId || submittingRef.current) return
    submittingRef.current = true
    setCreating(true)
    const ok = await createFromIntakes([item.intakeId])
    setCreating(false); submittingRef.current = false
    if (ok) { setFiles(prev => prev.filter(f => f.file !== item.file)); setSavedMsg(`${item.file.name} — CRM에 등록되었습니다`); router.refresh() }
  }

  function resetAll() {
    setResult(null); setRawInput(''); setFiles([]); setVoiceUsed(false); setError('')
  }

  function startVoiceInput() {
    const win = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
    const SpeechCtor = win.SpeechRecognition ?? win.webkitSpeechRecognition
    if (!SpeechCtor) {
      setVoiceSupported(false)
      setError('이 브라우저는 음성 인식을 지원하지 않습니다')
      return
    }
    const recognition = new SpeechCtor()
    recognition.lang = 'ko-KR'
    recognition.interimResults = false
    recognition.onstart = () => setListening(true)
    recognition.onend = () => setListening(false)
    recognition.onerror = () => { setListening(false); setError('음성 인식 중 오류가 발생했습니다') }
    recognition.onresult = (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      const text = Array.from(event.results).map((r) => r[0]?.transcript ?? '').join(' ').trim()
      if (text) { setRawInput((prev) => [prev, text].filter(Boolean).join('\n')); setVoiceUsed(true) }
    }
    recognition.start()
  }

  const processingFile = files.find(f => f.status === 'processing')
  const pendingTotal = files.filter(f => f.status === 'pending' || f.status === 'processing' || f.status === 'done').length
  const doneCount = files.filter(f => f.status === 'done').length
  const isFileProcessing = !!processingFile
  const pendingCount = files.filter(f => f.status === 'pending').length
  const hasText = rawInput.trim().length > 0
  const canAnalyze = hasText || pendingCount > 0
  const doneFiles = files.filter(f => f.status === 'done')

  // 대량 업로드(xlsx)는 별도 화면 점유
  if (bulkFile) {
    return (
      <div>
        <BulkImportProgress
          file={bulkFile}
          onComplete={() => { setBulkFile(null); router.refresh() }}
          onCancel={() => setBulkFile(null)}
        />
      </div>
    )
  }

  return (
    <div>
      <AXLoadingOverlay
        isLoading={loading || isFileProcessing}
        brandName={brandName}
        label={isFileProcessing ? `파일 분석 중… (${doneCount + 1} / ${pendingTotal})` : 'AI 분석 중…'}
        sublabel={isFileProcessing ? processingFile?.file.name : '입력 내용을 AI가 구조화하는 중'}
        ariaLabel={isFileProcessing ? `파일 분석 중 — ${processingFile?.file.name}` : 'AI 분석 중'}
      />

      {/* 통합 입력 영역 — 텍스트·붙여넣기·드래그&드롭·파일첨부·음성 한 곳 */}
      <form onSubmit={handleAnalyze}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleAnalyze() } }}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        {savedMsg && (
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '0.75rem', padding: '0.875rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1rem' }}>✅</span>
            <span style={{ color: '#0284c7', fontWeight: 600, fontSize: '0.875rem' }}>{savedMsg}</span>
          </div>
        )}
        <div>
          <label className="label">리드 정보 입력</label>
          <div className={`intake-unified${isDragging ? ' dropzone-active' : ''}`}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files) }}
            style={{ border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: '#fff' }}>
            <textarea value={rawInput} onChange={e => setRawInput(e.target.value)} onPaste={handlePaste} rows={6}
              placeholder={`텍스트를 입력·붙여넣거나, 명함·문서 파일을 끌어다 놓으세요.\n\n예시:\n삼성SDS 김철수 부장 (IT전략팀)\nkcs@samsung.com / 02-6360-0000\n클라우드 전환 프로젝트 논의 필요`}
              style={{ width: '100%', padding: '0.75rem', border: 'none', borderRadius: '0.5rem', fontSize: '0.875rem', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6, background: 'transparent', outline: 'none' }} />
          </div>
          {/* 파일 입력 — label 클릭이 브라우저 네이티브로 다이얼로그 오픈(JS .click() 미사용 → 환경 무관 보장) */}
          <input id="lead-file-input" type="file" multiple accept={ACCEPTED_TYPES} className="visually-hidden" disabled={loading} onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          <input id="lead-camera-input" type="file" accept="image/*" capture="environment" className="visually-hidden" disabled={loading} onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          {/* 입력 도구 — textarea 밖 별도 행(오버랩·오버레이 간섭 제거) */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            <label htmlFor="lead-file-input" className={`intake-tool-btn${loading ? ' intake-tool-label-disabled' : ''}`} aria-label="파일 첨부">📎 파일</label>
            <label htmlFor="lead-camera-input" className={`intake-tool-btn${loading ? ' intake-tool-label-disabled' : ''}`} aria-label="카메라로 찍기">📷 카메라</label>
            {voiceSupported && (
              <button type="button" className="intake-tool-btn" onClick={startVoiceInput} disabled={listening || loading} aria-label="음성 입력"
                style={listening ? { color: '#dc2626', borderColor: '#fecaca' } : undefined}>{listening ? '● 녹음중…' : '🎤 음성'}</button>
            )}
          </div>
          <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.375rem 0 0' }}>
            명함·미팅 메모·이메일 본문을 붙여넣거나, 이미지·PDF·DOCX·CSV를 첨부, 🎤로 받아쓰기 — XLSX는 대량 업로드로 처리됩니다
          </p>
        </div>

        {/* 첨부 파일 칩/상태 */}
        {files.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {files.map((item, idx) => (
              <div key={`${item.file.name}-${item.file.size}-${idx}`} className="file-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: item.status === 'done' ? '0.5rem' : 0 }}>
                    <span className="file-item-name">{item.file.name}</span>
                    {item.status === 'processing' && <span className="file-status-processing">분석중...</span>}
                    {item.status === 'done'       && <span className="file-status-done">완료</span>}
                    {item.status === 'error'      && <span className="file-status-error">오류</span>}
                  </div>
                  {item.status === 'done' && item.parsed && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <ParsedCard parsed={item.parsed} />
                      {item.intakeId && (
                        <button type="button" onClick={() => handleFileCreate(item)} disabled={creating} className="btn-primary"
                          style={{ padding: '0.5rem 1rem', minHeight: '40px', maxWidth: '220px' }}>
                          {creating ? '등록중...' : 'CRM 등록'}
                        </button>
                      )}
                    </div>
                  )}
                  {item.status === 'error' && <p style={{ fontSize: '0.8125rem', color: '#dc2626', margin: 0 }}>{item.error}</p>}
                </div>
                {item.status === 'pending' && (
                  <button type="button" className="file-remove-btn" onClick={() => setFiles(prev => prev.filter((_, i) => i !== idx))} aria-label="삭제">✕</button>
                )}
              </div>
            ))}
          </div>
        )}

        {error && <p style={{ color: '#dc2626', fontSize: '0.875rem', margin: 0 }}>{error}</p>}

        {/* 텍스트 분석 결과 — 저장 성공 시 resetAll로 사라지고 상단 완료 배너로 안내 */}
        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <ParsedCard parsed={result.parsed} />
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={handleCreate} disabled={creating} className="btn-primary" style={{ padding: '0.625rem 1.25rem', minHeight: '44px' }}>
                {creating ? '등록중...' : '거래처/담당자/영업기회 생성'}
              </button>
            </div>
          </div>
        )}

        {/* 통합 분석 버튼 + 초기화 */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="submit" disabled={loading || !canAnalyze} className="btn-primary"
            style={{ padding: '0.75rem 1.5rem', fontSize: '0.9375rem', minHeight: '48px' }}>
            {loading ? 'AI 분석중...' : 'AI 분석'}
            {!loading && pendingCount > 0 && <span style={{ fontSize: '0.75rem', opacity: 0.85, marginLeft: '0.375rem' }}>파일 {pendingCount}개{hasText ? ' + 텍스트' : ''}</span>}
            {!loading && pendingCount === 0 && <span style={{ fontSize: '0.7rem', opacity: 0.65, marginLeft: '0.375rem' }}>Ctrl+↵</span>}
          </button>
          {(result || doneFiles.length > 0 || rawInput || files.length > 0) && (
            <button type="button" onClick={resetAll}
              style={{ padding: '0.625rem 1.25rem', minHeight: '44px', background: 'none', border: '1px solid #e2e8f0', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', color: '#64748b' }}>
              초기화
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
