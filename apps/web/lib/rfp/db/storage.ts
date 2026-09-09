/**
 * 원문 보관함 (마이그레이션 250)
 *
 * ## 경로가 왜 해시인가
 *
 * `{org}/{case}/{sha256}.bin` 이다. 같은 파일을 두 번 올리면 **같은 경로**가 나온다 —
 * 그래서 올리기가 멱등이고, 워커가 되살아나 다시 돌아도 사본이 안 쌓인다.
 * 파일 ID 를 경로에 쓰면 행을 먼저 만들어야 하고, 그러면 「행은 있는데 바이트는 없는」
 * 중간 상태가 생긴다. 그 상태가 지금 이 저장소에서 실제로 났던 고장이다.
 *
 * ## 이름을 경로에 안 쓰는 이유
 *
 * 원문 이름은 한글·공백·괄호가 섞여 있고 Storage 키가 그걸 그대로 못 받는다.
 * 이름은 표(`original_name`)가 갖는다 — 경로는 찾기 위한 것이지 읽기 위한 것이 아니다.
 */

export const RFP_BUCKET = 'rfp-docs'

/** 파싱 결과(IR) 를 통째로 두는 자리. 표에는 못 담는 표·그림까지 여기 남는다 */
export const IR_SUFFIX = 'ir.json'

/** 원문 바이트 경로 */
export function filePath(orgId: string, caseId: string, sha256: string): string {
  return `${orgId}/${caseId}/${sha256}.bin`
}

/** IR 경로 — 파일 하나에 판(version) 하나 */
export function irPath(orgId: string, caseId: string, fileId: string, version: number): string {
  return `${orgId}/${caseId}/ir/${fileId}.v${version}.${IR_SUFFIX}`
}

/** 경로에서 조직을 되읽는다 — 정책이 1단계 폴더를 org_id 로 본다 */
export function orgOfPath(path: string): string | null {
  const first = path.split('/')[0]
  return first && first.length > 0 ? first : null
}

/** supabase-js 의 storage 만큼만 필요하다 — 테스트가 가짜를 끼울 수 있게 좁게 잡는다 */
export interface StorageClient {
  storage: {
    from(bucket: string): {
      upload(path: string, body: ArrayBuffer | Uint8Array | Blob, opts?: Record<string, unknown>):
        Promise<{ data: unknown; error: unknown }>
      download(path: string): Promise<{ data: Blob | null; error: unknown }>
      remove(paths: string[]): Promise<{ data: unknown; error: unknown }>
    }
  }
}

/**
 * 바이트를 올린다. 같은 경로면 덮는다(upsert) — 경로가 해시라 내용이 같다.
 *
 * supabase-js 는 실패를 **던지지 않고 돌려준다.** 검사하지 않으면 0바이트가
 * 조용히 성공으로 지나가고, 그 사실은 몇 주 뒤 파싱이 전부 실패할 때 드러난다.
 */
export async function putBytes(
  db: StorageClient, path: string, bytes: Uint8Array, contentType?: string,
): Promise<void> {
  const { error } = await db.storage.from(RFP_BUCKET).upload(path, bytes, {
    upsert: true,
    contentType: contentType && contentType.length > 0 ? contentType : 'application/octet-stream',
  })
  if (error) throw new Error(`원문을 저장하지 못했다(${path}): ${describe(error)}`)
}

/** 바이트를 읽는다. 없으면 그 사실을 던진다 — null 로 돌려주면 호출부가 빈 문서로 이어 간다 */
export async function getBytes(db: StorageClient, path: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(RFP_BUCKET).download(path)
  if (error || !data) throw new Error(`원문을 읽지 못했다(${path}): ${describe(error)}`)
  return new Uint8Array(await data.arrayBuffer())
}

/** IR 을 통째로 둔다 */
export async function putJson(db: StorageClient, path: string, value: unknown): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const { error } = await db.storage.from(RFP_BUCKET).upload(path, bytes, {
    upsert: true, contentType: 'application/json',
  })
  if (error) throw new Error(`파싱 결과를 저장하지 못했다(${path}): ${describe(error)}`)
}

/** IR 을 되읽는다 */
export async function getJson<T>(db: StorageClient, path: string): Promise<T> {
  const { data, error } = await db.storage.from(RFP_BUCKET).download(path)
  if (error || !data) throw new Error(`파싱 결과를 읽지 못했다(${path}): ${describe(error)}`)
  return JSON.parse(await data.text()) as T
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}
