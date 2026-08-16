/**
 * 실제 Gmail 어댑터 (dacrm T1-10 실모델 연결)
 *
 * `gmail.ts` 의 동기화 로직은 어댑터 뒤에 있다. 지금까지는 mock 어댑터뿐이라
 * 전 경로가 검증은 됐지만 **진짜 메일은 한 통도 안 들어왔다.** 이 파일이 그 자리를 채운다.
 *
 * 두 가지를 조심한다.
 *
 *   ① **증분으로 읽는다.** 매번 전체 메일함을 훑으면 쿼터가 녹고, 오래된 메일이
 *      매일 새 활동으로 다시 들어온다. Gmail 은 `historyId` 로 "그 뒤에 뭐가 바뀌었나"를 준다.
 *
 *   ② **처음 연결했을 때는 history 가 없다.** 그때만 최근 것 일부를 읽어 첫 화면을 채우고,
 *      그 뒤로는 계속 증분이다. 처음부터 전체를 당기면 몇 년 치가 한 번에 들어온다.
 */

import { google, type Auth } from 'googleapis'
import type { GmailAdapter, GmailMessage, GmailPage } from './gmail.ts'

/** 처음 연결했을 때 읽어 오는 최근 메일 수 — 첫 화면을 채울 만큼만 */
const FIRST_RUN_LIMIT = 25
/** 한 번에 처리하는 상한. 넘치면 다음 판에서 이어 받는다(커서가 남아 있다) */
const PAGE_LIMIT = 50

/** 헤더에서 이름 하나를 꺼낸다 — 대소문자가 제각각이라 정규화해서 본다 */
function header(headers: { name?: string | null; value?: string | null }[], want: string): string {
  const hit = headers.find((h) => (h.name ?? '').toLowerCase() === want.toLowerCase())
  return hit?.value ?? ''
}

/**
 * `"홍길동" <hong@a.com>, kim@b.com` → `['hong@a.com', 'kim@b.com']`
 *
 * 이름은 버린다. 우리가 사람을 찾는 기준은 이메일이고,
 * 이름으로 찾으면 동명이인이 섞인다.
 */
function emails(raw: string): string[] {
  if (!raw) return []
  return raw.split(',')
    .map((part) => {
      const m = part.match(/<([^>]+)>/)
      return (m ? m[1] : part).trim().toLowerCase()
    })
    .filter((e) => e.includes('@'))
}

function toMessage(msg: {
  id?: string | null
  snippet?: string | null
  internalDate?: string | null
  payload?: { headers?: { name?: string | null; value?: string | null }[] | null } | null
}): GmailMessage | null {
  if (!msg.id) return null
  const headers = msg.payload?.headers ?? []

  const participants = [
    ...emails(header(headers, 'From')),
    ...emails(header(headers, 'To')),
    ...emails(header(headers, 'Cc')),
  ]
  // 참여자를 못 읽으면 누구와의 대화인지 알 수 없다 — 넣어 봐야 고아가 된다
  if (participants.length === 0) return null

  return {
    id: msg.id,
    participants: Array.from(new Set(participants)),
    subject: header(headers, 'Subject') || '(제목 없음)',
    snippet: msg.snippet ?? '',
    // 구글이 주는 시각을 그대로 쓴다 — 우리가 "지금"으로 채우면 타임라인이 거짓이 된다
    occurredAt: msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : new Date().toISOString(),
  }
}

export function googleGmailAdapter(): GmailAdapter {
  return {
    async fetchSince(accessToken: string, historyId: string | null): Promise<GmailPage> {
      const auth = new google.auth.OAuth2()
      auth.setCredentials({ access_token: accessToken })
      const gmail = google.gmail({ version: 'v1', auth: auth as unknown as Auth.OAuth2Client })

      let ids: string[] = []
      let nextHistoryId: string | null = null

      if (!historyId) {
        // 첫 연결 — 최근 것만 읽어 첫 화면을 채운다
        const { data } = await gmail.users.messages.list({
          userId: 'me', maxResults: FIRST_RUN_LIMIT,
          // 보낸편지함·받은편지함만. 광고·소셜 탭까지 읽으면 쓸모없는 활동이 쌓인다
          q: 'in:inbox OR in:sent',
        })
        ids = (data.messages ?? []).map((m) => m.id!).filter(Boolean)

        // 다음 판부터 증분으로 읽을 기준점
        const { data: profile } = await gmail.users.getProfile({ userId: 'me' })
        nextHistoryId = profile.historyId ?? null
      } else {
        const { data } = await gmail.users.history.list({
          userId: 'me', startHistoryId: historyId,
          historyTypes: ['messageAdded'], maxResults: PAGE_LIMIT,
        })
        ids = (data.history ?? [])
          .flatMap((h) => h.messagesAdded ?? [])
          .map((m) => m.message?.id)
          .filter((id): id is string => !!id)
        // 변화가 없으면 커서를 그대로 둔다(null 이면 gmail.ts 가 안 옮긴다)
        nextHistoryId = data.historyId ?? historyId
      }

      // 중복 id 는 한 번만 읽는다 — 같은 메일이 여러 history 항목에 나올 수 있다
      const unique = Array.from(new Set(ids)).slice(0, PAGE_LIMIT)

      const messages: GmailMessage[] = []
      for (const id of unique) {
        try {
          const { data } = await gmail.users.messages.get({
            userId: 'me', id,
            // 본문 전체는 안 받는다 — 미리보기(snippet)면 충분하고, 전문 보관은 사생활 부담이 크다
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Cc', 'Subject'],
          })
          const m = toMessage(data)
          if (m) messages.push(m)
        } catch (e) {
          // 한 통이 안 읽힌다고 판 전체를 버리지 않는다 — 지워졌거나 권한이 없는 메일일 수 있다
          console.error('[crm/gmail] 메시지 조회 실패:', id, e)
        }
      }

      return { messages, nextHistoryId }
    },
  }
}
