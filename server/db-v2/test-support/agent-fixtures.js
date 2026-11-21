import { addClass } from './operations.js'
import { authorizeAgent } from './agent.js'
import { commitOperation, createTask, operation, saveRule } from './schoolwork.js'

export async function addAgentClass(client, count = 1) {
  const fixture = await addClass(client, { students: Array(count).fill('enrolled') })
  await authorizeAgent(client, fixture.classId)
  return fixture
}

export async function addAgentTask(client, fixture, amount) {
  const { rows: [{ today }] } = await client.query(
    "SELECT (clock_timestamp() AT TIME ZONE 'Asia/Taipei')::date::text AS today",
  )
  const { classId } = fixture
  const task = createTask(classId, { published_on: today, due_on: today })
  await commitOperation(client, task)
  if (amount !== undefined) {
    await commitOperation(client, saveRule(classId, {
      kind: 'event', event: 'submission.missing', amount,
    }))
  }
  return fixture.studentIds.map(studentId => ({ classId, taskId: task.payload.task_id, studentId }))
}

export async function agentCallRow(client, callId) {
  const { rows: [row] } = await client.query('SELECT * FROM ppt.agent_calls WHERE call_id = $1', [callId])
  return row
}

export async function ageAgentOperation(client, opId, minutes) {
  await client.query(`
    UPDATE ppt.operations
    SET recorded_at = recorded_at - make_interval(mins => $2),
        committed_at = committed_at - make_interval(mins => $2)
    WHERE op_id = $1
  `, [opId, minutes])
}

export async function ageHeldConfirmation(client, classId, confirmationId, minutes) {
  await client.query(`
    UPDATE ppt.confirmations SET created_at = created_at - make_interval(mins => $3)
    WHERE class_id = $1 AND confirmation_id = $2
  `, [classId, confirmationId, minutes])
}

export async function appendYesterdayRuleTransaction(client, target, opId, ruleId, amount) {
  await client.query(`
    SELECT ppt.append_account_transaction($1, $2, $3, 'adjust', $5, $5,
      clock_timestamp() - interval '24 hours', clock_timestamp() - interval '24 hours',
      '測試理由', null, $4, 1)
  `, [target.classId, target.studentId, opId, ruleId, amount])
}

export async function setAgentLimits(client, classId, overrides) {
  return commitOperation(client, operation(classId, 'setting.set', {
    key: 'agentLimits',
    value: {
      max_students_per_call: 5, max_students_per_10min: 10, max_points_per_tx: 200,
      max_points_per_student_per_day: 300, max_pending_held: 5, ...overrides,
    },
  }, { rev: 0 }))
}

export async function addManualRule(client, classId, amount = 5) {
  const op = saveRule(classId, { amount })
  await commitOperation(client, op)
  return op.payload.rule_id
}

export function agentApplyRule({ classId, studentId }, ruleId, version = 1) {
  return operation(classId, 'points.apply_rule', { student_id: studentId, rule_id: ruleId, rule_version: version })
}
