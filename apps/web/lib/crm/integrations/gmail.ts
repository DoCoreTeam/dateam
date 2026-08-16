/**
 * Gmail 자동 캡처 (dacrm T1-10, 구현명세 §3.5)
 *
 * 이 파일이 지켜야 하는 것은 셋이다.
 *
 *   DI-21 — **같은 메일이 두 번 들어와도 활동은 1건이다.**
 *           증분 동기화는 커서가 밀리거나 잡이 겹치면 같은 메시지를 다시 준다.
 *           그때 활동이 두 줄로 늘면 타임라인이 거짓말을 시작한다.
 *
 *   §3.5-5 — **모르는 사람의 메일은 저장하지 않는다.**
 *           내부 도구라고 아무 메일이나 담으면 그건 CRM 이 아니라 사찰이다.
 *           우리 인물 명부에 있는 주소만 남긴다.
 *
 *   §3.5-4 — **딜 연결은 확실할 때만 자동으로.**
 *           열린 딜이 하나면 붙이고, 둘 이상이면 붙이지 않는다.
 *           틀린 딜에 붙은 메일은 지워도 "그 딜에 그런 메일이 있었다"는 기억을 남긴다.
 *
 * 구글 호출은 **어댑터로 분리**한다. OAuth 클라이언트(T1-09)는 사람이 발급해야 하는데,
 * 그걸 기다리는 동안 동기화 로직 전체가 검증 불가가 되면 안 되기 때문이다.
 * 실어댑터가 붙어도 이 파일은 그대로다 — 바뀌는 건 어댑터 하나뿐이다.
 */

import type { CrmDb } from '../db/client.ts'
import { getCrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { normalizeEmail } from '../domain/normalize.ts'

/** 구글이 주는 메시지 한 통 — 우리가 실제로 쓰는 필드만 */
export interface GmailMessage {
  id: string
  /** 보낸이·받는이 전부. 우리 인물과 맞춰 보려면 한쪽만으론 부족하다 */
  participants: string[]
  subject: string
  snippet: string
  /** RFC3339. 구글이 주는 값을 그대로 쓴다 — 우리가 시각을 지어내지 않는다 */
  occurredAt: string
}

export interface GmailPage {
  messages: GmailMessage[]
  /** 다음에 여기서부터 읽는다. 성공했을 때만 커서를 옮긴다 */
  nextHistoryId: string | null
}

/** 구글과 말하는 유일한 창구 */
export interface GmailAdapter {
  /** historyId 이후의 메시지. null 이면 처음부터 */
  fetchSince(accessToken: string, historyId: string | null): Promise<GmailPage>
}

export interface SyncResult {
  /** 훑어본 메시지 수 */
  scanned: number
  /** 새로 남긴 활동 수 */
  created: number
  /** 이미 있던 것(멱등으로 걸러진 수) — DI-21 이 실제로 일하고 있다는 증거 */
  duplicates: number
  /** 우리 명부에 없어 저장하지 않은 수 */
  unknown: number
  /** 열린 딜이 하나여서 자동 연결한 수 */
  linked: number
  /** 열린 딜이 여럿이라 사람에게 넘긴 수 */
  ambiguous: number
  cursor: string | null
}

const EMPTY: SyncResult = {
  scanned: 0, created: 0, duplicates: 0, unknown: 0, linked: 0, ambiguous: 0, cursor: null,
}

/**
 * 메시지 참여자를 우리 인물과 맞춘다.
 *
 * 이메일은 대소문자를 가리지 않는다 — 정규화해서 비교하지 않으면
 * "Kim@a.com" 과 "kim@a.com" 이 다른 사람이 된다.
 */
async function matchPerson(db: CrmDb, emails: string[]): Promise<{ id: string; companyId: string | null } | null> {
  const normalized = emails.map((e) => normalizeEmail(e)).filter((e): e is string => !!e)
  if (normalized.length === 0) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const people = await (db as any).crmPerson.findMany({
    where: { email: { in: normalized, mode: 'insensitive' } },
    select: { id: true, companyId: true, email: true },
  }) as { id: string; companyId: string | null; email: string | null }[]

  if (people.length === 0) return null
  // 여럿이 걸리면 첫 번째를 쓴다 — 이메일은 유니크라 실제로는 한 명이다
  return { id: people[0].id, companyId: people[0].companyId }
}

/**
 * 딜 자동 연결 판정.
 *
 * "열려 있는 딜"만 후보다. 이미 끝난 딜에 새 메일이 붙으면
 * 종료된 거래가 다시 살아 있는 것처럼 보인다.
 */
async function pickDeal(db: CrmDb, personId: string, companyId: string | null): Promise<
  { dealId: string | null; ambiguous: boolean }
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viaContact = await (db as any).crmDealContact.findMany({
    where: { personId }, select: { dealId: true },
  }) as { dealId: string }[]

  const where = viaContact.length > 0
    ? { id: { in: viaContact.map((c) => c.dealId) }, status: 'OPEN' }
    : companyId ? { companyId, status: 'OPEN' } : null
  if (!where) return { dealId: null, ambiguous: false }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const open = await (db as any).crmDeal.findMany({ where, select: { id: true }, take: 2 }) as { id: string }[]

  if (open.length === 1) return { dealId: open[0].id, ambiguous: false }
  // 0개면 붙일 곳이 없는 것이고, 2개 이상이면 사람이 골라야 한다 — 둘 다 자동 연결은 안 한다
  return { dealId: null, ambiguous: open.length > 1 }
}

/**
 * 한 연결(계정)에 대해 증분 동기화를 돈다.
 *
 * 커서는 **성공했을 때만** 옮긴다. 중간에 실패했는데 커서가 앞서 나가면
 * 그 구간의 메일은 영영 안 들어온다 — 조용히 사라지는 게 가장 나쁜 실패다.
 */
export async function syncGmail(
  workspaceId: string,
  connectionId: string,
  adapter: GmailAdapter,
  accessToken: string,
): Promise<SyncResult> {
  const db = getCrmDb(workspaceId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = await (db as any).crmIntegrationConnection.findFirst({ where: { id: connectionId } })
  if (!conn) return { ...EMPTY }
  if (conn.status !== 'active') return { ...EMPTY, cursor: conn.gmailHistoryId }

  let page: GmailPage
  try {
    page = await adapter.fetchSince(accessToken, conn.gmailHistoryId)
  } catch (e) {
    /**
     * 토큰이 죽었으면 **조용히 멈추지 않는다.**
     * status 를 error 로 두어야 설정 화면이 "다시 연결해 주세요"를 띄울 수 있다(§3.5-6).
     */
    await withCrmTx(workspaceId, async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmIntegrationConnection.updateMany({
        where: { id: connectionId }, data: { status: 'error' },
      })
      await writeAudit(tx, {
        actorType: 'SYSTEM', actorId: null, action: 'integration.errored',
        targetType: 'integration', targetId: connectionId,
        afterJson: { reason: e instanceof Error ? e.message : String(e) },
      })
    })
    return { ...EMPTY, cursor: conn.gmailHistoryId }
  }

  const out: SyncResult = { ...EMPTY, cursor: conn.gmailHistoryId }

  for (const msg of page.messages) {
    out.scanned += 1

    // 이미 담은 메일인가 — 이게 DI-21 의 전부다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exists = await (db as any).crmActivity.findFirst({
      where: { gmailMessageId: msg.id }, select: { id: true },
    })
    if (exists) { out.duplicates += 1; continue }

    const person = await matchPerson(db, msg.participants)
    if (!person) { out.unknown += 1; continue }

    const { dealId, ambiguous } = await pickDeal(db, person.id, person.companyId)
    if (dealId) out.linked += 1
    if (ambiguous) out.ambiguous += 1

    await withCrmTx(workspaceId, async (tx) => {
      /**
       * 트랜잭션 안에서 한 번 더 본다.
       *
       * 잡이 겹쳐 돌면 위의 조회와 여기 사이에 남이 먼저 넣을 수 있다.
       * DB 의 부분 유니크 인덱스(마이그 201)가 최종 방어선이지만,
       * 거기까지 가서 터지면 그 판 전체가 죽는다 — 그 전에 걸러 준다.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const again = await (tx as any).crmActivity.findFirst({
        where: { gmailMessageId: msg.id }, select: { id: true },
      })
      if (again) { out.duplicates += 1; out.created -= 0; return }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = await (tx as any).crmActivity.create({
        data: {
          type: 'EMAIL',
          occurredAt: new Date(msg.occurredAt),
          title: msg.subject || '(제목 없음)',
          body: msg.snippet,
          personId: person.id,
          companyId: person.companyId,
          dealId,
          gmailMessageId: msg.id,
          source: 'SYNC',
          raw: { participants: msg.participants } as never,
        },
        select: { id: true },
      })
      out.created += 1

      await writeAudit(tx, {
        actorType: 'SYSTEM', actorId: null, action: 'activity.captured',
        targetType: 'activity', targetId: created.id,
        afterJson: { gmailMessageId: msg.id, dealId, ambiguous },
      })
    })
  }

  // 여기까지 왔으면 이 구간은 다 처리했다 — 이제 커서를 옮긴다
  if (page.nextHistoryId) {
    await withCrmTx(workspaceId, async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmIntegrationConnection.updateMany({
        where: { id: connectionId }, data: { gmailHistoryId: page.nextHistoryId },
      })
    })
    out.cursor = page.nextHistoryId
  }

  return out
}

/**
 * 아직 실계정이 없을 때 쓰는 어댑터.
 *
 * "연동은 나중에"라고 두면 동기화 로직이 배포될 때까지 한 번도 안 돌아 본 코드가 된다.
 * 픽스처로라도 전 경로를 밟아 두면, 실키가 붙는 날 바뀌는 건 어댑터 하나뿐이다.
 */
export function mockGmailAdapter(messages: GmailMessage[], nextHistoryId = 'h-mock'): GmailAdapter {
  return {
    async fetchSince(_token, historyId) {
      // 커서 뒤의 것만 준다 — 실제 증분 동기화가 하는 일을 흉내 낸다
      const from = historyId ? messages.findIndex((m) => m.id === historyId) + 1 : 0
      return { messages: messages.slice(from), nextHistoryId }
    },
  }
}

/** 토큰이 죽은 상황을 재현하는 어댑터 — 실패 경로도 코드다 */
export function failingGmailAdapter(message = 'invalid_grant'): GmailAdapter {
  return {
    async fetchSince() { throw new Error(message) },
  }
}
