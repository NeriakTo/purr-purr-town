import { readClassSnapshot } from '../db.js'
import { precheckClassAccess } from '../ops/class-access.js'
import { buildClassesResponse, queryOwnedClasses } from './classes.js'
import { buildChangesResponse, loadClassChanges } from './changes.js'
import { readChangesEnvelope, readClassEnvelope, readStateEnvelope } from './envelope.js'
import { buildExportResponse, loadClassExport, recordClassExport } from './export.js'
import { buildStateResponse, loadClassState } from './state.js'

export function registerReadRoutes(app, { pool, config, clock, hooks, authenticateTeacher }) {
  const auth = { onRequest: authenticateTeacher }

  app.post('/api/v2/read/classes', auth, async function readClasses(request) {
    const { id } = request.teacherSession.actor
    const classes = await readClassSnapshot(pool, config, client => queryOwnedClasses(client, id))
    return buildClassesResponse(clock, classes)
  })

  app.post('/api/v2/read/state', auth, async function readState(request) {
    const envelope = readStateEnvelope(request.body)
    await precheckClassAccess(pool, envelope.classId, request.teacherSession.actor)
    const readTime = clock()
    const state = await loadClassState(pool, config, envelope, readTime, hooks)
    return buildStateResponse(readTime, state)
  })

  app.post('/api/v2/read/changes', auth, async function readChanges(request) {
    const { classId, sinceSeq } = readChangesEnvelope(request.body)
    await precheckClassAccess(pool, classId, request.teacherSession.actor)
    const readTime = clock()
    const changes = await loadClassChanges(pool, config, classId, sinceSeq, readTime, hooks)
    return buildChangesResponse(readTime, changes)
  })

  app.post('/api/v2/read/export', auth, async function readExport(request) {
    const { classId } = readClassEnvelope(request.body)
    await precheckClassAccess(pool, classId, request.teacherSession.actor)
    const exportedAt = clock().toISOString()
    const backup = await loadClassExport(pool, config, classId, hooks)
    await recordClassExport(pool, config, classId, exportedAt, hooks)
    return buildExportResponse(classId, exportedAt, backup)
  })
}
