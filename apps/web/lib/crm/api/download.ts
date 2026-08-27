/**
 * 파일 내려받기 (SSOT) — 실패를 **화면에서** 말한다
 *
 * **왜 한 곳인가**: 내려받기는 짧아 보이지만 실제로는 다섯 가지를 한다 —
 * 실패 판정 · 오류 메시지 꺼내기 · 파일명 꺼내기 · 앵커 클릭 · URL 회수.
 * 화면마다 다시 적으면 그중 하나씩 빠지고, 빠진 것은 **실패했을 때만** 드러난다.
 *
 * **`window.location.href` 로 보내지 않는다.** 그렇게 하면 서버가 오류를 주는 순간
 * 브라우저가 **JSON 을 날것으로 그린다** — 사용자는 읽을 수 없고 돌아갈 길도 없다
 * (실브라우저에서 잡았다: 금액이 어긋난 견적서를 내려받으려 하자
 *  `{"error":{"message":"..."}}` 가 통째로 화면을 덮었다).
 */

import { readApiError } from './read-error.ts'

export interface DownloadOutcome {
  ok: boolean
  /** 실패했을 때 화면에 그대로 띄울 말 */
  message?: string
  /** 성공했을 때 서버가 함께 보낸 것(건수·잘림 여부 등) */
  headers?: Headers
}

/**
 * @param url        받을 주소
 * @param fallbackName 서버가 파일명을 안 주면 쓸 이름. `download.csv` 가 쌓이면 구분이 안 된다
 * @param failMessage 서버가 이유를 말하지 않을 때 쓸 말
 */
export async function downloadFromApi(
  url: string,
  fallbackName: string,
  failMessage: string,
): Promise<DownloadOutcome> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    return { ok: false, message: failMessage }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    return { ok: false, message: readApiError(body, failMessage) }
  }

  const blob = await res.blob()

  // 파일명은 서버가 정한 것을 쓴다. 한글은 RFC5987 로 오므로 그쪽을 먼저 본다
  const cd = res.headers.get('Content-Disposition') ?? ''
  const star = cd.match(/filename\*=UTF-8''([^;]+)/)
  const plain = cd.match(/filename="([^"]+)"/)
  const filename = star ? decodeURIComponent(star[1]) : (plain?.[1] ?? fallbackName)

  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)

  return { ok: true, headers: res.headers }
}
