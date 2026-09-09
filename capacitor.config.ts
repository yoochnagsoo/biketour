import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.yoochnagsoo.biketour",
  appName: "바이크투어",
  webDir: "out",
  ios: {
    contentInset: "automatic",
  },
  server: {
    hostname: "biketour-gules.vercel.app",
  },
};

export default config;
