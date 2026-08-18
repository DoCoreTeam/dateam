'use client'

// components/ui/RecordPicker.tsx — "많은 것 중에서 하나 고르기" SSOT (CLAUDE.md §2 · §2-5)
//
// 왜 이 부품이 필요한가:
//   회사·딜처럼 **개수가 자라는** 목록을 native `<select>`로 두면, 항목이 늘어난 만큼
//   목록도 그대로 길어져 화면 밖으로 흘러넘친다. 검색이 없으니 눈으로 훑는 것 말고는
//   찾을 방법이 없다. (실측 /crm/deals '딜 추가' — 회사 목록이 모달 밖까지 넘쳐 고를 수가 없었다.
//   사용자 지적: "이걸 어떻게 쓰니?")
//   더 나쁜 것은 호출부가 전부 `?limit=100`이었다는 점이다 — 101번째 회사는 화면에 **아예 없었고**,
//   없다는 사실조차 어디에도 안 적혀 있었다. 조용한 유실이다.
//
// 우리 방식은 이미 있었다: `OrgPeoplePicker`(조직원) = 모달 + 검색 + 목록.
//   그 파일 첫 줄 주석이 "드롭다운 대체"다. 다만 사람 전용이라 회사·딜에는 못 썼고,
//   그래서 새 화면들은 매번 `<select>`로 되돌아갔다. 자료 종류와 무관하게 쓸 수 있게 한 것이 이 부품이다.
//
// 경계 — **고정 목록에는 쓰지 않는다.**
//   통화(4개)·역할·회사 규모처럼 선택지가 코드에 박혀 있으면 드롭다운이 더 빠르고 정확하다.
//   이 부품은 "서버에서 찾아와야 하는" 목록 전용이다. 그 판정은 `lib/ui/picker-standard.test.ts`가 지킨다.
//
// 검색은 **서버가 한다.** 받아온 100건 안에서 거르면 101번째는 영원히 못 찾는다.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, Check, ChevronDown, Plus } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import AXDotLoader from '@/components/ui/AXDotLoader'
import { useEscClose } from '@/lib/use-esc-close'
import { isEnterKey } from '@/lib/ui/ime'
import styles from './record-picker.module.css'

export interface RecordOption {
  id: string
  name: string
  /** 이름만으로 구분이 안 될 때 곁들이는 보조 정보(회사명·단계 등) */
  hint?: string
}

/** 검색어로 서버에 물어본다. 빈 문자열이면 "처음 보여줄 것"을 준다. */
export type RecordSearch = (query: string, signal: AbortSignal) => Promise<RecordOption[]>

interface FieldProps {
  id?: string
  /** 무엇을 고르는지 — 모달 제목·빈 상태 문구에 쓰인다. 예: "회사" */
  noun: string
  /** 고른 것의 id. 빈 문자열이면 아직 안 고른 상태 */
  value: string
  /** 고른 것의 이름. 수정 화면처럼 id만 알고 여는 경우를 위해 부모가 넘긴다 */
  valueName?: string
  onChange: (next: RecordOption | null) => void
  search: RecordSearch
  /** 아직 안 골랐을 때 칸에 보일 말 */
  placeholder?: string
  /** true면 비울 수 없다(= 필수 항목) */
  required?: boolean
  disabled?: boolean
  /**
   * 목록에 없을 때 그 자리에서 만들기. 없으면 만들기 줄이 안 보인다.
   * 만들고 나면 그대로 골라진 상태로 닫힌다 — 다시 찾아 고르게 하면 그게 또 한 걸음이다.
   */
  onCreate?: (name: string) => Promise<RecordOption | null>
}

/**
 * 폼 안에서 `<select>` 자리에 그대로 들어가는 컨트롤.
 * 생김새는 입력칸(`--control-h`)과 같고, 누르면 검색 모달이 열린다.
 */
export default function RecordPickerField({
  id, noun, value, valueName, onChange, search,
  placeholder, required = false, disabled = false, onCreate,
}: FieldProps) {
  const [open, setOpen] = useState(false)
  const label = value ? (valueName || '고른 항목') : ''

  return (
    <>
      <div className={styles.control}>
        <button
          type="button"
          id={id}
          className={styles.trigger}
          onClick={() => setOpen(true)}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-label={value ? `${noun}: ${label} — 바꾸기` : `${noun} 고르기`}
        >
          <span className={value ? styles.triggerValue : styles.triggerPlaceholder}>
            {value ? label : (placeholder ?? `${noun}를 고르세요`)}
          </span>
          <Search size={15} className={styles.triggerIcon} aria-hidden />
        </button>

        {/* 필수가 아니면 비울 수 있어야 한다 — 잘못 고른 것을 되돌릴 길이 없으면 갇힌다 */}
        {value && !required && !disabled && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => onChange(null)}
            aria-label={`${noun} 선택 해제`}
          >
            <X size={15} />
          </button>
        )}
      </div>

      {open && (
        <RecordPickerModal
          noun={noun}
          selectedId={value}
          search={search}
          onCreate={onCreate}
          onPick={(opt) => { onChange(opt); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

interface ModalProps {
  noun: string
  selectedId?: string
  search: RecordSearch
  onCreate?: (name: string) => Promise<RecordOption | null>
  onPick: (opt: RecordOption) => void
  onClose: () => void
}

const DEBOUNCE_MS = 250

/**
 * 검색 모달. 폼 모달 **위에** 열릴 수 있으므로 자기 층을 가진다.
 * 부모 모달(NbModal)의 백드롭이 이미 스택 컨텍스트라, 그 안에서 `--z-modal`이면 카드 위로 온다.
 */
export function RecordPickerModal({ noun, selectedId, search, onCreate, onPick, onClose }: ModalProps) {
  useEscClose(onClose)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<RecordOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const trimmed = query.trim()

  useEffect(() => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      setError(null)
      search(trimmed, ctrl.signal)
        .then((rows) => { if (!ctrl.signal.aborted) setItems(rows) })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return
          // 조용히 빈 목록으로 두면 "없는 것"과 "못 불러온 것"이 구분되지 않는다
          setError(e instanceof Error && e.message ? e.message : `${noun} 목록을 불러오지 못했습니다.`)
          setItems([])
        })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    }, trimmed ? DEBOUNCE_MS : 0)

    return () => { clearTimeout(timer); ctrl.abort() }
  }, [trimmed, search, noun, reloadKey])

  // 이름이 정확히 같은 것이 이미 있으면 만들기를 권하지 않는다 — 같은 회사가 두 벌 생긴다
  const exactExists = useMemo(
    () => items.some((it) => it.name.trim().toLowerCase() === trimmed.toLowerCase()),
    [items, trimmed],
  )
  const canCreate = Boolean(onCreate) && trimmed.length > 0 && !exactExists && !loading

  const create = useCallback(async () => {
    if (!onCreate || !trimmed) return
    setCreating(true)
    setError(null)
    try {
      const made = await onCreate(trimmed)
      if (made) onPick(made)
      else setError(`${noun}을(를) 만들지 못했습니다.`)
    } catch (e: unknown) {
      setError(e instanceof Error && e.message ? e.message : `${noun}을(를) 만들지 못했습니다.`)
    } finally {
      setCreating(false)
    }
  }, [onCreate, trimmed, onPick, noun])

  // 엔터는 "지금 보이는 첫 줄"을 고른다 — 검색해서 하나만 남은 상황이 가장 흔하다
  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isEnterKey(e)) return
    e.preventDefault()
    if (items.length > 0) onPick(items[0])
    else if (canCreate) void create()
  }

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`${noun} 고르기`}
      onClick={onClose}
    >
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <strong className="tape-title">{noun} 고르기</strong>
          <button type="button" className={styles.close} onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <div className={styles.searchRow}>
          <Search size={15} className={styles.searchIcon} aria-hidden />
          <input
            className="input-field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={`${noun} 이름으로 검색`}
            aria-label={`${noun} 검색`}
            autoFocus
          />
        </div>

        <div className={styles.body} ref={listRef}>
          {error ? (
            <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
          ) : loading ? (
            <div className={styles.loading}>
              <AXDotLoader /> <span>찾는 중…</span>
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title={trimmed ? `'${trimmed}'와(과) 맞는 ${noun}이(가) 없습니다` : `${noun}이(가) 아직 없습니다`}
              description={onCreate ? '아래에서 그 이름 그대로 만들 수 있습니다.' : '이름의 일부만 넣어도 찾습니다.'}
            />
          ) : (
            <div className={styles.list}>
              {items.map((it) => {
                const picked = it.id === selectedId
                return (
                  <button
                    key={it.id}
                    type="button"
                    className={picked ? `${styles.row} ${styles.rowPicked}` : styles.row}
                    onClick={() => onPick(it)}
                    aria-pressed={picked}
                  >
                    <span className={styles.rowName}>{it.name}</span>
                    {it.hint && <span className={styles.rowHint}>{it.hint}</span>}
                    {picked && <Check size={15} className={styles.rowCheck} aria-label="지금 고른 것" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className={styles.foot}>
          {canCreate ? (
            <NbButton variant="ghost" onClick={() => void create()} disabled={creating}>
              <Plus size={15} /> {creating ? '만드는 중…' : `'${trimmed}' 만들기`}
            </NbButton>
          ) : <span />}
          <NbButton variant="ghost" onClick={onClose}>취소</NbButton>
        </div>
      </div>
    </div>
  )
}

/** `<select>`처럼 생긴 화살표가 필요한 곳을 위한 표시용 아이콘(트리거 커스터마이즈 시) */
export { ChevronDown as RecordPickerChevron }
