// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    // Select the wrangler config via WRANGLER_CONFIG (defaults to the
    // Resend variant; set WRANGLER_CONFIG=wrangler.cloudflare.toml to
    // develop against the Cloudflare Email Service provider).
    cloudflare({
      viteEnvironment: { name: "ssr" },
      configPath: process.env.WRANGLER_CONFIG ?? "wrangler.toml",
    }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
});
