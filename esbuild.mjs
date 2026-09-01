import esbuild from 'esbuild';

const production = process.argv.includes('--production');

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: !production,
  sourcesContent: false,
  minify: production,
  logLevel: 'info'
});
