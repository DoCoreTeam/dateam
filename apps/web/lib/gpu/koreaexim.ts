/**
 * 한국수출입은행 환율 API 호출 — **중간 인증서를 우리가 보충한다.**
 *
 * 왜(실측 2026-09-03): `oapi.koreaexim.go.kr` 가 TLS 핸드셰이크에서 **리프 인증서만**
 * 보내고 중간 인증서(`Thawte TLS RSA CA G1`)를 함께 내려주지 않는다. `curl` 은 OS
 * 신뢰저장소가 그 중간 인증서를 이미 갖고 있어 성공하지만, **Node 는 실패한다**
 * (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`). `openssl s_client` 도 같은 이유로 검증 실패한다.
 *
 * 그래서 환율 갱신이 **일주일째 500** 이었고(마지막 저장 2026-08-27), 화면의 매매기준율이
 * 그 날짜에 멈춰 있었다. 가격 계산이 전부 이 환율을 쓰므로 조용히 낡은 값으로 팔고 있었다.
 *
 * **검증을 끄지 않는다.** Node 기본 루트 목록(`tls.rootCertificates`)에 서버가 빠뜨린
 * 중간 인증서 **하나만 더해** 경로를 잇는다. 신뢰 범위는 그대로이고, 서버가 나중에
 * 체인을 제대로 보내기 시작해도 이 코드는 그대로 동작한다.
 *
 * `fetch` 가 아니라 `node:https` 를 쓰는 이유는 둘이다:
 *   ① 사설 CA 를 fetch 에 넘기려면 `undici` 를 직접 의존성으로 들여야 한다.
 *   ② **쿠키 확인형 봇 가드** — 이 서버는 첫 요청에 `302 + Set-Cookie` 로 답하고,
 *      **그 쿠키를 달고 다시 와야** 200 을 준다. `fetch` 는 리다이렉트를 따라가지만
 *      쿠키를 되돌려 보내지 않아 302 에서 끝난다(실측: 쿠키 없이 -L → 302,
 *      쿠키 들고 -L → 200 · 4,771바이트). 그래서 왕복을 직접 다룬다.
 */
import https from 'node:https'
import tls from 'node:tls'

/**
 * DigiCert `Thawte TLS RSA CA G1` — 서버가 보내지 않는 중간 인증서.
 * 공개 인증서라 비밀이 아니다. 상위는 Node 기본 루트에 있는 `DigiCert Global Root G2`.
 * 만료: 2027-11-02. 그 전에 갱신되면 `openssl s_client` 로 새 중간 인증서를 받아 교체한다.
 */
export const KOREAEXIM_INTERMEDIATE_CA = [
  '-----BEGIN CERTIFICATE-----',
  'MIIEizCCA3OgAwIBAgIQCQ7oxd5b+mLSri/3CXxIVzANBgkqhkiG9w0BAQsFADBh',
  'MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3',
  'd3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH',
  'MjAeFw0xNzExMDIxMjI0MjVaFw0yNzExMDIxMjI0MjVaMF4xCzAJBgNVBAYTAlVT',
  'MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j',
  'b20xHTAbBgNVBAMTFFRoYXd0ZSBUTFMgUlNBIENBIEcxMIIBIjANBgkqhkiG9w0B',
  'AQEFAAOCAQ8AMIIBCgKCAQEAxjngmPhVetC0b/ozbYJdzOBUA1sMog47030cAP+P',
  '23ANUN8grXECL8NhDEF4F1R9tL0wY0mczHaR0a7lYanlxtwWo1s2uGnnyDs6mOCs',
  '66ew2w3YETr6Tb14xgjpu1gGFtAeewaikO9Fud8hxGJTSwn8xeNkfKVWpD2L4vFN',
  '36FNgxeilK6aE4ykgGAzNlokTp6hNOLAYpDySdLAPKzuJSQ7JCEZ6O+SDKywIdXL',
  'oMTnpxuBKGSG88NWTo3CHCOGmQECia2yqdPDjgLqnEiYNjwQL8uMqj8rOvlMgviB',
  'cHA7xty+7/uYLN6ZS7Vq1/F/lVhVOf5ej6jZdmB85szFbQIDAQABo4IBQDCCATww',
  'HQYDVR0OBBYEFKWM/jLM6w8s1BnGCLgAJIhdw8W3MB8GA1UdIwQYMBaAFE4iVCAY',
  'lebjbuYP+vq5Eu0GF485MA4GA1UdDwEB/wQEAwIBhjAdBgNVHSUEFjAUBggrBgEF',
  'BQcDAQYIKwYBBQUHAwIwEgYDVR0TAQH/BAgwBgEB/wIBADA0BggrBgEFBQcBAQQo',
  'MCYwJAYIKwYBBQUHMAGGGGh0dHA6Ly9vY3NwLmRpZ2ljZXJ0LmNvbTBCBgNVHR8E',
  'OzA5MDegNaAzhjFodHRwOi8vY3JsMy5kaWdpY2VydC5jb20vRGlnaUNlcnRHbG9i',
  'YWxSb290RzIuY3JsMD0GA1UdIAQ2MDQwMgYEVR0gADAqMCgGCCsGAQUFBwIBFhxo',
  'dHRwczovL3d3dy5kaWdpY2VydC5jb20vQ1BTMA0GCSqGSIb3DQEBCwUAA4IBAQC6',
  'km0KA4sTb2VYpEBm/uL2HL/pZX9B7L/hbJ4NcoBe7V56oCnt7aeIo8sMjCRWTCWZ',
  'D1dY0+2KZOC1dKj8d1VXXAtnjytDDuPPf6/iow0mYQTO/GAg/MLyL6CDm3FzDB8V',
  'tsH/aeMgP6pgD1XQqz+haDnfnJTKBuxhcpnx3Adbleue/QnPf1hHYa8L+Rv8Pi5U',
  'h4V9FwHOfphdMXOxi14OqmsiTbc5cOs9/uukH+YVsuFdWTna6IVw1qh+tEtyH16R',
  'vmi7pkqyZYULOPMIE7avrljVVBZuikwARtY8tCVV6Pp9l3VeagBqb2ffgqNJt3C0',
  'TYNYQI+BXG1R1cABlold',
  '-----END CERTIFICATE-----',
].join('\n')

export const KOREAEXIM_BASE = 'https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON'

/** 호출 상한 — 외부 API 가 안 끊어 주면 라우트가 함수 상한까지 매달린다. */
export const KOREAEXIM_TIMEOUT_MS = 15_000

/**
 * 환율 API 를 부르고 JSON 을 돌려준다.
 * 실패는 던지지 않고 `null` — 호출부가 직전 영업일로 폴백할 수 있어야 한다.
 */
export async function fetchKoraeximJson(
  authKey: string,
  yyyymmdd: string,
): Promise<unknown | null> {
  const url = `${KOREAEXIM_BASE}?authkey=${encodeURIComponent(authKey)}&searchdate=${yyyymmdd}&data=AP01`
  // 1회차는 쿠키를 받으러 간다. 302 면 그 쿠키를 달고 2회차에 같은 주소로 다시 간다.
  const first = await once(url)
  if (first.status === 200) return parse(first.body)
  if (!first.cookie) return null
  const second = await once(url, first.cookie)
  return second.status === 200 ? parse(second.body) : null
}

function parse(body: string): unknown | null {
  try { return JSON.parse(body) } catch { return null }
}

/** 한 번의 GET — 상태·본문·받은 쿠키를 그대로 돌려준다. 던지지 않는다. */
function once(url: string, cookie?: string): Promise<{ status: number; body: string; cookie: string }> {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        ca: [...tls.rootCertificates, KOREAEXIM_INTERMEDIATE_CA],
        timeout: KOREAEXIM_TIMEOUT_MS,
        headers: cookie ? { Cookie: cookie } : {},
      },
      (res) => {
        // Set-Cookie 는 `name=value; Path=/` 형태 — 되돌려 보낼 때는 앞부분만 쓴다.
        const got = (res.headers['set-cookie'] ?? [])
          .map((c) => c.split(';')[0])
          .join('; ')
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { body += c })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, cookie: got }))
      },
    )
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', cookie: '' }) })
    req.on('error', () => resolve({ status: 0, body: '', cookie: '' }))
  })
}
