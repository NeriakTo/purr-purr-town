import { isDeepStrictEqual } from 'node:util'
import { classifyDatabaseError, writeTransaction } from '../db.js'
import { RequestError } from '../errors.js'

export const schedulerActor = Object.freeze({ kind: 'scheduler', id: 'scheduler' })
export const systemActor = Object.freeze({ kind: 'system', id: 'system' })

function requireServerActor(actor) {
  if (actor !== null && typeof actor === 'object' && Reflect.ownKeys(actor).length === 2) {
    if (isDeepStrictEqual(actor, schedulerActor)) return schedulerActor
    if (isDeepStrictEqual(actor, systemActor)) return systemActor
  }
  throw new TypeError('內部送出只接受固定的排程或系統身分')
}

export async function submitAsServer(pool, config, op, actor, hooks) {
  const serverActor = requireServerActor(actor)
  try {
    return await writeTransaction(pool, config, async function submitOperation(client) {
      const { rows: [{ receipt }] } = await client.query(
        'SELECT ppt.submit_operation($1::jsonb, $2::jsonb) AS receipt', [op, serverActor],
      )
      await hooks?.beforeServerCommit?.(op)
      return receipt
    })
  } catch (error) {
    const failure = error instanceof RequestError ? error : classifyDatabaseError(error)
    return { op_id: typeof op.op_id === 'string' ? op.op_id : null, status: 'retry', code: failure.code }
  }
}
