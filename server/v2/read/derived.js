import { queryAgentBatches } from './agent-batches.js'
import { queryLegacyEffects } from './legacy-effects.js'
import { queryPayroll } from './payroll.js'

export async function queryDerivedData(client, classId, readTime, changed) {
  const legacy_effects = await queryLegacyEffects(client, classId, changed)
  const payroll = await queryPayroll(client, classId, readTime)
  const agent_batches = await queryAgentBatches(client, classId, readTime)
  return { legacy_effects, payroll, agent_batches }
}
