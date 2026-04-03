#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const entry = join(__dirname, '..', 'dist', 'bin', 'airlock.js')

// Find tsx binary
const paths = [
  join(__dirname, '..', 'node_modules', '.bin', 'tsx'),
  join(process.cwd(), 'node_modules', '.bin', 'tsx'),
]
const tsx = paths.find(p => existsSync(p))

if (!tsx) {
  console.error('  tsx not found. Run: npm install tsx')
  process.exit(1)
}

try {
  execFileSync(tsx, [entry, ...process.argv.slice(2)], { stdio: 'inherit', cwd: process.cwd() })
} catch (e) {
  process.exit(e.status || 1)
}
