import {
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { apiFetch } from "@/lib/api-client";
import {
  passkeyAuthenticateOptionsBodySchema,
  passkeyAuthenticateVerifyBodySchema,
  passkeyDeleteBodySchema,
  passkeyRegisterOptionsBodySchema,
  passkeyRegisterVerifyBodySchema,
  passkeysResponseSchema,
  passkeyWebAuthnOptionsResponseSchema,
  sessionResponseSchema,
  type Passkey,
  type PasskeyDeleteBody,
  type PasskeyRegisterOptionsBody,
  type PasskeyWebAuthnOptionsResponse,
  type SessionResponse,
} from "@/lib/api/schemas/auth";
import { writeProductSession } from "@/services/product-session";

/** 通行密钥是独立 WebAuthn 登录能力；它不消费 MFA ticket，也不出现在身份验证器 methods 中。 */
export const passkeyService = {
  cancelActiveCeremony(): void {
    // SimpleWebAuthn ceremony 挂在浏览器凭据层；SPA 路由/密码登录状态失效时必须显式 abort 原生弹窗。
    WebAuthnAbortService.cancelCeremony();
  },

  async list(): Promise<Passkey[]> {
    const data = await apiFetch("/api/app/auth/passkeys", passkeysResponseSchema);
    return data.passkeys;
  },

  async register(body: PasskeyRegisterOptionsBody): Promise<void> {
    const payload = passkeyRegisterOptionsBodySchema.parse(body);
    const options = await apiFetch("/api/app/auth/passkeys/register/options", passkeyWebAuthnOptionsResponseSchema, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    // WebAuthn challenge 只在本次浏览器凭据流程内存中流转；verify 后服务端会消费并更新 credential。
    const response = await startRegistration({
      optionsJSON: options.options as unknown as PublicKeyCredentialCreationOptionsJSON,
    });
    const verifyPayload = passkeyRegisterVerifyBodySchema.parse({
      challengeId: options.challengeId,
      name: payload.name,
      response,
    });
    const data = await apiFetch("/api/app/auth/passkeys/register/verify", sessionResponseSchema, {
      method: "POST",
      body: JSON.stringify(verifyPayload),
    });
    writeProductSession(data);
  },

  async startAuthentication(): Promise<PasskeyWebAuthnOptionsResponse> {
    const payload = passkeyAuthenticateOptionsBodySchema.parse({});
    return await apiFetch("/api/app/auth/passkeys/authenticate/options", passkeyWebAuthnOptionsResponseSchema, {
      authMode: "none",
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async authenticate(options: { useBrowserAutofill?: boolean } = {}): Promise<SessionResponse> {
    const webAuthnOptions = await passkeyService.startAuthentication();
    // 前端只把服务端 challenge 交给浏览器凭据 API；origin/RP/counter 由后端 WebAuthn 库验证并签 session。
    const authenticationOptions: { optionsJSON: PublicKeyCredentialRequestOptionsJSON; useBrowserAutofill?: boolean } = {
      optionsJSON: webAuthnOptions.options as unknown as PublicKeyCredentialRequestOptionsJSON,
    };
    if (typeof options.useBrowserAutofill === "boolean") {
      authenticationOptions.useBrowserAutofill = options.useBrowserAutofill;
    }
    const response = await startAuthentication(authenticationOptions);
    const verifyPayload = passkeyAuthenticateVerifyBodySchema.parse({
      challengeId: webAuthnOptions.challengeId,
      response,
    });
    return await apiFetch("/api/app/auth/passkeys/authenticate/verify", sessionResponseSchema, {
      authMode: "none",
      method: "POST",
      body: JSON.stringify(verifyPayload),
    });
  },

  async delete(id: string, body: PasskeyDeleteBody): Promise<void> {
    const payload = passkeyDeleteBodySchema.parse(body);
    const data = await apiFetch(`/api/app/auth/passkeys/${encodeURIComponent(id)}/delete`, sessionResponseSchema, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    writeProductSession(data);
  },
};
