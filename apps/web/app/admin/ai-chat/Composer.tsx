'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Send, Square, Paperclip, FileText, X, Globe } from 'lucide-react'
import type { AiChatProviderId } from '@/types/database'
import type { ProviderView } from './AiChatClient'
import {
  ATTACHMENT_RULES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  kindOfMime,
  maxBytesForMime,
} from '@/lib/ai-chat/attachments'
import AXDotLoader from '@/components/ui/AXDotLoader'

const MAX_LEN = 32000
// ACCEPT는 ATTACHMENT_RULES(SSOT)에서 파생 — 화이트리스트 이중정의 금지
const ACCEPT = Array.from(
  new Set(Object.values(ATTACHMENT_RULES).flatMap((r) => [...r.mimes])),
).join(',')
const VISION_UNSUPPORTED_MSG = '이 프로바이더는 파일 첨부를 지원하지 않습니다'
const TOOLS_UNSUPPORTED_MSG = '이 프로바이더는 웹 검색을 지원하지 않습니다'

type AttachKind = 'image' | 'pdf' | 'document'

interface PendingAttachment {
  id: string // 업로드 완료 전 임시 = `tmp-…`, 완료 후 서버 id
  filename: string
  mime: string
  kind: AttachKind
  sizeBytes: number
  signedUrl: string | null
  status: 'uploading' | 'ready' | 'error'
  errorMsg?: string
}

interface ComposerProps {
  streaming: boolean
  conversationId: string | null
  visionSupported: boolean
  currentProvider: AiChatProviderId | null
  currentModel: string | null
  providers: ProviderView[]
  onSend: (content: string, attachmentIds: string[]) => void
  onStop: () => void
  onChangeModel: (provider: AiChatProviderId, model: string) => void
  /** 첨부는 대화 존재를 전제 — 없으면 지연 생성 후 id 반환(실패 시 null) */
  ensureConversation: () => Promise<string | null>
  /** S3 §4-3 — 웹 검색 토글(요청 단위). capabilities.tools=false면 비활성. */
  toolsSupported: boolean
  webSearch: boolean
  onToggleWebSearch: () => void
  /** S3 §5-5 — 과거 분기 열람 중이면 입력·전송 잠금(배너는 허브). */
  locked?: boolean
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function Composer({
  streaming,
  conversationId,
  visionSupported,
  currentProvider,
  currentModel,
  providers,
  onSend,
  onStop,
  onChangeModel,
  ensureConversation,
  toolsSupported,
  webSearch,
  onToggleWebSearch,
  locked = false,
}: ComposerProps) {
  const [value, setValue] = useState('')
  const [pending, setPending] = useState<PendingAttachment[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const noProviders = providers.length === 0
  const uploadingCount = pending.filter((p) => p.status === 'uploading').length
  const readyCount = pending.filter((p) => p.status === 'ready').length
  const attachDisabled = noProviders || streaming || !visionSupported || locked
  const webSearchDisabled = noProviders || streaming || !toolsSupported || locked

  const showNotice = useCallback((msg: string) => {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 3200)
  }, [])

  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])

  const autoGrow = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => { autoGrow() }, [value, autoGrow])

  const uploadOne = useCallback(
    async (file: File, convId: string) => {
      const kind = kindOfMime(file.type)
      const tmpId = `tmp-${crypto.randomUUID()}`
      if (!kind) {
        setPending((prev) => [
          ...prev,
          { id: tmpId, filename: file.name, mime: file.type, kind: 'document', sizeBytes: file.size, signedUrl: null, status: 'error', errorMsg: '지원하지 않는 형식' },
        ])
        return
      }
      if (file.size > maxBytesForMime(file.type)) {
        const mb = Math.floor(maxBytesForMime(file.type) / (1024 * 1024))
        setPending((prev) => [
          ...prev,
          { id: tmpId, filename: file.name, mime: file.type, kind, sizeBytes: file.size, signedUrl: null, status: 'error', errorMsg: `${mb}MB 초과` },
        ])
        return
      }

      setPending((prev) => [
        ...prev,
        { id: tmpId, filename: file.name, mime: file.type, kind, sizeBytes: file.size, signedUrl: null, status: 'uploading' },
      ])

      try {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('conversationId', convId)
        const res = await fetch('/api/admin/ai-chat/upload', { method: 'POST', body: fd })
        const json = (await res.json().catch(() => ({}))) as {
          attachment?: { id: string; filename: string; mime: string; sizeBytes: number; kind: AttachKind; signedUrl: string }
          error?: string
        }
        if (!res.ok || !json.attachment) {
          setPending((prev) => prev.map((p) => (p.id === tmpId ? { ...p, status: 'error', errorMsg: json.error ?? '업로드 실패' } : p)))
          return
        }
        const a = json.attachment
        setPending((prev) =>
          prev.map((p) =>
            p.id === tmpId
              ? { id: a.id, filename: a.filename, mime: a.mime, kind: a.kind, sizeBytes: a.sizeBytes, signedUrl: a.signedUrl, status: 'ready' }
              : p,
          ),
        )
      } catch {
        setPending((prev) => prev.map((p) => (p.id === tmpId ? { ...p, status: 'error', errorMsg: '업로드 실패' } : p)))
      }
    },
    [],
  )

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!visionSupported) {
        showNotice(VISION_UNSUPPORTED_MSG)
        return
      }
      if (files.length === 0) return
      const room = MAX_ATTACHMENTS_PER_MESSAGE - pending.length
      if (room <= 0) {
        showNotice(`메시지당 첨부는 최대 ${MAX_ATTACHMENTS_PER_MESSAGE}개입니다`)
        return
      }
      const accepted = files.slice(0, room)
      if (files.length > room) {
        showNotice(`메시지당 첨부는 최대 ${MAX_ATTACHMENTS_PER_MESSAGE}개입니다`)
      }
      let convId = conversationId
      if (!convId) convId = await ensureConversation()
      if (!convId) {
        showNotice('대화를 준비하지 못해 첨부할 수 없습니다')
        return
      }
      for (const file of accepted) void uploadOne(file, convId)
    },
    [visionSupported, pending.length, conversationId, ensureConversation, uploadOne, showNotice],
  )

  async function removeChip(att: PendingAttachment) {
    if (att.status === 'ready') {
      try {
        await fetch('/api/admin/ai-chat/upload', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attachmentId: att.id }),
        })
      } catch {
        /* best-effort — 목록에서는 제거 */
      }
    }
    setPending((prev) => prev.filter((p) => p.id !== att.id))
  }

  function submit() {
    const trimmed = value.trim()
    const ready = pending.filter((p) => p.status === 'ready')
    if (uploadingCount > 0 || streaming || noProviders || locked) return
    if (!trimmed && ready.length === 0) return
    onSend(trimmed.slice(0, MAX_LEN), ready.map((p) => p.id))
    setValue('')
    setPending([])
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) el.style.height = 'auto'
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files)
    if (files.length === 0) return
    e.preventDefault()
    if (!visionSupported) {
      showNotice(VISION_UNSUPPORTED_MSG)
      return
    }
    void handleFiles(files)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    if (!visionSupported) {
      showNotice(VISION_UNSUPPORTED_MSG)
      return
    }
    void handleFiles(files)
  }

  function handleModelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const p = providers.find((pv) => pv.id === e.target.value)
    if (p) onChangeModel(p.id, p.model)
  }

  const sendDisabled = (!value.trim() && readyCount === 0) || noProviders || uploadingCount > 0 || locked

  return (
    <div className="ai-chat-composer">
      <div
        className="ai-chat-composer-wrap"
        data-dragover={isDragOver}
        onDragOver={(e) => { if (visionSupported) { e.preventDefault(); setIsDragOver(true) } }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        {notice && (
          <div className="ai-chat-composer-notice" role="status" aria-live="polite">
            {notice}
          </div>
        )}

        {pending.length > 0 && (
          <div className="ai-chat-attach-chips">
            {pending.map((p) => (
              <div key={p.id} className="ai-chat-chip" data-status={p.status}>
                {p.kind === 'image' ? (
                  <span className="ai-chat-chip-thumb-wrap">
                    {p.signedUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="ai-chat-chip-thumb" src={p.signedUrl} alt={p.filename} />
                    ) : (
                      <FileText size={16} />
                    )}
                    {p.status === 'uploading' && (
                      <span className="ai-chat-chip-overlay">
                        <AXDotLoader size={4} color="#fff" />
                      </span>
                    )}
                  </span>
                ) : (
                  <FileText size={14} />
                )}
                {p.kind !== 'image' && <span className="ai-chat-chip-name">{p.filename}</span>}
                {p.status === 'error' ? (
                  <span className="ai-chat-chip-size">{p.errorMsg ?? '오류'}</span>
                ) : (
                  <span className="ai-chat-chip-size">{formatBytes(p.sizeBytes)}</span>
                )}
                <button
                  type="button"
                  className="ai-chat-chip-remove"
                  onClick={() => removeChip(p)}
                  aria-label={`${p.filename} 첨부 제거`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="ai-chat-composer-row">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              void handleFiles(files)
            }}
            aria-hidden="true"
            tabIndex={-1}
          />
          <button
            type="button"
            className="ai-chat-attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={attachDisabled}
            title={visionSupported ? '파일 첨부' : VISION_UNSUPPORTED_MSG}
            aria-label="파일 첨부"
          >
            <Paperclip size={18} />
          </button>

          <button
            type="button"
            className="ai-chat-attach-btn"
            data-active={webSearch && toolsSupported}
            onClick={onToggleWebSearch}
            disabled={webSearchDisabled}
            title={toolsSupported ? (webSearch ? '웹 검색 켜짐' : '웹 검색') : TOOLS_UNSUPPORTED_MSG}
            aria-label="웹 검색 토글"
            aria-pressed={webSearch && toolsSupported}
          >
            <Globe size={18} />
          </button>

          <textarea
            className="input-field ai-chat-textarea"
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              locked
                ? '과거 분기 열람 중 — 최신 분기로 돌아가면 이어쓸 수 있습니다'
                : noProviders
                  ? '설정에서 API 키를 먼저 등록하세요'
                  : '메시지를 입력하세요  (Enter 전송 · Shift+Enter 줄바꿈)'
            }
            rows={1}
            disabled={noProviders || locked}
            aria-label="메시지 입력"
          />

          {streaming ? (
            <button type="button" className="ai-chat-send" data-variant="stop" onClick={onStop} aria-label="생성 중단">
              <Square size={16} />
              중단
            </button>
          ) : (
            <button
              type="button"
              className="ai-chat-send"
              onClick={submit}
              disabled={sendDisabled}
              aria-label="전송"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <label className="label" htmlFor="ai-chat-model" style={{ margin: 0, fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>
          모델
        </label>
        <select id="ai-chat-model" className="input-field"
          value={currentProvider ?? ''}
          onChange={handleModelChange}
          disabled={noProviders}
          style={{ width: 'auto', maxWidth: '100%', fontSize: 'var(--fs-xs)', padding: 'var(--space-1) var(--space-2)' }}
          aria-label="프로바이더 및 모델 선택"
        >
          {noProviders && <option value="">사용 가능한 프로바이더 없음</option>}
          {currentProvider && !providers.some((p) => p.id === currentProvider) && (
            <option value={currentProvider}>
              {currentProvider} · {currentModel}
            </option>
          )}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {p.model}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
