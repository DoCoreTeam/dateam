import test from 'node:test'; import assert from 'node:assert/strict'; import { parseProjectCommand } from './project-command.ts'
test('프로젝트 자연어 명령은 실행 단위를 구조화한다',()=>{ assert.deepEqual(parseProjectCommand('리스크 추가: 납기 지연'),{action:'create',kind:'risk',title:'납기 지연',status:'open'}); assert.equal(parseProjectCommand('프로젝트를 알아서 삭제해'),null) })
