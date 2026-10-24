import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installCommandOf, shQuote, psQuote } from './install-command.ts'

const URL_ = 'https://x.supabase.co/storage/v1/object/sign/cli-release/v0.1.0/teamda-darwin-arm64.tar.gz?token=abc.def'

test('맥과 리눅스는 curl 로 받아 풀고 실행 권한을 준다, 격리 표시가 안 붙는 길', () => {
  for (const t of ['darwin-arm64', 'darwin-x64', 'linux-x64'] as const) {
    const c = installCommandOf(t, URL_, `teamda-${t}.tar.gz`)
    assert.equal(c.shell, 'sh')
    assert.match(c.command, /^curl -fL -o 'teamda-[a-z0-9-]+\.tar\.gz' '/)
    assert.ok(c.command.includes(`tar -xzf 'teamda-${t}.tar.gz'`))
    assert.ok(c.command.includes('chmod +x teamda'))
    assert.ok(c.command.includes(shQuote(URL_)))
  }
})

test('윈도우는 PowerShell 로 받아 풀고 웹 표시를 지운다', () => {
  const c = installCommandOf('windows-x64', URL_, 'teamda-windows-x64.zip')
  assert.equal(c.shell, 'powershell')
  assert.ok(c.command.startsWith(`Invoke-WebRequest -Uri ${psQuote(URL_)} -OutFile 'teamda-windows-x64.zip'`))
  assert.ok(c.command.includes("Expand-Archive -Path 'teamda-windows-x64.zip' -DestinationPath . -Force"))
  assert.ok(c.command.includes('Unblock-File .\\teamda.exe'))
})

test('★ 보안: 작은따옴표가 든 주소도 인용 밖으로 새지 않는다', () => {
  const evil = "https://x/a'; rm -rf ~; echo '"
  assert.equal(shQuote(evil), `'https://x/a'\\''; rm -rf ~; echo '\\'''`)
  assert.equal(psQuote(evil), "'https://x/a''; rm -rf ~; echo '''")
  // 인용을 풀면 원래 문자열 하나로 돌아온다 (sh 규칙대로 되감기)
  const unquoted = shQuote(evil).slice(1, -1).split(`'\\''`).join("'")
  assert.equal(unquoted, evil)
  assert.equal(psQuote(evil).slice(1, -1).split("''").join("'"), evil)
})
