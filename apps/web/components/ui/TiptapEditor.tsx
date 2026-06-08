'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Link from '@tiptap/extension-link'
import { useEffect, useRef, useState } from 'react'

interface TiptapEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
}

const TabIndent = Extension.create({
  name: 'tabIndent',
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.can().sinkListItem('listItem')) {
          return this.editor.commands.sinkListItem('listItem')
        }
        return this.editor.commands.insertContent('    ')
      },
      'Shift-Tab': () => {
        if (this.editor.can().liftListItem('listItem')) {
          return this.editor.commands.liftListItem('listItem')
        }
        return false
      },
    }
  },
})

const BTN: React.CSSProperties = {
  padding: '0.3rem 0.45rem',
  border: '1px solid transparent',
  borderRadius: '0.3rem',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: '0.8125rem',
  color: '#475569',
  lineHeight: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '1.75rem',
  height: '1.75rem',
}

const BTN_ACTIVE: React.CSSProperties = {
  ...BTN,
  background: 'var(--color-border)',
  color: 'var(--text)',
  border: '1px solid var(--border-color)',
}

const DIVIDER = (
  <span style={{ width: '1px', background: 'var(--color-border)', margin: '0 0.125rem', alignSelf: 'stretch', display: 'inline-block' }} />
)


const TEXT_COLORS = [
  { label: '기본', value: '' },
  { label: '빨강', value: 'var(--danger)' },
  { label: '주황', value: '#ea580c' },
  { label: '초록', value: 'var(--success)' },
  { label: '파랑', value: 'var(--info)' },
  { label: '보라', value: 'var(--brand)' },
  { label: '회색', value: 'var(--text-muted)' },
]

const HIGHLIGHT_COLORS = [
  { label: '없음', value: '' },
  { label: '노랑', value: '#fef08a' },
  { label: '초록', value: 'var(--success-border)' },
  { label: '파랑', value: 'var(--info-border)' },
  { label: '분홍', value: '#fbcfe8' },
]

export default function TiptapEditor({
  value,
  onChange,
  placeholder = '내용을 입력하세요',
  minHeight = 120,
}: TiptapEditorProps) {
  const [colorOpen, setColorOpen] = useState(false)
  const [highlightOpen, setHighlightOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const colorRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const linkRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({ placeholder }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      TabIndent,
    ],
    content: value || '',
    onUpdate({ editor }) {
      onChange(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: 'tiptap-content',
        style: `min-height:${minHeight}px; padding: 0.625rem 0.75rem; outline: none;`,
      },
    },
    immediatelyRender: false,
  })

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // 드롭다운 외부 클릭 닫기
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) setColorOpen(false)
      if (highlightRef.current && !highlightRef.current.contains(e.target as Node)) setHighlightOpen(false)
      if (linkRef.current && !linkRef.current.contains(e.target as Node)) setLinkOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function handleSetLink() {
    if (!linkUrl) {
      editor?.chain().focus().unsetLink().run()
    } else {
      const url = linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`
      editor?.chain().focus().setLink({ href: url }).run()
    }
    setLinkOpen(false)
    setLinkUrl('')
  }

  if (!editor) return (
    <div style={{ border: '2px solid var(--border-color)', borderRadius: 'var(--radius)', minHeight: `${minHeight}px`, background: '#fff' }} />
  )

  const currentColor = (editor.getAttributes('textStyle') as { color?: string }).color ?? ''
  const isHighlighted = editor.isActive('highlight')

  return (
    <div style={{ border: '2px solid var(--border-color)', borderRadius: 'var(--radius)', overflow: 'visible', background: '#fff' }}>
      {/* 툴바 */}
      <div
        style={{
          display: 'flex',
          gap: '0.125rem',
          padding: '0.375rem 0.5rem',
          borderBottom: '2px solid var(--border-color)',
          background: 'var(--color-bg)',
          flexWrap: 'wrap',
          alignItems: 'center',
          position: 'relative',
        }}
      >
        {/* 텍스트 서식 */}
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} style={editor.isActive('bold') ? BTN_ACTIVE : BTN} title="굵게 (Ctrl+B)">
          <strong style={{ fontSize: '0.9rem' }}>B</strong>
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} style={editor.isActive('italic') ? BTN_ACTIVE : BTN} title="기울임 (Ctrl+I)">
          <em style={{ fontSize: '0.9rem' }}>I</em>
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} style={editor.isActive('underline') ? BTN_ACTIVE : BTN} title="밑줄 (Ctrl+U)">
          <u style={{ fontSize: '0.9rem' }}>U</u>
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()} style={editor.isActive('strike') ? BTN_ACTIVE : BTN} title="취소선">
          <s style={{ fontSize: '0.9rem' }}>S</s>
        </button>

        {DIVIDER}

        {/* 텍스트 색상 */}
        <div ref={colorRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => { setColorOpen((p) => !p); setHighlightOpen(false); setLinkOpen(false) }}
            style={{ ...BTN, flexDirection: 'column', gap: '1px', padding: '0.25rem 0.4rem' }}
            title="글자 색상"
          >
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: currentColor || 'var(--text)', lineHeight: 1 }}>A</span>
            <span style={{ width: '14px', height: '3px', borderRadius: '1px', background: currentColor || 'var(--text)', display: 'block' }} />
          </button>
          {colorOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100, background: '#fff', border: '2px solid var(--border-color)', borderRadius: 'var(--radius)', padding: '0.5rem', display: 'flex', gap: '0.375rem', boxShadow: 'var(--shadow-sm)' }}>
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
                  onClick={() => {
                    if (!c.value) editor.chain().focus().unsetColor().run()
                    else editor.chain().focus().setColor(c.value).run()
                    setColorOpen(false)
                  }}
                  style={{
                    width: '1.25rem', height: '1.25rem', borderRadius: '50%',
                    background: c.value || 'var(--text)',
                    border: currentColor === c.value ? '2px solid var(--brand)' : '2px solid var(--color-border)',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* 하이라이트 */}
        <div ref={highlightRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => { setHighlightOpen((p) => !p); setColorOpen(false); setLinkOpen(false) }}
            style={isHighlighted ? BTN_ACTIVE : BTN}
            title="형광펜"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="9" width="12" height="4" rx="1" fill="#fef08a" stroke="var(--text-faint)" strokeWidth="1"/>
              <path d="M5 9L8 2L11 9" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {highlightOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100, background: '#fff', border: '2px solid var(--border-color)', borderRadius: 'var(--radius)', padding: '0.5rem', display: 'flex', gap: '0.375rem', boxShadow: 'var(--shadow-sm)' }}>
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
                  onClick={() => {
                    if (!c.value) editor.chain().focus().unsetHighlight().run()
                    else editor.chain().focus().setHighlight({ color: c.value }).run()
                    setHighlightOpen(false)
                  }}
                  style={{
                    width: '1.25rem', height: '1.25rem', borderRadius: '50%',
                    background: c.value || 'var(--surface-muted)',
                    border: '2px solid var(--color-border)',
                    cursor: 'pointer',
                    position: 'relative',
                  }}
                >
                  {!c.value && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', color: 'var(--text-faint)' }}>✕</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {DIVIDER}

        {/* 제목 */}
        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} style={editor.isActive('heading', { level: 1 }) ? BTN_ACTIVE : BTN} title="제목 1">
          <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>H1</span>
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} style={editor.isActive('heading', { level: 2 }) ? BTN_ACTIVE : BTN} title="제목 2">
          <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>H2</span>
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} style={editor.isActive('heading', { level: 3 }) ? BTN_ACTIVE : BTN} title="제목 3">
          <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>H3</span>
        </button>

        {DIVIDER}

        {/* 정렬 */}
        <button type="button" onClick={() => editor.chain().focus().setTextAlign('left').run()} style={editor.isActive({ textAlign: 'left' }) ? BTN_ACTIVE : BTN} title="왼쪽 정렬">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="12" height="1.5" rx="0.75"/><rect x="2" y="6.5" width="8" height="1.5" rx="0.75"/><rect x="2" y="10" width="12" height="1.5" rx="0.75"/><rect x="2" y="13.5" width="6" height="1.5" rx="0.75"/></svg>
        </button>
        <button type="button" onClick={() => editor.chain().focus().setTextAlign('center').run()} style={editor.isActive({ textAlign: 'center' }) ? BTN_ACTIVE : BTN} title="가운데 정렬">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="12" height="1.5" rx="0.75"/><rect x="4" y="6.5" width="8" height="1.5" rx="0.75"/><rect x="2" y="10" width="12" height="1.5" rx="0.75"/><rect x="5" y="13.5" width="6" height="1.5" rx="0.75"/></svg>
        </button>
        <button type="button" onClick={() => editor.chain().focus().setTextAlign('right').run()} style={editor.isActive({ textAlign: 'right' }) ? BTN_ACTIVE : BTN} title="오른쪽 정렬">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="12" height="1.5" rx="0.75"/><rect x="6" y="6.5" width="8" height="1.5" rx="0.75"/><rect x="2" y="10" width="12" height="1.5" rx="0.75"/><rect x="8" y="13.5" width="6" height="1.5" rx="0.75"/></svg>
        </button>

        {DIVIDER}

        {/* 목록 */}
        <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} style={editor.isActive('bulletList') ? BTN_ACTIVE : BTN} title="글머리 기호">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="4" r="1.25"/><rect x="6" y="3.25" width="8" height="1.5" rx="0.75"/><circle cx="3" cy="8" r="1.25"/><rect x="6" y="7.25" width="8" height="1.5" rx="0.75"/><circle cx="3" cy="12" r="1.25"/><rect x="6" y="11.25" width="8" height="1.5" rx="0.75"/></svg>
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} style={editor.isActive('orderedList') ? BTN_ACTIVE : BTN} title="번호 목록">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><text x="1.5" y="5.5" fontSize="5" fontFamily="sans-serif" fontWeight="700">1.</text><rect x="6" y="3.25" width="8" height="1.5" rx="0.75"/><text x="1.5" y="9.5" fontSize="5" fontFamily="sans-serif" fontWeight="700">2.</text><rect x="6" y="7.25" width="8" height="1.5" rx="0.75"/><text x="1.5" y="13.5" fontSize="5" fontFamily="sans-serif" fontWeight="700">3.</text><rect x="6" y="11.25" width="8" height="1.5" rx="0.75"/></svg>
        </button>

        {/* 들여쓰기 */}
        <button type="button" onClick={() => editor.chain().focus().sinkListItem('listItem').run()} disabled={!editor.can().sinkListItem('listItem')} style={{ ...BTN, opacity: editor.can().sinkListItem('listItem') ? 1 : 0.35 }} title="들여쓰기">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="12" height="1.5" rx="0.75"/><polygon points="5,6.5 5,9.5 8,8"/><rect x="9" y="6.5" width="5" height="1.5" rx="0.75"/><rect x="2" y="11" width="12" height="1.5" rx="0.75"/></svg>
        </button>
        <button type="button" onClick={() => editor.chain().focus().liftListItem('listItem').run()} disabled={!editor.can().liftListItem('listItem')} style={{ ...BTN, opacity: editor.can().liftListItem('listItem') ? 1 : 0.35 }} title="내어쓰기">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="12" height="1.5" rx="0.75"/><polygon points="8,6.5 8,9.5 5,8"/><rect x="9" y="6.5" width="5" height="1.5" rx="0.75"/><rect x="2" y="11" width="12" height="1.5" rx="0.75"/></svg>
        </button>

        {DIVIDER}

        {/* 링크 */}
        <div ref={linkRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => {
              setLinkOpen((p) => !p)
              setColorOpen(false)
              setHighlightOpen(false)
              setLinkUrl(editor.isActive('link') ? (editor.getAttributes('link') as { href?: string }).href ?? '' : '')
            }}
            style={editor.isActive('link') ? BTN_ACTIVE : BTN}
            title="링크"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5L7 4"/><path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l1.5-1.5"/></svg>
          </button>
          {linkOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100, background: '#fff', border: '2px solid var(--border-color)', borderRadius: 'var(--radius)', padding: '0.5rem', display: 'flex', gap: '0.375rem', boxShadow: 'var(--shadow-sm)', minWidth: '240px' }}>
              <input
                type="text"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSetLink() } }}
                placeholder="URL 입력 (Enter)"
                autoFocus
                style={{ flex: 1, fontSize: '0.8125rem', border: '2px solid var(--border-color)', borderRadius: '0.375rem', padding: '0.375rem 0.5rem', outline: 'none', fontFamily: 'inherit' }}
              />
              <button type="button" onClick={handleSetLink} style={{ ...BTN, background: 'var(--brand)', color: '#fff', border: 'none', padding: '0.375rem 0.625rem', borderRadius: '0.375rem' }}>
                확인
              </button>
              {editor.isActive('link') && (
                <button type="button" onClick={() => { editor.chain().focus().unsetLink().run(); setLinkOpen(false) }} style={{ ...BTN, background: 'var(--surface-muted)', color: 'var(--danger)' }} title="링크 제거">
                  ✕
                </button>
              )}
            </div>
          )}
        </div>

        <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} style={editor.isActive('blockquote') ? BTN_ACTIVE : BTN} title="인용">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3 4h4v5H5c0 1.5.7 2.5 2 3v1c-2.5-.8-4-2.8-4-5V4zm6 0h4v5h-2c0 1.5.7 2.5 2 3v1c-2.5-.8-4-2.8-4-5V4z" opacity="0.7"/></svg>
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleCodeBlock().run()} style={editor.isActive('codeBlock') ? BTN_ACTIVE : BTN} title="코드 블록">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="5,4 1,8 5,12"/><polyline points="11,4 15,8 11,12"/><line x1="9" y1="3" x2="7" y2="13"/></svg>
        </button>
        <button type="button" onClick={() => editor.chain().focus().setHorizontalRule().run()} style={BTN} title="구분선">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="7.25" width="14" height="1.5" rx="0.75"/></svg>
        </button>

        {DIVIDER}

        {/* 실행취소/재실행 */}
        <button type="button" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} style={{ ...BTN, opacity: editor.can().undo() ? 1 : 0.35 }} title="실행 취소 (Ctrl+Z)">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,7 1,4 4,2"/><path d="M1 4h8a5 5 0 0 1 0 10H6"/></svg>
        </button>
        <button type="button" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} style={{ ...BTN, opacity: editor.can().redo() ? 1 : 0.35 }} title="다시 실행 (Ctrl+Y)">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="13,7 15,4 12,2"/><path d="M15 4H7a5 5 0 0 0 0 10h3"/></svg>
        </button>
      </div>

      {/* 에디터 본문 */}
      <EditorContent editor={editor} />
    </div>
  )
}
