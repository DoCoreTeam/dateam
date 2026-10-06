import { test, expect } from '@playwright/test'
import * as fs from 'fs'
const ID = 'cmus4n1le0001js04vg8zjax1'

test('특기사항을 원래대로 비운다', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/crm/quotes')
  const got = await page.request.get(`/api/crm/quotes/${ID}`)
  const q = await got.json()
  fs.writeFileSync('/tmp/qa-revert-before.json', JSON.stringify({ notesMd: q.notesMd, version: q.version }))
  const res = await page.request.patch(`/api/crm/quotes/${ID}`, {
    data: { version: q.version, notesMd: null },
  })
  const body = await res.text()
  fs.writeFileSync('/tmp/qa-revert.txt', `${res.status()}\n${body.slice(0, 400)}`)
  expect(res.ok(), body).toBe(true)
})
