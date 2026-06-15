// 개발자센터 다국어 코드 예시 SSOT.
// 엔드포인트마다 RequestSpec 1개를 정의하면 7개 언어 스니펫을 결정적으로 생성한다.
// 손으로 언어별 예시를 복붙하지 않는다(드리프트 방지).

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface RequestSpec {
  method: HttpMethod
  /** 베이스 URL 뒤에 붙는 경로. 예: '/products' */
  path: string
  /** 쿼리스트링 파라미터 (선택) */
  query?: Record<string, string>
  /** JSON 요청 바디 (POST/PATCH 등, 선택) */
  body?: unknown
}

export interface LanguageDef {
  id: string
  label: string
  /** CodeBlock에 넘길 구문 강조 라벨 */
  hl: string
  generate: (spec: RequestSpec, baseUrl: string) => string
}

const ENV_HINT = 'YOUR_API_KEY'

function fullUrl(baseUrl: string, spec: RequestSpec): string {
  const qs = spec.query
    ? Object.entries(spec.query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    : ''
  return qs ? `${baseUrl}${spec.path}?${qs}` : `${baseUrl}${spec.path}`
}

function jsonBody(body: unknown, indent = 2): string {
  return JSON.stringify(body, null, indent)
}

// ─── curl ─────────────────────────────────────────────────────────────────────
function toCurl(spec: RequestSpec, baseUrl: string): string {
  const url = fullUrl(baseUrl, spec)
  const lines: string[] = []
  const methodFlag = spec.method === 'GET' ? '' : `-X ${spec.method} `
  lines.push(`curl ${methodFlag}${url} \\`)
  lines.push(`  -H "X-API-Key: $AX_API_KEY"${spec.body ? ' \\' : ''}`)
  if (spec.body) {
    lines.push('  -H "Content-Type: application/json" \\')
    lines.push(`  -d '${jsonBody(spec.body, 0)}'`)
  }
  return lines.join('\n')
}

// ─── JavaScript (Node, fetch) ───────────────────────────────────────────────────
function toJavaScript(spec: RequestSpec, baseUrl: string): string {
  const url = fullUrl(baseUrl, spec)
  const hasBody = spec.body !== undefined
  const opts: string[] = []
  if (spec.method !== 'GET') opts.push(`  method: '${spec.method}',`)
  opts.push(`  headers: {`)
  opts.push(`    'X-API-Key': process.env.AX_API_KEY,`)
  if (hasBody) opts.push(`    'Content-Type': 'application/json',`)
  opts.push(`  },`)
  if (hasBody) opts.push(`  body: JSON.stringify(${jsonBody(spec.body, 2).replace(/\n/g, '\n  ')}),`)
  return [
    `// Node.js 18+ (서버사이드 — 브라우저에 키를 노출하지 마세요)`,
    `const res = await fetch('${url}', {`,
    ...opts,
    `})`,
    ``,
    `if (!res.ok) throw new Error((await res.json()).error)`,
    `const { data, meta } = await res.json()`,
  ].join('\n')
}

// JSON 값을 Python 리터럴로 안전 변환(문자열 내부 true/false/null 오치환 방지)
function toPyLiteral(value: unknown, indent = 0): string {
  const pad = '    '.repeat(indent)
  const padIn = '    '.repeat(indent + 1)
  if (value === null) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map(v => `${padIn}${toPyLiteral(v, indent + 1)}`).join(',\n')
    return `[\n${items},\n${pad}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return '{}'
  const body = entries.map(([k, v]) => `${padIn}${JSON.stringify(k)}: ${toPyLiteral(v, indent + 1)}`).join(',\n')
  return `{\n${body},\n${pad}}`
}

// ─── Python (requests) ──────────────────────────────────────────────────────────
function toPython(spec: RequestSpec, baseUrl: string): string {
  const url = fullUrl(baseUrl, spec)
  const fn = spec.method.toLowerCase()
  const lines = [
    `import os`,
    `import requests`,
    ``,
    `headers = {"X-API-Key": os.environ["AX_API_KEY"]}`,
  ]
  if (spec.body !== undefined) {
    lines.push(`payload = ${toPyLiteral(spec.body)}`)
    lines.push(`res = requests.${fn}("${url}", headers=headers, json=payload)`)
  } else {
    lines.push(`res = requests.${fn}("${url}", headers=headers)`)
  }
  lines.push(`res.raise_for_status()`)
  lines.push(`data = res.json()["data"]`)
  return lines.join('\n')
}

// ─── Go (net/http) ──────────────────────────────────────────────────────────────
function toGo(spec: RequestSpec, baseUrl: string): string {
  const url = fullUrl(baseUrl, spec)
  const hasBody = spec.body !== undefined
  const lines = [
    `package main`,
    ``,
    `import (`,
    `\t"net/http"`,
    `\t"os"`,
    ...(hasBody ? ['\t"strings"'] : []),
    `)`,
    ``,
    `func main() {`,
  ]
  if (hasBody) {
    lines.push(`\tpayload := strings.NewReader(\`${jsonBody(spec.body, 0)}\`)`)
    lines.push(`\treq, _ := http.NewRequest("${spec.method}", "${url}", payload)`)
    lines.push(`\treq.Header.Set("Content-Type", "application/json")`)
  } else {
    lines.push(`\treq, _ := http.NewRequest("${spec.method}", "${url}", nil)`)
  }
  lines.push(`\treq.Header.Set("X-API-Key", os.Getenv("AX_API_KEY"))`)
  lines.push(``)
  lines.push(`\tres, err := http.DefaultClient.Do(req)`)
  lines.push(`\tif err != nil { panic(err) }`)
  lines.push(`\tdefer res.Body.Close()`)
  lines.push(`}`)
  return lines.join('\n')
}

// ─── PHP (cURL) ─────────────────────────────────────────────────────────────────
function toPHP(spec: RequestSpec, baseUrl: string): string {
  const url = fullUrl(baseUrl, spec)
  const hasBody = spec.body !== undefined
  const headers = [`'X-API-Key: ' . getenv('AX_API_KEY')`]
  if (hasBody) headers.push(`'Content-Type: application/json'`)
  const lines = [
    `<?php`,
    `$ch = curl_init('${url}');`,
    `curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);`,
    `curl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${spec.method}');`,
    `curl_setopt($ch, CURLOPT_HTTPHEADER, [${headers.join(', ')}]);`,
  ]
  if (hasBody) lines.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, '${jsonBody(spec.body, 0)}');`)
  lines.push(`$response = curl_exec($ch);`)
  lines.push(`curl_close($ch);`)
  lines.push(`$data = json_decode($response, true)['data'];`)
  return lines.join('\n')
}

// ─── Java (java.net.http) ───────────────────────────────────────────────────────
function toJava(spec: RequestSpec, baseUrl: string): string {
  const url = fullUrl(baseUrl, spec)
  const hasBody = spec.body !== undefined
  const bodyPublisher = hasBody
    ? `HttpRequest.BodyPublishers.ofString("${jsonBody(spec.body, 0).replace(/"/g, '\\"')}")`
    : `HttpRequest.BodyPublishers.noBody()`
  const lines = [
    `import java.net.URI;`,
    `import java.net.http.*;`,
    ``,
    `HttpClient client = HttpClient.newHttpClient();`,
    `HttpRequest request = HttpRequest.newBuilder()`,
    `    .uri(URI.create("${url}"))`,
    `    .header("X-API-Key", System.getenv("AX_API_KEY"))`,
    ...(hasBody ? [`    .header("Content-Type", "application/json")`] : []),
    `    .method("${spec.method}", ${bodyPublisher})`,
    `    .build();`,
    ``,
    `HttpResponse<String> res = client.send(request, HttpResponse.BodyHandlers.ofString());`,
  ]
  return lines.join('\n')
}

// ─── C# (.NET HttpClient) ───────────────────────────────────────────────────────
function toCSharp(spec: RequestSpec, baseUrl: string): string {
  const url = fullUrl(baseUrl, spec)
  const hasBody = spec.body !== undefined
  const lines = [
    `using System.Net.Http;`,
    ``,
    `var client = new HttpClient();`,
    `var request = new HttpRequestMessage(HttpMethod.${pascalMethod(spec.method)}, "${url}");`,
    `request.Headers.Add("X-API-Key", Environment.GetEnvironmentVariable("AX_API_KEY"));`,
  ]
  if (hasBody) {
    lines.push(`request.Content = new StringContent(`)
    lines.push(`    "${jsonBody(spec.body, 0).replace(/"/g, '\\"')}",`)
    lines.push(`    System.Text.Encoding.UTF8, "application/json");`)
  }
  lines.push(`var res = await client.SendAsync(request);`)
  lines.push(`var body = await res.Content.ReadAsStringAsync();`)
  return lines.join('\n')
}

function pascalMethod(m: HttpMethod): string {
  return m.charAt(0) + m.slice(1).toLowerCase()
}

export const LANGUAGES: LanguageDef[] = [
  { id: 'curl', label: 'cURL', hl: 'bash', generate: toCurl },
  { id: 'javascript', label: 'JavaScript', hl: 'javascript', generate: toJavaScript },
  { id: 'python', label: 'Python', hl: 'python', generate: toPython },
  { id: 'go', label: 'Go', hl: 'go', generate: toGo },
  { id: 'php', label: 'PHP', hl: 'php', generate: toPHP },
  { id: 'java', label: 'Java', hl: 'java', generate: toJava },
  { id: 'csharp', label: 'C#', hl: 'csharp', generate: toCSharp },
]

export { ENV_HINT }
