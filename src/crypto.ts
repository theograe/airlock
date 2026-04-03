import crypto from 'crypto'
import type { ApprovalRequest } from './types.js'

export function hashContent(secret: string, req: Pick<ApprovalRequest, 'type' | 'text' | 'metadata'>): string {
  const data = JSON.stringify({ type: req.type, text: req.text, metadata: req.metadata })
  return crypto.createHmac('sha256', secret).update(data).digest('hex').slice(0, 16)
}

export function verifyHash(secret: string, req: ApprovalRequest): boolean {
  if (!req.hash) return false
  return hashContent(secret, req) === req.hash
}

export function generateId(): string {
  return crypto.randomBytes(8).toString('hex')
}

export function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}
