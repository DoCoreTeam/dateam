import { google, Auth } from 'googleapis'
import { createAdminClient } from '@/lib/supabase/server'
import type { OAuthTokenInsert } from '@/types/database'
import type { Readable } from 'stream'

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
  await (admin as any).from('oauth_tokens').upsert(record, { onConflict: 'provider' })
}

// ── OAuth2Client 반환 ─────────────────────────────────────────
export function getOAuth2Client(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ??
    'http://localhost:4000/api/auth/google-drive/callback'

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

  const { Readable: NodeReadable } = await import('stream')
  const readableStream = NodeReadable.from(buffer)

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
export async function streamFile(
  fileId: string
): Promise<{ stream: Readable; mimeType: string; fileName: string }> {
  const auth = await refreshTokenIfNeeded()
  const drive = google.drive({ version: 'v3', auth })

  // 메타데이터 조회
  const { data: meta } = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType',
  })

  const mimeType = meta.mimeType ?? 'application/octet-stream'
  const fileName = meta.name ?? fileId

  // 파일 내용 스트림
  const { data: fileStream } = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  )

  return { stream: fileStream as Readable, mimeType, fileName }
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
