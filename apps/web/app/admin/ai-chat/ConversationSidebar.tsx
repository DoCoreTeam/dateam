'use client'

import { useState, useRef, useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import { Plus, Pin, PinOff, Pencil, Trash2, Check, X, RotateCcw, Search, FolderKanban } from 'lucide-react'
import type { AiChatConversation, AiChatProject } from '@/types/database'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { PROVIDER_LABELS } from '@/lib/ai-chat/labels'
import { searchConversations } from './actions'

interface SearchResult {
  id: string
  title: string
  pinned: boolean
  updated_at: string
  snippet: string | null
}

interface ConversationSidebarProps {
  conversations: AiChatConversation[]
  projects: AiChatProject[]
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

/** 검색어와 일치하는 부분을 굵게 강조 (토큰 색상 준수 — mark 미사용). */
function highlight(text: string, q: string): ReactNode {
  const query = q.trim()
  if (!query) return text
  const lower = text.toLowerCase()
  const ql = query.toLowerCase()
  const nodes: ReactNode[] = []
  let i = 0
  let key = 0
  while (i <= text.length) {
    const idx = lower.indexOf(ql, i)
    if (idx < 0) {
      nodes.push(text.slice(i))
      break
    }
    if (idx > i) nodes.push(text.slice(i, idx))
    nodes.push(
      <strong className="ai-chat-hl" key={key++}>
        {text.slice(idx, idx + query.length)}
      </strong>,
    )
    i = idx + query.length
  }
  return nodes
}

export default function ConversationSidebar({
  conversations,
  projects,
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

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  useEffect(() => {
    if (editingId) editRef.current?.focus()
  }, [editingId])

  // 300ms 디바운스 검색 — 2자 미만이면 일반 목록으로 복귀
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length < 2) {
      setSearchResults(null)
      setIsSearching(false)
      setSearchError(null)
      return
    }
    setIsSearching(true)
    const t = setTimeout(async () => {
      const r = await searchConversations(q)
      if (r.ok) {
        setSearchResults(r.items ?? [])
        setSearchError(null)
      } else {
        setSearchResults([])
        setSearchError(r.error ?? '검색 중 오류가 발생했습니다')
      }
      setIsSearching(false)
    }, 300)
    return () => clearTimeout(t)
  }, [searchQuery])

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

  const projectNameById = new Map(projects.map((p) => [p.id, p.name]))

  function renderConvItem(c: AiChatConversation): ReactNode {
    const active = c.id === selectedId
    const isEditing = editingId === c.id
    const projectName = c.project_id ? projectNameById.get(c.project_id) : null
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
              <div style={{ marginTop: 'var(--space-1)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                <NbBadge>{PROVIDER_LABELS[c.provider]}</NbBadge>
                {c.project_id && (
                  <NbBadge>
                    <FolderKanban size={10} style={{ verticalAlign: 'middle', marginRight: 'var(--space-1)' }} />
                    {projectName ?? '프로젝트'}
                  </NbBadge>
                )}
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
  }

  const pinned = conversations.filter((c) => c.pinned)
  const recent = conversations.filter((c) => !c.pinned)
  const searchMode = searchResults !== null

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
        <Link href="/admin/ai-chat/projects" className="ai-chat-projects-link">
          <FolderKanban size={14} />
          프로젝트
        </Link>
      </div>

      {/* 검색 */}
      <div className="ai-chat-search-wrap">
        <span className="ai-chat-search-icon">
          <Search size={14} />
        </span>
        <input
          className="input-field ai-chat-search-input"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setSearchQuery('') } }}
          placeholder="대화 검색 (제목·내용)"
          aria-label="대화 검색"
        />
        {searchQuery && (
          <button type="button" className="ai-chat-search-clear" onClick={() => setSearchQuery('')} aria-label="검색어 지우기">
            <X size={14} />
          </button>
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

      {/* 목록 / 검색 결과 */}
      <div className="ai-chat-scroll">
        {searchMode ? (
          // ── 검색 모드 ──
          isSearching ? (
            <div className="ai-chat-state" style={{ padding: 'var(--space-5)' }} aria-busy="true">
              <AXDotLoader size={5} color="var(--text-muted)" />
              <p style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>검색 중…</p>
            </div>
          ) : searchError ? (
            <div className="ai-chat-state" style={{ padding: 'var(--space-5)' }} role="alert">
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger)', margin: 0 }}>{searchError}</p>
            </div>
          ) : searchResults && searchResults.length === 0 ? (
            <div className="ai-chat-state" style={{ padding: 'var(--space-5)' }}>
              <p style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>검색 결과가 없습니다.</p>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 'var(--space-2) 0', display: 'flex', flexDirection: 'column' }}>
              {searchResults?.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="ai-chat-search-result"
                    data-active={r.id === selectedId}
                    onClick={() => onSelect(r.id)}
                  >
                    <span className="ai-chat-search-result-title">
                      {r.pinned && <Pin size={12} color="var(--brand)" fill="var(--brand)" style={{ flexShrink: 0 }} />}
                      {highlight(r.title, searchQuery)}
                    </span>
                    {r.snippet && <span className="ai-chat-search-snippet">{highlight(r.snippet, searchQuery)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : conversations.length === 0 ? (
          // ── 빈 목록 ──
          <div className="ai-chat-state" style={{ padding: 'var(--space-5)' }}>
            <p style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>대화가 없습니다.</p>
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', margin: 0 }}>새 대화를 시작하세요.</p>
          </div>
        ) : (
          // ── 고정됨 / 최근 2섹션 ──
          <>
            {pinned.length > 0 && (
              <>
                <div className="ai-chat-section-head">
                  <Pin size={11} />
                  고정됨
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 var(--space-2)', display: 'flex', flexDirection: 'column' }}>
                  {pinned.map(renderConvItem)}
                </ul>
              </>
            )}
            {recent.length > 0 && (
              <>
                {pinned.length > 0 && <div className="ai-chat-section-head">최근</div>}
                <ul style={{ listStyle: 'none', margin: 0, padding: 'var(--space-1) 0 var(--space-2)', display: 'flex', flexDirection: 'column' }}>
                  {recent.map(renderConvItem)}
                </ul>
              </>
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
          </>
        )}
      </div>
    </>
  )
}
