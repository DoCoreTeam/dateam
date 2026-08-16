'use client'

// 커맨드 팔레트 (dacrm FR-10)
//
// **Cmd+K 로 열고, 치고, 엔터.** 키보드에서 손을 떼지 않게 한다.
//
// 검색은 CRM 검색 API 를 그대로 부른다 — 팔레트가 자기 검색을 만들면
// 여기서 찾은 것과 검색 화면에서 찾은 것이 달라진다.
//
// **한글 입력을 조심한다.** 조합 중 엔터는 글자를 확정하는 키다.
// 그걸 실행으로 받으면 "삼성"을 치다가 엉뚱한 곳으로 이동한다(호스트에서 겪은 사고).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ArrowRight, Plus, FileText } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { isEnterKey } from '@/lib/ui/ime'
import {
  STATIC_COMMANDS, filterCommands, moveCursor, hitToCommand,
  KIND_LABEL, type PaletteCommand, type CommandKind,
} from '@/lib/crm/ui/palette'
import styles from './command-palette.module.css'

const ICON: Record<CommandKind, React.ReactNode> = {
  go: <ArrowRight size={14} />,
  create: <Plus size={14} />,
  record: <FileText size={14} />,
}

/** 검색을 매 글자마다 보내지 않는다 — 서버가 아니라 손가락 속도에 맞춘다 */
const DEBOUNCE_MS = 200

export default function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<PaletteCommand[]>([])
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Cmd+K / Ctrl+K 로 연다. 열려 있으면 닫는다 — 같은 키로 오가야 손이 외운다
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 열릴 때마다 처음부터 — 지난번 검색어가 남아 있으면 매번 지워야 한다
  useEffect(() => {
    if (!open) return
    setQ('')
    setHits([])
    setCursor(0)
    const t = setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(t)
  }, [open])

  // 레코드 검색 — 두 글자부터. 한 글자로는 거의 전부가 걸린다
  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (term.length < 2) { setHits([]); return }

    let alive = true
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crm/search?q=${encodeURIComponent(term)}`)
        if (!alive) return
        const body = await res.json()
        // 실패하면 조용히 고정 명령만 남긴다 — 팔레트가 안 열리는 것보다 낫다
        setHits(res.ok ? (body.hits ?? []).map(hitToCommand) : [])
      } catch {
        if (alive) setHits([])
      }
    }, DEBOUNCE_MS)

    return () => { alive = false; clearTimeout(t) }
  }, [q, open])

  const commands = [...filterCommands(STATIC_COMMANDS, q), ...hits]

  // 목록이 줄면 커서가 밖을 가리킬 수 있다
  useEffect(() => { setCursor((c) => (c >= commands.length ? 0 : c)) }, [commands.length])

  const run = useCallback((cmd: PaletteCommand | undefined) => {
    if (!cmd) return
    setOpen(false)
    router.push(cmd.href)
  }, [router])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => moveCursor(c, 1, commands.length)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => moveCursor(c, -1, commands.length)); return }
    // 조합 중 엔터는 글자를 확정하는 키다 — 실행으로 받으면 안 된다
    if (isEnterKey(e)) { e.preventDefault(); run(commands[cursor]) }
  }

  // 커서가 보이는 자리 밖으로 나가면 따라간다 — 안 그러면 방향키가 허공을 움직인다
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  return (
    <div
      className={styles.backdrop}
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="빠른 이동"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <Search size={16} />
          <input
            ref={inputRef}
            className={`input-field ${styles.input}`}
            value={q}
            placeholder="어디로 갈까요? 회사·사람·딜 이름도 됩니다"
            onChange={(e) => { setQ(e.target.value); setCursor(0) }}
            onKeyDown={onKeyDown}
            aria-label="빠른 이동 검색"
          />
          <kbd className={styles.kbd}>esc</kbd>
        </div>

        <ul className={styles.list} ref={listRef}>
          {commands.length === 0 && (
            <li className={styles.none}>
              <EmptyState
                title={q.trim().length >= 2 ? `"${q.trim()}"로 찾은 게 없어요` : '어디로 갈까요?'}
                description={
                  q.trim().length >= 2
                    ? '이름 일부만 넣어도 됩니다.'
                    : '두 글자 이상 넣으면 회사·사람·딜도 함께 찾아요.'
                }
                icon={<Search size={24} />}
              />
            </li>
          )}
          {commands.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className={styles.item}
                data-active={i === cursor ? '1' : '0'}
                onMouseEnter={() => setCursor(i)}
                onClick={() => run(c)}
              >
                <span className={styles.icon}>{ICON[c.kind]}</span>
                <span className={styles.label}>{c.label}</span>
                {c.hint && <span className={styles.hint}>{c.hint}</span>}
                <span className={styles.kind}>{KIND_LABEL[c.kind]}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className={styles.foot}>
          <kbd className={styles.kbd}>↑</kbd><kbd className={styles.kbd}>↓</kbd> 고르기
          <kbd className={styles.kbd}>↵</kbd> 열기
        </div>
      </div>
    </div>
  )
}
