import type { ExistingKeys } from './gateways'
import type { ImportItem } from './legacyFormat'
import { orderKey } from './ordersImport'

/**
 * Whether the tasks have already what an item of an import would make. An item of a backup is known by the
 * id that the file gave it (the id of the old app, or the id of the task here); an item of a file of orders,
 * which has no such id, by its order number. An order with no number cannot be told from another, so it is
 * never known.
 */
export function isKnown(item: ImportItem, known: ExistingKeys): boolean {
  if (item.legacyId !== null) return known.legacyIds.has(item.legacyId) || (item.id !== undefined && known.legacyIds.has(item.id))
  const order = orderKey(item.patch.order_number ?? '')
  return order !== '' && known.orderNumbers.has(order)
}
