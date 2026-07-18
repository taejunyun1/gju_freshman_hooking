import type {
  EquipmentCategory,
  EquipmentResultResource,
} from '../types/result'

export const equipmentCategoryOf = (resource: EquipmentResultResource): EquipmentCategory => {
  if (resource.displayMetadata.category) return resource.displayMetadata.category
  if (resource.primaryTag === 'camera') return 'body'
  if (resource.primaryTag === 'lens') return 'lens'
  return 'other'
}
