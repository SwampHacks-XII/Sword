/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONNECTION?: 'mock' | 'ws';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
