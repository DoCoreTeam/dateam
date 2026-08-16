// 엑셀에서 들여오기 (dacrm FR-13, P0)
//
// **왜 P0 인가**: 내보내기만 있고 들여오기가 없으면 **엑셀에서 CRM 으로 이사를 못 한다.**
// 지금 회사 목록이 엑셀에 있는 사람에게 "손으로 200개 넣으세요"라고 할 수는 없다.
// 그리고 그 말을 들은 사람은 CRM 을 안 쓴다.
//
// **넣기 전에 보여 준다.** 기획서는 "롤백"을 요구하지만, 되돌리기보다 **안 만드는 편**이 낫다 —
// 200행을 넣고 되돌리면 그사이 누가 그 회사에 딜을 붙였을 수 있다.
// 그래서 먼저 미리보기로 "새로 만들 것 · 이미 있는 것 · 못 넣는 것"을 세어 보여 주고,
// 사람이 확인한 뒤에만 넣는다. 되돌릴 일 자체를 만들지 않는다.
//
// **CSV 파싱은 호스트 SSOT 를 쓴다**(`lib/gpu/csv-intake.ts`) — 따옴표·개행·구분자 추정이
// 이미 검증돼 있다. 두 벌을 만들면 여기서만 깨지는 파일이 생긴다.

import { parseCsv } from '../../gpu/csv-intake.ts'
import { normalizeDomain, normalizeEmail, normalizeText } from '../domain/normalize.ts'
import { CrmError } from '../domain/errors.ts'
import type { CrmDb } from '../db/client.ts'
import type { CrmTxClient } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'

export type ImportKind = 'companies' | 'people'

export const IMPORT_LABEL: Record<ImportKind, string> = {
  companies: '회사', people: '인물',
}

/** 한 번에 받는 행 수 — 넘으면 한 판이 서버리스 시간 제한을 넘는다 */
export const MAX_ROWS = 1000

/**
 * 헤더 이름으로 칸을 알아본다.
 *
 * 사람은 "회사명"이라고도 "업체"라고도 "Company"라고도 쓴다.
 * 못 알아보면 그 칸은 버린다 — **틀리게 넣느니 안 넣는 편이 낫다.**
 */
const FIELD_ALIASES: Record<ImportKind, Record<string, string[]>> = {
  companies: {
    name: ['회사명', '회사', '업체명', '업체', '거래처', '거래처명', 'company', 'companyname', 'name', 'account', 'accountname'],
    domain: ['도메인', '홈페이지', '웹사이트', 'domain', 'website', 'url'],
    industry: ['산업', '업종', 'industry', 'sector'],
    region: ['지역', '국가', '소재지', 'region', 'country', 'location'],
    employeeRange: ['규모', '직원수', '인원', 'size', 'employees'],
    descriptionMd: ['설명', '메모', '비고', 'memo', 'description', 'note'],
  },
  people: {
    name: ['이름', '성명', '담당자', '담당자명', 'name', 'fullname', 'contact', 'contactname', 'person', 'personname'],
    companyName: ['회사명', '회사', '소속', '소속회사', '업체', 'company', 'companyname', 'account', 'organization'],
    title: ['직함', '직책', '직위', 'title', 'position', 'role'],
    email: ['이메일', '메일', 'email', 'mail', 'e-mail'],
    phone: ['전화', '연락처', '휴대폰', '전화번호', 'phone', 'mobile', 'tel'],
    memo: ['메모', '비고', '설명', 'memo', 'note', 'description'],
  },
}

/** 헤더 한 칸을 우리 필드로 — 못 알아보면 null */
export function matchField(kind: ImportKind, header: string): string | null {
  const h = header.trim().toLowerCase().replace(/[\s_-]/g, '')
  if (!h) return null
  for (const [field, aliases] of Object.entries(FIELD_ALIASES[kind])) {
    if (aliases.some((a) => a.toLowerCase().replace(/[\s_-]/g, '') === h)) return field
  }
  return null
}

export interface ImportRow {
  /** 원본 행 번호 — 사람이 엑셀에서 찾아갈 수 있게 (헤더가 1행) */
  line: number
  values: Record<string, string>
}

export interface ParsedCsv {
  /** 알아본 칸: 원본 헤더 → 우리 필드 */
  mapped: { header: string; field: string }[]
  /** 못 알아본 칸 — 숨기면 사람은 데이터가 들어간 줄 안다 */
  ignored: string[]
  rows: ImportRow[]
  truncated: boolean
}

export function parseImportCsv(kind: ImportKind, text: string): ParsedCsv {
  const table = parseCsv(text)
  if (table.length === 0) {
    throw new CrmError('VALIDATION_FAILED', '빈 파일이에요. 첫 줄에 칸 이름이 있어야 합니다.', { field: 'file' })
  }

  const header = table[0]
  const mapped: { header: string; field: string }[] = []
  const ignored: string[] = []
  const fieldOfCol = new Map<number, string>()

  header.forEach((h, i) => {
    const f = matchField(kind, h)
    // 같은 필드가 두 칸에 잡히면 앞의 것만 쓴다 — 뒤엣것이 앞을 덮으면 어느 칸이 들어갔는지 모른다
    if (f && !mapped.some((m) => m.field === f)) {
      mapped.push({ header: h, field: f })
      fieldOfCol.set(i, f)
    } else if (h.trim()) {
      ignored.push(h)
    }
  })

  if (!mapped.some((m) => m.field === 'name')) {
    throw new CrmError(
      'VALIDATION_FAILED',
      `이름 칸을 못 찾았어요. 첫 줄에 "${kind === 'companies' ? '회사명' : '이름'}" 같은 칸 이름이 있어야 합니다.`,
      { field: 'file' },
    )
  }

  const body = table.slice(1)
  const rows: ImportRow[] = []
  for (let i = 0; i < body.length && rows.length < MAX_ROWS; i++) {
    const cells = body[i]
    // 완전히 빈 줄은 건너뛴다 — 엑셀 파일 끝에 흔히 붙는다
    if (cells.every((c) => !c.trim())) continue

    const values: Record<string, string> = {}
    fieldOfCol.forEach((field, col) => {
      const v = (cells[col] ?? '').trim()
      if (v) values[field] = v
    })
    rows.push({ line: i + 2, values }) // 헤더가 1행이라 +2
  }

  return { mapped, ignored, rows, truncated: body.length > MAX_ROWS }
}

export type RowVerdict = 'create' | 'exists' | 'skip'

export interface RowPlan {
  line: number
  verdict: RowVerdict
  name: string
  /** 왜 이렇게 판정했는지 — 이유를 안 쓰면 사람이 파일을 고칠 수 없다 */
  reason: string
  values: Record<string, string>
}

export interface ImportPreview {
  kind: ImportKind
  mapped: { header: string; field: string }[]
  ignored: string[]
  plans: RowPlan[]
  counts: Record<RowVerdict, number>
  truncated: boolean
}

/** 같은 것인지 판단할 열쇠 — 이름은 흔들리니 도메인·이메일을 먼저 본다 */
function keysOf(kind: ImportKind, v: Record<string, string>): { strong: string | null; name: string | null } {
  if (kind === 'companies') {
    return { strong: normalizeDomain(v.domain), name: normalizeText(v.name)?.toLowerCase() ?? null }
  }
  return { strong: normalizeEmail(v.email), name: normalizeText(v.name)?.toLowerCase() ?? null }
}

/**
 * 넣기 전에 무엇이 일어날지 센다.
 *
 * **이미 있는 것은 건드리지 않는다.** 덮어쓰면 사람이 CRM 에서 고친 값이
 * 옛 엑셀 값으로 되돌아간다 — 그건 되돌리기가 아니라 손실이다.
 */
export async function planImport(
  db: CrmDb, kind: ImportKind, parsed: ParsedCsv,
): Promise<ImportPreview> {
  const model = kind === 'companies' ? 'crmCompany' : 'crmPerson'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (db as any)[model].findMany({
    select: kind === 'companies'
      ? { name: true, domain: true }
      : { name: true, email: true },
    take: 5000,
  }) as Record<string, string | null>[]

  const strongSet = new Set<string>()
  const nameSet = new Set<string>()
  for (const e of existing) {
    const k = keysOf(kind, {
      name: e.name ?? '',
      domain: e.domain ?? '',
      email: e.email ?? '',
    })
    if (k.strong) strongSet.add(k.strong)
    if (k.name) nameSet.add(k.name)
  }

  // 파일 안의 중복도 잡는다 — 같은 파일에 같은 회사가 두 번 있으면 두 개가 생긴다
  const seenStrong = new Set<string>()
  const seenName = new Set<string>()

  const plans: RowPlan[] = []
  const counts: Record<RowVerdict, number> = { create: 0, exists: 0, skip: 0 }

  for (const row of parsed.rows) {
    const name = row.values.name ?? ''
    const k = keysOf(kind, row.values)

    let verdict: RowVerdict
    let reason: string

    if (!name.trim()) {
      verdict = 'skip'
      reason = '이름이 비어 있어요'
    } else if (k.strong && (strongSet.has(k.strong) || seenStrong.has(k.strong))) {
      verdict = 'exists'
      reason = kind === 'companies' ? '같은 도메인이 이미 있어요' : '같은 이메일이 이미 있어요'
    } else if (k.name && (nameSet.has(k.name) || seenName.has(k.name))) {
      verdict = 'exists'
      reason = '같은 이름이 이미 있어요'
    } else {
      verdict = 'create'
      reason = '새로 만들어요'
      if (k.strong) seenStrong.add(k.strong)
      if (k.name) seenName.add(k.name)
    }

    counts[verdict] += 1
    plans.push({ line: row.line, verdict, name, reason, values: row.values })
  }

  return { kind, mapped: parsed.mapped, ignored: parsed.ignored, plans, counts, truncated: parsed.truncated }
}

export interface ImportOutcome {
  created: number
  skipped: number
  /** 넣다가 실패한 행 — 조용히 삼키면 몇 개가 들어갔는지 아무도 모른다 */
  failed: { line: number; name: string; reason: string }[]
}

/**
 * 실제로 넣는다.
 *
 * `create` 로 판정된 것만 만든다. 이미 있는 것은 손대지 않는다.
 * 한 행이 실패해도 나머지는 넣고, 실패한 행은 **번호와 함께** 돌려준다 —
 * 사람이 엑셀에서 그 줄을 찾아 고칠 수 있어야 한다.
 */
export async function applyImport(
  tx: CrmTxClient,
  kind: ImportKind,
  preview: ImportPreview,
  actorId: string | null,
): Promise<ImportOutcome> {
  const out: ImportOutcome = { created: 0, skipped: 0, failed: [] }

  // 인물은 회사 이름으로 붙인다 — 없는 회사면 회사 없이 만든다(사람을 버리지 않는다)
  const companyByName = new Map<string, string>()
  if (kind === 'people') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cos = await (tx as any).crmCompany.findMany({ select: { id: true, name: true }, take: 5000 })
    for (const c of cos as { id: string; name: string }[]) {
      companyByName.set(c.name.trim().toLowerCase(), c.id)
    }
  }

  for (const p of preview.plans) {
    if (p.verdict !== 'create') { out.skipped += 1; continue }

    try {
      if (kind === 'companies') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx as any).crmCompany.create({
          data: {
            name: p.values.name,
            domain: normalizeDomain(p.values.domain),
            industry: p.values.industry ?? null,
            region: p.values.region ?? null,
            employeeRange: p.values.employeeRange ?? null,
            descriptionMd: p.values.descriptionMd ?? null,
            source: 'IMPORT',
          },
        })
      } else {
        const coName = (p.values.companyName ?? '').trim().toLowerCase()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx as any).crmPerson.create({
          data: {
            name: p.values.name,
            companyId: coName ? companyByName.get(coName) ?? null : null,
            title: p.values.title ?? null,
            email: normalizeEmail(p.values.email),
            phone: p.values.phone ?? null,
            memo: p.values.memo ?? null,
            source: 'IMPORT',
          },
        })
      }
      out.created += 1
    } catch (e) {
      out.failed.push({ line: p.line, name: p.name, reason: e instanceof Error ? e.message : String(e) })
    }
  }

  // 한 번에 수백 건이 생긴다 — 누가 언제 무엇을 들여왔는지 남지 않으면 나중에 설명할 수 없다
  await writeAudit(tx, {
    actorType: 'HUMAN', actorId,
    action: 'import.csv',
    targetType: kind === 'companies' ? 'company' : 'person',
    targetId: 'bulk',
    afterJson: { kind, created: out.created, skipped: out.skipped, failed: out.failed.length },
  })

  return out
}
