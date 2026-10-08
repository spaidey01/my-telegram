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
