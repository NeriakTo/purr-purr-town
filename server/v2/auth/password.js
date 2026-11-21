import { randomBytes } from 'node:crypto'

export async function comparePassword(passcode, hash) {
  const { default: bcrypt } = await import('bcrypt')
  return bcrypt.compare(passcode, hash)
}

async function createDummyHash(cost) {
  const { default: bcrypt } = await import('bcrypt')
  return bcrypt.hash(randomBytes(32).toString('hex'), cost)
}

export function createPasswordCheck(verifyPassword, dummyHashCost = 10) {
  let dummyHash
  return async function verifyLoginPassword(passcode, teacher) {
    if (teacher) return verifyPassword(passcode, teacher.passcode_hash)
    dummyHash ??= createDummyHash(dummyHashCost)
    await verifyPassword(passcode, await dummyHash)
    return false
  }
}
