import { Env } from "../config/env.js";

export const runtimeConfig = {
  port: Env.integer("PORT", 3_000, { maximum: 65_535 }),
} as const;
