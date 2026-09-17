// lib/crm/services/card-limits.ts — 명함 받기의 **한도만**. 화면과 서버가 함께 읽는다.
//
// 왜 갈라 놓나: 이 값들은 `card-read.ts` 에 있었고 업로드 모달(client)이 거기서 가져다 썼다.
// 그런데 그 파일이 AI 게이트웨이를 끌어오게 되면서(v0.10.95~96) 서버 전용 모듈
// (`lib/supabase/server.ts` → `next/headers`)까지 딸려 왔고, **client 번들이 그것을 물어
// 컴파일이 통째로 죽었다** — 실측 2026-09-17: `pnpm build` 실패, `/crm/deals/*` ·
// `/crm/companies/*` 가 「Build Error」 화면만 떴다.
//
// 상수는 서버·화면 어느 쪽 물건도 아니다. 그래서 둘 다 딸려오는 것 없이 읽을 수 있는
// 자리에 둔다. `card-read.ts` 는 여기서 다시 내보내므로 부르던 쪽은 한 글자도 안 바뀐다.

/** 명함 한 장은 작다. 이보다 크면 사진을 줄여 달라고 말하는 것이 맞다 */
export const CARD_MAX_BYTES = 8 * 1024 * 1024

export const CARD_MIME_OK: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/heic']

/** 한 번에 받는 장수 — 모델을 그만큼 부르므로 상한이 필요하다 */
export const CARD_MAX_COUNT = 10
