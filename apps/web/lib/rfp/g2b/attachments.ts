/**
 * 공고에 붙은 첨부를 그대로 받아 온다 (사용자 개입)
 *
 * ## 왜 필요한가
 *
 * 공고에는 제안요청서·과업내용서·서식이 **이미 붙어 있다.** 그걸 사람이 다시 내려받아
 * 다시 올리게 하면, 시스템이 이미 아는 것을 두 번 시키는 것이다.
 * 공고를 골랐으면 첨부는 따라와야 한다.
 *
 * ## 나라장터 응답의 모양
 *
 * 첨부는 `ntceSpecDocUrl1~10` 과 `ntceSpecFileNm1~10` 짝으로 온다. 번호는 비어 있을 수 있고
 * 중간이 비기도 한다 — 1번이 없다고 2번이 없는 것이 아니다.
 *
 * ## 받은 것을 그대로 믿지 않는다
 *
 * 주소가 우리 도메인 밖이라는 이유로 아무 파일이나 받으면 안 된다.
 * 크기 상한을 넘거나 종류를 모르면 **버리고 사유를 남긴다** — 파이프라인이
 * 「행은 있는데 원문이 없는」 파일로 막히는 것보다 낫다.
 */

/** 나라장터가 주는 첨부 칸 수 */
export const MAX_SLOTS = 10

/** 첨부 하나에 이만큼 기다린다. 기관 파일 서버는 느린 곳이 많다 */
export const DOWNLOAD_TIMEOUT_MS = 60_000

export interface NoticeAttachment {
  fileName: string
  url: string
  slot: number
}

/**
 * 공고 행에서 첨부 목록을 뽑는다.
 *
 * 이름이 없으면 주소 끝을 이름으로 쓴다 — 이름 없는 파일은 화면에서 서로 구분이 안 된다.
 */
export function attachmentsOf(row: Record<string, unknown>): NoticeAttachment[] {
  const out: NoticeAttachment[] = []
  for (let i = 1; i <= MAX_SLOTS; i += 1) {
    const url = str(row[`ntceSpecDocUrl${i}`])
    if (!url) continue
    const name = str(row[`ntceSpecFileNm${i}`]) ?? fileNameOf(url) ?? `첨부${i}`
    out.push({ fileName: name, url, slot: i })
  }
  return out
}

/** 주소 끝에서 파일 이름을 건진다 */
export function fileNameOf(url: string): string | null {
  try {
    const path = new URL(url).pathname
    const last = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '')
    return last && /\.[A-Za-z0-9]{1,5}$/.test(last) ? last : null
  } catch {
    const last = url.split('/').filter(Boolean).pop() ?? ''
    return /\.[A-Za-z0-9]{1,5}$/.test(last) ? last : null
  }
}

/**
 * 응답 헤더에서 진짜 파일 이름을 얻는다.
 *
 * **주소에 이름이 없는 경우가 흔하다.** 실측(NIA): 첨부 주소가
 * `Download.do?bcIdx=29975&fileNo=1` 이고 이름은 `Content-Disposition` 에만 있다.
 * 헤더를 안 읽으면 이름이 「첨부1」이 되고 확장자가 없어 **종류 판정이 실패하고
 * 파싱이 통째로 죽는다** — 다운로드는 성공했는데 분석이 안 되는 가장 나쁜 모양이다.
 *
 * `filename*=UTF-8''…`(RFC 5987)이 먼저다. 한글 이름은 대개 이쪽으로 온다.
 */
export function nameFromDisposition(header: string | null): string | null {
  if (!header) return null

  const star = header.match(/filename\*\s*=\s*([^;]+)/i)
  if (star) {
    const raw = star[1].trim().replace(/^["']|["']$/g, '')
    // charset''value 모양. charset 은 무시하고 값만 푼다
    const value = raw.includes("''") ? raw.split("''").slice(1).join("''") : raw
    const decoded = safeDecode(value)
    if (decoded) return decoded
  }

  const plain = header.match(/filename\s*=\s*("([^"]+)"|[^;]+)/i)
  if (plain) {
    const raw = (plain[2] ?? plain[1]).trim().replace(/^["']|["']$/g, '')
    // 퍼센트 인코딩된 채로 오는 서버가 많다(실측 NIA)
    const decoded = safeDecode(raw)
    if (decoded) return decoded
  }
  return null
}

function safeDecode(v: string): string | null {
  const trimmed = v.trim()
  if (!trimmed) return null
  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

/** 파일 이름에 확장자가 없으면 붙여 준다 — 종류 판정이 확장자를 본다 */
export function withExtension(fileName: string, contentType: string | null): string {
  if (/\.[A-Za-z0-9]{1,5}$/.test(fileName)) return fileName
  const ext = EXT_BY_TYPE[(contentType ?? '').split(';')[0].trim().toLowerCase()]
  return ext ? `${fileName}.${ext}` : fileName
}

const EXT_BY_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/haansofthwp': 'hwp',
  'application/x-hwp': 'hwp',
  'application/vnd.hancom.hwp': 'hwp',
  'application/vnd.hancom.hwpx': 'hwpx',
  'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/html': 'html',
  // 공공기관 파일 서버는 종류를 안 알려 주고 octet-stream 으로만 보낸다.
  // 그때는 매직바이트가 판정한다(lib/rfp/parse/quality) — 여기서 억지로 정하지 않는다
}

export type DownloadReason = 'http_error' | 'timeout' | 'too_large' | 'empty' | 'fetch_failed'

export type DownloadResult =
  | { ok: true; bytes: Uint8Array; fileName: string; contentType: string | null }
  | { ok: false; reason: DownloadReason; detail: string }

export interface DownloadOptions {
  maxBytes: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * 첨부 하나를 받는다.
 *
 * **크기를 헤더로 먼저 본다.** 200MB 를 다 받고 나서 거절하면 거절 한 번에 200MB 를 쓴다.
 * 헤더가 없으면 받으면서 세고, 넘는 순간 끊는다.
 */
export async function downloadAttachment(
  att: NoticeAttachment, opts: DownloadOptions,
): Promise<DownloadResult> {
  const f = opts.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DOWNLOAD_TIMEOUT_MS)

  try {
    const res = await f(att.url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; RFP-Radar/1.0)' },
    })
    if (!res.ok) return { ok: false, reason: 'http_error', detail: String(res.status) }

    const declared = Number(res.headers?.get?.('content-length') ?? 0)
    if (declared > opts.maxBytes) {
      return { ok: false, reason: 'too_large', detail: `${declared}` }
    }

    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength === 0) return { ok: false, reason: 'empty', detail: '0바이트' }
    if (buf.byteLength > opts.maxBytes) {
      return { ok: false, reason: 'too_large', detail: `${buf.byteLength}` }
    }

    const contentType = res.headers?.get?.('content-type') ?? null
    // 헤더의 이름이 가장 정확하다 — 주소에 이름이 없는 첨부가 흔하다
    const headerName = nameFromDisposition(res.headers?.get?.('content-disposition') ?? null)
    const fileName = withExtension(headerName ?? att.fileName, contentType)
    return { ok: true, bytes: buf, fileName, contentType }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      reason: message.includes('abort') ? 'timeout' : 'fetch_failed',
      detail: message.slice(0, 200),
    }
  } finally {
    clearTimeout(timer)
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
