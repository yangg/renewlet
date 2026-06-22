import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { passkeyService } from "@/services/passkey-service";
import { useI18n } from "@/i18n/I18nProvider";
import { PASSKEYS_QUERY_KEY } from "./account-security-query-keys";
import { AccountPasskeysManagerDialog } from "./account-passkeys-manager-dialog";

export interface AccountPasskeysSectionProps {
  disabled?: boolean;
}

export function AccountPasskeysSection({
  disabled = false,
}: AccountPasskeysSectionProps) {
  const { t } = useI18n();
  const [managerOpen, setManagerOpen] = useState(false);

  const passkeysQuery = useQuery({
    queryKey: PASSKEYS_QUERY_KEY,
    queryFn: () => passkeyService.list(),
    staleTime: 30_000,
  });

  const passkeys = passkeysQuery.data ?? [];
  const hasPasskeys = passkeys.length > 0;
  const countLabel = passkeysQuery.isLoading ? t("common.loading") : t("settings.passkeyCount", { count: passkeys.length });

  return (
    <>
      <div className="grid gap-3 rounded-md border border-border bg-secondary/20 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid min-w-0 gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-foreground">{t("settings.passkeys")}</h3>
              <Badge variant={hasPasskeys ? "default" : "secondary"}>
                {hasPasskeys ? t("common.enabled") : t("common.disabled")}
              </Badge>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{t("settings.passkeyHelp")}</p>
            <p className="text-xs font-medium text-foreground">
              {t("settings.passkeyCountLabel")}：{countLabel}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full justify-center gap-2 border-border sm:w-auto"
            onClick={() => setManagerOpen(true)}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {t("settings.passkeysManage")}
          </Button>
        </div>
      </div>
      <AccountPasskeysManagerDialog
        disabled={disabled}
        open={managerOpen}
        onOpenChange={setManagerOpen}
        passkeys={passkeys}
        isLoading={passkeysQuery.isLoading}
      />
    </>
  );
}
