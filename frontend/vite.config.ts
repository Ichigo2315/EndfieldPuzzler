import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'
import fs from 'fs'

// Serve onnxruntime-web assets directly from node_modules in dev mode
function ortDevPlugin() {
  const ORT_PREFIX = '/ort-';
  const ortDistDir = path.join(__dirname, 'node_modules/onnxruntime-web/dist');
  return {
    name: 'ort-dev-server',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const url = (req.url ?? '').split('?')[0]; // strip ?import etc.
        if (url.startsWith(ORT_PREFIX)) {
          const file = path.join(ortDistDir, path.basename(url));
          if (fs.existsSync(file)) {
            const ext = path.extname(file);
            const mime = ext === '.wasm' ? 'application/wasm'
              : ext === '.mjs' ? 'application/javascript'
              : 'application/octet-stream';
            res.setHeader('Content-Type', mime);
            fs.createReadStream(file).pipe(res);
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    ortDevPlugin(),
    react(),
    viteStaticCopy({
      targets: [{
        src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm',
        dest: '.',
      }],
    }),
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
