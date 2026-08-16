import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDriveFileId, isDriveUrl } from './drive-link.ts'

const ID = '1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv'

test('공유 링크에서 파일 ID를 뽑는다 — 사용자가 실제로 붙여넣는 형태', () => {
  assert.equal(parseDriveFileId(`https://drive.google.com/file/d/${ID}/view?usp=sharing`), ID)
})

test('open·uc 형태의 쿼리 주소도 받는다', () => {
  assert.equal(parseDriveFileId(`https://drive.google.com/open?id=${ID}`), ID)
  assert.equal(parseDriveFileId(`https://drive.google.com/uc?id=${ID}&export=download`), ID)
  assert.equal(parseDriveFileId(`https://drive.usercontent.google.com/download?id=${ID}`), ID)
})

test('문서·슬라이드도 같은 모양이라 함께 잡힌다', () => {
  assert.equal(parseDriveFileId(`https://docs.google.com/document/d/${ID}/edit`), ID)
  assert.equal(parseDriveFileId(`https://docs.google.com/presentation/d/${ID}/edit#slide=1`), ID)
})

test('폴더는 파일이 아니다 — 내려받을 원본이 없다', () => {
  assert.equal(parseDriveFileId(`https://drive.google.com/drive/folders/${ID}`), null)
})

test('드라이브가 아닌 주소는 null — 유튜브를 드라이브로 오인하지 않는다', () => {
  assert.equal(parseDriveFileId('https://www.youtube.com/watch?v=jNQXAC9IVRw'), null)
  assert.equal(parseDriveFileId('https://example.com/file/d/abc/view'), null)
})

test('주소가 아니면 null — 예외로 등록을 멈추지 않는다', () => {
  assert.equal(parseDriveFileId('그냥 글자'), null)
  assert.equal(parseDriveFileId(''), null)
})

test('너무 짧은 ID는 받지 않는다 — 잘못 저장하면 프록시가 조용히 404가 된다', () => {
  assert.equal(parseDriveFileId('https://drive.google.com/file/d/abc/view'), null)
})

test('드라이브 호스트 판정은 www 유무와 무관하다', () => {
  assert.equal(isDriveUrl('https://www.drive.google.com/file/d/x/view'), true)
  assert.equal(isDriveUrl('https://drive.google.com/'), true)
  assert.equal(isDriveUrl('https://youtube.com/'), false)
})
