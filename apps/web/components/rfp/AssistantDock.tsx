'use client'

// 어시스턴트를 **어느 화면에서나** 연다.
//
// 메뉴 항목으로만 두면 리포트를 읽다 물어보려고 화면을 떠나야 하고, 떠나면
// 물어보려던 것을 잊는다. 그래서 셸의 Dock assistant 슬롯에 등록한다 —
// 좌표는 Dock 이 정한다(스스로 정하면 + 버튼과 겹쳐 잘린다).

import { useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import SlidePanel from '@/components/ui/SlidePanel'
import NbButton from '@/components/ui/nb/NbButton'
import { RFP_ASSISTANT } from '@/lib/rfp/terms'
import AssistantChat from './AssistantChat'

export default function AssistantDock() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <NbButton onClick={() => setOpen(true)} aria-label={RFP_ASSISTANT.open}>
        <MessagesSquare size={16} />{RFP_ASSISTANT.title}
      </NbButton>

      <SlidePanel
        isOpen={open}
        onClose={() => setOpen(false)}
        title={RFP_ASSISTANT.title}
        icon={<MessagesSquare size={18} />}
      >
        <AssistantChat compact />
      </SlidePanel>
    </>
  )
}
