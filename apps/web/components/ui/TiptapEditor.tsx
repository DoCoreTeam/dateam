'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect } from 'react'

interface TiptapEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
}

const TOOLBAR_BTN: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  border: '1px solid #e2e8f0',
  borderRadius: '0.3rem',
  background: '#f8fafc',
  cursor: 'pointer',
  fontSize: '0.8125rem',
  color: '#475569',
  lineHeight: 1,
}

const TOOLBAR_BTN_ACTIVE: React.CSSProperties = {
  ...TOOLBAR_BTN,
  background: '#e2e8f0',
  color: '#0f172a',
}

export default function TiptapEditor({
  value,
  onChange,
  placeholder = '내용을 입력하세요 (/, ** 등으로 서식 적용)',
  minHeight = 120,
}: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({ placeholder }),
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

  if (!editor) return (
    <div
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: '0.5rem',
        minHeight: `${minHeight}px`,
        background: '#fff',
        padding: '0.625rem 0.75rem',
        color: '#94a3b8',
        fontSize: '0.875rem',
      }}
    />
  )

  return (
    <div
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: '0.5rem',
        overflow: 'hidden',
        background: '#fff',
      }}
    >
      {/* 툴바 */}
      <div
        style={{
          display: 'flex',
          gap: '0.25rem',
          padding: '0.375rem 0.5rem',
          borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          style={editor.isActive('bold') ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN}
          title="굵게 (Ctrl+B)"
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          style={editor.isActive('italic') ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN}
          title="기울임 (Ctrl+I)"
        >
          <em>I</em>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          style={editor.isActive('underline') ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN}
          title="밑줄 (Ctrl+U)"
        >
          <u>U</u>
        </button>
        <span style={{ width: '1px', background: '#e2e8f0', margin: '0 0.25rem' }} />
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          style={editor.isActive('heading', { level: 2 }) ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN}
          title="제목 2"
        >
          H2
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          style={editor.isActive('heading', { level: 3 }) ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN}
          title="제목 3"
        >
          H3
        </button>
        <span style={{ width: '1px', background: '#e2e8f0', margin: '0 0.25rem' }} />
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          style={editor.isActive('bulletList') ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN}
          title="글머리 기호"
        >
          •—
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          style={editor.isActive('orderedList') ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN}
          title="번호 목록"
        >
          1.
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          style={editor.isActive('blockquote') ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN}
          title="인용"
        >
          ❝
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          style={editor.isActive('codeBlock') ? TOOLBAR_BTN_ACTIVE : TOOLBAR_BTN}
          title="코드 블록"
        >
          {'</>'}
        </button>
        <span style={{ width: '1px', background: '#e2e8f0', margin: '0 0.25rem' }} />
        <button
          type="button"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          style={TOOLBAR_BTN}
          title="구분선"
        >
          —
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          style={{ ...TOOLBAR_BTN, opacity: editor.can().undo() ? 1 : 0.4 }}
          title="실행 취소"
        >
          ↩
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          style={{ ...TOOLBAR_BTN, opacity: editor.can().redo() ? 1 : 0.4 }}
          title="다시 실행"
        >
          ↪
        </button>
      </div>

      {/* 에디터 본문 */}
      <EditorContent editor={editor} />

    </div>
  )
}
