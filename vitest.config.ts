import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // A fixed time zone with daylight saving keeps study-day tests reproducible.
    env: { TZ: 'Europe/Prague' },
  },
})
