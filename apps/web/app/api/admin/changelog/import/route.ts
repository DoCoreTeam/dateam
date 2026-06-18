import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { sanitizeChanges, normalizeType, STRICT_VERSION_RE, isIsoDate } from '@/lib/changelog/normalize'
import sourceReleases from '@/lib/changelog/source.generated.json'

// POST /api/admin/changelog/import — git 자동수집 결과(빌드타임 번들 JSON)를 초안 upsert.
// 소스는 비공개 번들(source.generated.json, prebuild 생성) — public 노출 없음.
// upsert(onConflict:version, ignoreDuplicates) → 기존 버전 편집 보존 + 동시요청 race 제거 + 언바운드 조회 제거.
export async function POST() {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const list = Array.isArray(sourceReleases) ? (sourceReleases as unknown[]) : []
  if (list.length === 0) return NextResponse.json({ error: '수집된 커밋 소스가 없습니다(빌드 시 생성됩니다)' }, { status: 400 })

  const rows = list
    .map((r) => {
      const o = r as Record<string, unknown>
      const version = typeof o.version === 'string' ? o.version.trim() : ''
      if (!STRICT_VERSION_RE.test(version)) return null
      const released_at = typeof o.released_at === 'string' && isIsoDate(o.released_at) ? o.released_at : null
      return {
        version,
        released_at,
        title: typeof o.title === 'string' ? o.title.trim().slice(0, 300) : null,
        changes: sanitizeChanges(o.changes),
        type: normalizeType(o.type),
        is_published: false, // 초안 — 어드민 검토 후 게시
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 1000)

  if (rows.length === 0) return NextResponse.json({ ok: true, inserted: 0 })

  const admin = createAdminClient()
  // 기존 version은 건드리지 않음(편집 보존) — ignoreDuplicates.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('app_releases')
    .upsert(rows, { onConflict: 'version', ignoreDuplicates: true })
    .select('id')
  if (error) return NextResponse.json({ error: '가져오기 중 오류가 발생했습니다' }, { status: 500 })
  return NextResponse.json({ ok: true, inserted: (data ?? []).length, total: rows.length })
}
