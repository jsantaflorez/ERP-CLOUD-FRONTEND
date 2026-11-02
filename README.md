<<<<<<< HEAD
# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
=======
# ERP-CLOUD-FRONTEND
Frontend interface for the enterprise cloud ERP platform, designed to work alongside the Spring Boot backend architecture.
 java-ecosystem, web-client
>>>>>>> 3945ef4609a5c1f34cea157665761c41acb4951e

## Configuración del backend (auditoría 2026-11-02)

La URL de la API se define en tiempo de build con `VITE_API_URL` (ver `.env.example`):

```bash
# desarrollo: copiar .env.example a .env.local (por defecto http://localhost:8081/api)
npm run dev

# producción
VITE_API_URL=https://api.tu-dominio.com/api npm run build
```

Si el backend responde 401 en una pantalla de negocio (token vencido, acceso
retirado, usuario o empresa desactivados), la app cierra la sesión y vuelve al login.
