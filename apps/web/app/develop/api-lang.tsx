'use client'

/**
 * 코드 언어 선택 — **화면 전체가 한 벌을 공유한다.**
 *
 * 왜 생겼나 (사용자 지적 2026-08-27): 「페이지별로 해당 언어를 하던가 전체에서
 * 내가 어떤 언어인지 고를 수 있던가 뭐 이래야지 어렵게 만들어놨다」.
 * 예전엔 `CodeTabs` 가 블록마다 자기 state 를 들고 있었다. 이 화면에는 코드 블록이
 * 엔드포인트 수만큼 뜨므로, Python 사용자는 **블록마다 Python 을 다시 골라야 했다.**
 * 고르는 자리가 여럿이면 고른 적이 없는 것과 같다.
 *
 * 규칙 셋:
 *   · 어디서 골라도 화면 전체가 따라온다 — 블록의 탭도 이 값을 바꾼다
 *   · 다음 방문에도 기억한다(localStorage)
 *   · 주소에 남긴다(`?lang=`) — 링크를 받은 사람도 같은 언어를 본다
 *
 * 우선순위는 목록 표준(§2-6 (3))과 같다: **주소 > 저장된 설정 > 기본값**.
 * 첫 렌더는 언제나 기본값이다 — 서버 렌더와 달라지면 하이드레이션이 깨진다.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { LANGUAGES } from '@/lib/api-docs/snippets'

const STORE_KEY = 'ax.develop.lang'
const QUERY_KEY = 'lang'
const DEFAULT_LANG = LANGUAGES[0].id

/** 모르는 값은 들이지 않는다 — 주소창으로 아무 문자열이나 들어온다 */
function known(id: string | null | undefined): id is string {
  return !!id && LANGUAGES.some((l) => l.id === id)
}

interface ApiLangValue {
  langId: string
  setLangId: (id: string) => void
}

const ApiLangContext = createContext<ApiLangValue>({ langId: DEFAULT_LANG, setLangId: () => {} })

export function ApiLangProvider({ children }: { children: React.ReactNode }) {
  const [langId, setLang] = useState(DEFAULT_LANG)

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get(QUERY_KEY)
    if (known(fromUrl)) { setLang(fromUrl); return }
    try {
      const saved = window.localStorage.getItem(STORE_KEY)
      if (known(saved)) setLang(saved)
    } catch { /* 저장소를 막아 둔 브라우저 — 기본값으로 간다 */ }
  }, [])

  const setLangId = useCallback((id: string) => {
    if (!known(id)) return
    setLang(id)
    try { window.localStorage.setItem(STORE_KEY, id) } catch { /* 저장 실패는 선택을 막지 않는다 */ }
    // 히스토리를 더럽히지 않는다 — 뒤로가기가 언어 전환을 되짚으면 안 된다
    const url = new URL(window.location.href)
    url.searchParams.set(QUERY_KEY, id)
    window.history.replaceState(null, '', url.toString())
  }, [])

  const value = useMemo(() => ({ langId, setLangId }), [langId, setLangId])
  return <ApiLangContext.Provider value={value}>{children}</ApiLangContext.Provider>
}

export function useApiLang(): ApiLangValue {
  return useContext(ApiLangContext)
}

/** 지금 고른 언어의 정의 — 없는 값이 들어와도 기본값으로 떨어진다 */
export function useApiLanguage() {
  const { langId } = useApiLang()
  return LANGUAGES.find((l) => l.id === langId) ?? LANGUAGES[0]
}

/**
 * 화면 위쪽의 언어 선택기 — 「어디서 고르는지」를 눈에 보이게 둔다.
 * 블록마다 있는 탭으로도 바꿀 수 있지만, 그건 찾아 내려가야 보인다.
 */
export function ApiLangPicker() {
  const { langId, setLangId } = useApiLang()
  const ns = 'devlang__'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-5)' }}>
      <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        코드 언어
      </span>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <SegmentedTabs
          ariaLabel="코드 언어 선택"
          tabs={LANGUAGES.map((l) => ({ id: ns + l.id, label: l.label }))}
          activeId={ns + langId}
          onSelect={(tabId) => setLangId(tabId.slice(ns.length))}
        />
      </div>
    </div>
  )
}
