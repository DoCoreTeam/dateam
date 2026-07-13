'use client'

import { useState, useRef, useEffect } from 'react'
import { Plus, Pin, PinOff, Pencil, Trash2, Check, X, RotateCcw } from 'lucide-react'
import type { AiChatConversation } from '@/types/database'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { PROVIDER_LABELS } from './AiChatClient'

interface ConversationSidebarProps {
  conversations: AiChatConversation[]
  selectedId: string | null
  canCreate: boolean
  hasMore: boolean
  loadingMore: boolean
  recentlyDeleted: { id: string; title: string } | null
  onSelect: (id: string) => void
  onNewChat: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onTogglePin: (id: string) => void
  onLoadMore: () => void
}

export default function ConversationSidebar({
  conversations,
  selectedId,
  canCreate,
  hasMore,
  loadingMore,
  recentlyDeleted,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  onRestore,
  onTogglePin,
  onLoadMore,
}: ConversationSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const editRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) editRef.current?.focus()
  }, [editingId])

  function startEdit(c: AiChatConversation) {
    setEditingId(c.id)
    setDraftTitle(c.title)
  }

  function commitEdit() {
    if (editingId) {
      const t = draftTitle.trim()
      if (t.length >= 1 && t.length <= 100) onRename(editingId, t)
    }
    setEditingId(null)
    setDraftTitle('')
  }

  function cancelEdit() {
    setEditingId(null)
    setDraftTitle('')
  }

  return (
    <>
      {/* 새 대화 */}
      <div className="ai-chat-sidebar-head">
        <button
          type="button"
          className="btn-primary"
          onClick={onNewChat}
          disabled={!canCreate}
          style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-1)', minHeight: 44 }}
        >
          <Plus size={16} />
          새 대화
        </button>
        {!canCreate && (
          <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', margin: 'var(--space-2) 0 0' }}>
            설정에서 API 키를 등록하면 대화를 시작할 수 있습니다.
          </p>
        )}
      </div>

      {/* 되돌리기 배너 */}
      {recentlyDeleted && (
        <div style={{ padding: 'var(--space-2) var(--space-3)' }}>
          <div className="ai-chat-banner" data-tone="neutral" role="status">
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              삭제됨 · {recentlyDeleted.title}
            </span>
            <button
              type="button"
              className="ai-chat-copy-btn"
              onClick={() => onRestore(recentlyDeleted.id)}
              style={{ color: 'var(--brand)', fontWeight: 700, flexShrink: 0 }}
            >
              <RotateCcw size={12} />
              되돌리기
            </button>
          </div>
        </div>
      )}

      {/* 목록 */}
      <div className="ai-chat-scroll">
        {conversations.length === 0 ? (
          <div className="ai-chat-state" style={{ padding: 'var(--space-5)' }}>
            <p style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>대화가 없습니다.</p>
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', margin: 0 }}>새 대화를 시작하세요.</p>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 'var(--space-2) 0', display: 'flex', flexDirection: 'column' }}>
            {conversations.map((c) => {
              const active = c.id === selectedId
              const isEditing = editingId === c.id
              return (
                <li key={c.id}>
                  {isEditing ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', padding: 'var(--space-1) var(--space-2)' }}>
                      <input className="input-field"
                        ref={editRef}
                        value={draftTitle}
                        maxLength={100}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
                          if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
                        }}
                        style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', padding: 'var(--space-1) var(--space-2)' }}
                        aria-label="대화 제목 수정"
                      />
                      <button type="button" className="ai-chat-icon-btn" onClick={commitEdit} aria-label="저장">
                        <Check size={14} />
                      </button>
                      <button type="button" className="ai-chat-icon-btn" onClick={cancelEdit} aria-label="취소">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div
                      className="ai-chat-conv"
                      data-active={active}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c.id) }
                      }}
                      aria-current={active}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                          {c.pinned && <Pin size={12} color="var(--brand)" fill="var(--brand)" style={{ flexShrink: 0 }} />}
                          <span className="ai-chat-conv-title">{c.title}</span>
                        </div>
                        <div style={{ marginTop: 'var(--space-1)' }}>
                          <NbBadge>{PROVIDER_LABELS[c.provider]}</NbBadge>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="ai-chat-icon-btn"
                          data-active={c.pinned}
                          onClick={() => onTogglePin(c.id)}
                          aria-label={c.pinned ? '고정 해제' : '고정'}
                        >
                          {c.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                        </button>
                        <button type="button" className="ai-chat-icon-btn" onClick={() => startEdit(c)} aria-label="이름 변경">
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="ai-chat-icon-btn"
                          data-danger="true"
                          onClick={() => onDelete(c.id)}
                          aria-label="삭제"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {hasMore && (
          <div style={{ padding: 'var(--space-2) var(--space-3) var(--space-4)' }}>
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              style={{
                width: '100%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-1)',
                minHeight: 40,
                padding: 'var(--space-2)',
                border: 'var(--border-w-2) solid var(--border-color)',
                borderRadius: 'var(--radius)',
                background: 'var(--surface-bg)',
                color: 'var(--text)',
                fontSize: 'var(--fs-sm)',
                fontWeight: 600,
                cursor: loadingMore ? 'default' : 'pointer',
              }}
            >
              {loadingMore ? <AXDotLoader size={4} color="var(--text-muted)" /> : null}
              더 보기
            </button>
          </div>
        )}
      </div>
    </>
  )
}
