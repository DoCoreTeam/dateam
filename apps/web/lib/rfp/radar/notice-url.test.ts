/**
 * 공고 원문 주소 가드
 *
 * 케이스 상세가 `raw.url` 을 읽는데 나라장터는 `bidNtceUrl` 로 준다. 그래서 g2b 공고의
 * 「공고 원문」이 **늘 비어 있었다** — 오류도 안 났고 값은 처음부터 거기 있었다.
 * 실측 2026-10-01: url 10건 / bidNtceUrl 537건 / 전체 567건.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripComments } from '../../ui/component-scan.ts'
import { noticeUrlOf, safeUrl, URL_KEYS, EXTERNAL_LINK_PROPS } from './notice-url.ts'

const WEB = new URL('../../../', import.meta.url)
const G2B = 'https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK01746331&bidPbancOrd=000'

test('나라장터 공고의 주소를 읽는다', () => {
  // 열에 아홉이 이 칸으로 온다. 이걸 못 읽으면 원문 링크가 통째로 없는 기능이 된다
  assert.equal(noticeUrlOf({ bidNtceUrl: G2B }), G2B)
})

test('기관 사이트에서 온 공고도 그대로 읽는다', () => {
  // 한쪽을 고치며 다른 쪽을 깨뜨리지 않는다
  const u = 'https://www.kisa.or.kr/403/form?postSeq=10849&page=1'
  assert.equal(noticeUrlOf({ url: u }), u)
})

test('둘 다 있으면 나라장터 것이 이긴다', () => {
  assert.equal(noticeUrlOf({ bidNtceUrl: G2B, url: 'https://other.example/x' }), G2B)
})

test('주소가 없으면 지어내지 않는다', () => {
  // 없는 것을 그럴듯한 주소로 채우면 사용자는 눌러서 엉뚱한 데로 간다
  for (const raw of [null, undefined, {}, { url: '' }, { url: '   ' }, { bidNtceUrl: null }, 'string', 3]) {
    assert.equal(noticeUrlOf(raw), null, `${JSON.stringify(raw)} 에서 주소를 지어냈다`)
  }
})

test('http 와 https 말고는 링크로 안 내보낸다', () => {
  /*
    이 값은 밖에서 온 것이고 화면에서 href 가 된다.
    javascript: 가 그대로 들어가면 그 자리가 실행 통로가 된다
  */
  for (const bad of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '어디로도아닌글자',
  ]) {
    assert.equal(safeUrl(bad), null, `${bad} 가 링크로 나간다`)
    assert.equal(noticeUrlOf({ bidNtceUrl: bad }), null, `${bad} 가 공고 주소로 나간다`)
  }
  assert.ok(safeUrl('http://example.com/a'))
  assert.ok(safeUrl('https://example.com/a'))
})

test('나쁜 주소가 앞에 있어도 뒤의 좋은 주소를 찾는다', () => {
  // 앞 칸이 못 쓰는 값이라고 뒤 칸까지 버리면 멀쩡한 주소를 잃는다
  const u = 'https://ok.example/notice'
  assert.equal(noticeUrlOf({ bidNtceUrl: 'javascript:alert(1)', url: u }), u)
})

test('바깥 링크에 붙일 것이 한자리에 있다', () => {
  // 자리마다 손으로 적으면 한 곳에서 빠지고, 빠진 그 자리가 구멍이 된다
  assert.equal(EXTERNAL_LINK_PROPS.target, '_blank')
  assert.match(EXTERNAL_LINK_PROPS.rel, /noopener/)
  assert.match(EXTERNAL_LINK_PROPS.rel, /noreferrer/)
})

test('케이스 상세가 이 함수를 쓴다', () => {
  // 화면이 raw.url 을 직접 읽으면 g2b 공고는 다시 비게 된다
  const src = stripComments(readFileSync(new URL('app/(rfp)/rfp/[id]/page.tsx', WEB), 'utf8'))
  assert.match(src, /noticeUrlOf\s*\(/, '케이스 상세가 주소 함수를 안 쓴다')
  assert.doesNotMatch(src, /raw\.url\b/, '케이스 상세가 아직 raw.url 하나만 읽는다')
})

test('읽는 칸 이름이 실제로 둘이다', () => {
  // 하나로 줄이면 한 길에서 들어온 공고가 통째로 링크를 잃는다
  assert.deepEqual([...URL_KEYS], ['bidNtceUrl', 'url'])
})
