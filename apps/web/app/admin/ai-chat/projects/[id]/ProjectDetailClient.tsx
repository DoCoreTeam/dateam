'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Upload, Trash2, FileText, MessageSquarePlus, MessageSquare, Loader2 } from 'lucide-react'
import type { AiChatProject, AiChatProviderId } from '@/types/database'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { PROVIDER_LABELS } from '@/lib/ai-chat/labels'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import {
  updateProject,
  addKnowledgeText,
  listKnowledge,
  deleteKnowledgeSource,
  createConversation,
  setConversationProject,
} from '../../actions'

export interface ProjectConversation {
  id: string
  title: string
  provider: AiChatProviderId
  model: string
  updated_at: string
}

interface KnowledgeItem {
  source: string
  chunks: number
  createdAt: string
}

interface Props {
  project: AiChatProject
  initialKnowledge: KnowledgeItem[]
  conversations: ProjectConversation[]
  defaultProvider: { id: AiChatProviderId; model: string } | null
}


const INSTRUCTIONS_MAX = 4000
const KNOWLEDGE_ACCEPT = '.txt,.md,.csv,.docx,.xlsx,.pptx,.pdf,text/plain,text/markdown,text/csv'

export default function ProjectDetailClient({ project, initialKnowledge, conversations, defaultProvider }: Props) {
  const router = useRouter()
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>(initialKnowledge)

  async function reloadKnowledge() {
    const r = await listKnowledge(project.id)
    if (r.ok && r.items) setKnowledge(r.items)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* 헤더 */}
      <div>
        <Link
          href="/ai-chat/projects"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', textDecoration: 'none', marginBottom: 'var(--space-2)' }}
        >
          <ArrowLeft size={14} />
          프로젝트 목록
        </Link>
        <h1 style={{ margin: 0, fontSize: 'var(--fs-2xl)', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' }}>
          {project.name}
        </h1>
        <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          수정 {formatKstDateTimeShort(project.updated_at)}
        </p>
      </div>

      <InstructionsEditor project={project} />

      <AddKnowledge project={project} onChanged={reloadKnowledge} />

      <KnowledgeList project={project} knowledge={knowledge} onChanged={reloadKnowledge} />

      <ConversationsSection
        conversations={conversations}
        defaultProvider={defaultProvider}
        onNewConversation={async () => {
          if (!defaultProvider) return null
          const c = await createConversation({ provider: defaultProvider.id, model: defaultProvider.model })
          if (!c.ok || !c.id) return { error: c.error ?? '대화 생성에 실패했습니다' }
          const link = await setConversationProject(c.id, project.id)
          if (!link.ok) return { error: link.error ?? '프로젝트 연결에 실패했습니다' }
          router.push(`/ai-chat?c=${c.id}`)
          return null
        }}
      />
    </div>
  )
}

// ── 지시문 편집 ──
function InstructionsEditor({ project }: { project: AiChatProject }) {
  const [value, setValue] = useState(project.instructions ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  async function save() {
    setBusy(true)
    setMsg(null)
    const r = await updateProject(project.id, { instructions: value })
    setBusy(false)
    setMsg(r.ok ? { tone: 'ok', text: '저장되었습니다' } : { tone: 'err', text: r.error ?? '저장 실패' })
  }

  return (
    <section className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)', gap: 'var(--space-3)' }}>
        <span className="tape-title">지시문</span>
        {msg && (
          <span role="status" style={{ fontSize: 'var(--fs-xs)', color: msg.tone === 'ok' ? 'var(--success)' : 'var(--danger)' }}>
            {msg.text}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <label className="label" htmlFor="instructions">이 프로젝트 대화에 공통 주입되는 지시</label>
        <textarea className="input-field" id="instructions"
          value={value}
          maxLength={INSTRUCTIONS_MAX}
          onChange={(e) => setValue(e.target.value)}
          rows={5}
          placeholder="예: 답변은 한국어로, 근거가 된 지식의 출처를 함께 밝혀라."
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', textAlign: 'right' }}>
          {value.length}/{INSTRUCTIONS_MAX}
        </span>
      </div>
      <div style={{ marginTop: 'var(--space-3)', display: 'flex', justifyContent: 'flex-end' }}>
        <NbButton onClick={save} disabled={busy}>{busy ? '저장중…' : '지시문 저장'}</NbButton>
      </div>
    </section>
  )
}

// ── 지식 추가 (텍스트 붙여넣기 + 파일 업로드) ──
function AddKnowledge({ project, onChanged }: { project: AiChatProject; onChanged: () => Promise<void> }) {
  const [source, setSource] = useState('')
  const [text, setText] = useState('')
  const [textBusy, setTextBusy] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [result, setResult] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function addText() {
    if (!text.trim()) {
      setResult({ tone: 'err', text: '내용을 입력하세요' })
      return
    }
    setTextBusy(true)
    setResult(null)
    const r = await addKnowledgeText(project.id, text, source.trim() || 'manual')
    setTextBusy(false)
    if (!r.ok) {
      setResult({ tone: 'err', text: r.error ?? '추가 실패' })
      return
    }
    setResult({ tone: 'ok', text: `추가됨 · ${r.chunks ?? 0}청크 중 ${r.embedded ?? 0}개 임베딩` })
    setText('')
    setSource('')
    await onChanged()
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadBusy(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('projectId', project.id)
      const res = await fetch('/api/admin/ai-chat/knowledge-upload', { method: 'POST', body: fd })
      const d = (await res.json()) as { ok: boolean; chunks?: number; embedded?: number; error?: string }
      if (!res.ok || !d.ok) {
        setResult({ tone: 'err', text: d.error ?? '업로드 실패' })
      } else {
        setResult({ tone: 'ok', text: `${file.name} · ${d.chunks ?? 0}청크 중 ${d.embedded ?? 0}개 임베딩` })
        await onChanged()
      }
    } catch {
      setResult({ tone: 'err', text: '업로드 중 오류가 발생했습니다' })
    } finally {
      setUploadBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <section className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <span className="tape-title">지식 추가</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginBottom: 'var(--space-3)' }}>
        <label className="label" htmlFor="knowledge-source">출처 이름 (선택)</label>
        <input className="input-field" id="knowledge-source"
          value={source}
          maxLength={200}
          onChange={(e) => setSource(e.target.value)}
          placeholder="예: 제품_FAQ (미입력 시 manual)"
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <label className="label" htmlFor="knowledge-text">텍스트 붙여넣기</label>
        <textarea className="input-field" id="knowledge-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="지식으로 등록할 내용을 붙여넣으세요. 자동으로 청크·임베딩됩니다."
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <NbButton onClick={addText} disabled={textBusy || uploadBusy}>
          {textBusy ? '추가중…' : '텍스트 추가'}
        </NbButton>

        <input className="input-field" ref={fileRef} type="file"
          accept={KNOWLEDGE_ACCEPT}
          aria-label="지식 파일 선택"
          onChange={onFilePicked}
          style={{ display: 'none' }}
        />
        <NbButton
          variant="secondary"
          onClick={() => fileRef.current?.click()}
          disabled={uploadBusy || textBusy}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
        >
          {uploadBusy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={14} />}
          {uploadBusy ? '업로드중…' : '파일 업로드'}
        </NbButton>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>
          txt·md·csv(1MB), docx·xlsx·pptx·pdf(10MB)
        </span>
      </div>

      {result && (
        <p role="status" style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--fs-sm)', color: result.tone === 'ok' ? 'var(--success)' : 'var(--danger)' }}>
          {result.text}
        </p>
      )}
    </section>
  )
}

// ── 지식 목록 (source 그룹) ──
function KnowledgeList({ project, knowledge, onChanged }: { project: AiChatProject; knowledge: KnowledgeItem[]; onChanged: () => Promise<void> }) {
  return (
    <section className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)', gap: 'var(--space-3)' }}>
        <span className="tape-title">지식 목록</span>
        <NbBadge>{knowledge.length}개 출처</NbBadge>
      </div>

      {knowledge.length === 0 ? (
        <div style={{ padding: 'var(--space-6) var(--space-2)', textAlign: 'center' }}>
          <FileText size={26} color="var(--text-faint)" style={{ margin: '0 auto var(--space-2)' }} />
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            등록된 지식이 없습니다. 위에서 텍스트나 파일을 추가하세요.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {knowledge.map((k) => (
            <KnowledgeRow key={k.source} projectId={project.id} item={k} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  )
}

function KnowledgeRow({ projectId, item, onChanged }: { projectId: string; item: KnowledgeItem; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function doDelete() {
    setBusy(true)
    setError(null)
    const r = await deleteKnowledgeSource(projectId, item.source)
    setBusy(false)
    if (!r.ok) {
      setError(r.error ?? '삭제 실패')
      return
    }
    await onChanged()
  }

  return (
    <li style={{ border: 'var(--hairline) solid var(--border-color)', borderRadius: 'var(--radius)', padding: 'var(--space-3) var(--space-4)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <FileText size={16} color="var(--text-faint)" style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.source}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexShrink: 0 }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{item.chunks}청크</span>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{formatKstDateTimeShort(item.createdAt)}</span>
        {confirming ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <button type="button" className="ai-chat-copy-btn" onClick={doDelete} disabled={busy} style={{ color: 'var(--danger)', fontWeight: 700 }}>
              {busy ? '삭제중…' : '삭제 확인'}
            </button>
            <button type="button" className="ai-chat-copy-btn" onClick={() => { setConfirming(false); setError(null) }} disabled={busy}>
              취소
            </button>
          </span>
        ) : (
          <button type="button" className="ai-chat-icon-btn" data-danger="true" onClick={() => setConfirming(true)} aria-label={`${item.source} 지식 삭제`}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {error && <span role="alert" style={{ width: '100%', fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}>{error}</span>}
    </li>
  )
}

// ── 이 프로젝트의 대화 ──
function ConversationsSection({
  conversations,
  defaultProvider,
  onNewConversation,
}: {
  conversations: ProjectConversation[]
  defaultProvider: { id: AiChatProviderId; model: string } | null
  onNewConversation: () => Promise<{ error: string } | null>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    const res = await onNewConversation()
    if (res?.error) {
      setError(res.error)
      setBusy(false)
    }
    // 성공 시 라우팅되므로 busy 유지(언마운트)
  }

  return (
    <section className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <span className="tape-title">대화</span>
        <NbButton
          onClick={start}
          disabled={busy || !defaultProvider}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
        >
          <MessageSquarePlus size={16} />
          {busy ? '생성중…' : '이 프로젝트에서 새 대화'}
        </NbButton>
      </div>

      {!defaultProvider && (
        <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          사용 가능한 AI 프로바이더가 없습니다. 설정에서 API 키를 등록하세요.
        </p>
      )}
      {error && <p role="alert" style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{error}</p>}

      {conversations.length === 0 ? (
        <div style={{ padding: 'var(--space-6) var(--space-2)', textAlign: 'center' }}>
          <MessageSquare size={26} color="var(--text-faint)" style={{ margin: '0 auto var(--space-2)' }} />
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            이 프로젝트에 연결된 대화가 없습니다.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={`/ai-chat?c=${c.id}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', border: 'var(--hairline) solid var(--border-color)', borderRadius: 'var(--radius)', padding: 'var(--space-3) var(--space-4)', textDecoration: 'none' }}
              >
                <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <MessageSquare size={15} color="var(--text-faint)" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.title}
                  </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                  <NbBadge>{PROVIDER_LABELS[c.provider]}</NbBadge>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{formatKstDateTimeShort(c.updated_at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
