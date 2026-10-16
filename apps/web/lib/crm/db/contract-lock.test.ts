/**
 * 계약서 버전은 고치지 않는다 — 그 잠금이 마이그레이션에 실제로 걸려 있나 (P0132 I03)
 *
 * 서버 연결은 RLS 를 지나간다(client.ts 머리말). 그래서 「버전은 한 번 쓰면 안 바뀐다」는
 * 정책이 아니라 트리거가 지킨다. 트리거 줄이 빠지면 화면에서는 아무 일도 안 일어나고
 * 버전 기록이 고쳐질 수 있게 된다 — 그래서 글자로 붙잡는다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MIG_DIR = join(import.meta.dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations')
const SQL = readFileSync(join(MIG_DIR, '308_crm_contract.sql'), 'utf8')
const LOCKED = ['crm_contract_version', 'crm_contract_template_version']

test('★ 버전 두 표에 UPDATE DELETE 앞 트리거가 걸린다', () => {
  for (const t of LOCKED) {
    const re = new RegExp(`CREATE TRIGGER \\w+\\s+BEFORE UPDATE OR DELETE ON ${t}\\s+FOR EACH ROW EXECUTE FUNCTION crm_contract_version_guard\\(\\)`)
    assert.match(SQL, re, `${t} 에 잠금 트리거가 없다`)
  }
})

test('★ 트리거 함수가 UPDATE 를 거절하고, DELETE 는 부모가 없을 때만 받는다', () => {
  const fn = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION crm_contract_version_guard'), SQL.indexOf('$$;'))
  assert.match(fn, /IF TG_OP = 'UPDATE' THEN\s+RAISE EXCEPTION/, 'UPDATE 를 거절하지 않는다')
  assert.match(fn, /EXISTS \(SELECT 1 FROM crm_contract WHERE id = OLD\."contractId"\)/)
  assert.match(fn, /EXISTS \(SELECT 1 FROM crm_contract_template WHERE id = OLD\."templateId"\)/)
  assert.match(fn, /SET search_path = public, pg_temp/, 'search_path 를 박지 않았다')
})

test('새 표 넷 모두 같은 파일에서 RLS 를 켜고 권한을 회수한다', () => {
  for (const t of ['crm_contract_template', 'crm_contract_template_version', 'crm_contract', 'crm_contract_version']) {
    assert.match(SQL, new RegExp(`ALTER TABLE ${t}\\s+ENABLE ROW LEVEL SECURITY`), `${t} RLS`)
    assert.match(SQL, new RegExp(`REVOKE ALL ON ${t}\\s+FROM anon, authenticated`), `${t} 회수`)
  }
})

test('★ 기존 crm 표를 대상으로 한 ALTER 가 없다 — 기존 데이터를 안 건드린다', () => {
  const targets = [...SQL.matchAll(/ALTER TABLE "?(\w+)"?/g)].map((m) => m[1])
  const foreign = targets.filter((t) => !t.startsWith('crm_contract'))
  assert.deepEqual(foreign, [], `기존 표를 고친다: ${foreign.join(', ')}`)
})

test('뒤 마이그레이션이 잠금을 풀지 않는다', () => {
  const later: string[] = []
  for (const name of readdirSync(MIG_DIR)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    if (/^\d+_/.test(name) && Number(name.split('_')[0]) > 308) later.push(name)
  }
  for (const f of later) {
    const s = readFileSync(join(MIG_DIR, f), 'utf8')
    assert.doesNotMatch(s, /DROP TRIGGER[^;]*crm_contract\w*_lock/i, `${f} 가 버전 잠금을 푼다`)
  }
})
