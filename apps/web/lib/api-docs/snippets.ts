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
  /**
   * 한도(429)에 걸렸을 때 다시 시도하는 법 — **고른 언어로 보여 준다.**
   *
   * 실측 v0.7.624: 「다시 시도 예시」가 언어와 무관하게 JavaScript 로 고정돼 있었다.
   * Python 을 고른 사람이 JS 를 읽는다 — 문서가 언어를 물어본 의미가 없다.
   */
  retry: (baseUrl: string) => string
  /** 커서로 이어 받는 법 — 같은 이유로 언어를 따라간다 */
  paginate: (baseUrl: string) => string
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

/* ─── 한도(429) 재시도 · 커서 이어보기 ───────────────────────────────────────
   요청 하나를 그리는 generate 와 달리 **흐름**을 보여 준다. 손으로 언어별로
   복붙하면 또 갈리므로 여기 한 곳에 둔다. */

const RETRY: Record<string, (b: string) => string> = {
  curl: (b) => [
    `# 429 면 Retry-After 초만큼 기다렸다가 다시 부른다`,
    `for i in 1 2 3; do`,
    `  code=$(curl -s -o /tmp/ax.json -D /tmp/ax.head -w '%{http_code}' \\`,
    `    "${b}/products" -H "X-API-Key: $AX_API_KEY")`,
    `  [ "$code" != "429" ] && break`,
    `  sleep "$(awk 'tolower($1)=="retry-after:"{print $2}' /tmp/ax.head)"`,
    `done`,
  ].join('\n'),

  javascript: (b) => [
    `async function callWithRetry(attempt = 1) {`,
    `  const res = await fetch('${b}/products', {`,
    `    headers: { 'X-API-Key': process.env.AX_API_KEY },`,
    `  })`,
    `  if (res.status === 429 && attempt < 3) {`,
    `    const wait = Number(res.headers.get('Retry-After') ?? 60)`,
    `    await new Promise((r) => setTimeout(r, wait * 1000))`,
    `    return callWithRetry(attempt + 1)`,
    `  }`,
    `  return res.json()`,
    `}`,
  ].join('\n'),

  python: (b) => [
    `import os, time, requests`,
    ``,
    `headers = {"X-API-Key": os.environ["AX_API_KEY"]}`,
    `for _ in range(3):`,
    `    res = requests.get("${b}/products", headers=headers)`,
    `    if res.status_code != 429:`,
    `        break`,
    `    time.sleep(int(res.headers.get("Retry-After", 60)))`,
    ``,
    `res.raise_for_status()`,
    `data = res.json()["data"]`,
  ].join('\n'),

  go: (b) => [
    `req, _ := http.NewRequest("GET", "${b}/products", nil)`,
    `req.Header.Set("X-API-Key", os.Getenv("AX_API_KEY"))`,
    ``,
    `var res *http.Response`,
    `for i := 0; i < 3; i++ {`,
    `\tres, _ = http.DefaultClient.Do(req)`,
    `\tif res.StatusCode != http.StatusTooManyRequests { break }`,
    `\twait, _ := strconv.Atoi(res.Header.Get("Retry-After"))`,
    `\tres.Body.Close()`,
    `\ttime.Sleep(time.Duration(wait) * time.Second)`,
    `}`,
    `defer res.Body.Close()`,
  ].join('\n'),

  php: (b) => [
    `<?php`,
    `for ($i = 0; $i < 3; $i++) {`,
    `    $ch = curl_init('${b}/products');`,
    `    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);`,
    `    curl_setopt($ch, CURLOPT_HEADER, true);`,
    `    curl_setopt($ch, CURLOPT_HTTPHEADER, ['X-API-Key: ' . getenv('AX_API_KEY')]);`,
    `    $raw  = curl_exec($ch);`,
    `    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);`,
    `    curl_close($ch);`,
    `    if ($code !== 429) break;`,
    `    preg_match('/retry-after:\\s*(\\d+)/i', $raw, $m);`,
    `    sleep((int) ($m[1] ?? 60));`,
    `}`,
  ].join('\n'),

  java: (b) => [
    `HttpClient client = HttpClient.newHttpClient();`,
    `HttpRequest request = HttpRequest.newBuilder()`,
    `    .uri(URI.create("${b}/products"))`,
    `    .header("X-API-Key", System.getenv("AX_API_KEY"))`,
    `    .build();`,
    ``,
    `HttpResponse<String> res = null;`,
    `for (int i = 0; i < 3; i++) {`,
    `    res = client.send(request, HttpResponse.BodyHandlers.ofString());`,
    `    if (res.statusCode() != 429) break;`,
    `    long wait = Long.parseLong(res.headers().firstValue("Retry-After").orElse("60"));`,
    `    Thread.sleep(wait * 1000);`,
    `}`,
  ].join('\n'),

  csharp: (b) => [
    `var client = new HttpClient();`,
    `client.DefaultRequestHeaders.Add("X-API-Key", Environment.GetEnvironmentVariable("AX_API_KEY"));`,
    ``,
    `HttpResponseMessage res = null;`,
    `for (var i = 0; i < 3; i++) {`,
    `    res = await client.GetAsync("${b}/products");`,
    `    if ((int)res.StatusCode != 429) break;`,
    `    var wait = res.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(60);`,
    `    await Task.Delay(wait);`,
    `}`,
  ].join('\n'),
}

const PAGINATE: Record<string, (b: string) => string> = {
  curl: (b) => [
    `# 첫 페이지 (기본 20건, 최대 100)`,
    `curl "${b}/crm/companies?limit=50" -H "X-API-Key: $AX_API_KEY"`,
    ``,
    `# 응답의 meta.nextCursor 를 그대로 cursor 에 넣는다`,
    `curl "${b}/crm/companies?limit=50&cursor=<meta.nextCursor>" \\`,
    `  -H "X-API-Key: $AX_API_KEY"`,
  ].join('\n'),

  javascript: (b) => [
    `let cursor = null`,
    `const all = []`,
    `do {`,
    `  const url = new URL('${b}/crm/companies')`,
    `  url.searchParams.set('limit', '50')`,
    `  if (cursor) url.searchParams.set('cursor', cursor)`,
    ``,
    `  const res = await fetch(url, { headers: { 'X-API-Key': process.env.AX_API_KEY } })`,
    `  const { data, meta } = await res.json()`,
    `  all.push(...data)`,
    `  cursor = meta.nextCursor`,
    `} while (cursor)`,
  ].join('\n'),

  python: (b) => [
    `import os, requests`,
    ``,
    `headers = {"X-API-Key": os.environ["AX_API_KEY"]}`,
    `params = {"limit": 50}`,
    `rows = []`,
    ``,
    `while True:`,
    `    res = requests.get("${b}/crm/companies", headers=headers, params=params)`,
    `    res.raise_for_status()`,
    `    body = res.json()`,
    `    rows += body["data"]`,
    `    if not body["meta"].get("nextCursor"):`,
    `        break`,
    `    params["cursor"] = body["meta"]["nextCursor"]`,
  ].join('\n'),

  go: (b) => [
    `cursor := ""`,
    `for {`,
    `\turl := "${b}/crm/companies?limit=50"`,
    `\tif cursor != "" { url += "&cursor=" + cursor }`,
    ``,
    `\treq, _ := http.NewRequest("GET", url, nil)`,
    `\treq.Header.Set("X-API-Key", os.Getenv("AX_API_KEY"))`,
    `\tres, err := http.DefaultClient.Do(req)`,
    `\tif err != nil { panic(err) }`,
    ``,
    `\tvar body struct {`,
    `\t\tData []map[string]any \`json:"data"\``,
    `\t\tMeta struct{ NextCursor string \`json:"nextCursor"\` } \`json:"meta"\``,
    `\t}`,
    `\tjson.NewDecoder(res.Body).Decode(&body)`,
    `\tres.Body.Close()`,
    ``,
    `\tif body.Meta.NextCursor == "" { break }`,
    `\tcursor = body.Meta.NextCursor`,
    `}`,
  ].join('\n'),

  php: (b) => [
    `<?php`,
    `$cursor = null;`,
    `do {`,
    `    $url = '${b}/crm/companies?limit=50' . ($cursor ? '&cursor=' . urlencode($cursor) : '');`,
    `    $ch = curl_init($url);`,
    `    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);`,
    `    curl_setopt($ch, CURLOPT_HTTPHEADER, ['X-API-Key: ' . getenv('AX_API_KEY')]);`,
    `    $body = json_decode(curl_exec($ch), true);`,
    `    curl_close($ch);`,
    ``,
    `    $cursor = $body['meta']['nextCursor'] ?? null;`,
    `} while ($cursor);`,
  ].join('\n'),

  java: (b) => [
    `HttpClient client = HttpClient.newHttpClient();`,
    `String cursor = null;`,
    ``,
    `do {`,
    `    String url = "${b}/crm/companies?limit=50"`,
    `        + (cursor == null ? "" : "&cursor=" + cursor);`,
    `    HttpRequest req = HttpRequest.newBuilder()`,
    `        .uri(URI.create(url))`,
    `        .header("X-API-Key", System.getenv("AX_API_KEY"))`,
    `        .build();`,
    ``,
    `    HttpResponse<String> res = client.send(req, HttpResponse.BodyHandlers.ofString());`,
    `    // res.body() 의 meta.nextCursor 를 읽어 cursor 에 넣는다`,
    `} while (cursor != null);`,
  ].join('\n'),

  csharp: (b) => [
    `var client = new HttpClient();`,
    `client.DefaultRequestHeaders.Add("X-API-Key", Environment.GetEnvironmentVariable("AX_API_KEY"));`,
    ``,
    `string cursor = null;`,
    `do {`,
    `    var url = $"${b}/crm/companies?limit=50"`,
    `        + (cursor is null ? "" : $"&cursor={cursor}");`,
    `    var body = await client.GetFromJsonAsync<JsonElement>(url);`,
    ``,
    `    cursor = body.GetProperty("meta").TryGetProperty("nextCursor", out var c)`,
    `        ? c.GetString() : null;`,
    `} while (cursor is not null);`,
  ].join('\n'),
}

export const LANGUAGES: LanguageDef[] = [
  { id: 'curl', label: 'cURL', hl: 'bash', generate: toCurl , retry: RETRY.curl, paginate: PAGINATE.curl },
  { id: 'javascript', label: 'JavaScript', hl: 'javascript', generate: toJavaScript , retry: RETRY.javascript, paginate: PAGINATE.javascript },
  { id: 'python', label: 'Python', hl: 'python', generate: toPython , retry: RETRY.python, paginate: PAGINATE.python },
  { id: 'go', label: 'Go', hl: 'go', generate: toGo , retry: RETRY.go, paginate: PAGINATE.go },
  { id: 'php', label: 'PHP', hl: 'php', generate: toPHP , retry: RETRY.php, paginate: PAGINATE.php },
  { id: 'java', label: 'Java', hl: 'java', generate: toJava , retry: RETRY.java, paginate: PAGINATE.java },
  { id: 'csharp', label: 'C#', hl: 'csharp', generate: toCSharp , retry: RETRY.csharp, paginate: PAGINATE.csharp },
]

export { ENV_HINT }
