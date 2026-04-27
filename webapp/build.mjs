import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs'

// Clean dist
rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })

// Compile the Hono worker
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/_worker.js',
  format: 'esm',
  target: 'es2022',
  platform: 'browser',  // Cloudflare Workers = browser-like environment
  external: [],
  minify: false,
})

// Compile the React/JSX app — React + ReactDOM are UMD globals from CDN
// tsconfigRaw overrides tsconfig.json's jsxImportSource:'hono/jsx' for this file only
await build({
  entryPoints: ['src/app.jsx'],
  bundle: true,
  outfile: 'dist/app.js',
  format: 'iife',
  target: 'es2017',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  external: ['react', 'react-dom'],
  // Override tsconfig.json (which sets jsxImportSource: hono/jsx) for the frontend app
  tsconfigRaw: JSON.stringify({
    compilerOptions: {
      jsx: 'react',
      jsxFactory: 'React.createElement',
      jsxFragmentFactory: 'React.Fragment',
      target: 'ES2017'
    }
  }),
  minify: true,
})

// Copy static HTML into dist root
cpSync('public', 'dist', { recursive: true })

// Patch index.html: remove Babel runtime + text/babel tag, reference compiled app.js
let html = readFileSync('dist/index.html', 'utf8')
html = html
  // Remove babel standalone CDN line
  .replace(/<script src="https:\/\/unpkg\.com\/@babel\/standalone\/babel\.min\.js"><\/script>\n?/g, '')
  // Change <script type="text/babel"> to regular deferred script ref
  .replace(/<script type="text\/babel">[\s\S]*<\/script>(\s*<\/body>)/, 
    '<script src="/app.js" defer></script>$1')
writeFileSync('dist/index.html', html)

// Write _routes.json so the worker handles /api/* and CF Pages serves static files
writeFileSync('dist/_routes.json', JSON.stringify({
  version: 1,
  include: ["/api/*"],
  exclude: []
}, null, 2))

console.log('✅ Build complete: dist/_worker.js + dist/app.js + static assets')
