'use client'

// /rfp/assistant 의 본문 — 실제 대화는 components/rfp/AssistantChat 한 벌이다.
//
// 같은 대화가 오른쪽 아래 패널에도 뜬다. 두 자리가 갈리지 않게 여기서는 감싸기만 한다.

import AssistantChat from '@/components/rfp/AssistantChat'

export default function AssistantClient() {
  return <AssistantChat />
}
