import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideMeetingEntry, meetingEntryHref, CRM_MEETINGS_HREF, MEETING_NOTES_HREF } from './meeting-entry.ts'

test('두 문을 다 지나야 CRM 미팅으로 간다', () => {
  assert.equal(decideMeetingEntry({ canOpenCrm: true, isCrmMember: true }), 'crm')
})

test('표면 권한만 있고 멤버가 아니면 회의노트로 간다', () => {
  assert.equal(decideMeetingEntry({ canOpenCrm: true, isCrmMember: false }), 'notes')
})

test('멤버여도 표면이 닫혀 있으면 회의노트로 간다', () => {
  assert.equal(decideMeetingEntry({ canOpenCrm: false, isCrmMember: true }), 'notes')
})

test('둘 다 없으면 회의노트로 간다', () => {
  assert.equal(decideMeetingEntry({ canOpenCrm: false, isCrmMember: false }), 'notes')
})

test('갈 주소는 CRM 기록 메뉴와 회의노트 둘뿐이다', () => {
  assert.equal(meetingEntryHref(true), '/crm/meetings')
  assert.equal(meetingEntryHref(false), '/meeting-notes')
  assert.equal(CRM_MEETINGS_HREF, '/crm/meetings')
  assert.equal(MEETING_NOTES_HREF, '/meeting-notes')
})

test('CRM 기록 메뉴 주소가 CRM 사이드바와 같다', async () => {
  const { readFileSync } = await import('node:fs')
  const nav = readFileSync(new URL('../nav/groups.ts', import.meta.url), 'utf8')
  assert.ok(nav.includes(`href: '${CRM_MEETINGS_HREF}'`), 'CRM 사이드바에 /crm/meetings 가 없다')
})
