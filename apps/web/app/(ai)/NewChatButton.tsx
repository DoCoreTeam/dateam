'use client'

// 새 대화 — 사이드바 메뉴 맨 위의 행동 하나.
//
// 예전엔 대화 목록 판 안에 있었다. 그래서 「무엇을 할 수 있나」(메뉴)와
// 「무엇을 했나」(목록)가 같은 판에 섞였고, claude.ai 처럼 왼쪽 맨 위에서 바로 시작할 수 없었다.
//
// 메뉴는 서버 컴포넌트(레이아웃)가 그리는데 대화 초기화는 클라이언트 상태다.
// 그래서 주소로 보내고(이미 /ai 면 주소가 안 바뀌므로) 창 이벤트로 한 번 더 알린다 —
// 패치노트 모달이 쓰는 것과 같은 방식이다.

import { usePathname, useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import styles from './new-chat.module.css'

/** AiChatClient 가 듣는 이름. 양쪽이 같은 상수를 봐야 조용히 갈리지 않는다 */
export const NEW_CHAT_EVENT = 'ai-chat:new'

export default function NewChatButton() {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <button
      type="button"
      className={`btn-primary ${styles.button}`}
      onClick={() => {
        if (pathname !== '/ai') router.push('/ai')
        else router.replace('/ai')
        window.dispatchEvent(new Event(NEW_CHAT_EVENT))
      }}
    >
      <Plus size={16} />
      새 대화
    </button>
  )
}
