import { defineConfig } from 'vitest/config'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 8000
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
