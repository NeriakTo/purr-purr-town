import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { createContext, Script } from 'node:vm'

const loopback = '127.0.0.1'
const mimeType = { TEXT: 'text/plain', JSON: 'application/json' }

function makeContext(properties, upstreamTimeoutMs) {
  return createContext({
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: key => properties[key] ?? null }),
    },
    UrlFetchApp: {
      async fetch(url, options) {
        const upstream = await fetch(url, {
          method: options.method.toUpperCase(),
          headers: { ...options.headers, 'Content-Type': options.contentType },
          body: options.payload,
          redirect: options.followRedirects ? 'follow' : 'manual',
          signal: AbortSignal.timeout(upstreamTimeoutMs),
        })
        if (!options.muteHttpExceptions && upstream.status >= 400) {
          throw new Error('後端回應 HTTP 錯誤')
        }
        const body = Buffer.from(await upstream.arrayBuffer()).toString('utf8')
        return {
          getResponseCode: () => upstream.status,
          getContentText: () => body,
        }
      },
    },
    ContentService: {
      MimeType: mimeType,
      createTextOutput: body => ({ setMimeType: type => ({ body, type }) }),
    },
  })
}

async function postEvent(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const separator = request.url.indexOf('?')
  const path = separator === -1 ? request.url : request.url.slice(0, separator)
  return {
    postData: { contents: Buffer.concat(chunks).toString('utf8') },
    queryString: separator === -1 ? null : request.url.slice(separator + 1),
    pathInfo: path === '/' ? '' : path,
  }
}

export async function startRelayServer({
  backendUrl,
  relayKey,
  relayPass = '',
  port = 0,
  upstreamTimeoutMs = 60_000,
}) {
  const backend = new URL(backendUrl)
  if (backend.protocol !== 'http:' || backend.hostname !== loopback ||
      backend.username || backend.password || backend.pathname !== '/' ||
      backend.search || backend.hash) {
    throw new Error('測試後端位址須為本機迴路 HTTP 來源')
  }
  const context = makeContext({
    PPT_RELAY_BACKEND_URL: backend.origin,
    PPT_V2_RELAY_KEY: relayKey,
    PPT_RELAY_PASS: relayPass,
  }, upstreamTimeoutMs)
  const source = await readFile(new URL('./Code.gs', import.meta.url), 'utf8')
  new Script(source, { filename: 'Code.gs' }).runInContext(context)

  const server = createServer(async (request, response) => {
    try {
      let output
      if (request.method === 'GET') output = context.doGet()
      else if (request.method === 'POST') output = await context.doPost(await postEvent(request))
      else {
        response.writeHead(405, { Allow: 'GET, POST' }).end()
        return
      }
      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': output.type + '; charset=utf-8',
      }).end(output.body)
    } catch {
      response.destroy()
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, loopback, () => {
      server.off('error', reject)
      resolve()
    })
  })
  return server
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const server = await startRelayServer({
      backendUrl: process.env.PPT_RELAY_BACKEND_URL,
      relayKey: process.env.PPT_V2_RELAY_KEY,
      relayPass: process.env.PPT_RELAY_PASS,
      port: Number(process.env.PPT_RELAY_PORT ?? 0),
    })
    process.stdout.write('轉送替身通訊埠：' + server.address().port + '\n')
  } catch {
    process.stderr.write('轉送替身啟動失敗，請檢查後端位址與通訊埠。\n')
    process.exitCode = 1
  }
}
