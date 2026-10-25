#!/usr/bin/env node
/**
 * 입력 추출기, 동작마다 받는 조회 조건과 본문 칸을 코드에서 읽는다
 *
 * 왜: 명세에 조건 이름이 없어 CLI help 가 「무엇을 넣어야 하는지」 말하지 못했다
 *     AI 는 400 메시지로 이름을 짐작했고, 짐작이 끝내 안 맞는 명령이 남았다 (지시서 문제 7)
 *     손으로 적은 목록은 코드와 갈라진다, 그래서 타입 검사기로 처리 함수를 직접 읽는다
 *
 * 읽는 것
 *   조회 조건  URLSearchParams 의 get getAll has 에 넘긴 글자 이름, 요청을 넘겨받는 도우미 함수 속까지 따라간다
 *   본문 칸    req.json() 이나 readJson(req) 결과가 단언(as T), zod safeParse, 함수 인자로 넘어간 자리의 형
 *   서버 액션  함수 서명의 인자 형
 *
 * complete 는 「이 목록 밖의 이름은 받지 않는다」를 확신할 때만 참이다
 *   이름을 글자로 못 읽거나 조건 묶음을 통째로 넘기면 거짓, CLI 는 거짓이면 모르는 이름을 막지 않는다
 *
 * 출력: { [op.key]: { query: Field[], queryComplete, body: Field[] | null, bodyComplete } }
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const WEB = path.join(ROOT, 'apps/web')
const require = createRequire(path.join(WEB, 'package.json'))
const ts = require('typescript')

const MAX_DEPTH = 4
const REQUEST_TYPES = new Set(['Request', 'NextRequest'])
const QUERY_READERS = new Set(['get', 'getAll', 'has'])
const BODY_READERS = new Set(['readJson', 'readBody', 'readJsonBody', 'safeJson', 'parseJson'])
const NUMBER_WRAPPERS = new Set(['Number', 'parseInt', 'parseFloat'])
/** 본문에서 정해진 칸 하나만 읽는 도우미, 본문을 통째로 넘겨도 다른 칸을 받는 것이 아니다 */
const KEY_READERS = new Set(['requireVersion'])
/** 형을 펼칠 때 칸이 이만큼 넘으면 그 형은 「아무 칸」으로 본다 (Record 꼴 오판 방지) */
const MAX_FIELDS = 80

function loadProgram(files) {
  const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} }
  const cfg = ts.getParsedCommandLineOfConfigFile(path.join(WEB, 'tsconfig.json'), {}, host)
  return ts.createProgram(files, { ...cfg.options, noEmit: true })
}

const isProjectFile = (sf) => !!sf && !sf.isDeclarationFile && !sf.fileName.includes('/node_modules/')

function typeName(checker, node) {
  const t = checker.getTypeAtLocation(node)
  return (t.aliasSymbol ?? t.symbol)?.getName() ?? ''
}
const isRequest = (checker, node) => REQUEST_TYPES.has(typeName(checker, node))
const isSearchParams = (checker, node) => typeName(checker, node) === 'URLSearchParams'

/** 호출된 함수의 선언, 프로젝트 안의 몸통 있는 함수만 */
function calleeDecl(checker, call) {
  let sym = checker.getSymbolAtLocation(call.expression)
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym)
  const decl = sym?.valueDeclaration ?? sym?.declarations?.[0]
  if (!decl) return null
  const fn = ts.isVariableDeclaration(decl) ? decl.initializer : decl
  if (!fn || !isProjectFile(fn.getSourceFile())) return null
  if (ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isMethodDeclaration(fn)) {
    return fn.body ? fn : null
  }
  return null
}

function stripParens(n) {
  let x = n
  while (x && (ts.isParenthesizedExpression(x) || ts.isAwaitExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x))) x = x.expression
  return x
}

/** get('x') 결과가 어떤 형으로 쓰이는지, 숫자 함수로 감싸면 number, 'true' '1' 과 견주면 boolean */
function queryTypeOf(call, fnBody) {
  const direct = directQueryType(call)
  if (direct !== 'string') return direct
  // const yearStr = sp.get('year'); Number(yearStr) 처럼 한 번 옮겨 담은 뒤 감싸는 꼴
  const decl = call.parent && ts.isVariableDeclaration(call.parent) && ts.isIdentifier(call.parent.name) ? call.parent.name.text : null
  if (!decl) return 'string'
  let found = 'string'
  ts.forEachChild(fnBody, function visit(n) {
    if (found !== 'string') return
    if (ts.isIdentifier(n) && n.text === decl && n !== call.parent.name) {
      const t = directQueryType(n)
      if (t !== 'string') found = t
    }
    ts.forEachChild(n, visit)
  })
  return found
}

function directQueryType(call) {
  let p = call.parent
  while (p && (ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p) || (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))) p = p.parent
  if (p && ts.isCallExpression(p) && ts.isIdentifier(p.expression) && NUMBER_WRAPPERS.has(p.expression.text)) {
    return p.expression.text === 'parseFloat' ? 'number' : 'integer'
  }
  if (p && ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(p.operatorToken.kind)) {
    const other = p.left === call || stripParens(p.left) === call ? p.right : p.left
    if (ts.isStringLiteral(other) && ['true', 'false', '1', '0'].includes(other.text)) return 'boolean'
  }
  return 'string'
}

/** const x = sp.get('a') 뒤에 if (!x) 400 이 오면 필수 */
function isRequiredQuery(call, fnBody) {
  let p = call.parent
  while (p && !ts.isVariableDeclaration(p) && !ts.isBlock(p) && !ts.isSourceFile(p)) p = p.parent
  if (!p || !ts.isVariableDeclaration(p) || !ts.isIdentifier(p.name)) return false
  const names = new Set([p.name.text])
  // 한 번 옮겨 담은 이름도 본다 (const year = Number(yearStr))
  ts.forEachChild(fnBody, function visit(n) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const text = n.initializer.getText()
      if ([...names].some((v) => new RegExp(`\\b${v}\\b`).test(text))) names.add(n.name.text)
    }
    ts.forEachChild(n, visit)
  })
  let required = false
  ts.forEachChild(fnBody, function visit(n) {
    if (required) return
    if (ts.isIfStatement(n)) {
      const cond = n.expression.getText()
      const then = n.thenStatement.getText()
      const tested = [...names].some((v) => new RegExp(`(^|[^\\w.])!\\s*${v}\\b|\\b${v}\\s*===?\\s*(null|undefined|'')`).test(cond))
      if (tested && /\b400\b|throw\b|badRequest|VALIDATION/.test(then)) required = true
    }
    ts.forEachChild(n, visit)
  })
  return required
}

function addField(map, f) {
  const cur = map.get(f.name)
  if (!cur) { map.set(f.name, f); return }
  map.set(f.name, {
    ...cur,
    type: cur.type === 'string' && f.type !== 'string' ? f.type : cur.type,
    required: cur.required || f.required,
    ...(cur.enum || f.enum ? { enum: cur.enum ?? f.enum } : {}),
  })
}

/** 조회 조건 읽기, 요청이나 조건 묶음을 넘겨받는 함수 속까지 */
function readQuery(checker, root, state, depth = 0) {
  if (depth > MAX_DEPTH || state.seen.has(root)) return
  state.seen.add(root)
  const body = root.body ?? root
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression
      if (ts.isPropertyAccessExpression(callee) && QUERY_READERS.has(callee.name.text) && isSearchParams(checker, callee.expression)) {
        const arg = n.arguments[0]
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
          const type = callee.name.text === 'getAll' ? 'array' : queryTypeOf(n, body)
          addField(state.fields, { name: arg.text, type, required: isRequiredQuery(n, body) })
        } else {
          state.complete = false
        }
      } else if (n.arguments.some((a) => isRequest(checker, a) || isSearchParams(checker, a))) {
        const decl = calleeDecl(checker, n)
        if (decl) readQuery(checker, decl, state, depth + 1)
        else if (!isSafeSink(n)) state.complete = false
      }
    } else if ((ts.isForOfStatement(n) && isSearchParams(checker, n.expression)) || (ts.isSpreadElement(n) && isSearchParams(checker, n.expression))) {
      state.complete = false
    } else if (ts.isPropertyAccessExpression(n) && isSearchParams(checker, n.expression) && ['entries', 'keys', 'forEach', 'toString', 'values'].includes(n.name.text)) {
      state.complete = false
    }
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(body, visit)
}

/** 요청을 넘겨도 조회 조건을 읽지 않는 바깥 함수 (응답 만들기 기록 남기기) */
function isSafeSink(call) {
  const text = call.expression.getText()
  return /^(NextResponse\.|Response\.|console\.|new URL$)/.test(text) || text === 'NextResponse.json'
}

/** 형 하나를 JSON 스키마 조각으로, 깊이 한 단만 */
function schemaOf(checker, type) {
  const F = ts.TypeFlags
  if (type.flags & (F.Any | F.Unknown)) return {}
  if (type.isUnion()) {
    const parts = type.types.filter((t) => !(t.flags & (F.Undefined | F.Null | F.Void)))
    if (parts.length === 0) return {}
    if (parts.every((t) => t.flags & F.StringLiteral)) return { type: 'string', enum: parts.map((t) => t.value) }
    if (parts.every((t) => t.flags & F.NumberLiteral)) return { type: 'number', enum: parts.map((t) => t.value) }
    if (parts.every((t) => t.flags & F.BooleanLike)) return { type: 'boolean' }
    if (parts.length === 1) return schemaOf(checker, parts[0])
    const kinds = new Set(parts.map((t) => schemaOf(checker, t).type))
    return kinds.size === 1 ? { type: [...kinds][0] } : {}
  }
  if (type.isIntersection()) {
    // 낙인 형 (number & { __brand }) 은 바탕 형으로
    const base = type.types.find((t) => t.flags & (F.StringLike | F.NumberLike | F.BooleanLike))
    if (base) return schemaOf(checker, base)
  }
  if (type.flags & F.StringLike) return { type: 'string' }
  if (type.flags & F.NumberLike) return { type: 'number' }
  if (type.flags & F.BooleanLike) return { type: 'boolean' }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const el = checker.getTypeArguments(type)[0]
    const items = el ? schemaOf(checker, el) : {}
    return { type: 'array', ...(Object.keys(items).length ? { items } : {}) }
  }
  if ((type.aliasSymbol ?? type.symbol)?.getName() === 'Date') return { type: 'string', format: 'date-time' }
  if (type.flags & F.Object) return { type: 'object' }
  return {}
}

/** 객체 형의 칸 목록, 이름 없는 색인 형(Record<string, x>)이면 null */
function fieldsOfType(checker, type) {
  const F = ts.TypeFlags
  if (!type || type.flags & (F.Any | F.Unknown)) return null
  const t = type.isUnion() ? type.types.find((x) => x.flags & F.Object) ?? type : type
  if (!(t.flags & F.Object) || checker.isArrayType(t)) return null
  if (checker.getIndexInfosOfType(t).length > 0) return null
  const props = checker.getPropertiesOfType(t)
  if (props.length === 0 || props.length > MAX_FIELDS) return null
  return props.map((p) => {
    const decl = p.valueDeclaration ?? p.declarations?.[0]
    const pt = decl ? checker.getTypeOfSymbolAtLocation(p, decl) : checker.getTypeOfSymbol(p)
    const optional = !!(p.flags & ts.SymbolFlags.Optional) || (pt.isUnion() && pt.types.some((x) => x.flags & ts.TypeFlags.Undefined))
    return { name: p.getName(), ...schemaOf(checker, pt), required: !optional }
  })
}

/** 본문을 읽는 호출인가: req.json(), readJson(req), 그리고 그 둘에 .catch() 를 붙인 꼴 */
function isBodyRead(checker, n) {
  if (!n || !ts.isCallExpression(n)) return false
  const c = n.expression
  if (ts.isPropertyAccessExpression(c) && c.name.text === 'catch') return isBodyRead(checker, stripParens(c.expression))
  if (ts.isPropertyAccessExpression(c) && c.name.text === 'json' && isRequest(checker, c.expression)) return true
  if (ts.isIdentifier(c) && BODY_READERS.has(c.text) && n.arguments.some((a) => isRequest(checker, a))) return true
  return false
}

/** zod 스키마가 받는 형 (_input, 기본값 있는 칸은 비워도 되므로 _output 이 아니다) */
function zodOutput(checker, schemaExpr) {
  const t = checker.getTypeAtLocation(schemaExpr)
  const out = t.getProperty('_input') ?? t.getProperty('_output')
  return out ? checker.getTypeOfSymbolAtLocation(out, schemaExpr) : null
}

/** 본문 식을 감싼 await 괄호 .catch() 를 지나 바깥 자리까지 */
function outerOf(n) {
  let x = n
  for (;;) {
    const p = x.parent
    if (!p) return x
    if (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p)) { x = p; continue }
    if (ts.isPropertyAccessExpression(p) && p.name.text === 'catch' && ts.isCallExpression(p.parent)) { x = p.parent; continue }
    return x
  }
}

const isBindingAlias = (p, n) => ts.isVariableDeclaration(p) && p.initializer === n && ts.isIdentifier(p.name)

/** 본문 칸 읽기 */
function readBody(checker, root) {
  const state = { fields: new Map(), typed: false, loose: false, found: false }
  const bodyVars = new Set()
  const body = root.body ?? root
  const take = (fields) => {
    if (!fields) { state.loose = true; return }
    state.typed = true
    for (const f of fields) addField(state.fields, f)
  }
  const bindNames = (pattern) => {
    for (const el of pattern.elements) {
      if (el.dotDotDotToken) { state.loose = true; continue }
      addField(state.fields, { name: (el.propertyName ?? el.name).getText(), required: false })
    }
  }

  /** 본문 값 하나(변수 참조 또는 읽는 식 자체)가 어디로 가는지 */
  const follow = (n) => {
    const p = n.parent
    if (ts.isPropertyAccessExpression(p) && p.expression === n) { addField(state.fields, { name: p.name.text, required: false }); return }
    if (ts.isElementAccessExpression(p) && p.expression === n) {
      if (ts.isStringLiteral(p.argumentExpression)) addField(state.fields, { name: p.argumentExpression.text, required: false })
      else state.loose = true
      return
    }
    if (ts.isVariableDeclaration(p) && p.initializer === n) {
      if (ts.isObjectBindingPattern(p.name)) { bindNames(p.name); return }
      if (ts.isIdentifier(p.name)) {
        if (p.type) { const f = fieldsOfType(checker, checker.getTypeFromTypeNode(p.type)); if (f) take(f) }
        bodyVars.add(p.name.text)
      }
      return
    }
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === n && ts.isIdentifier(p.left)) {
      bodyVars.add(p.left.text)
      return
    }
    if (ts.isCallExpression(p) && p.arguments.includes(n)) {
      const callee = p.expression
      if (ts.isPropertyAccessExpression(callee) && ['safeParse', 'parse', 'safeParseAsync', 'parseAsync'].includes(callee.name.text)) {
        take(fieldsOfType(checker, zodOutput(checker, callee.expression)))
        return
      }
      if (ts.isIdentifier(callee) && KEY_READERS.has(callee.text)) return
      const sig = checker.getResolvedSignature(p)
      const param = sig?.parameters[p.arguments.indexOf(n)]
      const pt = param?.valueDeclaration ? checker.getTypeOfSymbolAtLocation(param, param.valueDeclaration) : null
      const fields = pt ? fieldsOfType(checker, pt) : null
      if (fields) take(fields)
      else state.loose = true
      return
    }
    if (ts.isAsExpression(p) || (ts.isSpreadAssignment(p) && ts.isAsExpression(stripAsParent(p)))) {
      let target = ts.isAsExpression(p) ? p : stripAsParent(p)
      while (ts.isAsExpression(target.parent)) target = target.parent
      const fields = fieldsOfType(checker, checker.getTypeFromTypeNode(target.type))
      if (fields) { take(fields); return }
      // as Record<string, unknown> 같은 빈 단언은 이름만 바꾼 것, 그 이름을 따라간다
      if (isBindingAlias(target.parent, target)) { bodyVars.add(target.parent.name.text); return }
      if (ts.isBinaryExpression(target.parent) && target.parent.right === target && ts.isIdentifier(target.parent.left)) { bodyVars.add(target.parent.left.text); return }
      state.loose = true
      return
    }
    if (ts.isBinaryExpression(p) || ts.isPrefixUnaryExpression(p) || ts.isTypeOfExpression(p) || ts.isIfStatement(p)) return
    state.loose = true
  }

  // 1 읽는 식 자체
  ts.forEachChild(body, function visit(n) {
    if (isBodyRead(checker, n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name.text === 'catch')) {
      state.found = true
      const generic = n.typeArguments?.[0] ? fieldsOfType(checker, checker.getTypeFromTypeNode(n.typeArguments[0])) : null
      if (generic) take(generic)
      follow(outerOf(n))
    }
    ts.forEachChild(n, visit)
  })
  if (!state.found) return null
  // 2 담은 이름들, 이름이 이름을 낳으면 한 바퀴 더
  let size = -1
  const done = new Set()
  while (bodyVars.size !== size) {
    size = bodyVars.size
    ts.forEachChild(body, function visit(n) {
      if (ts.isIdentifier(n) && bodyVars.has(n.text) && !done.has(n) && n.parent && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n)
        && !(ts.isBinaryExpression(n.parent) && n.parent.left === n) && !ts.isParameter(n.parent)) {
        done.add(n)
        follow(n)
      }
      ts.forEachChild(n, visit)
    })
  }
  return finish(state)
}

/** { ...body, x } as T 꼴에서 바깥 단언까지 올라간다 */
function stripAsParent(spread) {
  let p = spread.parent
  while (p && (ts.isObjectLiteralExpression(p) || ts.isParenthesizedExpression(p))) p = p.parent
  while (p && ts.isAsExpression(p) && ts.isAsExpression(p.parent)) p = p.parent
  return p
}

function finish(state) {
  const fields = [...state.fields.values()].sort((a, b) => a.name.localeCompare(b.name))
  return { fields, complete: state.typed && !state.loose && fields.length > 0 }
}

/** export async function GET 이나 export const GET = ... 의 몸통 */
function methodNodes(sf) {
  const out = new Map()
  for (const st of sf.statements) {
    const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!exported) continue
    if (ts.isFunctionDeclaration(st) && st.name && st.body) out.set(st.name.text, st)
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) out.set(d.name.text, d.initializer)
      }
    }
  }
  return out
}

/** 몸통이 다른 지역 함수를 이름으로 넘기면(export const GET = run) 그 함수를 본다 */
function resolveLocal(checker, node) {
  if (ts.isIdentifier(node)) {
    const sym = checker.getSymbolAtLocation(node)
    const decl = sym?.valueDeclaration
    if (decl && ts.isFunctionDeclaration(decl)) return decl
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer) return decl.initializer
  }
  return node
}

function actionFunction(sf, name) {
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st
  }
  return null
}

function routeInputs(checker, sf, method) {
  const node = methodNodes(sf).get(method)
  if (!node) return null
  const root = resolveLocal(checker, node)
  const q = { fields: new Map(), complete: true, seen: new Set() }
  readQuery(checker, root, q)
  const query = [...q.fields.values()].sort((a, b) => a.name.localeCompare(b.name))
  const b = method === 'GET' ? null : readBody(checker, root)
  return {
    query,
    queryComplete: q.complete,
    body: b ? b.fields : null,
    bodyComplete: b ? b.complete : false,
  }
}

function actionInputs(checker, sf, name) {
  const fn = actionFunction(sf, name)
  if (!fn) return null
  const args = fn.parameters.map((p) => {
    const t = checker.getTypeAtLocation(p)
    const optional = !!p.questionToken || !!p.initializer
    const argName = ts.isIdentifier(p.name) ? p.name.text : 'input'
    const fields = fieldsOfType(checker, t)
    return { name: argName, ...schemaOf(checker, t), required: !optional, ...(fields ? { fields } : {}) }
  })
  return { query: [], queryComplete: true, args }
}

/**
 * ops: extract-operations 의 출력. 정의가 있는 동작만 넘기면 빨라진다
 * 반환: op.key → 입력
 */
export function extractInputs(ops) {
  const files = [...new Set(ops.map((o) => path.join(ROOT, o.file)))]
  const program = loadProgram(files)
  const checker = program.getTypeChecker()
  const out = {}
  for (const op of ops) {
    const sf = program.getSourceFile(path.join(ROOT, op.file))
    if (!sf) continue
    const res = op.kind === 'action'
      ? actionInputs(checker, sf, op.path.split('#')[1])
      : routeInputs(checker, sf, op.method)
    if (res) out[op.key] = res
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { extractOperations } = await import('./extract-operations.mjs')
  const only = process.argv.slice(2)
  const ops = extractOperations().filter((o) => only.length === 0 || only.some((k) => o.key.includes(k)))
  process.stdout.write(JSON.stringify(extractInputs(ops), null, 1) + '\n')
}
