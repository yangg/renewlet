import type { MfaTotpSetupResponse } from "@/lib/api/schemas/auth";

// 这里只管理身份验证器/TOTP 与恢复码弹窗；通行密钥有独立管理弹窗，避免两个同级安全能力串线。
export type MfaPasswordAction = "regenerate" | "disable";

export type AccountSecurityDialogState =
  | { type: "none" }
  | { type: "mfa_setup"; setup: MfaTotpSetupResponse }
  | { type: "mfa_password"; action: MfaPasswordAction }
  | { type: "recovery_codes"; codes: string[] };
