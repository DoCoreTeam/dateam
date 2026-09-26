// app/(trading)/trading/layout.tsx — AI 트레이딩의 문
//
// **왜 화면이 아니라 여기인가**: 화면마다 소유자 확인을 적게 하면 새 화면을 만든 사람이
// 기억해야 한다. 기억해야 하는 규칙은 반드시 빠뜨리고, 빠뜨린 자리는 조용히 열려 있다.
// `(trading)` 셸 레이아웃이 표면 판정으로 한 번 거르고, 여기가 소유자로 한 번 더 거른다.
//
// **왜 두 겹인가**: 표면 판정(`lib/access/decide.ts`)은 관리자를 맨 먼저 통과시킨다 —
// 그것이 그쪽의 옳은 규칙이다. 그런데 여기 든 것은 한 사람의 매매 판단 기록이고,
// 명세 M11 은 소유자만 본다고 적는다. 축이 다른 규칙을 한 함수에 섞으면 둘 다 틀린다.

import AccessDenied from '@/components/ui/AccessDenied'
import { tradingAccess } from '@/lib/trading/access'
import { navLabel } from '@/lib/nav/menu'

export default async function TradingLayout({ children }: { children: React.ReactNode }) {
  const decision = await tradingAccess()
  if (!decision.allowed) {
    // 막으면서 이유를 말한다. 조용히 홈으로 되돌리면 사용자는 자기가 잘못 눌렀다고 읽는다
    return (
      <AccessDenied
        what={navLabel('/trading')}
        why={decision.userMessage ?? undefined}
      />
    )
  }
  return <>{children}</>
}
