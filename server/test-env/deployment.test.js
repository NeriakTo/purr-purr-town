import { readFile } from 'node:fs/promises'
import { load } from 'js-yaml'
import pg from 'pg'
import { expect, test } from 'vitest'
import { buildDatabaseUrl } from './start-api.js'

const deployment = new URL('../../deploy/test-env/', import.meta.url)

async function readYaml(name) {
  return load(await readFile(new URL(name, deployment), 'utf8'))
}

function defaultValues(value) {
  return value.replace(/\$\{[A-Z0-9_]+:-([^}]*)\}/g, '$1')
}

test('部署範本限制主機埠、秘密值、通道路由與映像標籤', async () => {
  const compose = await readYaml('compose.yaml')
  const tunnel = await readYaml('cloudflared-config.example.yml')
  const dockerfile = await readFile(new URL('Dockerfile', deployment), 'utf8')
  expect(compose.name).toBe('purrtown-test')
  expect(Object.keys(compose.services).sort()).toEqual(['api', 'db', 'setup', 'tunnel'])
  for (const service of Object.values(compose.services)) {
    expect(service.ports ?? []).toEqual([])
    expect(service.network_mode).not.toBe('host')
    expect(defaultValues(service.image)).toMatch(/:[^/:]+$/)
    expect(defaultValues(service.image)).not.toMatch(/:latest$/i)
    for (const [key, value] of Object.entries(service.environment ?? {})) {
      if (key.includes('PASSWORD')) {
        if (key.endsWith('_FILE')) expect(value).toMatch(/^\/run\/secrets\/[a-z_]+$/)
        else expect(key).toBe('PPT_V2_DATABASE_URL_NO_PASSWORD')
      }
      expect(String(value)).not.toMatch(/:\/{2}.*@/)
    }
  }
  expect(dockerfile).toMatch(/^ARG NODE_IMAGE=node:22-[\w-]+-slim$/m)
  expect(dockerfile).not.toMatch(/:latest\b/i)
  expect(tunnel.ingress).toEqual([
    { hostname: 'ppt-test.example.com', path: '^/api/v2/', service: 'http://api:3011' },
    { service: 'http_status:404' },
  ])
  const { api, setup, tunnel: tunnelService } = compose.services
  expect(setup.image).toBe(api.image)
  expect(setup.profiles).toEqual(['setup'])
  expect(compose.networks.backend.internal).toBe(true)
  expect(tunnelService.networks).toHaveProperty('egress')
  expect(api.environment.PPT_V2_TRUST_PROXY).toBe(tunnelService.networks.backend.ipv4_address)
  const value = defaultValues(api.environment.PPT_V2_DATABASE_URL_NO_PASSWORD)
  const testPassword = ['@', '/', '%'].join('')
  const { connectionParameters } = new pg.Client({ connectionString: buildDatabaseUrl(value, testPassword) })
  expect(connectionParameters).toMatchObject({ host: 'db', user: 'ppt_web', database: 'ppt_test', password: testPassword })
})

test('常駐服務設定自動重啟，一次性 setup 無重啟設定', async () => {
  const { services } = await readYaml('compose.yaml')
  for (const name of ['db', 'api', 'tunnel']) {
    expect(services[name], name).toHaveProperty('restart', 'unless-stopped')
  }
  expect(services.setup).not.toHaveProperty('restart')
})
