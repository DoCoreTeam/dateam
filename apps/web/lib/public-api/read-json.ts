/**
 * 공개 API 요청 본문을 안전하게 읽는다
 *
 * **왜**: 라우트가 `await request.json()` 을 그대로 불러 깨진 JSON 이 오면 예외가 catch 로 가서
 *   500 「요청을 처리하지 못했습니다」로 답했다. 보낸 쪽 잘못인데 서버 고장처럼 읽혔다.
 *   여기서 실패를 값으로 돌려주고 라우트는 fail(400, INVALID_JSON_MESSAGE) 로 답한다.
 *
 * next/server 를 안 불러 node --test 가 바로 읽는다.
 */

export const INVALID_JSON_MESSAGE = '요청 본문이 올바른 JSON 이 아닙니다.'

export type ReadJsonResult = { ok: true; body: unknown } | { ok: false }

/** `json()` 이 있는 것이면 받는다 (Request, NextRequest) */
export async function readJsonBody(request: { json(): Promise<unknown> }): Promise<ReadJsonResult> {
  try {
    const body = await request.json()
    return { ok: true, body }
  } catch {
    return { ok: false }
  }
}
