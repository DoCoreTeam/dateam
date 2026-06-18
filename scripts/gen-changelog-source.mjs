// 빌드타임 체인지로그 자동수집 — git log → apps/web/public/changelog-source.json
// (Vercel 런타임은 git 접근 불가 → 빌드 시 굳혀 두고, 어드민 "가져오기"가 이 JSON을 upsert)
// SSOT 파서 재사용: apps/web/lib/changelog/parse-commits.ts (type-only import라 strip-types로 로드 가능)
// 실행: node --experimental-strip-types scripts/gen-changelog-source.mjs

import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseCommits } from '../apps/web/lib/changelog/parse-commits.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 번들 정적 import용(비공개) — public 노출 금지(커밋 제목·내부표현 누출 방지). import 라우트가 정적 import.
const OUT = join(__dirname, '..', 'apps', 'web', 'lib', 'changelog', 'source.generated.json')

function readCommits() {
  try {
    // 탭 구분: 날짜<TAB>제목. 최신순. 충분히 큰 상한.
    const raw = execSync('git log --pretty=format:%ad%x09%s --date=short -n 2000', { encoding: 'utf8' })
    return raw.split('\n').filter(Boolean).map((line) => {
      const [date, ...rest] = line.split('\t')
      return { date: (date || '').trim(), subject: rest.join('\t').trim() }
    })
  } catch (e) {
    console.warn('[gen-changelog] git log 실패 — 빈 소스로 진행:', e.message)
    return []
  }
}

const releases = parseCommits(readCommits())
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(releases, null, 2) + '\n', 'utf8')
console.log(`[gen-changelog] ${releases.length}개 버전 → ${OUT}`)
