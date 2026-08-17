import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}', 'test/**/*.test.{js,jsx}', 'server/**/*.test.js'],
    globals: false,
  },
})
