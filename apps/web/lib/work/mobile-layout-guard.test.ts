import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8')
const workTabs = readFileSync(new URL('../../components/ui/WorkTabBar.tsx', import.meta.url), 'utf8')
const deptTasks = readFileSync(new URL('../../app/(member)/dept-tasks/DeptTasksClient.tsx', import.meta.url), 'utf8')

test('업무 주탭은 모바일 3+2 그리드를 사용하고 인라인 가로 스크롤이 없다', () => {
  assert.match(css, /\.work-primary-tabs\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6,/)
  assert.doesNotMatch(workTabs, /overflowX:\s*'auto'/)
})

test('부서업무는 선택 시 모바일 전체화면 상세 경로를 제공한다', () => {
  assert.match(deptTasks, /dept-task-layout.*has-selection/)
  assert.match(css, /\.dept-task-detail-pane\s*\{[\s\S]*?position:\s*fixed/)
})

test('주간보고 표는 모바일에서 고정 최소폭을 해제한다', () => {
  assert.match(css, /\.report-form-table\s*\{[\s\S]*?min-width:\s*0\s*!important/)
})

test('업무 모바일 액션은 44px 터치 기준을 유지한다', () => {
  assert.match(css, /\.daily-log-actions[\s\S]*?min-height:\s*44px/)
  assert.match(css, /\.work-activity-filters\s*>\s*button\s*\{\s*min-height:\s*44px/)
})
