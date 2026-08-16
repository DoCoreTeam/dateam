// 내보내기 (dacrm FR-13, P0)
//
// **왜 P0 인가**: 영업은 "엑셀로 뽑아 줘"를 매주 듣는다. 임원 보고, 세무, 정산.
// 그걸 못 하면 사람은 CRM 을 **다시 엑셀로 옮겨 적는다** — 그 순간 CRM 은
// 이중 입력을 만드는 도구가 되고, 아무도 최신 상태로 유지하지 않게 된다.
//
// **금액은 minor 정수 그대로 내보내지 않는다.** 300000000 을 받은 사람은
// 그게 3억인지 300만인지 모른다. 사람이 읽는 단위로 바꾸고 통화를 함께 적는다.
//
// CSV 이스케이프는 호스트 SSOT(`csvCell`)를 쓴다 — 수식 인젝션 방어가 이미 들어 있다.
// 두 벌을 만들면 한쪽만 고치게 되고, 안 고친 쪽으로 나간 파일이 남의 엑셀에서 실행된다.

import type { CrmDb } from '../db/client.ts'
import { csvCell } from '../../admin/daily-monitoring.ts'
import { formatKstDateTimeShort, kstDateKey } from '../../datetime/kst.ts'

export type ExportKind = 'companies' | 'people' | 'deals' | 'meetings' | 'tasks'

export const EXPORT_LABEL: Record<ExportKind, string> = {
  companies: '회사', people: '인물', deals: '딜', meetings: '미팅', tasks: '할 일',
}

/** 한 번에 내보내는 상한 — 브라우저가 받아 열 수 있는 크기를 넘기지 않는다 */
const MAX_ROWS = 5000

/** 소수 자리가 없는 통화 — minor 가 곧 표시 단위다 */
const ZERO_DECIMAL = new Set(['KRW', 'JPY'])

/**
 * 금액을 사람이 읽는 수로.
 *
 * 엑셀에서 계산에 쓰려면 **숫자여야** 하므로 천단위 구분은 넣지 않는다.
 * 대신 통화를 옆 칸에 따로 적는다 — 한 칸에 "300,000,000 KRW"를 넣으면
 * 받는 사람이 다시 쪼개야 한다.
 */
function money(minor: bigint | string | null, currency: string | null): string {
  if (minor === null || minor === undefined || minor === '') return ''
  const cur = (currency ?? 'KRW').toUpperCase()
  const digits = ZERO_DECIMAL.has(cur) ? 0 : 2
  const n = Number(minor) / 10 ** digits
  if (!Number.isFinite(n) || !Number.isSafeInteger(Number(minor))) return String(minor)
  return String(n)
}

function date(v: Date | string | null): string {
  if (!v) return ''
  try { return kstDateKey(typeof v === 'string' ? v : v.toISOString()) } catch { return '' }
}

function at(v: Date | string | null): string {
  if (!v) return ''
  try { return formatKstDateTimeShort(typeof v === 'string' ? v : v.toISOString()) } catch { return '' }
}

export interface ExportResult {
  filename: string
  csv: string
  rows: number
  /** 상한에 걸려 잘렸나 — 조용히 자르면 "이게 전부"로 읽힌다 */
  truncated: boolean
}

function toCsv(header: string[], rows: string[][]): string {
  const lines = [header.map(csvCell).join(',')]
  for (const r of rows) lines.push(r.map((c) => csvCell(String(c ?? ''))).join(','))
  // 한글이 깨지지 않게 BOM 을 붙인다 — 엑셀은 이게 없으면 UTF-8 을 못 알아본다
  return '\uFEFF' + lines.join('\n')
}

export async function exportCrm(db: CrmDb, kind: ExportKind): Promise<ExportResult> {
  const take = MAX_ROWS + 1
  const today = kstDateKey(new Date().toISOString())

  if (kind === 'companies') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (db as any).crmCompany.findMany({
      select: {
        name: true, domain: true, industry: true, region: true,
        employeeRange: true, descriptionMd: true, createdAt: true, updatedAt: true,
      },
      orderBy: { name: 'asc' }, take,
    }) as Record<string, unknown>[]
    const body = rows.slice(0, MAX_ROWS).map((c) => [
      String(c.name ?? ''), String(c.domain ?? ''), String(c.industry ?? ''),
      String(c.region ?? ''), String(c.employeeRange ?? ''), String(c.descriptionMd ?? ''),
      at(c.createdAt as Date), at(c.updatedAt as Date),
    ])
    return {
      filename: `crm_회사_${today}.csv`,
      csv: toCsv(['회사명', '도메인', '산업', '지역', '규모', '설명', '만든날', '고친날'], body),
      rows: body.length, truncated: rows.length > MAX_ROWS,
    }
  }

  if (kind === 'people') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (db as any).crmPerson.findMany({
      select: {
        name: true, title: true, email: true, phone: true, memo: true,
        createdAt: true, company: { select: { name: true } },
      },
      orderBy: { name: 'asc' }, take,
    }) as Record<string, unknown>[]
    const body = rows.slice(0, MAX_ROWS).map((p) => [
      String(p.name ?? ''),
      String((p.company as { name?: string } | null)?.name ?? ''),
      String(p.title ?? ''), String(p.email ?? ''), String(p.phone ?? ''),
      String(p.memo ?? ''), at(p.createdAt as Date),
    ])
    return {
      filename: `crm_인물_${today}.csv`,
      csv: toCsv(['이름', '회사', '직함', '이메일', '전화', '메모', '만든날'], body),
      rows: body.length, truncated: rows.length > MAX_ROWS,
    }
  }

  if (kind === 'deals') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (db as any).crmDeal.findMany({
      select: {
        name: true, status: true, amountMinor: true, currency: true,
        expectedCloseDate: true, wonAt: true, lostReason: true, createdAt: true,
        company: { select: { name: true } },
        stage: { select: { name: true } },
        pipeline: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' }, take,
    }) as Record<string, unknown>[]
    const body = rows.slice(0, MAX_ROWS).map((d) => [
      String(d.name ?? ''),
      String((d.company as { name?: string } | null)?.name ?? ''),
      String((d.pipeline as { name?: string } | null)?.name ?? ''),
      String((d.stage as { name?: string } | null)?.name ?? ''),
      d.status === 'OPEN' ? '진행 중' : d.status === 'WON' ? '성사' : '실패',
      money(d.amountMinor as bigint | null, d.currency as string | null),
      String(d.currency ?? 'KRW'),
      date(d.expectedCloseDate as Date), date(d.wonAt as Date),
      String(d.lostReason ?? ''), at(d.createdAt as Date),
    ])
    return {
      filename: `crm_딜_${today}.csv`,
      csv: toCsv(
        ['딜 이름', '회사', '파이프라인', '단계', '상태', '금액', '통화', '마감 예정일', '성사일', '실패 사유', '만든날'],
        body,
      ),
      rows: body.length, truncated: rows.length > MAX_ROWS,
    }
  }

  if (kind === 'meetings') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (db as any).crmMeeting.findMany({
      select: { title: true, startedAt: true, location: true, summaryMd: true },
      orderBy: { startedAt: 'desc' }, take,
    }) as Record<string, unknown>[]
    const body = rows.slice(0, MAX_ROWS).map((m) => [
      String(m.title ?? ''), at(m.startedAt as Date), String(m.location ?? ''),
      m.summaryMd ? '정리됨' : '',
    ])
    return {
      filename: `crm_미팅_${today}.csv`,
      csv: toCsv(['제목', '일시', '장소', 'AI 정리'], body),
      rows: body.length, truncated: rows.length > MAX_ROWS,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmTask.findMany({
    select: { title: true, status: true, dueAt: true, completedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' }, take,
  }) as Record<string, unknown>[]
  const body = rows.slice(0, MAX_ROWS).map((t) => [
    String(t.title ?? ''),
    t.status === 'DONE' ? '완료' : t.status === 'CANCELED' ? '취소' : t.status === 'DOING' ? '진행 중' : '할 일',
    date(t.dueAt as Date), at(t.completedAt as Date), at(t.createdAt as Date),
  ])
  return {
    filename: `crm_할일_${today}.csv`,
    csv: toCsv(['할 일', '상태', '마감', '끝낸 때', '만든날'], body),
    rows: body.length, truncated: rows.length > MAX_ROWS,
  }
}
