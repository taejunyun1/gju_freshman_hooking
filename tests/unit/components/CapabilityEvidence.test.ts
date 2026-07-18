import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CapabilityEvidence from '../../../app/components/result/CapabilityEvidence.vue'
import type { EquipmentResultResource } from '../../../shared/types/result'

const equipment: EquipmentResultResource = {
  id: 31,
  type: 'equipment',
  title: '레거시 카메라 바디',
  summary: '확인된 기자재입니다.',
  sourceDate: '2026-07-14',
  affinity: 90,
  primaryTag: 'camera',
  connectionReason: '촬영 관심과 연결됩니다.',
  displayMetadata: {
    category: 'body',
    locationLabel: '사진영상미디어학과 기자재실',
    confirmedQuantity: 1,
    reservationUrl: 'https://gjureserve.co.kr',
    accessMode: 'inquiry',
    accessLabel: '문의 전용',
  },
}

describe('capability evidence empty states', () => {
  it('shows one subordinate facility notice for an equipment-only legacy result', () => {
    const wrapper = mount(CapabilityEvidence, {
      props: {
        equipment: [equipment],
        facility: [],
        resultPublicId: 'legacy-equipment-only',
        telemetryEnabled: false,
      },
    })

    expect(wrapper.findAll('[data-capability-evidence]')).toHaveLength(1)
    expect(wrapper.get('[data-facility-empty]').text()).toContain('확인된 시설 정보')
    expect(wrapper.findAll('.capability__empty')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('확인된 학과 데이터를 준비 중입니다')
  })
})
