import { expect } from 'vitest'
import { sendRead } from './read.js'

export async function readJson(context, endpoint, payload = {}, options) {
  const response = await sendRead(context, endpoint, { class_id: context.target.classId, ...payload }, options)
  expect(response.statusCode).toBe(200)
  return response.json()
}
