'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ParsedLeadData } from '@/lib/gemini-lead'
import ParsedCard from './ParsedCard'

type Tab = 'prompt' | 'file'

type FileItem = {
  file: File
  status: 'pending' | 'processing' | 'done' | 'error'
  parsed?: ParsedLeadData
  error?: string
}

const MAX_FILE_BYTES = 20 * 1024 * 1024 // 20MB — Gemini Vision inline 한도

const ACCEPTED_TYPES = [
  'image/jpeg,image/png,image/webp,image/gif,image/bmp',
  'image/tiff,image/heic,image/heif,image/avif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/plain,text/csv',
].join(',')

export default function LeadIntakeForm() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('prompt')

  const [rawInput, setRawInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ parsed: ParsedLeadData; intakeId: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(false)

  const [files, setFiles] = useState<FileItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  function addFiles(incoming: FileList | null) {
    if (!incoming) return
    const next: FileItem[] = []
    for (const file of Array.from(incoming)) {
      if (file.size === 0) { setError(`${file.name}: 빈 파일입니다`); continue }
      if (file.size > MAX_FILE_BYTES) { setError(`${file.name}: 파일이 너무 큽니다 (최대 20MB)`); continue }
      next.push({ file, status: 'pending' })
    }
    setFiles(prev => [...prev, ...next])
  }

  async function handleTextSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!rawInput.trim()) { setError('내용을 입력하세요'); return }
    setLoading(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/leads/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_input: rawInput, source: 'prompt' }),
      })
      const data = await res.json() as { parsed?: ParsedLeadData; intake?: { id: string }; error?: string }
      if (!res.ok) { setError(data.error ?? '오류가 발생했습니다'); return }
      setResult({ parsed: data.parsed!, intakeId: data.intake?.id ?? '' })
    } finally {
      setLoading(false)
    }
  }

  async function handleFileAnalyze() {
    const pending = files.filter(f => f.status === 'pending')
    if (!pending.length) { setError('분석할 파일을 선택하세요'); return }
    setError('')
    for (const item of pending) {
      setFiles(prev => prev.map(f => f.file === item.file ? { ...f, status: 'processing' } : f))
      try {
        const fd = new FormData()
        fd.append('file', item.file)
        fd.append('source', 'file')
        const res = await fetch('/api/leads/parse', { method: 'POST', body: fd })
        const data = await res.json() as { parsed?: ParsedLeadData; intake?: { id: string }; error?: string }
        if (!res.ok) throw new Error(data.error ?? '오류가 발생했습니다')
        setFiles(prev => prev.map(f => f.file === item.file ? { ...f, status: 'done', parsed: data.parsed } : f))
      } catch (err) {
        const msg = err instanceof Error ? err.message : '오류가 발생했습니다'
        setFiles(prev => prev.map(f => f.file === item.file ? { ...f, status: 'error', error: msg } : f))
      }
    }
    router.refresh()
  }

  async function handleCreate() {
    if (!result) return
    setCreating(true)
    const { parsed } = result
    if (parsed.company_name) {
      const accRes = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: parsed.company_name, industry: parsed.industry, segment: parsed.segment,
          size: parsed.size, region: parsed.region, website: parsed.website,
          phone: parsed.company_phone, address: parsed.address,
          fit_score: parsed.fit_score, tags: parsed.tags ?? [],
        }),
      })
      const accData = await accRes.json() as { id?: string }
      if (parsed.contact_name && accData.id) {
        await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: accData.id, name: parsed.contact_name, title: parsed.contact_title,
            department: parsed.contact_department, email: parsed.contact_email,
            phone: parsed.contact_phone, mobile: parsed.contact_mobile,
          }),
        })
      }
      if (accData.id) {
        await fetch('/api/deals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: accData.id,
            title: parsed.deal_title ?? `${parsed.company_name} 신규 협력`,
            description: parsed.deal_description, next_action: parsed.next_action, stage: '신규',
          }),
        })
      }
    }
    setCreated(true); setCreating(false); router.refresh()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button className={`tab-btn${tab === 'prompt' ? ' tab-btn-active' : ''}`}
          onClick={() => { setTab('prompt'); setError('') }}>텍스트 입력</button>
        <button className={`tab-btn${tab === 'file' ? ' tab-btn-active' : ''}`}
          onClick={() => { setTab('file'); setError('') }}>명함/문서</button>
      </div>

      {/* 텍스트 탭 */}
      {tab === 'prompt' && !result && (
        <form
          onSubmit={handleTextSubmit}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.requestSubmit() } }}
          style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          <div>
            <label className="label">리드 정보 입력</label>
            <textarea value={rawInput} onChange={e => setRawInput(e.target.value)} rows={6}
              placeholder={`예시:\n삼성SDS 김철수 부장 (IT전략팀)\nkcs@samsung.com / 02-6360-0000\n클라우드 전환 프로젝트 논의 필요\n내주 화요일 킥오프 미팅 예정`}
              style={{ width: '100%', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', fontSize: '0.875rem', resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6 }} />
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.375rem 0 0' }}>
              명함 정보, 미팅 메모, 이메일 본문 등 자유롭게 붙여넣기하세요
            </p>
          </div>
          {error && <p style={{ color: '#dc2626', fontSize: '0.875rem', margin: 0 }}>{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary"
            style={{ padding: '0.75rem 1.5rem', fontSize: '0.9375rem', minHeight: '48px', maxWidth: '200px' }}>
            {loading ? 'AI 분석중...' : 'AI 분석'}{!loading && <span style={{ fontSize: '0.7rem', opacity: 0.65, marginLeft: '0.375rem' }}>Ctrl+↵</span>}
          </button>
        </form>
      )}

      {tab === 'prompt' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <ParsedCard parsed={result.parsed} />
          {created ? (
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '0.75rem', padding: '1rem', textAlign: 'center' }}>
              <p style={{ color: '#0284c7', fontWeight: 600, margin: 0 }}>거래처·담당자·영업기회가 CRM에 등록되었습니다</p>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button onClick={handleCreate} disabled={creating} className="btn-primary"
                style={{ padding: '0.625rem 1.25rem', minHeight: '44px' }}>
                {creating ? '등록중...' : '거래처/담당자/영업기회 생성'}
              </button>
              <button onClick={() => { setResult(null); setRawInput('') }}
                style={{ padding: '0.625rem 1.25rem', minHeight: '44px', background: 'none', border: '1px solid #e2e8f0', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', color: '#64748b' }}>
                다시 입력
              </button>
            </div>
          )}
        </div>
      )}

      {/* 파일 탭 */}
      {tab === 'file' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className={`dropzone${isDragging ? ' dropzone-active' : ''}`}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files) }}
            onClick={() => fileInputRef.current?.click()}>
            <div className="dropzone-icon">↑</div>
            <p className="dropzone-title">파일을 드래그하거나 클릭하여 선택</p>
            <p className="dropzone-hint">이미지(JPG·PNG·WEBP·HEIC·TIFF·BMP·AVIF·GIF) · PDF · DOCX · XLSX · CSV · TXT</p>
          </div>

          <input ref={fileInputRef} type="file" multiple accept={ACCEPTED_TYPES} style={{ display: 'none' }}
            onChange={e => addFiles(e.target.files)} />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={e => addFiles(e.target.files)} />

          <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap' }}>
            <button className="intake-action-btn" onClick={() => fileInputRef.current?.click()}>파일 선택</button>
            <button className="intake-action-btn" onClick={() => cameraInputRef.current?.click()}>카메라로 찍기</button>
          </div>

          {files.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {files.map((item, idx) => (
                <div key={`${item.file.name}-${item.file.size}-${idx}`} className="file-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: item.status !== 'pending' ? '0.5rem' : 0 }}>
                      <span className="file-item-name">{item.file.name}</span>
                      {item.status === 'processing' && <span className="file-status-processing">분석중...</span>}
                      {item.status === 'done'       && <span className="file-status-done">완료</span>}
                      {item.status === 'error'      && <span className="file-status-error">오류</span>}
                    </div>
                    {item.status === 'done'  && item.parsed && <ParsedCard parsed={item.parsed} />}
                    {item.status === 'error' && <p style={{ fontSize: '0.8125rem', color: '#dc2626', margin: 0 }}>{item.error}</p>}
                  </div>
                  {item.status === 'pending' && (
                    <button className="file-remove-btn" onClick={() => setFiles(prev => prev.filter((_, i) => i !== idx))} aria-label="삭제">✕</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {error && <p style={{ color: '#dc2626', fontSize: '0.875rem', margin: 0 }}>{error}</p>}

          {files.some(f => f.status === 'pending') && (
            <button onClick={handleFileAnalyze} className="btn-primary"
              style={{ padding: '0.75rem 1.5rem', fontSize: '0.9375rem', minHeight: '48px', maxWidth: '220px' }}>
              AI 분석 ({files.filter(f => f.status === 'pending').length}개)
            </button>
          )}
        </div>
      )}
    </div>
  )
}
