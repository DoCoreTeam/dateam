'use client'

import React, { useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Copy, Check } from 'lucide-react'

/** 하이라이트된 노드(span 트리)에서 원본 텍스트를 재귀 추출 — 코드 복사용. */
function extractText(node: React.ReactNode): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

function CodeBlock({
  lang,
  className,
  children,
}: {
  lang: string
  className?: string
  children: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    const text = extractText(children)
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {
        /* 클립보드 거부 시 무시 */
      },
    )
  }

  return (
    <div className="ai-chat-codeblock">
      <div className="ai-chat-codeblock-head">
        <span className="ai-chat-codeblock-lang">{lang || 'code'}</span>
        <button
          type="button"
          className="ai-chat-copy-btn"
          onClick={handleCopy}
          aria-label="코드 복사"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? '복사됨' : '복사'}
        </button>
      </div>
      <pre className="ai-chat-code">
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

const components: Components = {
  code({ className, children }) {
    const match = /language-([\w-]+)/.exec(className || '')
    if (match) {
      return (
        <CodeBlock lang={match[1]} className={className}>
          {children}
        </CodeBlock>
      )
    }
    return <code className="ai-chat-inline-code">{children}</code>
  },
  // 코드블록 래핑은 CodeBlock이 직접 <pre>를 렌더하므로 기본 pre는 통과만.
  pre({ children }) {
    return <>{children}</>
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  },
}

interface MarkdownMessageProps {
  content: string
}

export default function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="ai-chat-md">
      {/* raw HTML은 rehype-raw 미사용 → react-markdown v9 기본이 비활성(escape). 04 §6-7 skipHtml 계약 충족 = XSS 면적 제거. */}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
