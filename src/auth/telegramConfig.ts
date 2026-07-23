export const TELEGRAM_PROVIDER = "telegram";

export type ConfirmationChannel = "in_app" | "telegram" | "both";

export const CONFIRMATION_SETTINGS_KEY = "agent_confirmations";

export function getFrontendUrl(): string {
  return (
    process.env.FRONTEND_URL ||
    process.env.VITE_FRONTEND_URL ||
    "http://localhost:8080"
  ).replace(/\/$/, "");
}
