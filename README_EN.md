# Endfield Puzzler

![React](https://img.shields.io/badge/React-18-blue) ![Vite](https://img.shields.io/badge/Vite-6.0-purple) ![ONNX Runtime](https://img.shields.io/badge/ONNX%20Runtime-Web-yellow) ![License](https://img.shields.io/badge/License-AGPL%203.0-red)

[English] | [中文](./README.md)

---

## 📖 Introduction

**Endfield Puzzler** is an automated puzzle solver designed for *Arknights: Endfield*. It utilizes computer vision to automatically recognize puzzle boards, constraints, and pieces from game screenshots, employing the Recursive Backtracking algorithm to find all feasible solutions in milliseconds.

This project features a **Pure Frontend Architecture**. All image processing and model inference run locally in the browser via **WebAssembly (WASM)**, eliminating the need to upload images to a server, thus protecting user privacy and ensuring low-latency performance.

### ✨ Key Features

1.  **High-Precision Recognition**: Uses **YOLO26n** model for Region of Interest (ROI) localization and feature extraction, accurately identifying puzzle grids and piece panels.
2.  **Smart Constraint Parsing**: A specialized digit/shape recognition model trained on **MobileNetV3** supports parsing complex row/column constraints.
3.  **High-Performance Inference**: Accelerated by **ONNX Runtime Web**, enabling high-speed inference across platforms.
4.  **Ready to Use**: Deployed via Cloudflare Pages, accessible directly [here](https://endfieldpuzzler.pages.dev/).

### 🛠️ Tech Stack

*   **Frontend**: React, TypeScript, Vite, Material UI
*   **Inference**: ONNX Runtime Web, WASM
*   **Models**: YOLO26n (Object Detection), MobileNetV3 (Classification)
*   **Algorithm**: DFS

### 🚀 Local Deployment

Ensure [Node.js](https://nodejs.org/) (v18+) and [pnpm](https://pnpm.io/) are installed.

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

### 🧩 Core Architecture

```text
[Input Screenshot]
      │
      ▼
[YOLO26n Detector] ──┬──> [ROI: Grid Area] ──(CV Analysis)──> [Map Matrix]
                     │
                     ├──> [ROI: Constraints] ──(MobileNetV3)──> [Constraints Data]
                     │
                     └──> [ROI: Piece Panel] ──(CV Analysis)──> [Piece Shapes]
                                                                     │
                                                                     ▼
                                                                [Backtracking Solver]
                                                                     │
                                                                     ▼
                                                               [React UI Render]
```

### 📄 License

This project is licensed under the **AGPL-3.0** License.
