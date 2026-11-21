import { queryVersionRows } from './version-query.js'

export function queryAccountRows(client, classId, sinceSeq) {
  return queryVersionRows(client, classId, 'account', sinceSeq, {
    from: 'ppt.accounts AS e',
    key: "'student_id', e.student_id",
    value: "jsonb_build_object('balance', e.balance, 'total_earned', e.total_earned)",
  })
}

export function queryRuleRows(client, classId, sinceSeq) {
  return queryVersionRows(client, classId, 'rule', sinceSeq, {
    from: `ppt.rules AS e JOIN ppt.rule_versions AS v
      ON v.class_id = e.class_id AND v.rule_id = e.rule_id AND v.rev = e.rev`,
    key: "'rule_id', e.rule_id",
    value: `jsonb_build_object(
      'kind', e.kind, 'event', e.event, 'disabled', e.disabled,
      'name', v.name, 'amount', v.amount, 'icon', v.icon, 'category', v.category
    )`,
  })
}

export function queryProductRows(client, classId, sinceSeq) {
  return queryVersionRows(client, classId, 'product', sinceSeq, {
    from: 'ppt.products AS e',
    key: "'product_id', e.product_id",
    value: `jsonb_build_object(
      'name', e.name, 'icon', e.icon, 'price', e.price, 'price_unit', e.price_unit,
      'stock', e.stock, 'initial_stock', e.initial_stock, 'description', e.description, 'disabled', e.disabled
    )`,
  })
}

export function queryInventoryItemRows(client, classId, sinceSeq) {
  return queryVersionRows(client, classId, 'inventory_item', sinceSeq, {
    from: 'ppt.inventory_items AS e',
    key: "'item_id', e.item_id",
    value: `jsonb_build_object(
      'student_id', e.student_id, 'product_id', e.product_id, 'product_name', e.product_name,
      'product_icon', e.product_icon, 'purchase_transaction_id', e.purchase_transaction_id, 'status', e.status
    )`,
  })
}

export function queryJobRows(client, classId, sinceSeq) {
  return queryVersionRows(client, classId, 'job', sinceSeq, {
    from: 'ppt.jobs AS e',
    key: "'job_id', e.job_id",
    value: `jsonb_build_object(
      'title', e.title, 'salary', e.salary, 'icon', e.icon, 'cycle', e.cycle,
      'category', e.category, 'disabled', e.disabled, 'assignee_ids', e.assignee_ids
    )`,
  })
}

export function queryDutyRows(client, classId, sinceSeq) {
  return queryVersionRows(client, classId, 'duty', sinceSeq, {
    from: 'ppt.daily_duties AS e',
    key: "'date', e.duty_date",
    value: "jsonb_build_object('student_ids', e.student_ids)",
  })
}
