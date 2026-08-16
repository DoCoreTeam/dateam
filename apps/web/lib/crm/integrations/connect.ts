/**
 * CRM 구글 연결 저장·조회 (dacrm T1-09 재개판)
 *
 * **T1-09 는 사람이 열어야 하는 문이 아니었다.** 호스트에 Google OAuth 클라이언트가
 * 이미 있고(`GOOGLE_CLIENT_ID`), Drive 연동이 그것으로 몇 달째 돌고 있었다.
 * 없는 것은 클라이언트가 아니라 **CRM 이 그 클라이언트를 쓰는 배선**이었다.
 * 확인하지 않고 "사람이 발급해야 한다"고 적었던 것을 여기서 바로잡는다.
 *
 * 저장 위치가 Drive 와 다른 이유: Drive 는 조직 하나의 저장소라 `oauth_tokens` 한 행이면 되지만,
 * CRM 은 **누구의 메일함인지**가 핵심이다. 팀원 셋이 각자 자기 계정을 붙여야
 * 각 담당자의 대화가 제 딜에 붙는다. 그래서 `CrmIntegrationConnection`(멤버별)에 넣는다.
 *
 * 토큰은 평문으로 두지 않는다 — 설정 시크릿과 같은 AES-256-GCM 을 쓴다.
 * 토큰이 새면 그 사람의 메일함 전체가 새는 것이라 설정 키보다 더 무겁다.
 */

import { withCrmTx } from '../db/tx.ts'
import { getCrmDb } from '../db/client.ts'
import { writeAudit } from '../db/audit.ts'
import { encryptSecret, decryptSecret } from '../services/setting.ts'
import { resolveCrmAccess } from '../auth/requireCrmMember.ts'
import { CrmError } from '../domain/errors.ts'

export interface GoogleTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  scopes: string
}

/**
 * 연결을 저장한다. 이미 있으면 갱신한다 —
 * 다시 연결하는 사람은 "고치려고" 온 것이지 두 번째 계정을 만들려는 게 아니다.
 */
export async function saveCrmGoogleConnection(tokens: GoogleTokens): Promise<void> {
  const access = await resolveCrmAccess()
  if (!access.ok) throw new CrmError('FORBIDDEN', '영업 CRM 멤버만 연동할 수 있습니다.')

  const { workspaceId, memberId } = access.session

  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (tx as any).crmIntegrationConnection.findFirst({
      where: { memberId, provider: 'google' }, select: { id: true },
    })

    const data = {
      scopes: tokens.scopes,
      accessTokenEnc: encryptSecret(tokens.accessToken),
      refreshTokenEnc: encryptSecret(tokens.refreshToken),
      expiresAt: tokens.expiresAt,
      // 다시 연결했으니 지난번 실패는 지운다 — error 로 남겨 두면 배너가 안 사라진다
      status: 'active',
    }

    if (existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmIntegrationConnection.updateMany({ where: { id: existing.id }, data })
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmIntegrationConnection.create({
        data: { ...data, memberId, provider: 'google' },
      })
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId: memberId, action: 'integration.connected',
      targetType: 'integration', targetId: memberId,
      // 토큰은 감사에도 남기지 않는다 — 감사 로그가 유출 경로가 되면 안 된다
      afterJson: { provider: 'google', scopes: tokens.scopes },
    })
  })
}

/**
 * 동기화가 쓸 액세스 토큰을 꺼낸다.
 *
 * 만료됐으면 **갱신해서 돌려준다.** 여기서 안 하면 잡마다 "만료라서 못 했다"가 되고,
 * 그건 연동이 있는데 안 도는 것과 같다.
 */
export async function getCrmAccessToken(
  workspaceId: string,
  connectionId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const db = getCrmDb(workspaceId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = await (db as any).crmIntegrationConnection.findFirst({ where: { id: connectionId } })
  if (!conn || conn.status !== 'active') return null

  const expires = conn.expiresAt ? new Date(conn.expiresAt).getTime() : 0
  // 5분 여유 — 요청 도중 만료되면 그 잡만 실패한다
  if (expires - now.getTime() > 5 * 60 * 1000) {
    return decryptSecret(conn.accessTokenEnc)
  }

  const refreshed = await refreshGoogleToken(decryptSecret(conn.refreshTokenEnc))
  if (!refreshed) {
    // 갱신이 안 되면 사람이 다시 연결해야 한다 — 조용히 null 만 돌려주지 않고 상태를 남긴다
    await withCrmTx(workspaceId, async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmIntegrationConnection.updateMany({
        where: { id: connectionId }, data: { status: 'error' },
      })
    })
    return null
  }

  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmIntegrationConnection.updateMany({
      where: { id: connectionId },
      data: {
        accessTokenEnc: encryptSecret(refreshed.accessToken),
        expiresAt: refreshed.expiresAt,
        status: 'active',
      },
    })
  })
  return refreshed.accessToken
}

/**
 * 리프레시 토큰으로 새 액세스 토큰을 받는다.
 *
 * 호스트의 `getOAuth2Client()` 를 쓴다 — 클라이언트 ID·시크릿을 두 곳에 두지 않는다.
 */
async function refreshGoogleToken(refreshToken: string): Promise<
  { accessToken: string; expiresAt: Date } | null
> {
  try {
    const { getOAuth2Client } = await import('../../google-drive.ts')
    const auth = getOAuth2Client()
    auth.setCredentials({ refresh_token: refreshToken })
    const { credentials } = await auth.refreshAccessToken()
    if (!credentials.access_token) return null
    return {
      accessToken: credentials.access_token,
      expiresAt: credentials.expiry_date
        ? new Date(credentials.expiry_date)
        : new Date(Date.now() + 3600 * 1000),
    }
  } catch (e) {
    console.error('[crm/connect] 토큰 갱신 실패:', e)
    return null
  }
}
