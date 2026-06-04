import { Component, type ErrorInfo, type PropsWithChildren } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import { reportClientError } from "@/lib/report-client-error";

interface AppErrorBoundaryState {
  error: Error | null;
}

export const appErrorBoundaryBrowser = {
  reload: () => window.location.reload(),
};

export class AppErrorBoundary extends Component<PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(error, { componentStack: info.componentStack ?? "" });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <AppErrorFallback onReload={() => appErrorBoundaryBrowser.reload()} />;
  }
}

function AppErrorFallback({ onReload }: { onReload: () => void }) {
  const { t } = useI18n();
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10 text-foreground">
      <section className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
        <div className="space-y-3">
          <p className="text-lg font-semibold">{t("appError.title")}</p>
          <p className="text-sm leading-6 text-muted-foreground">{t("appError.description")}</p>
        </div>
        <Button className="mt-6 w-full sm:w-auto" onClick={onReload}>
          <RefreshCw className="mr-2 size-4" aria-hidden="true" />
          {t("appError.reload")}
        </Button>
      </section>
    </main>
  );
}
