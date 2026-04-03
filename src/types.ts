export interface AirlockConfig {
  /** Telegram user IDs allowed to approve actions */
  allowedUsers: string[]
  /** Port for the HTTPS webhook server (Telegram callbacks) */
  webhookPort: number
  /** Port for the HTTP queue server (agent submits actions here) */
  queuePort: number
  /** Path to self-signed cert for webhook HTTPS */
  certPath: string
  /** Path to private key for webhook HTTPS */
  keyPath: string
  /** Server's public IP or domain (for Telegram webhook URL) */
  publicHost: string
  /** Approval bot token (from BotFather) */
  botToken: string
  /** Secret for HMAC content verification */
  secret: string
  /** Webhook secret token (verified by Telegram in header) */
  webhookSecret: string
  /** Directory to store pending/done approval files */
  dataDir: string
  /** Action executors - define what each action type does when approved */
  executors: Record<string, Executor>
}

export type Executor = (data: ApprovalRequest) => Promise<ExecutorResult>

export interface ExecutorResult {
  success: boolean
  message?: string
  data?: Record<string, unknown>
}

export interface ApprovalRequest {
  id: string
  type: string
  text?: string
  context?: string
  metadata?: Record<string, unknown>
  hash: string
  createdAt: string
  status: 'pending' | 'approved' | 'rejected'
}

export interface TelegramCallbackQuery {
  id: string
  data: string
  from: { id: number; username?: string }
  message?: { chat: { id: number } }
}
