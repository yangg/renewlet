import type { MessageKey } from "@/i18n/messages";
import type { AiRecognitionSettings } from "@/lib/api/schemas/ai-recognition";
import { resolveAIProviderEndpoint } from "@renewlet/shared/ai-provider-endpoints";

export function getAIRecognitionSettingsBlocker(settings: AiRecognitionSettings): MessageKey | null {
  if (!settings.model.trim()) return "aiRecognition.modelRequired";
  const endpoint = resolveAIProviderEndpoint(settings);
  if (endpoint.baseUrlRequired && !settings.baseUrl.trim()) {
    return "aiRecognition.baseUrlRequired";
  }
  if (endpoint.apiKeyRequired && !settings.apiKey.trim()) {
    return "aiRecognition.apiKeyRequired";
  }
  return null;
}
