import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleExplainApi } from './explainApi.js'

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  await handleExplainApi(req, res)
  if (!res.writableEnded) {
    res.statusCode = 404
    res.end('Not found')
  }
}
