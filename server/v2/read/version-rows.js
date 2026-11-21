import {
  queryAnnouncementRows, queryClassRows, queryCommentRows, queryGroupRows,
  querySeatingRows, querySettingRows, queryStudentRows,
} from './classroom-rows.js'
import {
  queryAccountRows, queryDutyRows, queryInventoryItemRows,
  queryJobRows, queryProductRows, queryRuleRows,
} from './economy-rows.js'
import { queryConfirmationRows, queryCorrectionRows, querySubmissionRows, queryTaskRows } from './schoolwork-rows.js'

const queries = [
  queryClassRows, queryStudentRows, queryAccountRows, querySubmissionRows, queryTaskRows, queryRuleRows,
  queryConfirmationRows, queryCorrectionRows, queryProductRows, queryInventoryItemRows, querySettingRows,
  queryJobRows, queryDutyRows, queryGroupRows, queryAnnouncementRows, querySeatingRows, queryCommentRows,
]

function compareText(left, right) {
  if (left < right) return -1
  return Number(left > right)
}

function compareVersionRows(left, right) {
  return compareText(left.entity, right.entity) || compareText(JSON.stringify(left.key), JSON.stringify(right.key))
}

export async function queryClassVersionRows(client, classId) {
  const rows = []
  for (const query of queries) {
    for (const row of await query(client, classId)) rows.push(row)
  }
  return rows.sort(compareVersionRows)
}
