# Endfield Puzzler / 终末地解谜助手

![React](https://img.shields.io/badge/React-18-blue) ![Vite](https://img.shields.io/badge/Vite-6.0-purple) ![ONNX Runtime](https://img.shields.io/badge/ONNX%20Runtime-Web-yellow) ![License](https://img.shields.io/badge/License-AGPL%203.0-red)

[English](./README_EN.md) | [中文]

---

## 📖 项目简介 (Introduction)

**Endfield Puzzler** 是一个专为《明日方舟：终末地》设计的自动化解谜辅助工具。它通过计算机视觉技术自动识别游戏截图中的谜题盘面、约束条件和拼图碎片，并利用回溯算法（Backtracking）在毫秒级内计算出所有可行解。

本项目为 **纯前端架构**，所有图像处理与推理模型均通过 **WebAssembly (WASM)** 在浏览器本地运行，无需上传图片到服务器，保护用户隐私并实现低延迟体验。

### ✨ 核心特性

1.  **高精度识别**: 采用 **YOLO26n** 模型进行关键区域（ROI）定位和特征提取，精准识别谜题网格与拼图面板。
2.  **智能约束解析**: 基于 **MobileNetV3** 训练的专用数字识别模型，支持识别复杂的行/列约束条件（数字、形状）。
3.  **高性能推理**: 基于 **ONNX Runtime Web** 加速，跨平台高速运行推理。
4.  **即开即用**: 项目已通过 Cloudflare Pages 部署，可[直接访问](https://endfieldpuzzler.pages.dev/)。

### 🛠️ 技术栈

*   **Frontend**: React, TypeScript, Vite, Material UI
*   **Inference**: ONNX Runtime Web, WASM
*   **Models**: YOLO26n (Object Detection), MobileNetV3 (Classification)
*   **Algorithm**: DFS

### 🚀 本地部署

确保已安装 [Node.js](https://nodejs.org/) (v18+) 和 [pnpm](https://pnpm.io/)。

```bash
#进入前端目录
cd frontend

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

### 🧩 核心架构

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

### 📄 开源协议

本项目遵循 **AGPL-3.0** 开源协议。
