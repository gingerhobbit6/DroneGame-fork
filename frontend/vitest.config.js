import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{js,jsx}'],
    environment: 'node',
    // a generated 54 km world takes seconds to build, and many files build one before their tests while others run alongside
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      // src/render draws through WebGL, so it is measured only where tests reach it and otherwise checked by hand in a browser: there is no automated browser test
      include: ['src/game.js', 'src/api/**/*.js', 'src/sim/**/*.js', 'src/ui/**/*.{js,jsx}'],
      reporter: ['text-summary', 'text'],
      thresholds: { statements: 90, branches: 80, functions: 90, lines: 90 },
    },
  },
});
