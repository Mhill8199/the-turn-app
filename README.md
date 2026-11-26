# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Native beta (Capacitor)

The Vite build writes the web app to `dist` (`webDir` in `capacitor.config.json`). Android and iOS projects are in `android/` and `ios/`. Do not commit `google-services.json`, `GoogleService-Info.plist`, or signing keys.

```bash
npm run build
npx cap sync
npx cap open android
npx cap open ios
```

Store enrollment is not done yet. Solis Noir LLC has to enroll itself:

- Apple Developer Program is $99/year, and that enrollment is required before TestFlight.
- Google Play Console is a $25 one-time fee, and that enrollment is required before Closed Testing.
