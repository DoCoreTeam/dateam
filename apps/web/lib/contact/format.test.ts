import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatPhone, telHref, mailtoHref } from './format.ts'

test('저장된 숫자열을 사람이 읽는 형태로 자른다', () => {
  // 실측 앵커 — /crm/people 목록에 실제로 들어 있는 값(v0.7.598)
  assert.equal(formatPhone('01040593436'), '010-4059-3436')
  assert.equal(formatPhone('01093749439'), '010-9374-9439')
  assert.equal(formatPhone('01022153496'), '010-2215-3496')
})

test('서울 02 는 국번 3자리와 4자리를 모두 지원한다', () => {
  assert.equal(formatPhone('021234567'), '02-123-4567')
  assert.equal(formatPhone('0212345678'), '02-1234-5678')
})

test('지역번호 3자리는 국번 길이에 따라 자른다', () => {
  assert.equal(formatPhone('0311234567'), '031-123-4567')
  assert.equal(formatPhone('03112345678'), '031-1234-5678')
})

test('전국대표번호와 평생번호는 규칙이 달라 따로 자른다', () => {
  assert.equal(formatPhone('15881234'), '1588-1234')
  assert.equal(formatPhone('16441234'), '1644-1234')
  // 050x 를 010 규칙으로 자르면 050-412-345678 처럼 어긋난다
  assert.equal(formatPhone('050412345678'), '0504-1234-5678')
})

test('+82 는 국내 표기로 바꿔 보여 준다', () => {
  assert.equal(formatPhone('+821040593436'), '010-4059-3436')
  assert.equal(formatPhone('+82 10-4059-3436'), '010-4059-3436')
})

test('모르는 형태는 지어내서 자르지 않고 원문을 그대로 둔다', () => {
  assert.equal(formatPhone('+1 415 555 2671'), '+1 415 555 2671')
  assert.equal(formatPhone('내선 1234'), '내선 1234')
  assert.equal(formatPhone('0101234'), '0101234')
})

test('이미 하이픈이 있는 값도 같은 결과로 모인다', () => {
  assert.equal(formatPhone('010-4059-3436'), '010-4059-3436')
  assert.equal(formatPhone('010.4059.3436'), '010-4059-3436')
})

test('빈 값은 빈 문자열 — 화면이 "없음"을 스스로 판단할 수 있어야 한다', () => {
  assert.equal(formatPhone(null), '')
  assert.equal(formatPhone(undefined), '')
  assert.equal(formatPhone('   '), '')
})

test('tel: 은 구분자를 지우고 국제 표기는 보존한다', () => {
  assert.equal(telHref('010-4059-3436'), 'tel:01040593436')
  assert.equal(telHref('+82 10-4059-3436'), 'tel:+821040593436')
})

test('걸 수 없는 값이면 링크를 만들지 않는다', () => {
  assert.equal(telHref('1234'), null)
  assert.equal(telHref(''), null)
  assert.equal(telHref(null), null)
  assert.equal(telHref('전화없음'), null)
})

test('mailto 는 주소 꼴일 때만 만든다', () => {
  assert.equal(mailtoHref('episode@e-gate.co.kr'), 'mailto:episode@e-gate.co.kr')
  assert.equal(mailtoHref('  hyunjin.choi@findy.co.jp '), 'mailto:hyunjin.choi@findy.co.jp')
  assert.equal(mailtoHref('사내메일'), null)
  assert.equal(mailtoHref('a@b'), null)
  assert.equal(mailtoHref(null), null)
})
