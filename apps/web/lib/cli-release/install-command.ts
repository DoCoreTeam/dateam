/**
 * 운영체제별 teamda 설치 명령 (P0167 I05a)
 *
 * 브라우저로 받은 실행 파일은 macOS 가 격리 표시(com.apple.quarantine)를 붙여 서명 없는 teamda 를
 * 아무 말 없이 죽이고(실측 종료 137), Windows 는 웹 표시(Zone.Identifier)를 붙여 SmartScreen 이 막는다
 * curl 과 Invoke-WebRequest 로 받으면 그 표시가 붙지 않는다, 그래서 화면이 터미널 명령을 함께 준다
 * 주소는 창구가 준 600초 서명 주소만 받고, 셸 인용을 지나 명령에 들어간다
 */
import type { ReleaseTarget } from './manifest.ts'

/** POSIX 셸 작은따옴표 인용, 주소 안의 ' 는 '\'' 로 끊어 잇는다 */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** PowerShell 작은따옴표 인용, 안의 ' 는 '' 로 겹친다 */
export function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

export type Shell = 'sh' | 'powershell'

export interface InstallCommand {
  shell: Shell
  command: string
}

export function installCommandOf(target: ReleaseTarget, url: string, fileName: string): InstallCommand {
  if (target === 'windows-x64') {
    const zip = psQuote(fileName)
    return {
      shell: 'powershell',
      command: [
        `Invoke-WebRequest -Uri ${psQuote(url)} -OutFile ${zip}`,
        `Expand-Archive -Path ${zip} -DestinationPath . -Force`,
        `Unblock-File .\\teamda.exe`,
        `.\\teamda.exe --help`,
      ].join('; '),
    }
  }
  const tgz = shQuote(fileName)
  return {
    shell: 'sh',
    command: [
      `curl -fL -o ${tgz} ${shQuote(url)}`,
      `tar -xzf ${tgz}`,
      `chmod +x teamda`,
      `./teamda --help`,
    ].join(' && '),
  }
}
