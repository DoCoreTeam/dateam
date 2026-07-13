'use client'

// 세션 3 §2-3 — 우측 artifact 프리뷰 패널.
// 탭(미리보기/코드) · 버전 셀렉터(v1..vN) · 복사 · 다운로드 · 닫기(X, ESC).
// 프레젠테이션 전용 — 활성 artifact/버전 상태는 허브(AiChatClient)가 관리하고 props로 주입.
// 데스크탑: 컨테이너를 채움(허브가 ~40% 폭 분할). 모바일(<768px): 전면 오버레이(CSS 미디어쿼리 — JS 아님).

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy, Download, X } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import { extForLanguage, type ArtifactBlock } from '@/lib/ai-chat/artifacts'
import HtmlSandbox from './HtmlSandbox'

export interface ArtifactVersionEntry {
  messageId: string
  block: ArtifactBlock
}

interface Props {
  versions: ArtifactVersionEntry[]
  versionIndex: number
  onClose: () => void
  onVersionChange: (index: number) => void
}

type Tab = 'preview' | 'code'

/** content 내 최장 백틱 연속 길이(코드펜스 안전 길이 산출용). */
function longestBacktickRun(s: string): number {
  const m = s.match(/`+/g)
  return m ? Math.max(...m.map((r) => r.length)) : 0
}

/** 언어 하이라이트 코드 렌더 — MarkdownMessage를 건드리지 않는 자기완결 렌더러(.hljs-* 전역 토큰 재사용). */
function CodeView({ language, content }: { language: string; content: string }) {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(content) + 1))
  const md = `${fence}${language}\n${content}\n${fence}`
  return (
    <div className="artifact-codeview ai-chat-md">
      <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{md}</ReactMarkdown>
    </div>
  )
}

export default function ArtifactPanel({ versions, versionIndex, onClose, onVersionChange }: Props) {
  useEscClose(onClose)
  const [tab, setTab] = useState<Tab>('preview')
  const [copied, setCopied] = useState(false)

  const safeIndex = Math.min(Math.max(versionIndex, 0), versions.length - 1)
  const entry = versions[safeIndex]
  if (!entry) return null
  const block = entry.block

  function handleCopy() {
    navigator.clipboard.writeText(block.content).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {
        /* 클립보드 거부 시 무시 */
      },
    )
  }

  function handleDownload() {
    const ext = extForLanguage(block.language)
    const filename = `${block.title || 'artifact'}.${ext}`
    const blob = new Blob([block.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const isEmbeddable = block.type === 'html' || block.type === 'svg'

  return (
    <aside className="artifact-panel" role="complementary" aria-label="아티팩트 미리보기">
      <header className="artifact-panel-head">
        <h2 className="tape-title artifact-panel-title" title={block.title}>
          {block.title}
        </h2>
        <button
          type="button"
          className="artifact-close-btn"
          onClick={onClose}
          aria-label="패널 닫기"
        >
          <X size={18} />
        </button>
      </header>

      <div className="artifact-tabs" role="tablist" aria-label="미리보기/코드">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'preview'}
          className={`artifact-tab${tab === 'preview' ? ' is-active' : ''}`}
          onClick={() => setTab('preview')}
        >
          미리보기
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'code'}
          className={`artifact-tab${tab === 'code' ? ' is-active' : ''}`}
          onClick={() => setTab('code')}
        >
          코드
        </button>
      </div>

      <div className="artifact-toolbar">
        {versions.length > 1 && (
          <div className="artifact-versions" role="group" aria-label="버전 선택">
            {versions.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`artifact-version-btn${i === safeIndex ? ' is-active' : ''}`}
                onClick={() => onVersionChange(i)}
                aria-pressed={i === safeIndex}
                aria-label={`버전 ${i + 1}`}
              >
                v{i + 1}
              </button>
            ))}
          </div>
        )}
        <div className="artifact-toolbar-actions">
          <button
            type="button"
            className="artifact-action-btn"
            onClick={handleCopy}
            aria-label="내용 복사"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? '복사됨' : '복사'}
          </button>
          <button
            type="button"
            className="artifact-action-btn"
            onClick={handleDownload}
            aria-label="파일 다운로드"
          >
            <Download size={14} />
            다운로드
          </button>
        </div>
      </div>

      <div className="artifact-panel-body">
        {tab === 'preview' ? (
          isEmbeddable ? (
            <HtmlSandbox html={block.content} />
          ) : block.type === 'markdown' ? (
            <div className="artifact-scroll">
              <div className="ai-chat-md artifact-md-preview">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {block.content}
                </ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="artifact-scroll">
              <CodeView language={block.language} content={block.content} />
            </div>
          )
        ) : (
          <div className="artifact-scroll">
            <CodeView language={block.language} content={block.content} />
          </div>
        )}
      </div>
    </aside>
  )
}
