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
  const dummyHash = createDummyHash(dummyHashCost)
  // 保留原 Promise 的錯誤供查無帳號時處理，避免啟動時出現未處理的拒絕。
  dummyHash.catch(() => {})
  return async function preparePasswordCheck(passcode, teacher) {
    const hash = teacher ? teacher.passcode_hash : await dummyHash
    return async function verifyLoginPassword() {
      const verified = await verifyPassword(passcode, hash)
      return teacher ? verified : false
    }
  }
}
