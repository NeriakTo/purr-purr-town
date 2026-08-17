import { buildApp, cleanExpiredSessions } from './app.js'

const port = parseInt(process.env.PORT || '3010')
const host = process.env.HOST || '0.0.0.0'

const app = await buildApp({ logger: true })

try {
  await app.listen({ port, host })
  console.log(`Purr Purr Town API listening on ${host}:${port}`)
  // Clean expired sessions every hour
  setInterval(() => cleanExpiredSessions().catch(e => app.log.error(e)), 3600_000)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
