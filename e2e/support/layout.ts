import { expect, type ElementHandle, type Locator, type Page } from "@playwright/test";

export async function getRequiredElementBoundingBox(
  element: ElementHandle<HTMLElement | SVGElement>,
  label: string,
) {
  const box = await element.boundingBox();
  if (!box) {
    throw new Error(`Missing bounding box for ${label}`);
  }
  return box;
}

export async function getRequiredLocatorBoundingBox(locator: Locator, label: string) {
  const element = await locator.elementHandle();
  if (!element) {
    throw new Error(`Missing element for ${label}`);
  }
  return getRequiredElementBoundingBox(element, label);
}

// 这类布局回归不会出现在 role/label 断言里：Radix 包装层、隐藏 input 或 chip field
// 变动都可能让 label 和控件视觉脱节，所以用真实 DOMRect 约束可见间距。
export async function expectLabelControlGap(control: Locator, label: string) {
  await control.scrollIntoViewIfNeeded();
  const gap = await control.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error("Control is not an HTMLElement");
    }

    if (!element.id) {
      throw new Error("Control has no id for label lookup");
    }

    const labelElement = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`);
    if (!labelElement) {
      throw new Error(`Missing label for #${element.id}`);
    }

    const labelRect = labelElement.getBoundingClientRect();
    // tag 输入的可见控件是 chip field 外壳，原始 input 只是内部 autosize 光标。
    const visualControl =
      element instanceof HTMLInputElement
        ? element.closest<HTMLElement>('[data-slot="subscription-tag-field"]') ?? element
        : element;
    const controlRect = visualControl.getBoundingClientRect();
    return Math.round((controlRect.top - labelRect.bottom) * 100) / 100;
  });

  expect(gap, `${label}: label/control gap`).toBeGreaterThanOrEqual(7);
  expect(gap, `${label}: label/control gap`).toBeLessThanOrEqual(9);
}

interface LayoutSnapshot {
  header: { x: number };
  content: { x: number };
  saveButton?: { x: number };
  rootOverflowY: string;
  rootScrollbarGutter: string;
  bodyScrollLocked: boolean;
}

export async function captureLayoutSnapshot(
  page: Page,
  targets: {
    content: Locator;
    saveButton?: ElementHandle<HTMLElement | SVGElement>;
  },
): Promise<LayoutSnapshot> {
  // 浮层打开时 Radix 可能把背景内容从可访问树隐藏，role 查询会失效；
  // 用稳定 testid 读取 DOMRect，专门验证 body scroll lock 不会推动固定布局。
  const [header, content, saveButton, scrollState] = await Promise.all([
    getRequiredLocatorBoundingBox(page.getByTestId("app-header"), "header layout target"),
    getRequiredLocatorBoundingBox(targets.content, "content layout target"),
    targets.saveButton ? getRequiredElementBoundingBox(targets.saveButton, "save button layout target") : undefined,
    page.evaluate(() => {
      const root = document.getElementById("root");
      if (!root) {
        throw new Error("Missing #root scroll container");
      }

      const rootStyle = window.getComputedStyle(root);
      return {
        rootOverflowY: rootStyle.overflowY,
        rootScrollbarGutter: rootStyle.scrollbarGutter,
        bodyScrollLocked: document.body.hasAttribute("data-scroll-locked"),
      };
    }),
  ]);

  return {
    header,
    content,
    saveButton,
    ...scrollState,
  };
}

export function expectRootScrollContainer(snapshot: LayoutSnapshot) {
  expect(snapshot.rootOverflowY).toBe("auto");
  expect(snapshot.rootScrollbarGutter).toContain("stable");
}

export async function expectNoHorizontalOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => {
    const root = document.getElementById("root");
    if (!root) {
      throw new Error("Missing #root scroll container");
    }

    return {
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
    };
  });

  expect(metrics.rootScrollWidth - metrics.rootClientWidth, `${label}: #root horizontal overflow`).toBeLessThanOrEqual(1);
  expect(
    metrics.documentScrollWidth - metrics.documentClientWidth,
    `${label}: document horizontal overflow`,
  ).toBeLessThanOrEqual(1);
  expect(metrics.bodyScrollWidth - metrics.bodyClientWidth, `${label}: body horizontal overflow`).toBeLessThanOrEqual(1);
}

export async function expectTouchTarget(locator: Locator, label: string, minSize = 24) {
  const box = await getRequiredLocatorBoundingBox(locator, label);
  expect(box.width, `${label}: touch target width`).toBeGreaterThanOrEqual(minSize);
  expect(box.height, `${label}: touch target height`).toBeGreaterThanOrEqual(minSize);
}

export async function expectActionNearContainerBottom(
  container: Locator,
  action: Locator,
  label: string,
  maxGap = 64,
) {
  const [containerBox, actionBox] = await Promise.all([
    getRequiredLocatorBoundingBox(container, `${label} container`),
    getRequiredLocatorBoundingBox(action, `${label} action`),
  ]);
  const gap = containerBox.y + containerBox.height - (actionBox.y + actionBox.height);
  expect(gap, `${label}: action-to-bottom gap`).toBeGreaterThanOrEqual(0);
  expect(gap, `${label}: action-to-bottom gap`).toBeLessThanOrEqual(maxGap);
}

export async function expectScrollContentNearFooter(
  scrollRegion: Locator,
  label: string,
  maxGap = 24,
) {
  const gap = await scrollRegion.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error("Scroll region is not an HTMLElement");
    }

    element.scrollTop = element.scrollHeight;

    const footer = element.parentElement?.querySelector<HTMLElement>("[data-subscription-dialog-footer]");
    const lastContent = Array.from(element.children)
      .reverse()
      .find((child): child is HTMLElement => child instanceof HTMLElement && child.offsetParent !== null);

    if (!footer || !lastContent) {
      throw new Error("Missing overlay footer or visible scroll content");
    }

    const footerRect = footer.getBoundingClientRect();
    const contentRect = lastContent.getBoundingClientRect();
    return Math.round((footerRect.top - contentRect.bottom) * 100) / 100;
  });

  expect(gap, `${label}: scroll content to footer gap`).toBeGreaterThanOrEqual(0);
  expect(gap, `${label}: scroll content to footer gap`).toBeLessThanOrEqual(maxGap);
}

export async function expectOverlayLeavesTopScrim(
  page: Page,
  overlay: Locator,
  label: string,
  minScrim = 40,
) {
  const box = await getRequiredLocatorBoundingBox(overlay, label);
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("Missing viewport size");
  }

  expect(box.y, `${label}: visible top scrim`).toBeGreaterThanOrEqual(minScrim);
  expect(box.height, `${label}: not full viewport height`).toBeLessThanOrEqual(viewport.height - minScrim);
}

export function expectStableLayout(before: LayoutSnapshot, after: LayoutSnapshot, label: string) {
  // 允许 1px 内的浏览器亚像素差异，但不允许 scroll lock 引起整列横向漂移。
  expect(Math.abs(after.header.x - before.header.x), `${label}: header x offset`).toBeLessThan(1);
  expect(Math.abs(after.content.x - before.content.x), `${label}: main content x offset`).toBeLessThan(1);

  if (before.saveButton && after.saveButton) {
    expect(Math.abs(after.saveButton.x - before.saveButton.x), `${label}: fixed save button x offset`).toBeLessThan(1);
  }
}
