import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentsFromPage, MAX_FOUND } from './attachments-from-page.ts'

const PAGE = 'https://www.nia.or.kr/site/nia_kor/ex/bbs/View.do?cbIdx=78336&bcIdx=29975'

test('★ 상세 쪽에서 첨부를 찾는다 — 기관 게시판은 첨부 칸이 따로 없다', () => {
  const html = `
    <a href="/common/board/Download.do?bcIdx=29975&cbIdx=78336&fileNo=1">제안요청서.hwpx</a>
    <a href="/common/board/Download.do?bcIdx=29975&cbIdx=78336&fileNo=2">공고서.hwpx</a>
    <a href="/site/nia_kor/main.do">홈으로</a>`
  const rows = attachmentsFromPage(html, PAGE)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].fileName, '제안요청서.hwpx')
  assert.ok(rows[0].url.startsWith('https://www.nia.or.kr/common/board/Download.do'))
})

test('같은 파일이 두 번 걸려도 한 번만 담는다 — 아이콘 링크와 글자 링크가 같이 있다', () => {
  const html = `
    <a href="/f/Download.do?fileNo=1"><img src="icon.png"></a>
    <a href="/f/Download.do?fileNo=1">제안요청서.hwpx</a>`
  assert.equal(attachmentsFromPage(html, PAGE).length, 1)
})

test('미리보기·뷰어는 첨부가 아니다', () => {
  const html = `
    <a href="/f/Download.do?fileNo=1&preview=1">미리 보기</a>
    <a href="/f/Download.do?fileNo=1">제안요청서.hwpx</a>`
  const rows = attachmentsFromPage(html, PAGE)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].fileName, '제안요청서.hwpx')
})

test('이름이 없으면 자리 번호 — 진짜 이름은 받을 때 헤더에서 다시 본다', () => {
  const rows = attachmentsFromPage('<a href="/f/FileDown.do?id=3"><span></span></a>', PAGE)
  assert.equal(rows[0].fileName, '첨부1')
})

test('첨부가 아닌 링크는 안 담는다', () => {
  assert.deepEqual(attachmentsFromPage('<a href="/site/main.do">홈</a>', PAGE), [])
})

test('수십 개가 붙어도 상한을 지킨다', () => {
  const html = Array.from({ length: 40 }, (_, i) =>
    `<a href="/f/Download.do?fileNo=${i}">파일${i}.hwp</a>`).join('')
  assert.equal(attachmentsFromPage(html, PAGE).length, MAX_FOUND)
})
