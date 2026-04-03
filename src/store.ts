import { readFile, writeFile, mkdir, unlink, readdir } from 'fs/promises'
import path from 'path'
import type { ApprovalRequest } from './types.js'

export class Store {
  private pendingDir: string
  private doneDir: string

  constructor(dataDir: string) {
    this.pendingDir = path.join(dataDir, 'pending')
    this.doneDir = path.join(dataDir, 'done')
  }

  async save(req: ApprovalRequest): Promise<void> {
    await mkdir(this.pendingDir, { recursive: true })
    await writeFile(path.join(this.pendingDir, `${req.id}.json`), JSON.stringify(req, null, 2))
  }

  async get(id: string): Promise<ApprovalRequest | null> {
    try {
      return JSON.parse(await readFile(path.join(this.pendingDir, `${id}.json`), 'utf-8'))
    } catch {
      return null
    }
  }

  async resolve(id: string, status: 'approved' | 'rejected', result?: Record<string, unknown>): Promise<void> {
    const pending = await this.get(id)
    if (!pending) return

    const resolved = { ...pending, status, result, resolvedAt: new Date().toISOString() }
    await mkdir(this.doneDir, { recursive: true })
    await writeFile(path.join(this.doneDir, `${id}.json`), JSON.stringify(resolved, null, 2))
    await unlink(path.join(this.pendingDir, `${id}.json`)).catch(() => {})
  }

  async listPending(): Promise<ApprovalRequest[]> {
    try {
      const files = await readdir(this.pendingDir)
      const items = await Promise.all(
        files.filter(f => f.endsWith('.json')).map(async f => {
          try { return JSON.parse(await readFile(path.join(this.pendingDir, f), 'utf-8')) } catch { return null }
        })
      )
      return items.filter(Boolean) as ApprovalRequest[]
    } catch {
      return []
    }
  }
}
