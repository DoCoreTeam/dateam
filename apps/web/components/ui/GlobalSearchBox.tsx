// 글로벌 통합 검색 진입점 — 헤더(MobileShell headerRight)에 배치.
// 데스크탑: 항상 보이는 입력창. 모바일: 아이콘 → 탭 시 확장 입력.
// 제출(Enter/돋보기) 시 /work/search?q=... 로 이동. 디자인은 헤더 질감(토큰)에 맞춤.
'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { isEnterKey } from '@/lib/ui/ime'

/**
 * 어디로 찾으러 갈지.
 *
 * 기본은 호스트 업무 검색이다. 다만 **워크스페이스 안(CRM 등)에서는 그 안을 찾아야** 한다 —
 * CRM 에서 "삼성"을 쳤는데 CRM 을 떠나 업무 문서가 나오면, 사람은 검색이 고장 났다고 본다.
 */
export interface GlobalSearchBoxProps {
  /** 결과 화면 경로. 검색어는 `?q=` 로 붙는다 */
  action?: string
  placeholder?: string
}

export default function GlobalSearchBox({ action = '/work/search', placeholder }: GlobalSearchBoxProps = {}) {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [expanded, setExpanded] = useState(false) // 모바일 확장 상태
  const inputRef = useRef<HTMLInputElement>(null)

  // 모바일 확장 시 입력 포커스
  useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  const submit = () => {
    const q = value.trim()
    if (!q) {
      inputRef.current?.focus()
      return
    }
    router.push(`${action}?q=${encodeURIComponent(q)}`)
    setExpanded(false)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isEnterKey(e)) submit()
    if (e.key === 'Escape') {
      setValue('')
      setExpanded(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div className="global-search" role="search">
      {/* 모바일: 접힘 상태일 때 아이콘 버튼만 노출 */}
      {!expanded && (
        <button
          type="button"
          className="global-search-trigger mobile-only-flex"
          onClick={() => setExpanded(true)}
          aria-label="통합 검색 열기"
          title="통합 검색"
        >
          <Search size={18} aria-hidden="true" />
        </button>
      )}

      {/* 입력 묶음: 데스크탑 항상 표시 / 모바일 확장 시 표시 */}
      <div className={`global-search-field${expanded ? ' is-expanded' : ''}`}>
        <button
          type="button"
          className="global-search-submit"
          onClick={submit}
          aria-label="검색"
          title="검색"
        >
          <Search size={16} aria-hidden="true" />
        </button>
        <input className="input-field global-search-input"
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? '업무 통합 검색…'}
          aria-label="업무 통합 검색"
          enterKeyHint="search"
        />
        {expanded && (
          <button
            type="button"
            className="global-search-close mobile-only-flex"
            onClick={() => { setValue(''); setExpanded(false) }}
            aria-label="검색 닫기"
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
