/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GPU_ENGINE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
