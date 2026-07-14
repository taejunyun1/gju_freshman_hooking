import { describe, expect, it } from 'vitest'
import { generateNickname } from '../../../server/modules/identity/nickname'

describe('nickname identity domain', () => {
  it('retries a colliding candidate and returns the next available nickname', async () => {
    const values = [new Uint8Array([0, 0, 0]), new Uint8Array([1, 0, 27])]
    const checked: string[] = []
    const byteSource = (length: number) => {
      expect(length).toBe(3)
      return values.shift() as Uint8Array
    }

    const nickname = await generateNickname(async (candidate) => {
      checked.push(candidate)
      return checked.length === 2
    }, byteSource)

    expect(nickname).toBe('고요한프레임27')
    expect(checked).toEqual(['선명한프레임00', '고요한프레임27'])
  })

  it('stops after 20 unavailable nickname candidates', async () => {
    let sourceCalls = 0

    await expect(generateNickname(
      async () => false,
      () => {
        sourceCalls += 1
        return new Uint8Array([0, 0, 0])
      },
    )).rejects.toThrowError('NICKNAME_GENERATION_FAILED')

    expect(sourceCalls).toBe(20)
  })
})
