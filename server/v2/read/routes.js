import { readClassSnapshot } from '../db.js'
import { buildClassesResponse, queryOwnedClasses } from './classes.js'

export function registerReadRoutes(app, { pool, config, clock, authenticateTeacher }) {
  const auth = { onRequest: authenticateTeacher }

  app.post('/api/v2/read/classes', auth, async function readClasses(request) {
    const { id } = request.teacherSession.actor
    const classes = await readClassSnapshot(pool, config, client => queryOwnedClasses(client, id))
    return buildClassesResponse(clock, classes)
  })
}
