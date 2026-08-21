import { google, Auth } from 'googleapis'
import { createAdminClient } from '@/lib/supabase/server'
import type { OAuthTokenInsert } from '@/types/database'
import { Readable } from 'node:stream'

type OAuth2Client = Auth.OAuth2Client

// ── 타입 ──────────────────────────────────────────────────────
export interface DriveTokens {
  accessToken: string
  refreshToken: string
  tokenExpiry: string
  accountEmail: string
}

export interface DriveUploadResult {
  fileId: string
  fileName: string
}

// ── oauth_tokens 행 타입 ──────────────────────────────────────
interface OAuthTokenRow {
  access_token: string
  refresh_token: string
  token_expiry: string
  account_email: string
}

const GOOGLE_DRIVE_PROVIDER = 'google_drive'

// ── 토큰 읽기 ────────────────────────────────────────────────
// service_role(admin client)은 RLS를 우회하여 oauth_tokens에 직접 접근
export async function getTokens(): Promise<DriveTokens | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('oauth_tokens')
    .select('access_token, refresh_token, token_expiry, account_email')
    .eq('provider', GOOGLE_DRIVE_PROVIDER)
    .maybeSingle()

  const row = data as OAuthTokenRow | null
  if (!row) return null

  const { access_token, refresh_token, token_expiry, account_email } = row
  if (!access_token || !refresh_token || !token_expiry || !account_email) return null

  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    tokenExpiry: token_expiry,
    accountEmail: account_email,
  }
}

// ── 토큰 쓰기 ────────────────────────────────────────────────
export async function saveTokens(
  tokens: DriveTokens,
  _updatedBy?: string
): Promise<void> {
  const admin = createAdminClient()
  const record: OAuthTokenInsert = {
    provider: GOOGLE_DRIVE_PROVIDER,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_expiry: tokens.tokenExpiry,
    account_email: tokens.accountEmail,
    updated_at: new Date().toISOString(),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('oauth_tokens')
    .upsert(record, { onConflict: 'provider' })

  // 저장 실패를 삼키면 화면은 "연결됨"인데 토큰은 없는 상태가 된다.
  // supabase-js는 던지지 않고 error를 돌려주므로 여기서 올려야 호출부가 안다.
  if (error) {
    throw new Error(`oauth_tokens 저장 실패: ${error.message ?? String(error)}`)
  }
}

// ── OAuth2Client 반환 ─────────────────────────────────────────
export function getOAuth2Client(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  // 폴백은 dev 서버 포트(:3000)와 같아야 한다. 예전 기본값이 :4000이라
  // env를 안 주면 동의까지 통과해도 콜백이 죽은 포트로 가서 연결이 실패했다.
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ??
    'http://localhost:3000/api/auth/google-drive/callback'

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID 또는 GOOGLE_CLIENT_SECRET 환경변수가 설정되지 않았습니다')
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

// ── 토큰 자동 갱신 ───────────────────────────────────────────
export async function refreshTokenIfNeeded(): Promise<OAuth2Client> {
  const tokens = await getTokens()
  if (!tokens) {
    throw new Error('Google Drive 연동이 설정되지 않았습니다. 먼저 OAuth 인증을 완료해주세요')
  }

  const auth = getOAuth2Client()
  auth.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expiry_date: new Date(tokens.tokenExpiry).getTime(),
  })

  const expiryMs = new Date(tokens.tokenExpiry).getTime()
  const bufferMs = 5 * 60 * 1000 // 만료 5분 전에 갱신

  if (Date.now() >= expiryMs - bufferMs) {
    const { credentials } = await auth.refreshAccessToken()

    if (credentials.access_token) {
      const newExpiry = credentials.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : new Date(Date.now() + 3600 * 1000).toISOString()

      await saveTokens({
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token ?? tokens.refreshToken,
        tokenExpiry: newExpiry,
        accountEmail: tokens.accountEmail,
      })

      auth.setCredentials(credentials)
    }
  }

  return auth
}

// ── 폴더 ensure ──────────────────────────────────────────────
export async function ensureFolder(
  name: string,
  parentId?: string
): Promise<string> {
  const auth = await refreshTokenIfNeeded()
  const drive = google.drive({ version: 'v3', auth })

  // 이미 존재하는 폴더 탐색
  const queryParts = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
  ]
  if (parentId) {
    queryParts.push(`'${parentId}' in parents`)
  }

  const { data } = await drive.files.list({
    q: queryParts.join(' and '),
    fields: 'files(id, name)',
    spaces: 'drive',
  })

  const existing = data.files?.[0]
  if (existing?.id) return existing.id

  // 폴더 생성
  const createMeta: { name: string; mimeType: string; parents?: string[] } = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  }
  if (parentId) createMeta.parents = [parentId]

  const { data: created } = await drive.files.create({
    requestBody: createMeta,
    fields: 'id',
  })

  if (!created.id) throw new Error(`폴더 생성 실패: ${name}`)
  return created.id
}

// ── 파일 업로드 ──────────────────────────────────────────────
export async function uploadFile(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  folderId: string
): Promise<string> {
  const auth = await refreshTokenIfNeeded()
  const drive = google.drive({ version: 'v3', auth })

  // 정적 import를 쓴다. 동적 `import('stream')`은 번들러를 거치면서 named export가 사라져
  // `Readable`이 undefined가 됐고, 업로드가 통째로 500이 났다
  // (실측: "Cannot read properties of undefined (reading 'from')" — 파일 올리기가 아예 안 됐다).
  const readableStream = Readable.from(buffer)

  const { data } = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: readableStream,
    },
    fields: 'id',
  })

  if (!data.id) throw new Error(`파일 업로드 실패: ${filename}`)
  return data.id
}

// ── 파일 스트리밍 ────────────────────────────────────────────
export interface StreamFileResult {
  stream: Readable
  mimeType: string
  fileName: string
  /** 전체 크기(바이트). 못 얻으면 null */
  size: number | null
  /** 부분 응답일 때 그대로 내려줄 Content-Range 값 */
  contentRange: string | null
  /** 206이면 부분 응답이다 */
  partial: boolean
}

/**
 * 응답 헤더 하나를 꺼낸다.
 * 왜 두 갈래인가: 구글 클라이언트가 버전에 따라 헤더를 **plain object** 로도, **Headers 인스턴스**
 * 로도 준다. 한쪽만 가정하면 값이 조용히 null이 되고, 206을 보내면서 Content-Range를 빼먹어
 * 브라우저가 구간을 해석하지 못한다(실측: 그래서 탐색이 안 됐다).
 */
function headerOf(res: unknown, name: string): string | null {
  const raw = (res as { headers?: unknown }).headers
  if (!raw) return null
  if (typeof (raw as Headers).get === 'function') return (raw as Headers).get(name)
  const bag = raw as Record<string, string | string[] | undefined>
  const hit = bag[name] ?? bag[name.toLowerCase()]
  if (Array.isArray(hit)) return hit[0] ?? null
  return hit ?? null
}

/**
 * 드라이브 파일을 흘려보낸다.
 *
 * `range`를 주면 그 구간만 받아 **부분 응답**으로 돌려준다.
 * 왜 필요한가: 브라우저 `<video>`는 구간 요청(Range)이 되어야 **탐색(seek)** 을 한다.
 * 편집점 분석은 영상을 초 단위로 건너뛰며 프레임을 뜨므로, Range가 없으면
 * 큰 영상에서 처음부터 전부 받아야 하고 사실상 분석이 불가능해진다.
 */
export async function streamFile(
  fileId: string,
  range?: string | null,
): Promise<StreamFileResult> {
  const auth = await refreshTokenIfNeeded()
  const drive = google.drive({ version: 'v3', auth })

  // 메타데이터 조회
  const { data: meta } = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size',
  })

  const mimeType = meta.mimeType ?? 'application/octet-stream'
  const fileName = meta.name ?? fileId
  const size = meta.size != null && Number.isFinite(Number(meta.size)) ? Number(meta.size) : null

  // 파일 내용 스트림. Range는 드라이브에 그대로 전달한다 — 우리가 잘라내지 않는다.
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream', headers: range ? { Range: range } : undefined },
  )

  const status = (res as { status?: number }).status ?? 200

  return {
    stream: res.data as Readable,
    mimeType,
    fileName,
    size,
    contentRange: headerOf(res, 'content-range'),
    partial: status === 206,
  }
}

// ── 파일 삭제 ────────────────────────────────────────────────
/**
 * 드라이브 파일을 지운다.
 *
 * **이미 없는 파일(404)은 성공으로 본다.** 사람이 드라이브에서 먼저 지웠을 수 있고,
 * 그때 잡이 매번 실패하면 그 행은 영원히 `audio_deleted_at` 을 못 받아
 * 정리 대상 목록에 영구히 남는다 — 큐가 막히는 자리다.
 */
export async function deleteFile(fileId: string): Promise<{ deleted: boolean; alreadyGone: boolean }> {
  const auth = await refreshTokenIfNeeded()
  const drive = google.drive({ version: 'v3', auth })
  try {
    await drive.files.delete({ fileId })
    return { deleted: true, alreadyGone: false }
  } catch (e) {
    // googleapis 는 판마다 code(number|string)·status·response.status 로 제각각 실어 보낸다.
    // 한 자리만 보면 404 를 놓치고, 놓치면 그 행이 영원히 정리 목록에 남는다.
    const err = e as { code?: number | string; status?: number; response?: { status?: number } }
    const status = String(err?.code ?? err?.status ?? err?.response?.status ?? '')
    if (status === '404') return { deleted: false, alreadyGone: true }
    throw e
  }
}

// ── Drive 연동 상태 확인 ──────────────────────────────────────
export async function getDriveConnectionStatus(): Promise<{
  connected: boolean
  email: string | null
}> {
  const tokens = await getTokens()
  return {
    connected: !!(tokens?.accessToken && tokens?.accountEmail),
    email: tokens?.accountEmail ?? null,
  }
}

// ── 토큰 삭제 (연동 해제) ─────────────────────────────────────
// Google revoke 엔드포인트 호출 후 DB row 삭제
export async function revokeDriveTokens(): Promise<void> {
  const tokens = await getTokens()

  // Google revoke 엔드포인트에 access_token 전송 (실패해도 로컬 삭제는 진행)
  if (tokens?.accessToken) {
    try {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.accessToken)}`,
        { method: 'POST' }
      )
    } catch {
      // revoke 실패는 무시하고 로컬 토큰만 삭제
    }
  }

  const admin = createAdminClient()
  await admin
    .from('oauth_tokens')
    .delete()
    .eq('provider', GOOGLE_DRIVE_PROVIDER)
}
