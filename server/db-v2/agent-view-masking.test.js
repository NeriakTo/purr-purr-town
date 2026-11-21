import { expect, it } from 'vitest'
import { authorizeAgent } from './test-support/agent.js'
import {
  maskedColumns, readAgentView, setViewStudentNames, withViewRole,
} from './test-support/agent-views.js'
import { createRound } from './test-support/correction-rounds.js'
import { addClass } from './test-support/operations.js'
import { commitOperation, createTask } from './test-support/schoolwork.js'
import { describeDatabase, useTestDatabase } from './test-support/suite.js'

async function addMaskingClass(client) {
  const fixture = await addClass(client, { students: ['enrolled', 'enrolled', 'transferred', 'archived'] })
  await setViewStudentNames(client, fixture)
  await authorizeAgent(client, fixture.classId)
  return fixture
}

async function addTitledTask(client, classId, title) {
  const task = createTask(classId, { title })
  await commitOperation(client, task)
  return task.payload.task_id
}

async function readTaskTitle(database, classId, taskId) {
  return withViewRole(database, 'ppt_agent', async (agent) => {
    const rows = await readAgentView(agent, 'tasks', classId)
    return rows.find(row => row.task_id === taskId)?.title
  })
}

describeDatabase('小野檢視表的姓名遮罩', () => {
  const database = useTestDatabase()

  it('03:393 作業標題與老師 OP-18 備註同時遮完整姓名和去姓名字', async () => {
    const { client } = database()
    const { classId, studentId } = await addMaskingClass(client)
    const text = '王小明與大文'
    const taskId = await addTitledTask(client, classId, text)
    const { correctionId } = await createRound(client, { classId, taskId, studentId }, { note: text })
    expect(await readTaskTitle(database(), classId, taskId)).toBe('1號與2號')
    await withViewRole(database(), 'ppt_agent', async (agent) => {
      const rows = await readAgentView(agent, 'corrections', classId)
      expect(rows.find(row => row.correction_id === correctionId)?.note).toBe('1號與2號')
    })
  })

  it('03:426 作業標題遮半形、全形、定位字元及四字姓名末兩字', async () => {
    const { client } = database()
    const { classId } = await addMaskingClass(client)
    const taskId = await addTitledTask(client, classId, 'Page 12｜王 小明｜王　小明｜王\t小明｜小華')
    expect(await readTaskTitle(database(), classId, taskId)).toBe('Page 12｜1號｜1號｜1號｜3號')
  })

  const columns = Object.values(maskedColumns).flatMap(columnsByName => Object.values(columnsByName))
  for (const { view, column, write, match } of columns) {
    it(`${view}.${column} 以來源操作寫入後遮成座號`, async () => {
      const { client } = database()
      const fixture = await addMaskingClass(client)
      await write(client, fixture, '王小明交件')
      await withViewRole(database(), 'ppt_agent', async (agent) => {
        const rows = await readAgentView(agent, view, fixture.classId)
        expect(rows).toContainEqual(expect.objectContaining({ ...match, [column]: '1號交件' }))
      })
    })
  }

  it('已轉出與封存學生的姓名仍遮成座號', async () => {
    const { client } = database()
    const { classId } = await addMaskingClass(client)
    const taskId = await addTitledTask(client, classId, '歐陽小華、司馬大中')
    expect(await readTaskTitle(database(), classId, taskId)).toBe('3號、4號')
  })

  it('別班同名者不加入候選座號，別班獨有姓名保留原文', async () => {
    const { client } = database()
    const { classId } = await addMaskingClass(client)
    const other = await addClass(client, { students: ['enrolled', 'enrolled', 'enrolled'] })
    await setViewStudentNames(client, other, ['林小天', '王小明', '張大山'])
    await authorizeAgent(client, other.classId)
    const taskId = await addTitledTask(client, classId, '王小明、林小天')
    expect(await readTaskTitle(database(), classId, taskId)).toBe('1號、林小天')
  })

  it('有預設村民姓名的班級依座號處理末兩字撞名', async () => {
    const { client } = database()
    const fixture = await addClass(client, { students: ['enrolled', 'enrolled', 'enrolled'] })
    const { classId } = fixture
    await setViewStudentNames(client, { classId, studentIds: [fixture.studentId] }, ['王小明'])
    await authorizeAgent(client, classId)
    const taskId = await addTitledTask(client, classId, '王小明、村民、3號村民')
    expect(await readTaskTitle(database(), classId, taskId)).toBe('1號、2號或3號、3號')
  })
})
