import { randomUUID } from 'node:crypto'
import { beforeAll, expect, it } from 'vitest'
import { agentCallRow } from './test-support/agent-fixtures.js'
import { heldMemberRows } from './test-support/agent-held.js'
import {
  addOperationsViewFixture, addSchoolworkViewFixture, expectViewAccess, expectViewReadDenied,
  makeViewHeldEntries, readAgentView, revokeViewAuthorization, viewMaxPendingHeld, withViewRole,
} from './test-support/agent-views.js'
import { confirm } from './test-support/confirmations.js'
import { adjustment, cancel, submit } from './test-support/operations.js'
import { agentSubmitAs } from './test-support/roles.js'
import { commitOperation } from './test-support/schoolwork.js'
import { setStatus, submissionRow } from './test-support/submissions.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

function teacherViewOperation(stored, seat) {
  const { class_id, op_id, actor_kind, type, class_seq, committed_at } = stored
  return {
    class_id, op_id, actor_kind, type, class_seq, committed_at, target_seat_number: seat,
    status: null, code: null, recorded_at: null, batch_id: null, payload: null, expect: null, receipt: null,
  }
}

async function viewHeldItems(client, entries, status, code) {
  const members = await heldMemberRows(client, entries)
  expect(members).toHaveLength(entries.length)
  return members.map(({ op_id, status: storedStatus, code: storedCode, receipt }, index) => {
    expect({ op_id, status: storedStatus, code: storedCode }).toEqual({ op_id: entries[index].op_id, status, code })
    return { op_id, status, code, receipt }
  })
}

async function readHeldView(agent, classId, callId, proposalId) {
  const rows = await readAgentView(agent, 'held_batches', classId)
  expect(rows.some(row => row.confirmation_id === proposalId)).toBe(false)
  return rows.find(row => row.batch_id === callId)
}

describeDatabase('小野檢視表的資料列', () => {
  const database = useTestDatabase()
  let visible
  let operationsFixture
  let hidden

  beforeAll(async () => {
    const { client } = database()
    visible = await addSchoolworkViewFixture(database())
    operationsFixture = await addOperationsViewFixture(database())
    hidden = await addOperationsViewFixture(database())
    await revokeViewAuthorization(client, hidden.classId)
  })

  function asAgent(check) {
    return withViewRole(database(), 'ppt_agent', check)
  }

  it('每個檢視表只列獲授權班，撤權後清空且還原授權後再出現', async () => {
    await expectViewAccess(database(), operationsFixture.classId, hidden.classId)
  })

  it.each(['ppt_web', 'ppt_backup'])('%s 讀取每個檢視表都回 42501', async (role) => {
    await expectViewReadDenied(database(), role)
  })

  it('班級只給契約欄位，最後成立時間與最大時間相同', async () => {
    const { classId } = visible
    const { rows: [committed] } = await database().client.query(`
      SELECT count(*)::int AS count, max(committed_at) AS last_committed_at, max(class_seq) AS class_seq
      FROM ppt.operations WHERE class_id = $1 AND status = 'committed'
    `, [classId])
    expect(committed.count).toBeGreaterThanOrEqual(2)
    const { count: _count, ...latest } = committed
    await asAgent(async (agent) => {
      expect(await readAgentView(agent, 'classes', classId)).toEqual([{ class_id: classId, status: 'active', ...latest }])
    })
  })

  it('學生列出四種在學狀態，只給契約欄位並遮組鍵', async () => {
    const { classId, studentIds } = visible
    await asAgent(async (agent) => {
      const rows = await readAgentView(agent, 'students', classId)
      expect(rows.sort((a, b) => a.seat_number - b.seat_number)).toEqual(
        ['enrolled', 'home_study', 'transferred', 'archived'].map((status, index) => ({
          class_id: classId, student_id: studentIds[index], seat_number: index + 1,
          group_key: index === 0 ? '組1號' : null, enrollment_status: status,
        })),
      )
    })
  })

  it('組名與組鍵遮成座號，學生仍能以遮後的組鍵接上小組', async () => {
    const { classId, studentId } = visible
    await asAgent(async (agent) => {
      const { rows } = await agent.query(`
        SELECT s.student_id, g.group_key, g.name FROM ppt_agent.students s
        JOIN ppt_agent.groups g USING (class_id, group_key)
        WHERE s.class_id = $1
      `, [classId])
      expect(rows).toEqual([{ student_id: studentId, group_key: '組1號', name: '2號組' }])
    })
  })

  it('帳戶餘額與累計加分逐筆等於底層帳戶', async () => {
    const { classId } = visible
    const { rows } = await database().client.query(`
      SELECT class_id, student_id, balance, total_earned FROM ppt.accounts WHERE class_id = $1
    `, [classId])
    expect(rows).toContainEqual({ class_id: classId, student_id: visible.studentId, balance: '25', total_earned: '25' })
    await asAgent(async (agent) => {
      const accounts = await readAgentView(agent, 'accounts', classId)
      const byStudent = (a, b) => a.student_id.localeCompare(b.student_id)
      expect(accounts.sort(byStudent)).toEqual(rows.sort(byStudent))
    })
  })

  it('交易不帶理由，規則名稱取當時版本並遮姓名，手動調整沒有規則名', async () => {
    const { classId, adjustId, appliedId, ruleId } = visible
    const { rows } = await database().client.query(
      'SELECT reason FROM ppt.transactions WHERE class_id = $1 AND op_id = $2', [classId, adjustId],
    )
    expect(rows).toEqual([{ reason: '王小明理由' }])
    await asAgent(async (agent) => {
      const transactions = await readAgentView(agent, 'transactions', classId)
      expect(transactions).toHaveLength(2)
      const adjust = transactions.find(row => row.op_id === adjustId)
      expect(adjust).toMatchObject({ kind: 'adjust', rule_id: null, rule_rev: null, rule_name: null })
      expect(adjust).not.toHaveProperty('reason')
      expect(transactions.find(row => row.op_id === appliedId)).toMatchObject({
        rule_id: ruleId, rule_rev: 1, rule_name: '1號舊規則',
      })
    })
  })

  it('規則取現行版本，規則版本保留舊版且兩邊都遮姓名', async () => {
    const { classId, ruleId } = visible
    await asAgent(async (agent) => {
      const versions = await readAgentView(agent, 'rule_versions', classId)
      versions.sort((a, b) => a.rev - b.rev)
      expect(versions).toHaveLength(2)
      expect(versions[0]).toMatchObject({
        rule_id: ruleId, rev: 1, name: '1號舊規則', amount: '5', icon: '3號圖', category: '4號類',
      })
      expect(versions[1]).toMatchObject({
        rule_id: ruleId, rev: 2, name: '2號新規則', amount: '8', icon: '3號圖', category: '4號類',
      })
      expect(await readAgentView(agent, 'rules', classId)).toEqual([
        { ...versions[1], kind: 'manual', event: null, disabled: false },
      ])
    })
  })

  it('作業標題、類型與頁碼遮成座號，其餘欄位等於底層', async () => {
    const { classId, taskId } = visible
    const { rows: [task] } = await database().client.query(`
      SELECT class_id, task_id, published_on, due_on, semester, voided
      FROM ppt.tasks WHERE class_id = $1 AND task_id = $2
    `, [classId, taskId])
    await asAgent(async (agent) => {
      const tasks = await readAgentView(agent, 'tasks', classId)
      expect(tasks.find(row => row.task_id === taskId)).toEqual({
        ...task, title: '1號和3號的作業', task_type: '1號類', page_text: 'Page 12，1號和1號',
      })
    })
  })

  it('繳交只列參與者，內嵌歷史效果旗標且可用檢視版本送 OP-14', async () => {
    const { classId, taskId, studentIds: [first, second, transferred] } = visible
    const { client } = database()
    const baseline = await submissionRow(client, { classId, taskId, studentId: second })
    expect(baseline).toMatchObject({ assignment_active: true, rev: 2, last_op_id: expect.any(String) })
    expect(await submissionRow(client, { classId, taskId, studentId: transferred })).toMatchObject({
      assignment_active: false,
    })
    await asAgent(async (agent) => {
      const rows = (await readAgentView(agent, 'submissions', classId)).filter(row => row.task_id === taskId)
      expect(rows).toHaveLength(2)
      expect(rows.find(row => row.student_id === first)).toMatchObject({
        status: 'pending', has_unresolved_legacy_effect: true,
      })
      const settled = rows.find(row => row.student_id === second)
      expect(settled).toMatchObject({
        status: baseline.status, rev: baseline.rev, last_op_id: baseline.last_op_id,
        has_unresolved_legacy_effect: false,
      })
      const { class_id: _classId, ...op } = setStatus(
        { classId, taskId, studentId: second }, 'on_time', { rev: settled.rev },
      )
      const { receipts } = await agentSubmitAs(agent, classId, [op])
      expect(receipts).toMatchObject([{ status: 'committed', code: 'OK' }])
      const changed = (await readAgentView(agent, 'submissions', classId))
        .find(row => row.task_id === taskId && row.student_id === second)
      expect(changed).toMatchObject({ status: 'on_time', rev: settled.rev + 1, last_op_id: op.op_id })
    })
  })

  it('訂正只對老師與匯入的備註遮姓名，小野建立的保留原文', async () => {
    const { classId, correctionIds: ids } = visible
    await asAgent(async (agent) => {
      const rows = await readAgentView(agent, 'corrections', classId)
      expect(rows).toHaveLength(3)
      expect(Object.fromEntries(rows.map(row => [row.correction_id, row.note]))).toEqual({
        [ids.teacher]: '請1號重寫', [ids.agent]: '請王小明重寫', [ids.imported]: '請1號重寫',
      })
    })
  })

  it('職務只給契約欄位，指派逐位依原序且保留轉出者', async () => {
    const { classId, jobId, studentIds: [first, , transferred] } = visible
    await asAgent(async (agent) => {
      expect(await readAgentView(agent, 'jobs', classId)).toEqual([{
        class_id: classId, job_id: jobId, title: '1號值日', salary: '10', icon: '3號圖',
        cycle: 'daily', category: '4號類', disabled: false,
      }])
      const rows = await readAgentView(agent, 'job_assignees', classId)
      expect(rows.sort((a, b) => Number(a.position) - Number(b.position))).toEqual([
        { class_id: classId, job_id: jobId, position: '1', student_id: transferred },
        { class_id: classId, job_id: jobId, position: '2', student_id: first },
      ])
    })
  })

  it('值日名單逐位列出三人，保留原陣列順序', async () => {
    const { classId, dutyDate, studentIds: [first, second, transferred] } = visible
    await asAgent(async (agent) => {
      const { rows } = await agent.query(`
        SELECT class_id, duty_date::text, position, student_id
        FROM ppt_agent.daily_duties WHERE class_id = $1 ORDER BY position
      `, [classId])
      expect(rows).toEqual([second, first, transferred].map((studentId, index) => ({
        class_id: classId, duty_date: dutyDate, position: String(index + 1), student_id: studentId,
      })))
    })
  })

  it('操作只給小野自己的全文與老師成立操作的指定欄位及座號', async () => {
    const { classId, adjustId, agentOps, heldEntries } = operationsFixture
    const { client } = database()
    const rejected = adjustment(operationsFixture, 0)
    expect(await submit(client, rejected)).toMatchObject({ status: 'rejected', code: 'INVALID_PAYLOAD' })
    const cancelledId = randomUUID()
    expect(await cancel(client, classId, cancelledId)).toMatchObject({ status: 'cancelled' })
    const { rows: base } = await client.query(`
      SELECT class_id, op_id, actor_kind, type, status, code::text, class_seq, recorded_at,
             committed_at, batch_id, payload, expect, receipt
      FROM ppt.operations WHERE class_id = $1
    `, [classId])
    await asAgent(async (agent) => {
      const rows = await readAgentView(agent, 'operations', classId)
      const byId = new Map(rows.map(row => [row.op_id, row]))
      for (const [op, status, seat] of [
        [agentOps.committed, 'committed', 1], [agentOps.rejected, 'rejected', 1], [heldEntries[0], 'held', 2],
      ]) {
        const stored = base.find(row => row.op_id === op.op_id)
        expect(stored).toMatchObject({ status, actor_kind: 'agent' })
        expect(byId.get(op.op_id)).toEqual({ ...stored, target_seat_number: seat })
      }
      const teacherAdjust = base.find(row => row.op_id === adjustId)
      const teacherRule = base.find(row => row.type === 'rule.save' && row.actor_kind === 'teacher')
      for (const [stored, seat] of [[teacherAdjust, 1], [teacherRule, null]]) {
        expect(byId.get(stored.op_id)).toEqual(teacherViewOperation(stored, seat))
      }
      expect(byId.has(rejected.op_id)).toBe(false)
      expect(byId.has(cancelledId)).toBe(false)
    })
  })

  it('待確認列兩種類型與對象座號，佇列滿時讀到的待確認數等於上限', async () => {
    const fixture = await addOperationsViewFixture(database())
    const { classId, proposalId, studentId, taskId, callId, heldEntries } = fixture
    await asAgent(async (agent) => {
      const rows = await readAgentView(agent, 'confirmations', classId)
      expect(rows).toHaveLength(2)
      expect(rows.find(row => row.confirmation_id === proposalId)).toMatchObject({
        kind: 'leader_proposal', task_id: taskId, student_id: studentId, seat_number: 1,
        status: 'pending', proposed_status: 'on_time',
      })
      expect(rows.find(row => row.confirmation_id === heldEntries[0].op_id)).toMatchObject({
        kind: 'agent_held', status: 'pending', batch_id: callId, seat_number: null, proposed_status: null,
      })
      const next = await agentSubmitAs(agent, classId, makeViewHeldEntries(fixture))
      expect(next.receipts).toMatchObject([{ status: 'held' }, { status: 'held' }])
      expect(await agentSubmitAs(agent, classId, makeViewHeldEntries(fixture))).toMatchObject({
        status: 'retry', code: 'HELD_QUEUE_FULL',
      })
      const { rows: [{ count }] } = await agent.query(`
        SELECT count(*)::int AS count FROM ppt_agent.confirmations
        WHERE class_id = $1 AND kind = 'agent_held' AND status = 'pending'
      `, [classId])
      expect(count).toBe(viewMaxPendingHeld)
    })
  })

  it('暫緩批次保留明傳空值，只列新成員並在 OP-16 後更新狀態與收據', async () => {
    const { classId, proposalId, callId, heldEntries, note } = await addOperationsViewFixture(database())
    const { client } = database()
    const confirmationId = heldEntries[0].op_id
    const inputs = heldEntries.map(op => ({ ...op, class_id: classId, batch_id: callId }))
    const beforeItems = await viewHeldItems(client, heldEntries, 'held', 'HELD_FOR_TEACHER')
    await asAgent(async (agent) => {
      const before = await readHeldView(agent, classId, callId, proposalId)
      expect(before).toMatchObject({
        confirmation_id: confirmationId, status: 'pending', processed_at: null, note,
        held_inputs: inputs, items: beforeItems,
      })
      const processed = await withViewRole(database(), 'ppt_web', web =>
        commitOperation(web, confirm(classId, confirmationId)),
      )
      const after = await readHeldView(agent, classId, callId, proposalId)
      expect(after).toEqual({
        ...before, status: 'confirmed', processed_at: new Date(processed.committed_at),
        items: await viewHeldItems(client, heldEntries, 'committed', 'OK'),
      })
    })
  })

  it('小野呼叫保存說明、輸入與有序操作編號，內容雜湊留在底層', async () => {
    const { classId, callId, note, heldEntries, agentOps } = operationsFixture
    const stored = await agentCallRow(database().client, callId)
    expect(stored.entries.every(entry => /^[a-f0-9]{64}$/.test(entry.content_hash))).toBe(true)
    await asAgent(async (agent) => {
      const row = (await readAgentView(agent, 'agent_calls', classId)).find(call => call.call_id === callId)
      expect(row).toEqual({
        class_id: classId, call_id: callId, created_at: stored.created_at, note,
        entries: [
          { op_id: heldEntries[0].op_id, is_new: true },
          { op_id: agentOps.committed.op_id, is_new: false },
          { op_id: heldEntries[1].op_id, is_new: true },
        ],
        held_inputs: heldEntries.map(op => ({ ...op, class_id: classId, batch_id: callId })),
      })
    })
  })
})
