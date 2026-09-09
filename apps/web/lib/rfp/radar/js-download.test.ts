import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  downloadCalls, parseFnShape, buildDownloadUrl, scriptUrls, MAX_SCRIPTS,
} from './js-download.ts'

// 실측(KISA): 첨부가 href 가 아니라 onclick 이다
const KISA_HTML = `
<li><a href="#fnPostAttachDownload" onclick="javascript:fnPostAttachDownload(403, '10843', 1, 'KO');" title="첨부파일 다운로드">입찰공고(2026-222) 중소기업 AI 위협 대응 지원 추진 방안 수립.hwpx (98KB)</a>
<a href="#fndoDocumentPreview" onclick="javascript:doDocumentPreview('403','10843','1');"><img src="btn_preview.png" alt="미리보기"></a></li>
<li><a href="#fnPostAttachDownload" onclick="javascript:fnPostAttachDownload(403, '10843', 2, 'KO');">[제안요청서] 중소기업 AI 위협 대응 지원 추진 방안 수립.hwpx (346KB)</a></li>`

// 실측(KISA common.js)
const KISA_JS = `
function fnPostAttachDownload(menu_seq, post_seq, attach_seq, lang_type) {
	$('<form></form>').attr("id","attachForm").attr("method","get").attr("action","/post/fileDownload")
		.append($('<input/>', {type: 'hidden', name: 'menuSeq', value:menu_seq}))
		.append($('<input/>', {type: 'hidden', name: 'postSeq', value:post_seq}))
		.append($('<input/>', {type: 'hidden', name: 'attachSeq', value:attach_seq}))
		.append($('<input/>', {type: 'hidden', name: 'lang_type', value:lang_type}))
		.appendTo('body').submit();
}`

const PAGE = 'https://www.kisa.or.kr/403/form?postSeq=10843'

test('★ onclick 내려받기를 찾는다 — 기관 게시판 절반이 href 가 아니라 onclick 이다', () => {
  const calls = downloadCalls(KISA_HTML)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].fnName, 'fnPostAttachDownload')
  assert.deepEqual(calls[0].args, ['403', '10843', '1', 'KO'])
  assert.ok(calls[0].text.includes('입찰공고'))
})

test('미리보기는 첨부가 아니다', () => {
  assert.equal(downloadCalls(KISA_HTML).some((c) => /preview/i.test(c.fnName)), false)
})

test('★ 그 사이트의 자바스크립트에서 주소와 인자 짝을 읽는다 — 규칙을 박지 않는다', () => {
  const shape = parseFnShape(KISA_JS, 'fnPostAttachDownload')
  assert.ok(shape)
  assert.equal(shape?.action, '/post/fileDownload')
  assert.deepEqual(shape?.mapping.map((m) => m.query), ['menuSeq', 'postSeq', 'attachSeq', 'lang_type'])
})

test('호출과 함수 모양으로 실제 주소를 만든다', () => {
  const call = downloadCalls(KISA_HTML)[1]
  const shape = parseFnShape(KISA_JS, 'fnPostAttachDownload')!
  const url = buildDownloadUrl(call, shape, PAGE)
  assert.ok(url)
  assert.ok(url!.includes('/post/fileDownload'))
  assert.ok(url!.includes('postSeq=10843'))
  assert.ok(url!.includes('attachSeq=2'), url!)
})

test('주소를 조립하는 모양도 읽는다', () => {
  const js = `function goDown(seq, idx) { location.href = "/cmm/down?fileSn=" + seq + "&idx=" + idx }`
  const shape = parseFnShape(js, 'goDown')
  assert.ok(shape)
  assert.equal(shape?.action, '/cmm/down?fileSn=')
  assert.ok(shape!.mapping.length > 0)
})

test('함수를 못 찾으면 null — 억지로 만들지 않는다', () => {
  assert.equal(parseFnShape(KISA_JS, '없는함수'), null)
})

test('인자를 하나도 못 채우면 주소를 안 만든다', () => {
  const shape = { action: '/down', params: ['a'], mapping: [{ query: 'x', argIndex: 9 }] }
  assert.equal(buildDownloadUrl({ fnName: 'f', args: ['1'], text: '' }, shape, PAGE), null)
})

test('남의 라이브러리는 안 훑는다 — 우리 함수가 거기 없다', () => {
  const html = `
    <script src="/js/jquery.min.js"></script>
    <script src="/resource/kor/js/common.js"></script>
    <script src="/js/swiper.min.js"></script>`
  const urls = scriptUrls(html, PAGE)
  assert.equal(urls.length, 1)
  assert.ok(urls[0].includes('common.js'))
  assert.ok(MAX_SCRIPTS > 0)
})

test('★ 게시판 푸터의 내려받기는 이 공고 첨부가 아니다', () => {
  // 실측(KISA): 푸터의 「KISA소개 자료」가 같은 함수를 쓴다
  const html = KISA_HTML + `
    <dl><dt>KISA소개 자료</dt>
    <dd><a href="#fnPostAttachDownload" onclick="javascript:fnPostAttachDownload(99999999, 1, 1, 'KO');">KR</a></dd></dl>`
  const all = downloadCalls(html)
  assert.equal(all.length, 3, '주소를 안 주면 다 담는다')

  const mine = downloadCalls(html, PAGE)
  assert.equal(mine.length, 2, '이 공고의 글 번호를 가진 것만 남는다')
  assert.equal(mine.some((c) => c.args.includes('99999999')), false)
})

test('★ 쪽 번호는 공고를 가르는 값이 아니다 — 이것 때문에 브로슈어가 딸려 왔다', () => {
  // 실측(KISA): 주소가 ?postSeq=10843&page=1 이고 푸터 호출이 (99999999, 1, 1, 'KO') 라
  // 인자 「1」이 page=1 과 겹쳐 기관 브로슈어가 공고 첨부로 들어왔다
  const html = KISA_HTML + `
    <dd><a href="#fnPostAttachDownload" onclick="javascript:fnPostAttachDownload(99999999, 1, 1, 'KO');">KR</a></dd>`
  const mine = downloadCalls(html, 'https://www.kisa.or.kr/403/form?postSeq=10843&page=1')
  assert.equal(mine.length, 2)
  assert.equal(mine.some((c) => c.args.includes('99999999')), false)
})

test('주소에 글 번호가 없는 게시판이면 거르지 않는다 — 다 잃는 것보다 낫다', () => {
  const calls = downloadCalls(KISA_HTML, 'https://x.go.kr/board')
  assert.equal(calls.length, 2)
})
