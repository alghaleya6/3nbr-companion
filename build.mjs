// Bundles the two renderer entry points (Studio + desktop overlay) into dist/.
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: {
    studio: 'src/studio/studio.js',
    overlay: 'src/overlay/overlay.js',
    'aicut-dev': 'src/dev/aicut.js',
    'aipack-dev': 'src/dev/aipack.js',
  },
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  platform: 'browser',
  target: 'chrome130',
  sourcemap: true,
  logLevel: 'warning',
});
console.log('built dist/studio.js, dist/overlay.js');
