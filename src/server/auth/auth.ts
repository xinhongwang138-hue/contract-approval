import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/server/db/client";
import { hashPassword, verifyPassword } from "./password";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) {
  throw new Error("BETTER_AUTH_SECRET is not set");
}

const isProduction = process.env.NODE_ENV === "production";

// Loopback-only allowlist for local development; production must set BETTER_AUTH_URL.
const devBaseURL = {
  allowedHosts: [
    "localhost:3000",
    "127.0.0.1:3000",
    "localhost:3001",
    "127.0.0.1:3001",
    "localhost:3100",
    "127.0.0.1:3100",
  ],
  protocol: "http" as const,
};

export const auth = betterAuth({
  appName: "合同审批系统",
  baseURL: process.env.BETTER_AUTH_URL ?? devBaseURL,
  secret,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    password: {
      hash: hashPassword,
      verify: ({ hash, password }) => verifyPassword(hash, password),
    },
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 60,
  },
  advanced: {
    useSecureCookies: isProduction,
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
    },
  },
  plugins: [nextCookies()],
});
