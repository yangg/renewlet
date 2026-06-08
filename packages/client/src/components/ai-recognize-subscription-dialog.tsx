import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileSearch } from "lucide-react";
import { AIDraftReviewPanel } from "@/components/ai-recognition/ai-draft-review-panel";
import {
  AIRecognitionCompactStepper,
  AIRecognitionFooterActions,
  AIRecognitionRunSettingsPanel,
  AIRecognitionStepper,
  NO_THINKING_CONTROL_ID,
  type AIRecognitionStep,
} from "@/components/ai-recognition/ai-recognition-dialog-layout";
import { AIRecognitionInputTabs } from "@/components/ai-recognition/ai-recognition-input-tabs";
import type { AIDraftListItem, AIRecognitionImageItem, AIRecognitionInputMode } from "@/components/ai-recognition/ai-recognition-dialog-types";
import Link from "@/components/router-link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImportPreviewPanel } from "@/components/import-preview-panel";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useI18n } from "@/i18n/I18nProvider";
import { getDisplayErrorMessage } from "@/lib/display-error";
import { todayDateOnlyInTimeZone } from "@/lib/time/date-only";
import {
  AI_RECOGNITION_MAX_IMAGE_BYTES,
  AI_RECOGNITION_MAX_IMAGES,
  type AiRecognizedSubscriptionDraft,
  type AiThinkingControl,
} from "@/lib/api/schemas/ai-recognition";
import { cn } from "@/lib/utils";
import type { CustomConfig } from "@/types/config";
import type { AppSettings } from "@/types/subscription";
import {
  getAIThinkingOptions,
  normalizeAIThinkingControl,
  thinkingControlFromOptionId,
  thinkingOptionId,
} from "@/modules/ai-recognition/domain/model-capabilities";
import { getAIRecognitionSettingsBlocker } from "@/modules/ai-recognition/domain/settings-readiness";
import { buildPreparedImportFromAIDrafts } from "@/modules/ai-recognition/domain/ai-recognition-import";
import { getAIDraftBlockingIssues } from "@/modules/ai-recognition/domain/ai-draft-preflight";
import { IMPORT_MESSAGE_CODES } from "@/modules/import-export/domain/import-export-model";
import { useImportPreviewApply } from "@/modules/import-export/application/use-import-preview-apply";
import { aiRecognitionService } from "@/services/ai-recognition-service";

interface AIRecognizeSubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AppSettings;
  config: CustomConfig;
  availableTags?: readonly string[];
}

type AIRecognitionStage = "input" | "draft" | "preview";
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const AI_BLOCKING_IMPORT_WARNING_CODES = new Set<string>([
  IMPORT_MESSAGE_CODES.aiBillingCycleDefaulted,
  IMPORT_MESSAGE_CODES.aiCurrencyDefaulted,
  IMPORT_MESSAGE_CODES.aiCustomCycleDefaulted,
  IMPORT_MESSAGE_CODES.aiDateDefaulted,
  IMPORT_MESSAGE_CODES.aiPriceDefaulted,
]);

export function AIRecognizeSubscriptionDialog({
  open,
  onOpenChange,
  settings,
  config,
  availableTags = [],
}: AIRecognizeSubscriptionDialogProps) {
  const { t } = useI18n();
  const isMobile = useMediaQuery("(max-width: 639px)");
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const imageItemsRef = useRef<AIRecognitionImageItem[]>([]);
  const imageIdRef = useRef(0);
  const draftIdRef = useRef(0);
  const recognitionRunRef = useRef(0);
  const [inputMode, setInputMode] = useState<AIRecognitionInputMode>("text");
  const [text, setText] = useState("");
  const [images, setImages] = useState<AIRecognitionImageItem[]>([]);
  const [drafts, setDrafts] = useState<AIDraftListItem[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [recognitionWarnings, setRecognitionWarnings] = useState<string[]>([]);
  const [thinkingControl, setThinkingControl] = useState<AiThinkingControl | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [previewingDrafts, setPreviewingDrafts] = useState(false);
  const [stage, setStage] = useState<AIRecognitionStage>("input");
  const [draftsStale, setDraftsStale] = useState(false);
  const today = todayDateOnlyInTimeZone(new Date(), settings.timezone);
  const aiSettings = settings.aiRecognition;
  const settingsBlocker = getAIRecognitionSettingsBlocker(aiSettings);
  const thinkingOptions = useMemo(
    () => getAIThinkingOptions(aiSettings.providerType, aiSettings.transportProtocol, aiSettings.model),
    [aiSettings.model, aiSettings.providerType, aiSettings.transportProtocol],
  );
  const selectedThinkingId = thinkingControl ? thinkingOptionId(thinkingControl) : NO_THINKING_CONTROL_ID;
  const {
    prepared,
    preview,
    conflictMode,
    previewFilter,
    skippedIndexes,
    error,
    applying,
    assetProgress,
    applyProgress,
    setError,
    setPreviewFilter,
    resetImportPreview,
    previewPrepared,
    handleConflictModeChange,
    handleLogoChange,
    handleSkipChange,
    handleApply,
  } = useImportPreviewApply({ onApplied: () => handleOpenChange(false) });
  const hasBlockingImportWarnings = prepared ? hasBlockingAIImportWarnings(prepared.warnings) : false;
  const draftBlockingIssuesById = useMemo(
    () => new Map(drafts.map((item) => [item.id, getAIDraftBlockingIssues(item.draft)])),
    [drafts],
  );
  const firstBlockingDraftId = useMemo(
    () => drafts.find((item) => (draftBlockingIssuesById.get(item.id)?.length ?? 0) > 0)?.id ?? null,
    [draftBlockingIssuesById, drafts],
  );
  const hasDraftBlockingIssues = firstBlockingDraftId !== null;
  const activeText = inputMode === "text" ? text.trim() : "";
  const activeImages = inputMode === "image" ? images : [];
  const canGenerate = !settingsBlocker && (activeText.length > 0 || activeImages.length > 0) && !recognizing;
  const workflowExpanded = stage !== "input";
  const inputStageVisible = stage === "input";
  const draftStageVisible = stage === "draft";
  const previewStageVisible = stage === "preview";
  const steps: AIRecognitionStep[] = [
    { label: t("aiRecognition.stepInput"), active: stage === "input", done: drafts.length > 0 && !draftsStale },
    { label: t("aiRecognition.stepDraft"), active: stage === "draft", done: stage === "preview" },
    { label: t("import.stepPreview"), active: stage === "preview", done: Boolean(preview && preview.summary.errors === 0) },
    { label: t("import.stepApply"), active: Boolean(preview && preview.summary.errors === 0), done: false },
  ];
  const mobileActiveStepIndex = previewStageVisible && preview?.summary.errors === 0
    ? 3
    : draftStageVisible ? 1 : previewStageVisible ? 2 : 0;

  useEffect(() => {
    imageItemsRef.current = images;
  }, [images]);

  useEffect(() => () => revokeImageItems(imageItemsRef.current), []);

  useEffect(() => {
    if (!open) return;
    setThinkingControl(normalizeAIThinkingControl(aiSettings.providerType, aiSettings.transportProtocol, aiSettings.model, aiSettings.defaultThinkingControl));
  }, [aiSettings.defaultThinkingControl, aiSettings.model, aiSettings.providerType, aiSettings.transportProtocol, open]);

  function reset() {
    recognitionRunRef.current += 1;
    revokeImageItems(imageItemsRef.current);
    imageItemsRef.current = [];
    imageIdRef.current = 0;
    draftIdRef.current = 0;
    setInputMode("text");
    setText("");
    setImages([]);
    setDrafts([]);
    setSelectedDraftId(null);
    setRecognitionWarnings([]);
    setRecognizing(false);
    setPreviewingDrafts(false);
    setStage("input");
    setDraftsStale(false);
    setError(null);
    resetImportPreview();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  function addImages(files: File[]) {
    if (files.length === 0) return;
    setError(null);
    const nextImages = [...imageItemsRef.current];
    const previousCount = nextImages.length;
    let nextError: string | null = null;
    for (const file of files) {
      if (nextImages.length >= AI_RECOGNITION_MAX_IMAGES) {
        nextError = t("aiRecognition.imageLimit", { count: AI_RECOGNITION_MAX_IMAGES });
        break;
      }
      if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size > AI_RECOGNITION_MAX_IMAGE_BYTES) {
        nextError = t("aiRecognition.imageInvalid");
        continue;
      }
      nextImages.push({
        id: nextImageId(imageIdRef),
        file,
        thumbnailUrl: createObjectUrl(file),
      });
    }
    imageItemsRef.current = nextImages;
    setImages(nextImages);
    if (nextImages.length !== previousCount) markDraftsStaleFromInputChange();
    if (nextError) setError(nextError);
  }

  function removeImage(id: string) {
    const removed = imageItemsRef.current.find((image) => image.id === id);
    const nextImages = imageItemsRef.current.filter((image) => image.id !== id);
    if (removed) revokeImageItem(removed);
    imageItemsRef.current = nextImages;
    setImages(nextImages);
    if (removed) markDraftsStaleFromInputChange();
  }

  function handleInputModeChange(nextMode: AIRecognitionInputMode) {
    if (nextMode === inputMode) return;
    setInputMode(nextMode);
    markDraftsStaleFromInputChange();
  }

  function handleTextChange(nextText: string) {
    if (nextText === text) return;
    setText(nextText);
    markDraftsStaleFromInputChange();
  }

  function handleThinkingChange(value: string) {
    const nextThinkingControl = value === NO_THINKING_CONTROL_ID ? null : thinkingControlFromOptionId(thinkingOptions, value);
    if (thinkingOptionIdOrNull(nextThinkingControl) === thinkingOptionIdOrNull(thinkingControl)) return;
    setThinkingControl(nextThinkingControl);
    markDraftsStaleFromInputChange();
  }

  function markDraftsStaleFromInputChange() {
    if (drafts.length === 0) return;
    // 输入、图片和思考控制是草稿生成的事实源；返回输入后改动任一项，都必须让旧 preview 失效。
    setDraftsStale(true);
    resetImportPreview();
  }

  function handleBackToInput() {
    setStage("input");
    setError(null);
  }

  function handleBackToDraft() {
    if (drafts.length === 0 || draftsStale) return;
    setStage("draft");
    setError(null);
  }

  const handleRecognize = async () => {
    if (!canGenerate) return;
    const runId = recognitionRunRef.current + 1;
    recognitionRunRef.current = runId;
    setRecognizing(true);
    setError(null);
    setRecognitionWarnings([]);
    resetImportPreview();
    try {
      const response = await aiRecognitionService.recognizeSubscriptions({
        text: inputMode === "text" ? text : "",
        images: inputMode === "image" ? images.map((image) => image.file) : [],
        thinkingControl,
      });
      if (recognitionRunRef.current !== runId) return;
      const nextDrafts = response.subscriptions.map((draft) => ({
        id: nextDraftId(draftIdRef),
        draft,
      }));
      setDrafts(nextDrafts);
      setSelectedDraftId(nextDrafts[0]?.id ?? null);
      setRecognitionWarnings(response.warnings);
      setDraftsStale(false);
      setStage("draft");
    } catch (err) {
      if (recognitionRunRef.current !== runId) return;
      setError(getDisplayErrorMessage(err, t("aiRecognition.recognizeFailedDescription")));
    } finally {
      if (recognitionRunRef.current === runId) setRecognizing(false);
    }
  };

  const handleBuildPreview = async () => {
    if (drafts.length === 0 || draftsStale) return;
    if (firstBlockingDraftId) {
      setSelectedDraftId(firstBlockingDraftId);
      setStage("draft");
      setError(null);
      return;
    }
    setPreviewingDrafts(true);
    setError(null);
    try {
      const preparedImport = buildPreparedImportFromAIDrafts(drafts.map((item) => item.draft), { settings, config, today });
      await previewPrepared(preparedImport, conflictMode);
      setStage("preview");
    } catch (err) {
      setError(getDisplayErrorMessage(err, t("import.previewFailed")));
    } finally {
      setPreviewingDrafts(false);
    }
  };

  function invalidateDraftPreview() {
    // 草稿是导入预览的前端事实源；任何编辑/删除都必须废弃旧 preview，避免确认时写入过期数据。
    resetImportPreview();
  }

  function updateDraft(id: string, patch: Partial<AiRecognizedSubscriptionDraft>) {
    invalidateDraftPreview();
    setDrafts((current) => current.map((item) => (item.id === id ? { ...item, draft: { ...item.draft, ...patch } } : item)));
  }

  function removeDraft(id: string) {
    invalidateDraftPreview();
    const removedIndex = drafts.findIndex((item) => item.id === id);
    const nextDrafts = drafts.filter((item) => item.id !== id);
    const fallback = removedIndex >= 0 ? nextDrafts[Math.min(removedIndex, nextDrafts.length - 1)]?.id ?? null : null;
    setDrafts(nextDrafts);
    setSelectedDraftId((currentSelected) => (currentSelected === id ? fallback : currentSelected));
  }

  const inputTabs = (
    <AIRecognitionInputTabs
      mode={inputMode}
      onModeChange={handleInputModeChange}
      text={text}
      onTextChange={handleTextChange}
      textInputRef={textInputRef}
      images={images}
      disabled={recognizing}
      onAddImages={addImages}
      onRemoveImage={removeImage}
      layout={isMobile ? "mobile-compact" : "default"}
    />
  );
  const runSettingsPanel = (
    <AIRecognitionRunSettingsPanel
      providerType={aiSettings.providerType}
      model={aiSettings.model}
      mode={inputMode}
      textLength={text.length}
      imageCount={images.length}
      thinkingOptions={thinkingOptions}
      selectedThinkingId={selectedThinkingId}
      disabled={recognizing}
      layout={isMobile ? "mobile-bar" : "default"}
      onThinkingChange={handleThinkingChange}
    />
  );

  const body = (
    <div
      data-testid="ai-recognition-dialog-body"
      className={cn(
        "min-h-0",
        isMobile ? "px-3 py-2" : "px-4 py-4 sm:px-6",
        inputStageVisible || draftStageVisible
          ? cn("flex flex-col overflow-hidden", isMobile ? "gap-2" : "gap-4")
          : cn("overflow-y-auto", isMobile ? "space-y-3" : "space-y-4"),
      )}
    >
          {settingsBlocker ? (
            <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>{t(settingsBlocker)}</span>
              </div>
              <Button asChild type="button" variant="outline" className="shrink-0 border-border">
                <Link href="/settings#settings-ai-recognition" onClick={() => handleOpenChange(false)}>
                  {t("aiRecognition.openSettings")}
                </Link>
              </Button>
            </div>
          ) : null}

          {inputStageVisible ? (
            <section
              className={cn(
                "grid min-h-0 flex-1",
                isMobile
                  ? "grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden"
                  : "gap-4 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-stretch lg:overflow-hidden",
              )}
              aria-label={t("aiRecognition.stepInput")}
            >
              {isMobile ? (
                <>
                  {runSettingsPanel}
                  {inputTabs}
                </>
              ) : (
                <>
                  {inputTabs}
                  {runSettingsPanel}
                </>
              )}
            </section>
          ) : null}

          {inputStageVisible && drafts.length > 0 && draftsStale ? (
            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("aiRecognition.draftsStale")}</span>
            </div>
          ) : null}

          {error ? (
            <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {recognitionWarnings.length > 0 ? (
            <div className="rounded-lg border border-border bg-secondary/30 p-3 text-xs leading-5 text-muted-foreground">
              {recognitionWarnings.slice(0, 6).map((warning, index) => <p key={`${warning}:${index}`}>{warning}</p>)}
            </div>
          ) : null}

          {draftStageVisible && drafts.length > 0 ? (
            <AIDraftReviewPanel
              drafts={drafts}
              config={config}
              settings={settings}
              availableTags={availableTags}
              draftBlockingIssuesById={draftBlockingIssuesById}
              selectedDraftId={selectedDraftId}
              onSelectedDraftIdChange={setSelectedDraftId}
              onChangeDraft={updateDraft}
              onRemoveDraft={removeDraft}
            />
          ) : null}

          {previewStageVisible && prepared && preview ? (
            <>
              {hasBlockingImportWarnings ? (
                <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t("aiRecognition.blockingWarnings")}</span>
                </div>
              ) : null}
              <ImportPreviewPanel
                prepared={prepared}
                preview={preview}
                conflictMode={conflictMode}
                previewFilter={previewFilter}
                skippedIndexes={skippedIndexes}
                assetProgress={assetProgress}
                applyProgress={applyProgress}
                showImportOptions={false}
                onConflictModeChange={handleConflictModeChange}
                onPreviewFilterChange={setPreviewFilter}
                onLogoChange={handleLogoChange}
                onSkipChange={handleSkipChange}
              />
            </>
          ) : null}
    </div>
  );

  const desktopFooter = (
    <DialogFooter className="shrink-0 border-t border-border bg-card px-4 py-4 sm:px-6">
      <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>{t("common.cancel")}</Button>
      <AIRecognitionFooterActions
        inputStageVisible={inputStageVisible}
        draftStageVisible={draftStageVisible}
        previewStageVisible={previewStageVisible}
        draftsCount={drafts.length}
        draftsStale={draftsStale}
        recognizing={recognizing}
        canGenerate={canGenerate}
        previewingDrafts={previewingDrafts}
        hasDraftBlockingIssues={hasDraftBlockingIssues}
        preview={preview}
        applying={applying}
        hasBlockingImportWarnings={hasBlockingImportWarnings}
        onBackToDraft={handleBackToDraft}
        onRecognize={() => void handleRecognize()}
        onBackToInput={handleBackToInput}
        onBuildPreview={() => void handleBuildPreview()}
        onApply={() => void handleApply()}
      />
    </DialogFooter>
  );

  const mobileFooter = (
    <div
      data-testid="ai-recognition-mobile-footer"
      className="flex shrink-0 gap-2 border-t border-border bg-card px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
    >
      <AIRecognitionFooterActions
        inputStageVisible={inputStageVisible}
        draftStageVisible={draftStageVisible}
        previewStageVisible={previewStageVisible}
        draftsCount={drafts.length}
        draftsStale={draftsStale}
        recognizing={recognizing}
        canGenerate={canGenerate}
        previewingDrafts={previewingDrafts}
        hasDraftBlockingIssues={hasDraftBlockingIssues}
        preview={preview}
        applying={applying}
        hasBlockingImportWarnings={hasBlockingImportWarnings}
        mobile
        onBackToDraft={handleBackToDraft}
        onRecognize={() => void handleRecognize()}
        onBackToInput={handleBackToInput}
        onBuildPreview={() => void handleBuildPreview()}
        onApply={() => void handleApply()}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        layout="frame"
        closeLabel={t("common.close")}
        className={cn(
          "overflow-hidden border-border bg-card p-0",
          isMobile
            ? "h5-ai-recognition-workbench-frame"
            : cn(
              "h5-import-dialog-panel sm:max-w-6xl",
              workflowExpanded ? "h5-dialog-frame" : "h5-ai-recognition-input-dialog-frame",
            ),
        )}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          // H5 首屏需要先露出输入模式和上传入口；自动聚焦会立刻弹键盘并挤掉工作区。
          if (isMobile) return;
          textInputRef.current?.focus();
        }}
      >
        <DialogHeader
          className={cn(
            "shrink-0 border-b border-border bg-card pr-12",
            isMobile ? "px-4 py-3 text-left" : "px-4 py-4 sm:px-6 sm:pr-14",
          )}
        >
          {isMobile ? (
            <>
              <DialogTitle className="text-base leading-6">{t("aiRecognition.dialogTitle")}</DialogTitle>
              <DialogDescription className="sr-only">{t("aiRecognition.dialogDescription")}</DialogDescription>
            </>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/50 text-muted-foreground">
                  <FileSearch className="h-4 w-4" />
                </div>
                <div className="min-w-0 text-left">
                  <DialogTitle className="text-lg">{t("aiRecognition.dialogTitle")}</DialogTitle>
                  <DialogDescription className="mt-1 max-w-3xl text-left leading-5">{t("aiRecognition.dialogDescription")}</DialogDescription>
                </div>
              </div>
              <AIRecognitionStepper
                steps={steps}
                ariaLabel={t("aiRecognition.dialogTitle")}
              />
            </div>
          )}
        </DialogHeader>

        {isMobile ? (
          <AIRecognitionCompactStepper
            steps={steps}
            activeIndex={mobileActiveStepIndex}
            ariaLabel={t("aiRecognition.dialogTitle")}
          />
        ) : null}

        {body}
        {isMobile ? mobileFooter : desktopFooter}
      </DialogContent>
    </Dialog>
  );
}

function thinkingOptionIdOrNull(control: AiThinkingControl | null): string | null {
  return control ? thinkingOptionId(control) : null;
}

function nextImageId(ref: { current: number }): string {
  ref.current += 1;
  return `ai-image-${ref.current}`;
}

function nextDraftId(ref: { current: number }): string {
  ref.current += 1;
  return `ai-draft-${ref.current}`;
}

function createObjectUrl(file: File): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  return URL.createObjectURL(file);
}

function revokeImageItem(image: AIRecognitionImageItem) {
  if (image.thumbnailUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(image.thumbnailUrl);
  }
}

function revokeImageItems(images: readonly AIRecognitionImageItem[]) {
  for (const image of images) {
    revokeImageItem(image);
  }
}

function hasBlockingAIImportWarnings(warnings: readonly string[]): boolean {
  return warnings.some((warning) => (
    warning.split("|").some((part) => AI_BLOCKING_IMPORT_WARNING_CODES.has(part))
  ));
}
