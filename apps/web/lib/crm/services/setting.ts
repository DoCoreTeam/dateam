/**
 * 설정 체계 (dacrm T1-08, 구현명세 §4.4-1)
 *
 * 코드에 모델명·벤더명을 박지 않는 이유는 하나다: **바꾸려면 배포해야 하기 때문**이다.
 * 모델은 몇 달마다 바뀌고, 그때마다 배포를 기다리면 그 사이 비싼 모델이 계속 돈다.
 *
 * 두 층으로 읽는다(스키마 CrmSettingScope):
 *   GLOBAL     — 전 워크스페이스 기본값
 *   WORKSPACE  — 이 워크스페이스만의 값. 있으면 GLOBAL 을 덮는다
 *
 * 시크릿(API 키)은 **평문으로 두지 않는다.** 저장은 AES-256-GCM, 읽기는 두 갈래다 —
 * 서버가 쓸 때는 복호하고, 화면에 줄 때는 마스킹만 준다.
 * 화면에 한 번이라도 평문으로 내보내면 그때부터 브라우저 기록·로그에 남는다.
 *
 * **AI API 키는 여기에 두지 않는다.** 호스트 시스템 설정(→ 통합)에 Gemini·Claude·OpenAI
 * 키가 이미 있고 AI 채팅·GPU 추출·회의록이 전부 그것으로 돈다. 같은 키를 두 곳에서 받으면
 * 사용자는 같은 값을 두 번 넣어야 하고, 한쪽만 바꾸면 CRM 만 조용히 옛 키로 돈다.
 * CRM 이 정하는 건 **어느 AI 를 쓸지**뿐이다(`ai.model.*`).
 * 음성 인식만 여기 남는다 — 호스트에 그 연동이 없기 때문이다.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'

export type SettingScope = 'GLOBAL' | 'WORKSPACE'

/**
 * 등록된 설정 키만 쓴다.
 *
 * 자유 문자열로 두면 오타 하나가 조용히 다른 키를 만들고, 화면은 저장됐다고 하는데
 * 읽는 쪽은 기본값을 계속 쓴다. 그 사이 아무도 이상을 못 느낀다.
 */
export interface SettingDef {
  key: string
  label: string
  /** 값 종류 — 화면이 어떤 입력을 그릴지 정한다 */
  kind: 'text' | 'number' | 'secret' | 'choice'
  /**
   * `choice` 일 때 고를 수 있는 것.
   *
   * 함수인 이유: 선택지가 **지금 등록된 AI 키**에 따라 달라진다.
   * 목록을 코드에 박아 두면 키가 없는 것까지 보여 주고, 사용자는 고른 뒤에야
   * "그건 안 됩니다"를 듣는다. 고를 수 없는 것은 아예 안 보여야 한다.
   */
  choices?: (ctx: SettingContext) => { value: string; label: string; hint?: string }[]
  /** 코드 기본값 — 설정이 하나도 없어도 시스템이 돈다 */
  fallback: unknown
  description: string
}

/** 선택지를 정할 때 참고하는 것 — 지금 어떤 AI 키가 살아 있나 */
export interface SettingContext {
  /** 호스트 시스템 설정에 키가 등록된 프로바이더들 */
  availableProviders: { id: string; label: string; model: string }[]
  /** 호스트가 기본으로 쓰는 프로바이더 */
  defaultProvider: string | null
}

export const SETTING_DEFS: readonly SettingDef[] = [
  {
    key: 'ai.model.extract', label: '추출에 쓸 AI', kind: 'choice',
    fallback: 'auto',
    description: '명함·미팅에서 정보를 뽑을 때 쓸 AI입니다. 키는 시스템 설정에 등록된 것을 그대로 씁니다.',
    choices: (ctx) => [
      {
        value: 'auto',
        label: ctx.defaultProvider
          ? `자동 (지금은 ${ctx.availableProviders.find((p) => p.id === ctx.defaultProvider)?.label ?? ctx.defaultProvider})`
          : '자동',
        hint: '시스템 설정의 기본 AI를 따릅니다. 기본 AI를 바꾸면 여기도 같이 바뀝니다.',
      },
      // 키가 등록된 것만 — 못 쓰는 걸 보여 주면 고른 뒤에야 실패를 듣는다
      ...ctx.availableProviders.map((p) => ({
        value: p.id, label: p.label, hint: `모델: ${p.model}`,
      })),
      {
        value: 'mock', label: 'AI 안 씀 (규칙만)',
        hint: 'AI를 부르지 않고 정해진 규칙으로만 읽습니다. 비용이 들지 않지만 정확도가 낮습니다.',
      },
    ],
  },
] as const

/**
 * **아직 안 쓰는 설정은 화면에 두지 않는다.**
 *
 * 음성 인식(`stt.vendor`·`stt.api_key`)은 미팅 녹음 기능(Phase 2)이 붙어야 쓸 데가 생긴다.
 * 그런데 입력창을 먼저 띄워 두면 사용자는 키를 넣고 아무 일도 안 일어나는 걸 보게 된다 —
 * 그건 빈 칸보다 나쁘다. 빈 칸은 적어도 "아직 없구나"라고 알려 준다.
 *
 * 녹음 기능을 붙일 때 여기 두 줄을 SETTING_DEFS 로 옮긴다.
 */
export const PLANNED_SETTINGS = [
  { key: 'ai.model.summary', label: '요약에 쓸 AI', reason: '미팅 요약 기능이 붙으면 씁니다' },
  { key: 'stt.vendor', label: '음성 인식 업체', reason: '미팅 녹음 기능이 붙으면 씁니다' },
  { key: 'stt.api_key', label: '음성 인식 키', reason: '미팅 녹음 기능이 붙으면 씁니다' },
] as const

const DEF_BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]))

export function settingDef(key: string): SettingDef {
  const d = DEF_BY_KEY.get(key)
  if (!d) throw new CrmError('VALIDATION_FAILED', '알 수 없는 설정입니다.', { field: 'key' })
  return d
}

// ------------------------------------------------------------
// 시크릿 암호화
// ------------------------------------------------------------

/**
 * 암호화 키.
 *
 * 없으면 **평문으로 떨어지지 않고 거절한다.** 평문 폴백을 두면 키를 안 넣은 환경에서
 * API 키가 그대로 DB 에 들어가고, 그 사실을 아무도 모른다.
 */
function masterKey(): Buffer {
  const raw = process.env.CRM_SETTING_KEY
  if (!raw) {
    throw new CrmError('VALIDATION_FAILED',
      '시크릿을 저장할 수 없습니다. 서버에 암호화 키가 설정되지 않았습니다.')
  }
  // 길이가 제각각인 환경변수를 32바이트로 고정한다
  return createHash('sha256').update(raw).digest()
}

/** iv:tag:cipher (base64) — iv 를 매번 새로 뽑아 같은 평문도 다른 암호문이 된다 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', masterKey(), iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`
}

export function decryptSecret(stored: string): string {
  const [ivB, tagB, encB] = stored.split(':')
  if (!ivB || !tagB || !encB) {
    throw new CrmError('VALIDATION_FAILED', '저장된 시크릿을 읽을 수 없습니다.')
  }
  const d = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB, 'base64'))
  d.setAuthTag(Buffer.from(tagB, 'base64'))
  return Buffer.concat([d.update(Buffer.from(encB, 'base64')), d.final()]).toString('utf8')
}

/**
 * 화면에 보낼 마스킹.
 *
 * 뒤 4자만 남기는 이유: 사용자가 "어느 키를 넣었는지"는 알아야 바꿀지 판단한다.
 * 전부 가리면 키가 있는지조차 헷갈리고, 더 보여 주면 그건 노출이다.
 */
export function maskSecret(plain: string): string {
  if (plain.length <= 4) return '••••'
  return `••••${plain.slice(-4)}`
}

// ------------------------------------------------------------
// 읽기 — GLOBAL 을 WORKSPACE 가 덮는다
// ------------------------------------------------------------

export interface ResolvedSetting {
  key: string
  value: unknown
  /** 이 값이 어디서 왔나 — 화면이 "기본값 사용 중"을 보여 줄 수 있어야 한다 */
  source: 'WORKSPACE' | 'GLOBAL' | 'FALLBACK'
  isSecret: boolean
}

/**
 * 설정 하나를 푼다.
 *
 * 워크스페이스 가드가 CrmAppSetting 을 GLOBAL(null) + 내 워크스페이스로 좁혀 주므로
 * 여기서는 둘 중 어느 것이 이기는지만 정한다.
 */
export async function resolveSetting(db: CrmDb, key: string): Promise<ResolvedSetting> {
  const def = settingDef(key)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmAppSetting.findMany({
    where: { key },
    select: { scope: true, valueJson: true, isSecret: true },
  }) as { scope: SettingScope; valueJson: unknown; isSecret: boolean }[]

  const ws = rows.find((r) => r.scope === 'WORKSPACE')
  const global = rows.find((r) => r.scope === 'GLOBAL')
  const hit = ws ?? global

  if (!hit) return { key, value: def.fallback, source: 'FALLBACK', isSecret: def.kind === 'secret' }

  // 시크릿은 여기서 풀지 않는다 — 푸는 곳을 한 군데(readSecret)로 좁혀야 유출 경로를 셀 수 있다
  return {
    key,
    value: hit.isSecret ? null : hit.valueJson,
    source: ws ? 'WORKSPACE' : 'GLOBAL',
    isSecret: hit.isSecret,
  }
}

/** 서버가 실제로 쓸 시크릿 값. 화면으로 나가는 경로에서는 절대 부르지 않는다 */
export async function readSecret(db: CrmDb, key: string): Promise<string | null> {
  const def = settingDef(key)
  if (def.kind !== 'secret') {
    throw new CrmError('VALIDATION_FAILED', '시크릿이 아닌 설정입니다.', { field: 'key' })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmAppSetting.findMany({
    where: { key }, select: { scope: true, valueJson: true },
  }) as { scope: SettingScope; valueJson: unknown }[]

  const hit = rows.find((r) => r.scope === 'WORKSPACE') ?? rows.find((r) => r.scope === 'GLOBAL')
  if (!hit || typeof hit.valueJson !== 'string') return null
  return decryptSecret(hit.valueJson)
}

/** 설정 화면이 읽는 목록 — 시크릿은 마스킹만 나간다 */
export async function listSettings(db: CrmDb, ctx?: SettingContext): Promise<{
  key: string
  label: string
  kind: SettingDef['kind']
  description: string
  value: string | null
  masked: string | null
  source: ResolvedSetting['source']
  /** choice 일 때 고를 수 있는 것 — 없으면 화면이 드롭다운을 못 그린다 */
  choices?: { value: string; label: string; hint?: string }[]
}[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmAppSetting.findMany({
    select: { scope: true, key: true, valueJson: true, isSecret: true },
  }) as { scope: SettingScope; key: string; valueJson: unknown; isSecret: boolean }[]

  return SETTING_DEFS.map((def) => {
    const mine = rows.filter((r) => r.key === def.key)
    const hit = mine.find((r) => r.scope === 'WORKSPACE') ?? mine.find((r) => r.scope === 'GLOBAL')
    const source: ResolvedSetting['source'] = hit
      ? (mine.find((r) => r.scope === 'WORKSPACE') ? 'WORKSPACE' : 'GLOBAL')
      : 'FALLBACK'

    if (def.kind === 'secret') {
      let masked: string | null = null
      if (hit && typeof hit.valueJson === 'string') {
        // 마스킹 실패가 화면 전체를 막지 않게 한다 — 키가 깨졌다는 사실만 보이면 된다
        try { masked = maskSecret(decryptSecret(hit.valueJson)) } catch { masked = '(읽을 수 없음)' }
      }
      return { ...pick(def, ctx), value: null, masked, source }
    }

    const value = hit ? String(hit.valueJson ?? '') : (def.fallback === null ? '' : String(def.fallback))
    return { ...pick(def, ctx), value, masked: null, source }
  })
}

/**
 * 화면에 내보낼 모양.
 *
 * 선택지는 **지금 등록된 AI 키**에 따라 달라지므로 ctx 를 받아 그때 만든다.
 * 목록을 코드에 박아 두면 키가 없는 것까지 보여 주고, 사용자는 고른 뒤에야 실패를 듣는다.
 */
function pick(d: SettingDef, ctx?: SettingContext) {
  return {
    key: d.key, label: d.label, kind: d.kind, description: d.description,
    choices: d.choices && ctx ? d.choices(ctx) : undefined,
  }
}

// ------------------------------------------------------------
// 쓰기 — 감사에 남기되 값은 남기지 않는다
// ------------------------------------------------------------

export async function setSetting(
  workspaceId: string,
  actorId: string | null,
  key: string,
  rawValue: string | number | null,
): Promise<void> {
  const def = settingDef(key)
  const isSecret = def.kind === 'secret'

  if (rawValue === null || rawValue === '') {
    await clearSetting(workspaceId, actorId, key)
    return
  }

  if (def.kind === 'number' && Number.isNaN(Number(rawValue))) {
    throw new CrmError('VALIDATION_FAILED', '숫자를 입력해 주세요.', { field: key })
  }

  const stored: unknown = isSecret ? encryptSecret(String(rawValue)) : rawValue

  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (tx as any).crmAppSetting.findFirst({
      where: { key, scope: 'WORKSPACE' }, select: { id: true },
    })

    if (existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmAppSetting.updateMany({
        where: { id: existing.id }, data: { valueJson: stored as never, isSecret, updatedById: actorId },
      })
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmAppSetting.create({
        data: {
          scope: 'WORKSPACE', key, valueJson: stored as never,
          isSecret, description: def.description, updatedById: actorId,
        },
      })
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'setting.changed',
      targetType: 'setting', targetId: key,
      // 시크릿은 감사에도 값을 남기지 않는다 — 감사 로그가 키 유출 경로가 되면 안 된다
      afterJson: isSecret ? { key, changed: true } : { key, value: rawValue },
    })
  })
}

/** 워크스페이스 설정을 지운다 — GLOBAL 또는 코드 기본값으로 돌아간다 */
export async function clearSetting(
  workspaceId: string,
  actorId: string | null,
  key: string,
): Promise<void> {
  settingDef(key)

  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmAppSetting.deleteMany({ where: { key, scope: 'WORKSPACE' } })
    if (res.count === 0) return

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'setting.cleared',
      targetType: 'setting', targetId: key, afterJson: { key },
    })
  })
}
