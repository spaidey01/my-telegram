> **STARGRAM RELEASE / AUDIT STATUS — Stage 0 (baseline backup)**  
> This branch, `stargram_clone`, is a safety snapshot created from `main` at commit `b40f6f37783f26a54e37e3e3dc952de21190f07e` on 2026-10-12, before cross-branch integration.  
> **Do not treat this branch as the final integrated release.** Branch-only features may be absent here until audited and validated. No source feature branches have been merged by creating this snapshot.  
> Current workflow: **Stage 1 — inventory branches, compare features against this baseline, review conflicts/security, then test before any integration.** See [`STARGRAM_STAGE_STATUS.md`](STARGRAM_STAGE_STATUS.md).

# Stargram — Next.js & Socket.io  

A feature-rich messaging platform built with **Next.js**, **Socket.io**, and **PWA** support. It features instant messaging, user authentication, group and channel management, and a modern UI with **Tailwind CSS** and **DaisyUI**.


## ✨ Features  
-  **Real-time messaging** powered by Socket.io  
-  **User authentication & management**  
-  **Groups & channels** support  
-  **Profile & settings management**  
-  **Channel & group administration**
-  **Progressive Web App (PWA) support** for a seamless experience  

## ⚙️ Built with 
-  **Next.js** 16
-  **Socket.io** for real-time communication
-  **Zustand** for state management
-  **MongoDB & Liara** for data management
-  **Tailwind CSS & DaisyUI** for modern UI design  
-  **PWA support** for an enhanced web experience
- **TypeScript** for Type Safety


## Production

Production VPS setup and systemd service definitions are in [deploy/README.md](deploy/README.md).

The production application requires MongoDB, Redis, S3-compatible storage, and ClamAV when malware scanning is enabled. The web/API process listens on port 3000 and the Socket.IO process on port 3001.
