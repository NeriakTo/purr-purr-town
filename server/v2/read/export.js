import { writeTransaction } from '../db.js'
import { withClassReadSnapshot } from './snapshot.js'
import { queryTransactions } from './streams.js'
import { queryClassVersionRows } from './version-rows.js'

async function queryAllEffects(client, classId) {
  const { rows } = await client.query(`
    SELECT to_jsonb(effect) AS item
    FROM ppt.effects AS effect
    WHERE effect.class_id = $1
    ORDER BY effect.effect_id COLLATE "C"
  `, [classId])
  return rows.map(row => row.item)
}

async function queryAllRuleVersions(client, classId) {
  const { rows } = await client.query(`
    SELECT to_jsonb(version) AS item
    FROM ppt.rule_versions AS version
    WHERE version.class_id = $1
    ORDER BY version.rule_id COLLATE "C", version.rev
  `, [classId])
  return rows.map(row => row.item)
}

export function loadClassExport(pool, config, classId, hooks) {
  return withClassReadSnapshot(pool, config, classId, hooks, async function queryClassExport(client, classSeq) {
    const rows = await queryClassVersionRows(client, classId)
    const transactions = await queryTransactions(client, classId)
    const effects = await queryAllEffects(client, classId)
    const ruleVersions = await queryAllRuleVersions(client, classId)
    return { classSeq, rows, transactions, effects, ruleVersions }
  })
}

export async function recordClassExport(pool, config, classId, exportedAt, hooks) {
  await hooks?.beforeExportRecord?.()
  await writeTransaction(pool, config, async function writeExportTime(client) {
    await client.query(`
      INSERT INTO ppt_web_state.class_exports AS previous (class_id, last_export_at)
      VALUES ($1, $2)
      ON CONFLICT (class_id) DO UPDATE
      SET last_export_at = greatest(previous.last_export_at, excluded.last_export_at)
    `, [classId, exportedAt])
  })
}

export function buildExportResponse(classId, exportedAt, { classSeq, rows, transactions, effects, ruleVersions }) {
  return {
    server_time: exportedAt,
    export_v: 1,
    exported_at: exportedAt,
    class_id: classId,
    class_seq: classSeq,
    rows,
    transactions,
    effects,
    rule_versions: ruleVersions,
  }
}
