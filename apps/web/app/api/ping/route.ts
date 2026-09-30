import { NextResponse } from 'next/server'

/**
 * GET /api/ping — 「이 브라우저가 우리 서버에 닿나」 그 한 가지만 대답한다
 *
 * **왜 창구를 하나 더 여나 (실측 2026-09-30)**: 화면이 연결 여부를 `navigator.onLine` 으로
 * 판정하고 있었다. 그 값은 **기기에 네트워크가 있나**를 말하지 **우리 서버가 답하나**를
 * 말하지 않는다. 그래서 서버가 내려간 채 전날 화면이 멀쩡히 떠 있었고, 사용자가 「녹음 시작」을
 * 누르고 나서야 죽은 줄 알았다. 화면이 그 전에 말하려면 실제로 한 번 물어봐야 한다.
 *
 * 있는 창구를 쓰지 않는 이유: 가장 가벼운 축인 `/api/work/sync/version` 도 DB 를 네 번 친다.
 * 몇십 초마다 부를 것을 거기에 얹으면 재는 행위가 서버를 누른다.
 *
 * **로그인을 안 본다.** 봐도 되지만 볼 것이 없다 — 나가는 값이 `{"ok":true}` 한 가지뿐이라
 * 누가 불러도 알아낼 수 있는 것이 「이 주소에 서버가 떠 있다」 하나다. 그 사실은 어차피
 * 첫 화면을 여는 것만으로 알 수 있다. 대신 `lib/policy/api-auth-surface.test.ts` 의
 * OPEN_ON_PURPOSE 에 이유와 함께 적어 둬서, 나중에 여기에 값을 하나 얹으면 걸리게 한다.
 */

// 빌드 때 굳으면 서버가 죽어도 CDN 이 200 을 준다 — 그러면 이 창구는 거짓말을 한다
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
