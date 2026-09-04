'use client'

/**
 * 달력 우클릭 메뉴 — **네 화면이 함께 쓰는 실행기.**
 *
 * 사용자 지시(2026-09-02): *"달력은 다 동일한 동작이라면 동일하게"*.
 * 달력은 넷이다(캘린더 · 홈 · 회의노트 · 어드민 모니터링). 화면마다 「누르면 무엇이 되는가」를
 * 다시 적으면 그 순간 네 벌이 되고, 하나를 고치면 셋이 남는다.
 *
 * 그래서 **항목은 `lib/calendar/day-menu.ts`(SSOT)가 만들고, 실행은 여기가 한다.**
 * 어느 화면에서나 뜻이 같은 둘(다른 화면으로 가기 · 미팅 만들기)은 이 부품이 직접 처리하고,
 * 그 화면에서만 뜻이 있는 것(그 날 열기 · 일정 폼)은 `onAction` 으로 넘긴다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarClock, CalendarPlus, CheckSquare, ExternalLink, Mic, NotebookPen,
  Pencil, Sparkles, Trash2,
} from 'lucide-react'
import ContextMenu, { type ContextMenuItem, type ContextMenuState } from '@/components/ui/ContextMenu'
import { startMeeting, meetingHref } from '@/lib/crm/ui/start-meeting'
import type { CalMenuIcon, CalMenuItem, CalMenuRun } from '@/lib/calendar/day-menu'
import { ACTION } from '@/lib/terms'

const ICON: Record<CalMenuIcon, React.ReactNode> = {
  open: <ExternalLink size={14} aria-hidden />,
  meeting: <Mic size={14} aria-hidden />,
  event: <CalendarPlus size={14} aria-hidden />,
  daily: <NotebookPen size={14} aria-hidden />,
  crmTask: <CheckSquare size={14} aria-hidden />,
  ci: <Sparkles size={14} aria-hidden />,
  edit: <Pencil size={14} aria-hidden />,
  delete: <Trash2 size={14} aria-hidden />,
  source: <CalendarClock size={14} aria-hidden />,
}

interface Props {
  /** null 이면 아무것도 그리지 않는다 */
  state: ContextMenuState | null
  items: CalMenuItem[]
  /** 메뉴 맨 위 — 무엇에 대한 메뉴인지 */
  title?: string
  onClose: () => void
  /**
   * 이 화면에서만 뜻이 있는 실행. `link`·`meeting` 은 여기까지 오지 않는다.
   * 안 넘기면 그 항목들은 아무 일도 하지 않으므로, **쓰지 않을 항목은 애초에 만들지 않는다.**
   */
  onAction?: (run: CalMenuRun) => void
}

export default function CalendarContextMenu({ state, items, title, onClose, onAction }: Props) {
  const router = useRouter()
  /** 미팅은 만드는 데 시간이 걸린다 — 두 번 눌러 두 개가 생기지 않게 */
  const [busy, setBusy] = useState(false)

  if (!state) return null

  async function run(item: CalMenuItem) {
    const r = item.run
    if (r.kind === 'link') { router.push(r.href); return }
    if (r.kind === 'meeting') {
      if (busy) return
      setBusy(true)
      try {
        const { id } = await startMeeting({ dateKey: r.dateKey })
        router.push(meetingHref(id))
      } catch {
        /* 실패는 화면이 말한다 — 여기서 삼키면 사용자는 눌렀는지도 모른다 */
        onAction?.(r)
      } finally {
        setBusy(false)
      }
      return
    }
    onAction?.(r)
  }

  const menuItems: ContextMenuItem[] = items.map((it) => ({
    key: it.key,
    label: it.run.kind === 'meeting' && busy ? `${it.label}…` : it.label,
    icon: ICON[it.icon],
    surfaceLabel: it.surfaceLabel,
    danger: it.danger,
    separatorBefore: it.separatorBefore,
    disabled: it.run.kind === 'meeting' && busy,
    onSelect: () => void run(it),
  }))

  return (
    <ContextMenu
      anchor={state.anchor}
      title={title}
      items={menuItems}
      onClose={onClose}
      ariaLabel={title ? `${title} ${ACTION.open}` : undefined}
    />
  )
}
