# OCEDA - Frontend

<p align="center">
  <b>AI-Assisted Otoscopy for Accessible Ear Examination</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-v1.0.0-blue" alt="version" />
  <img src="https://img.shields.io/badge/Status-Frontend%20v1-green" alt="status" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Tailwind%20CSS-v4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
</p>

---

## ✨ About OCEDA

**OCEDA** is an AI-assisted otoscopy system designed to support ear examination through a portable otoscope and an intuitive digital interface. The system is being developed to help non-specialist healthcare workers perform preliminary ear examinations and receive AI-assisted classification of ear images.

The project combines a physical otoscope device with a web-based application for patient management, image capture, and AI-assisted examination results. The frontend provides the primary interface connecting healthcare workers with the examination workflow, from entering patient information to reviewing captured ear images and viewing AI analysis results.

This repository contains the **frontend application** of OCEDA.

---

## 🌟 Key Features

- 🏥 **Clinical Examination Dashboard**  
  A centralized workspace for managing ear examinations and monitoring device status.

- 👤 **Patient Information Management**  
  Record patient identification and examination information before starting a capture session.

- 📷 **Ear Image Capture Workflow**  
  Guide users through capturing, reviewing, and selecting ear images from the connected otoscope.

- 🤖 **AI-Assisted Analysis Interface**  
  Display AI classification results, confidence information, and visual heatmaps for examination analysis.

- 🌓 **Light & Dark Mode**  
  Support both light and dark interfaces for different clinical and diagnostic environments.

- 🌐 **Bilingual Interface**  
  Provide English and Indonesian language options through the built-in internationalization system.

- 📱 **Responsive Interface**  
  Designed for desktop and smaller screens while maintaining a clinical and accessible workflow.

- 🔌 **Device Status Display**  
  Present connected-device information such as camera model, connection status, battery level, and image resolution.

---

## 👩‍💻 Project Team

<p align="center">
  <i>OCEDA Capstone Project</i>
</p>

| Member | Role |
| --- | --- |
| Laura Fawzia Sambowo | UI/UX, Frontend, Backend Integration |
| Aqila Ananti | Hardware Raspberry PI Zero W, LCD, LED , Wiring, & Device Building |
| Arsinta Kirana Nisa | AI Model Training & Implementation, Backend |
| Belva Nayla Soendaroeputri | 3D Design, Wiring, Design, Component Mearsurements |
| Sang Kala Sansvatama| Hardware Raspberry PI, Backend, AI Model | 

> The frontend repository is primarily maintained for the OCEDA web application and its user interface implementation.

---

## 🛠️ Tech Stack

<p align="center">
  <img src="https://img.shields.io/badge/React-19-20232A?style=flat-square&logo=react&logoColor=61DAFB" height="24"/>
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white" height="24"/>
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white" height="24"/>
  <img src="https://img.shields.io/badge/TailwindCSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" height="24"/>
  <img src="https://img.shields.io/badge/Lucide%20React-FD4F4F?style=flat-square&logo=lucide&logoColor=white" height="24"/>
  <img src="https://img.shields.io/badge/Figma-F24E1E?style=flat-square&logo=figma&logoColor=white" height="24"/>
</p>

### Frontend

- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- Lucide React
- Responsive UI/UX

### Planned System Integration

- Node.js
- Express.js
- AI inference service
- Raspberry Pi Zero W
- Raspberry Pi Camera / Arducam IMX219

---

## 🗂️ Project Structure

```text
frontend/
├── public/
│   ├── dr-sari.png
│   ├── ear-abnormal.jpeg
│   ├── ear-abnormal-heatmap.jpeg
│   ├── ear-normal.jpeg
│   └── ear-normal-heatmap.jpeg
│
├── src/
│   ├── imports/
│   ├── screens/
│   │   ├── AIResult.tsx
│   │   ├── Capture.tsx
│   │   ├── Dashboard.tsx
│   │   ├── Landing.tsx
│   │   ├── Login.tsx
│   │   ├── PatientInfo.tsx
│   │   └── Settings.tsx
│   ├── App.tsx
│   ├── i18n.tsx
│   ├── index.css
│   └── main.tsx
│
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 🔄 Examination Workflow

The current frontend is designed around the following examination flow:

```text
Landing
   ↓
Login
   ↓
Dashboard
   ↓
Patient Information
   ↓
Capture Ear Images
   ↓
Select Capture
   ↓
AI Analysis
   ↓
Classification & Heatmap
```

The current implementation focuses on the **frontend workflow and UI/UX**. Backend communication, real-time hardware integration, and AI inference will be integrated in subsequent development stages.

---

## 🖥️ Current Frontend

The current frontend provides the following primary screens:

### Dashboard

Central workspace for starting examinations and viewing device status.

### Patient Information

Input patient identification and examination details before image capture.

### Capture

Interface for capturing and reviewing ear images from the otoscope.

### AI Result

Display the predicted classification, confidence information, and heatmap visualization.

### Settings

Configure application preferences including language and appearance.

---

## 🚀 Getting Started

### Prerequisites

Make sure the following are installed:

- Node.js
- npm

### Installation

1. **Clone the repository**

   ```sh
   git clone <repository-url>
   cd frontend
   ```

2. **Install dependencies**

   ```sh
   npm install
   ```

3. **Run the development server**

   ```sh
   npm run dev
   ```

4. Open the local development server shown in the terminal, typically:

   ```text
   http://localhost:5173/
   ```

### Build for Production

```sh
npm run build
```

To preview the production build:

```sh
npm run preview
```

---

## 📈 Development Status

### Frontend v1.0.0

- [x] Initial frontend project setup
- [x] React + TypeScript + Vite configuration
- [x] Tailwind CSS v4 integration
- [x] Landing page
- [x] Login page
- [x] Dashboard
- [x] Patient information flow
- [x] Image capture interface
- [x] AI result interface
- [x] Settings page
- [x] Light/dark mode
- [x] English/Indonesian interface
- [x] Responsive layout
- [ ] Backend API integration
- [ ] Raspberry Pi device integration
- [ ] Real-time image transfer
- [ ] AI inference integration
- [ ] Dynamic examination data

---

## 🧭 Planned System Architecture

The intended OCEDA system will connect the frontend with the hardware and AI pipeline:

```text
Raspberry Pi Camera
        ↓
   Image Capture
        ↓
 Raspberry Pi Zero W
        ↓
    Backend API
        ↓
  AI Inference Service
        ↓
Classification + Heatmap
        ↓
     OCEDA Frontend
```

> The architecture above represents the planned system integration. The current repository contains the frontend implementation and does not yet include the complete backend, hardware, or AI pipeline.

---

<p align="center">
  <b>Made with 💙 by the OCEDA Team</b>
</p>
```
