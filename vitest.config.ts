import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [vue()],
        test: {
          name: 'unit',
          environment: 'happy-dom',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'local-integration',
          environment: 'node',
          include: ['tests/local/**/*.test.ts'],
        },
      },
    ],
  },
})
