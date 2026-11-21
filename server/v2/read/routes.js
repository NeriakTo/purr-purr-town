import { readClassSnapshot } from '../db.js'
import { precheckClassAccess } from '../ops/class-access.js'
import { buildClassesResponse, queryOwnedClasses } from './classes.js'
import { buildChangesResponse, loadClassChanges } from './changes.js'
import { readChangesEnvelope, readClassEnvelope } from './envelope.js'
import { buildStateResponse, loadClassState } from './state.js'

export function registerReadRoutes(app, { pool, config, clock, hooks, authenticateTeacher }) {
  const auth = { onRequest: authenticateTeacher }

  app.post('/api/v2/read/classes', auth, async function readClasses(request) {
    const { id } = request.teacherSession.actor
    const classes = await readClassSnapshot(pool, config, client => queryOwnedClasses(client, id))
    return buildClassesResponse(clock, classes)
  })

  app.post('/api/v2/read/state', auth, async function readState(request) {
    const { classId } = readClassEnvelope(request.body)
    await precheckClassAccess(pool, classId, request.teacherSession.actor)
    const state = await loadClassState(pool, config, classId, hooks)
    return buildStateResponse(clock, state)
  })

  app.post('/api/v2/read/changes', auth, async function readChanges(request) {
    const { classId, sinceSeq } = readChangesEnvelope(request.body)
    await precheckClassAccess(pool, classId, request.teacherSession.actor)
    const changes = await loadClassChanges(pool, config, classId, sinceSeq, hooks)
    return buildChangesResponse(clock, changes)
  })
}
