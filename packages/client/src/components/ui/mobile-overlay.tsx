import * as React from "react";

import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

export const MOBILE_OVERLAY_QUERY = "(max-width: 767px)";
export const MOBILE_SHEET_LARGE_ITEM_THRESHOLD = 10;

export type MobileSheetDetent = "auto" | "compact" | "large";
export type ResolvedMobileSheetDetent = Exclude<MobileSheetDetent, "auto">;
export type MobileSheetKind = "list" | "calendar" | "panel";

let activeMobileBackdropCount = 0;
let suppressMobileOverlayTrigger = false;
let clearMobileOverlayTriggerSuppressionTimer: ReturnType<typeof setTimeout> | undefined;
const mobileOverlayStateListeners = new Set<() => void>();

function subscribeMobileOverlayState(listener: () => void) {
  mobileOverlayStateListeners.add(listener);
  return () => {
    mobileOverlayStateListeners.delete(listener);
  };
}

function getMobileOverlayStateSnapshot() {
  return activeMobileBackdropCount > 0;
}

function updateMobileOverlayOpenState() {
  if (typeof document === "undefined") return;

  if (activeMobileBackdropCount > 0) {
    document.body.setAttribute("data-mobile-overlay-open", "");
    return;
  }

  document.body.removeAttribute("data-mobile-overlay-open");
}

function emitMobileOverlayStateChange() {
  mobileOverlayStateListeners.forEach((listener) => listener());
}

function registerMobileOverlayBackdrop() {
  activeMobileBackdropCount += 1;
  updateMobileOverlayOpenState();
  emitMobileOverlayStateChange();

  return () => {
    activeMobileBackdropCount = Math.max(0, activeMobileBackdropCount - 1);
    updateMobileOverlayOpenState();
    emitMobileOverlayStateChange();
  };
}

export function useIsMobileOverlay() {
  return useMediaQuery(MOBILE_OVERLAY_QUERY);
}

export function useHasActiveMobileOverlayBackdrop() {
  return React.useSyncExternalStore(
    subscribeMobileOverlayState,
    getMobileOverlayStateSnapshot,
    () => false,
  );
}

export function useControllableOpen({
  defaultOpen = false,
  onOpenChange,
  open,
}: {
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  open?: boolean | undefined;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = open !== undefined;
  const currentOpen = isControlled ? open : uncontrolledOpen;

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  return [currentOpen, setOpen] as const;
}

export function resolveMobileSheetDetent({
  itemCount,
  kind = "panel",
  requestedDetent = "auto",
}: {
  itemCount?: number | undefined;
  kind?: MobileSheetKind | undefined;
  requestedDetent?: MobileSheetDetent | undefined;
}): ResolvedMobileSheetDetent {
  if (requestedDetent === "compact" || requestedDetent === "large") {
    return requestedDetent;
  }

  if (kind === "list" && typeof itemCount === "number" && itemCount > MOBILE_SHEET_LARGE_ITEM_THRESHOLD) {
    return "large";
  }

  return "compact";
}

export function isMobileOverlayBackdropTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest("[data-mobile-overlay-backdrop]") !== null;
}

export function stopMobileOverlayBackdropEvent(event: Pick<Event, "preventDefault" | "stopPropagation">) {
  event.preventDefault();
  event.stopPropagation();
}

function markMobileOverlayBackdropInteraction() {
  suppressMobileOverlayTrigger = true;

  if (clearMobileOverlayTriggerSuppressionTimer) {
    clearTimeout(clearMobileOverlayTriggerSuppressionTimer);
  }
  clearMobileOverlayTriggerSuppressionTimer = setTimeout(() => {
    suppressMobileOverlayTrigger = false;
    clearMobileOverlayTriggerSuppressionTimer = undefined;
  }, 0);
}

export function shouldSuppressMobileOverlayTriggerEvent(
  event: Pick<React.SyntheticEvent, "preventDefault" | "stopPropagation">,
) {
  if (!suppressMobileOverlayTrigger) return false;

  event.preventDefault();
  event.stopPropagation();
  suppressMobileOverlayTrigger = false;
  return true;
}

export function handleMobileOverlayOutsideEvent(
  event: {
    detail?: { originalEvent?: Event };
    target: EventTarget | null;
    preventDefault: () => void;
  },
  _onDismiss?: (() => void) | undefined,
) {
  const originalTarget = event.detail?.originalEvent?.target ?? event.target;
  if (!isMobileOverlayBackdropTarget(originalTarget)) return false;

  // Radix observes outside pointer events before React receives the backdrop click.
  // Keep the sheet mounted until click so the browser cannot retarget that same
  // tap to a trigger or to the parent Dialog behind the backdrop.
  event.preventDefault();
  markMobileOverlayBackdropInteraction();
  return true;
}

export function getMobileSheetClassName({
  detent,
  kind,
}: {
  detent: ResolvedMobileSheetDetent;
  kind: MobileSheetKind;
}) {
  return cn(
    "h5-mobile-sheet-content",
    detent === "compact" && "h5-mobile-sheet-compact",
    detent === "large" && "h5-mobile-sheet-large",
    kind === "list" && "h5-mobile-sheet-list",
    kind === "calendar" && "h5-mobile-sheet-calendar",
    kind === "panel" && "h5-mobile-sheet-panel",
  );
}

export function MobileOverlayBackdrop({
  className,
  onDismiss,
  onClick,
  onClickCapture,
  onPointerDown,
  onPointerDownCapture,
  onPointerUp,
  onPointerUpCapture,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  onDismiss?: (() => void) | undefined;
}) {
  const isMobileOverlay = useIsMobileOverlay();

  React.useEffect(() => {
    if (!isMobileOverlay) return undefined;

    // Nested Radix portals can place a mobile sheet inside DialogContent while
    // DialogOverlay stays in a sibling stacking layer. Registering the active
    // backdrop gives shared tests and guards one source of truth for the top
    // mobile layer, while the backdrop itself consumes the tap before dismissal.
    return registerMobileOverlayBackdrop();
  }, [isMobileOverlay]);

  return (
    <div
      aria-hidden="true"
      data-mobile-overlay-backdrop=""
      className={cn("h5-mobile-overlay-backdrop", className)}
      style={{ ...style, pointerEvents: "auto" }}
      {...props}
      onClickCapture={(event) => {
        markMobileOverlayBackdropInteraction();
        stopMobileOverlayBackdropEvent(event);
        onDismiss?.();
        onClickCapture?.(event);
      }}
      onClick={(event) => {
        markMobileOverlayBackdropInteraction();
        stopMobileOverlayBackdropEvent(event);
        onClick?.(event);
      }}
      onPointerDownCapture={(event) => {
        markMobileOverlayBackdropInteraction();
        stopMobileOverlayBackdropEvent(event);
        onPointerDownCapture?.(event);
      }}
      onPointerDown={(event) => {
        markMobileOverlayBackdropInteraction();
        stopMobileOverlayBackdropEvent(event);
        onPointerDown?.(event);
      }}
      onPointerUpCapture={(event) => {
        markMobileOverlayBackdropInteraction();
        stopMobileOverlayBackdropEvent(event);
        onPointerUpCapture?.(event);
      }}
      onPointerUp={(event) => {
        markMobileOverlayBackdropInteraction();
        stopMobileOverlayBackdropEvent(event);
        onPointerUp?.(event);
      }}
    />
  );
}
