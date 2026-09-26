import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export default function handler(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('Method not allowed')
    return
  }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ gameId: randomUUID() }))
}
