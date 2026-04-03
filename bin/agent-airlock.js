#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = join(__dirname, '..', 'dist', 'bin', 'airlock.js')
const tsx = join(__dirname, '..', 'node_modules', '.bin', 'tsx')

try {
  execFileSync(tsx, [entry, ...process.argv.slice(2)], { stdio: 'inherit' })
} catch (e) {
  process.exit(e.status || 1)
}
