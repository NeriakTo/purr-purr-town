import { expect } from 'vitest'

export const databaseRoles = ['ppt_owner', 'ppt_web', 'ppt_agent', 'ppt_backup']

export async function connectAsRole(database, role) {
  if (!databaseRoles.includes(role)) throw new Error('未知的測試資料庫角色')
  const client = await database.connect()
  try {
    await client.query('SET ROLE ' + role)
    const { rows: [{ current_user: currentUser }] } = await client.query('SELECT current_user')
    expect(currentUser).toBe(role)
    return client
  } catch (error) {
    await client.end()
    throw error
  }
}
