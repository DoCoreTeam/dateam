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

/**
 * 경로 변수(`{id}`, `:id`)를 `<id>` 자리표시로 바꾼다
 * (P0168) 예시 주소에 `/products/:id` 가 그대로 실려 붙여 넣으면 404 였다.
 * `<id>` 는 그대로 보내면 서버가 거절하는 꼴이라, 바꿔 넣어야 한다는 것이 눈에 보인다
 */
export function placeholderPath(path: string): string {
  return path.replace(/\{(\w+)\}|:(\w+)/g, (_m, a: string | undefined, b: string | undefined) => `<${a ?? b}>`)
}

/** 쿼리 값의 자리표시(<workspace_id>)는 인코딩하지 않고 그대로 보인다 */
function encodeQueryValue(v: string): string {
  return /^<\w+>$/.test(v) ? v : encodeURIComponent(v)
}

function fullUrl(baseUrl: string, spec: RequestSpec): string {
  const qs = spec.query
    ? Object.entries(spec.query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeQueryValue(v)}`)
        .join('&')
    : ''
  const path = placeholderPath(spec.path)
  return qs ? `${baseUrl}${path}?${qs}` : `${baseUrl}${path}`
}

/** 셸의 작은따옴표 문자열 안에 넣을 수 있게 */
function shellQuoted(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Java C# 의 큰따옴표 문자열 리터럴 안에 넣을 수 있게, 역슬래시를 먼저 */
function cStringBody(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function jsonBody(body: unknown, indent = 2): string {
  return JSON.stringify(body, null, indent)
}

// ─── curl ─────────────────────────────────────────────────────────────────────
function toCurl(spec: RequestSpec, baseUrl: string): string {
  const url = fullUrl(baseUrl, spec)
  const lines: string[] = []
  const methodFlag = spec.method === 'GET' ? '' : `-X ${spec.method} `
  // 주소를 따옴표로 감싼다, & 와 <id> 가 셸에서 다른 뜻이 된다
  lines.push(`curl ${methodFlag}"${url}" \\`)
  lines.push(`  -H "X-API-Key: $AX_API_KEY"${spec.body ? ' \\' : ''}`)
  if (spec.body) {
    lines.push('  -H "Content-Type: application/json" \\')
    lines.push(`  -d ${shellQuoted(jsonBody(spec.body, 0))}`)
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
  // 맨 위 await 는 CommonJS 에서 문법 오류라 async 함수로 감싼다
  return [
    `// Node.js 18+ (서버에서만 부르고 브라우저에 키를 노출하지 마세요)`,
    `async function main() {`,
    `  const res = await fetch('${url}', {`,
    ...opts.map((l) => `  ${l}`),
    `  })`,
    ``,
    `  if (!res.ok) throw new Error((await res.json()).error)`,
    `  const { data, meta } = await res.json()`,
    `  console.log(data, meta)`,
    `}`,
    ``,
    `main().catch((err) => { console.error(err); process.exitCode = 1 })`,
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
  if (hasBody) lines.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, '${jsonBody(spec.body, 0).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}');`)
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
    ? `HttpRequest.BodyPublishers.ofString("${cStringBody(jsonBody(spec.body, 0))}")`
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
    lines.push(`    "${cStringBody(jsonBody(spec.body, 0))}",`)
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

// 다시 시도 규칙은 CLI 와 같다: 429 는 Retry-After 만큼 기다리며 최대 3번, 5xx 는 1초 뒤 1번
const RETRY: Record<string, (b: string) => string> = {
  curl: (b) => [
    `# 429 면 Retry-After 초만큼 기다리고, 5xx 면 1초 뒤 한 번 더 부른다`,
    `retried5xx=0`,
    `for i in 1 2 3 4; do`,
    `  code=$(curl -s -o /tmp/ax.json -D /tmp/ax.head -w '%{http_code}' \\`,
    `    "${b}/products" -H "X-API-Key: $AX_API_KEY")`,
    `  case "$code" in`,
    `    429)`,
    `      # 헤더 줄 끝의 \\r 을 지워야 sleep 이 숫자로 읽는다`,
    `      wait=$(awk 'tolower($1)=="retry-after:"{print $2}' /tmp/ax.head | tr -d '\\r')`,
    `      sleep "\${wait:-1}" ;;`,
    `    5??)`,
    `      [ "$retried5xx" = 1 ] && break`,
    `      retried5xx=1`,
    `      sleep 1 ;;`,
    `    *) break ;;`,
    `  esac`,
    `done`,
    `cat /tmp/ax.json`,
  ].join('\n'),

  javascript: (b) => [
    `// Node.js 18+, CommonJS 와 ES 모듈 어디서나 돈다`,
    `async function callWithRetry() {`,
    `  let retried5xx = false`,
    `  for (let attempt = 1; ; attempt++) {`,
    `    const res = await fetch('${b}/products', {`,
    `      headers: { 'X-API-Key': process.env.AX_API_KEY },`,
    `    })`,
    `    if (res.status === 429 && attempt <= 3) {`,
    `      const wait = Number(res.headers.get('Retry-After')) || 1`,
    `      await new Promise((r) => setTimeout(r, wait * 1000))`,
    `      continue`,
    `    }`,
    `    if (res.status >= 500 && !retried5xx) {`,
    `      retried5xx = true`,
    `      await new Promise((r) => setTimeout(r, 1000))`,
    `      continue`,
    `    }`,
    `    if (!res.ok) throw new Error(\`HTTP \${res.status}\`)`,
    `    return res.json()`,
    `  }`,
    `}`,
    ``,
    `callWithRetry()`,
    `  .then(({ data }) => console.log(data))`,
    `  .catch((err) => { console.error(err); process.exitCode = 1 })`,
  ].join('\n'),

  python: (b) => [
    `import os, time, requests`,
    ``,
    `headers = {"X-API-Key": os.environ["AX_API_KEY"]}`,
    `retried_5xx = False`,
    `for attempt in range(4):`,
    `    res = requests.get("${b}/products", headers=headers)`,
    `    if res.status_code == 429 and attempt < 3:`,
    `        time.sleep(int(res.headers.get("Retry-After", 1)))`,
    `        continue`,
    `    if res.status_code >= 500 and not retried_5xx:`,
    `        retried_5xx = True`,
    `        time.sleep(1)`,
    `        continue`,
    `    break`,
    ``,
    `res.raise_for_status()`,
    `data = res.json()["data"]`,
    `print(data)`,
  ].join('\n'),

  go: (b) => [
    `package main`,
    ``,
    `import (`,
    `\t"fmt"`,
    `\t"io"`,
    `\t"net/http"`,
    `\t"os"`,
    `\t"strconv"`,
    `\t"time"`,
    `)`,
    ``,
    `func main() {`,
    `\tretried5xx := false`,
    `\tvar res *http.Response`,
    `\tfor attempt := 1; ; attempt++ {`,
    `\t\treq, _ := http.NewRequest("GET", "${b}/products", nil)`,
    `\t\treq.Header.Set("X-API-Key", os.Getenv("AX_API_KEY"))`,
    `\t\tr, err := http.DefaultClient.Do(req)`,
    `\t\tif err != nil {`,
    `\t\t\tpanic(err)`,
    `\t\t}`,
    `\t\tres = r`,
    `\t\tif res.StatusCode == http.StatusTooManyRequests && attempt <= 3 {`,
    `\t\t\twait, err := strconv.Atoi(res.Header.Get("Retry-After"))`,
    `\t\t\tif err != nil {`,
    `\t\t\t\twait = 1`,
    `\t\t\t}`,
    `\t\t\tres.Body.Close()`,
    `\t\t\ttime.Sleep(time.Duration(wait) * time.Second)`,
    `\t\t\tcontinue`,
    `\t\t}`,
    `\t\tif res.StatusCode >= 500 && !retried5xx {`,
    `\t\t\tretried5xx = true`,
    `\t\t\tres.Body.Close()`,
    `\t\t\ttime.Sleep(time.Second)`,
    `\t\t\tcontinue`,
    `\t\t}`,
    `\t\tbreak`,
    `\t}`,
    `\tdefer res.Body.Close()`,
    `\tbody, _ := io.ReadAll(res.Body)`,
    `\tfmt.Println(res.StatusCode, string(body))`,
    `}`,
  ].join('\n'),

  php: (b) => [
    `<?php`,
    `$retried5xx = false;`,
    `for ($attempt = 1; ; $attempt++) {`,
    `    $ch = curl_init('${b}/products');`,
    `    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);`,
    `    curl_setopt($ch, CURLOPT_HEADER, true);`,
    `    curl_setopt($ch, CURLOPT_HTTPHEADER, ['X-API-Key: ' . getenv('AX_API_KEY')]);`,
    `    $raw  = curl_exec($ch);`,
    `    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);`,
    `    curl_close($ch);`,
    `    if ($code === 429 && $attempt <= 3) {`,
    `        preg_match('/retry-after:\\s*(\\d+)/i', $raw, $m);`,
    `        sleep((int) ($m[1] ?? 1));`,
    `        continue;`,
    `    }`,
    `    if ($code >= 500 && !$retried5xx) {`,
    `        $retried5xx = true;`,
    `        sleep(1);`,
    `        continue;`,
    `    }`,
    `    break;`,
    `}`,
  ].join('\n'),

  java: (b) => [
    `import java.net.URI;`,
    `import java.net.http.HttpClient;`,
    `import java.net.http.HttpRequest;`,
    `import java.net.http.HttpResponse;`,
    ``,
    `public class Main {`,
    `    public static void main(String[] args) throws Exception {`,
    `        HttpClient client = HttpClient.newHttpClient();`,
    `        HttpRequest request = HttpRequest.newBuilder()`,
    `            .uri(URI.create("${b}/products"))`,
    `            .header("X-API-Key", System.getenv("AX_API_KEY"))`,
    `            .build();`,
    ``,
    `        boolean retried5xx = false;`,
    `        HttpResponse<String> res;`,
    `        for (int attempt = 1; ; attempt++) {`,
    `            res = client.send(request, HttpResponse.BodyHandlers.ofString());`,
    `            if (res.statusCode() == 429 && attempt <= 3) {`,
    `                long wait = Long.parseLong(res.headers().firstValue("Retry-After").orElse("1").trim());`,
    `                Thread.sleep(wait * 1000);`,
    `                continue;`,
    `            }`,
    `            if (res.statusCode() >= 500 && !retried5xx) {`,
    `                retried5xx = true;`,
    `                Thread.sleep(1000);`,
    `                continue;`,
    `            }`,
    `            break;`,
    `        }`,
    `        System.out.println(res.statusCode() + " " + res.body());`,
    `    }`,
    `}`,
  ].join('\n'),

  csharp: (b) => [
    `using System;`,
    `using System.Net.Http;`,
    `using System.Threading.Tasks;`,
    ``,
    `var client = new HttpClient();`,
    `client.DefaultRequestHeaders.Add("X-API-Key", Environment.GetEnvironmentVariable("AX_API_KEY"));`,
    ``,
    `var retried5xx = false;`,
    `HttpResponseMessage res;`,
    `for (var attempt = 1; ; attempt++) {`,
    `    res = await client.GetAsync("${b}/products");`,
    `    if ((int)res.StatusCode == 429 && attempt <= 3) {`,
    `        var wait = res.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(1);`,
    `        await Task.Delay(wait);`,
    `        continue;`,
    `    }`,
    `    if ((int)res.StatusCode >= 500 && !retried5xx) {`,
    `        retried5xx = true;`,
    `        await Task.Delay(TimeSpan.FromSeconds(1));`,
    `        continue;`,
    `    }`,
    `    break;`,
    `}`,
    `Console.WriteLine($"{(int)res.StatusCode} {await res.Content.ReadAsStringAsync()}");`,
  ].join('\n'),
}

// 커서는 서버가 준 그대로 넘기되 주소에 넣을 때는 반드시 인코딩한다 (+ / = & 가 섞일 수 있다)
const PAGINATE: Record<string, (b: string) => string> = {
  curl: (b) => [
    `# 첫 페이지 (기본 20건, 최대 100)`,
    `curl "${b}/crm/companies?limit=50" -H "X-API-Key: $AX_API_KEY"`,
    ``,
    `# 응답의 meta.nextCursor 를 그대로 cursor 에 넣는다 (-G 와 --data-urlencode 가 인코딩한다)`,
    `curl -G "${b}/crm/companies" --data-urlencode "limit=50" \\`,
    `  --data-urlencode "cursor=<meta.nextCursor>" \\`,
    `  -H "X-API-Key: $AX_API_KEY"`,
  ].join('\n'),

  javascript: (b) => [
    `// Node.js 18+, CommonJS 와 ES 모듈 어디서나 돈다`,
    `async function main() {`,
    `  let cursor = null`,
    `  const all = []`,
    `  do {`,
    `    const url = new URL('${b}/crm/companies')`,
    `    url.searchParams.set('limit', '50')`,
    `    if (cursor) url.searchParams.set('cursor', cursor)`,
    ``,
    `    const res = await fetch(url, { headers: { 'X-API-Key': process.env.AX_API_KEY } })`,
    `    if (!res.ok) throw new Error(\`HTTP \${res.status}\`)`,
    `    const { data, meta } = await res.json()`,
    `    all.push(...data)`,
    `    cursor = meta.nextCursor`,
    `  } while (cursor)`,
    `  return all`,
    `}`,
    ``,
    `main()`,
    `  .then((all) => console.log(all.length))`,
    `  .catch((err) => { console.error(err); process.exitCode = 1 })`,
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
    ``,
    `print(len(rows))`,
  ].join('\n'),

  go: (b) => [
    `package main`,
    ``,
    `import (`,
    `\t"encoding/json"`,
    `\t"fmt"`,
    `\t"net/http"`,
    `\t"net/url"`,
    `\t"os"`,
    `)`,
    ``,
    `func main() {`,
    `\tvar rows []map[string]any`,
    `\tcursor := ""`,
    `\tfor {`,
    `\t\tu := "${b}/crm/companies?limit=50"`,
    `\t\tif cursor != "" {`,
    `\t\t\tu += "&cursor=" + url.QueryEscape(cursor)`,
    `\t\t}`,
    ``,
    `\t\treq, _ := http.NewRequest("GET", u, nil)`,
    `\t\treq.Header.Set("X-API-Key", os.Getenv("AX_API_KEY"))`,
    `\t\tres, err := http.DefaultClient.Do(req)`,
    `\t\tif err != nil {`,
    `\t\t\tpanic(err)`,
    `\t\t}`,
    ``,
    `\t\tvar body struct {`,
    `\t\t\tData []map[string]any \`json:"data"\``,
    `\t\t\tMeta struct {`,
    `\t\t\t\tNextCursor string \`json:"nextCursor"\``,
    `\t\t\t} \`json:"meta"\``,
    `\t\t}`,
    `\t\terr = json.NewDecoder(res.Body).Decode(&body)`,
    `\t\tres.Body.Close()`,
    `\t\tif err != nil {`,
    `\t\t\tpanic(err)`,
    `\t\t}`,
    `\t\trows = append(rows, body.Data...)`,
    ``,
    `\t\tif body.Meta.NextCursor == "" {`,
    `\t\t\tbreak`,
    `\t\t}`,
    `\t\tcursor = body.Meta.NextCursor`,
    `\t}`,
    `\tfmt.Println(len(rows))`,
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
    `import java.net.URI;`,
    `import java.net.URLEncoder;`,
    `import java.net.http.HttpClient;`,
    `import java.net.http.HttpRequest;`,
    `import java.net.http.HttpResponse;`,
    `import java.nio.charset.StandardCharsets;`,
    `import java.util.regex.Matcher;`,
    `import java.util.regex.Pattern;`,
    ``,
    `public class Main {`,
    `    // 예시라 정규식으로 읽는다, 실제 코드는 Jackson 같은 JSON 라이브러리를 쓴다`,
    String.raw`    static final Pattern NEXT = Pattern.compile("\"nextCursor\"\\s*:\\s*\"([^\"]+)\"");`,
    ``,
    `    public static void main(String[] args) throws Exception {`,
    `        HttpClient client = HttpClient.newHttpClient();`,
    `        String cursor = null;`,
    `        int pages = 0;`,
    `        do {`,
    `            String url = "${b}/crm/companies?limit=50"`,
    `                + (cursor == null ? "" : "&cursor=" + URLEncoder.encode(cursor, StandardCharsets.UTF_8));`,
    `            HttpRequest req = HttpRequest.newBuilder()`,
    `                .uri(URI.create(url))`,
    `                .header("X-API-Key", System.getenv("AX_API_KEY"))`,
    `                .build();`,
    ``,
    `            HttpResponse<String> res = client.send(req, HttpResponse.BodyHandlers.ofString());`,
    `            if (res.statusCode() != 200) throw new RuntimeException("HTTP " + res.statusCode());`,
    `            pages++;`,
    `            Matcher m = NEXT.matcher(res.body());`,
    `            cursor = m.find() ? m.group(1) : null;`,
    `        } while (cursor != null);`,
    `        System.out.println(pages + " pages");`,
    `    }`,
    `}`,
  ].join('\n'),

  csharp: (b) => [
    `using System;`,
    `using System.Net.Http;`,
    `using System.Text.Json;`,
    ``,
    `var client = new HttpClient();`,
    `client.DefaultRequestHeaders.Add("X-API-Key", Environment.GetEnvironmentVariable("AX_API_KEY"));`,
    ``,
    `string? cursor = null;`,
    `var pages = 0;`,
    `do {`,
    `    var url = "${b}/crm/companies?limit=50"`,
    `        + (cursor is null ? "" : "&cursor=" + Uri.EscapeDataString(cursor));`,
    `    // JsonDocument 는 리플렉션 없이 읽어 파일 하나로 돌리는 앱에서도 돈다`,
    `    var body = JsonDocument.Parse(await client.GetStringAsync(url)).RootElement;`,
    `    pages++;`,
    ``,
    `    cursor = body.GetProperty("meta").TryGetProperty("nextCursor", out var c)`,
    `        ? c.GetString() : null;`,
    `} while (cursor is not null);`,
    `Console.WriteLine($"{pages} pages");`,
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
