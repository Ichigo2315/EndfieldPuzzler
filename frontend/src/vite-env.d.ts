/// <reference types="vite/client" />

interface Window {
  cv: typeof import('./types/opencv').cv;
}
