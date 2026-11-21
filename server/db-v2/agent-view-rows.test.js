import { beforeAll, expect, it } from 'vitest'
import {
  addClassViewFixture, expectViewAccess, expectViewReadDenied, readAgentView, withViewRole,
} from './test-support/agent-views.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

describeDatabase('小野檢視表的資料列', () => {
  const database = useTestDatabase()
  let visible
  let hidden

  beforeAll(async () => {
    const { client } = database()
    visible = await addClassViewFixture(client)
    hidden = await addClassViewFixture(client, false)
  })

  function asAgent(check) {
    return withViewRole(database(), 'ppt_agent', check)
  }

  it('每個檢視表只列獲授權班，撤權後清空且還原授權後再出現', async () => {
    await expectViewAccess(database(), visible.classId, hidden.classId)
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
})
