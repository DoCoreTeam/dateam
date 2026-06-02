#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const args = new Set(process.argv.slice(2))

const files = {
  prompt: '.ralph/PROMPT.md',
  status: '.ralph/status.json',
  fixPlan: '.ralph/fix_plan.md',
}

function readRequiredFile(label, relativePath) {
  const path = resolve(root, relativePath)

  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${relativePath}`)
  }

  return readFileSync(path, 'utf8')
}

function readStatus() {
  const rawStatus = readRequiredFile('Ralph status', files.status)

  try {
    return JSON.parse(rawStatus)
  } catch (error) {
    throw new Error(`Invalid JSON in ${files.status}: ${error.message}`)
  }
}

function validateMemory() {
  readRequiredFile('Ralph prompt', files.prompt)
  readRequiredFile('Ralph fix plan', files.fixPlan)
  return readStatus()
}

function printStatus(status) {
  console.log('Ralph memory: OK')
  console.log(`Current task: ${status.current_task ?? 'UNKNOWN'}`)
  console.log(`Loop number: ${status.loop_number ?? 'UNKNOWN'}`)
  console.log(`Gate status: ${status.gate_status ?? 'UNKNOWN'}`)
  console.log(`Exit signal: ${String(status.exit_signal ?? false)}`)
  console.log(`Tests status: ${status.tests_status ?? 'UNKNOWN'}`)
}

function printOnceInstructions(status) {
  printStatus(status)
  console.log('')
  console.log('Run one Codex Ralph iteration with:')
  console.log('@ralph <task>')
  console.log('')
  console.log('This helper validates repository Ralph memory; Codex performs the iteration.')
}

try {
  const status = validateMemory()

  if (args.has('--once')) {
    printOnceInstructions(status)
  } else {
    printStatus(status)
  }
} catch (error) {
  console.error(`Ralph check failed: ${error.message}`)
  process.exitCode = 1
}
