import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  createSubscription,
  openAddSubscriptionDialog,
  openSubscriptionEditDialog,
  uniqueE2EName,
} from "./support/subscriptions";
import {
  expectActionNearContainerBottom,
  expectNoHorizontalOverflow,
  expectOverlayLeavesTopScrim,
  expectScrollContentNearFooter,
  expectTouchTarget,
  getRequiredLocatorBoundingBox,
} from "./support/layout";
import {
  fillChangedTestPhone,
  getSettingsDiscardButton,
  getSettingsSaveButton,
  gotoSettingsAfterHydration,
} from "./support/settings";

async function expectPanelInsideViewport(page: Page, locatorLabel: string) {
  const panel = page.getByRole("dialog").first();
  await expectLocatorInsideViewport(page, panel, locatorLabel);
}

async function expectLocatorInsideViewport(page: Page, locator: Locator, locatorLabel: string) {
  const box = await getRequiredLocatorBoundingBox(locator, locatorLabel);
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("Missing viewport size");
  }

  expect(box.x, `${locatorLabel}: left edge`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${locatorLabel}: top edge`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${locatorLabel}: right edge`).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height, `${locatorLabel}: bottom edge`).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectSheetAnimationFromBottom(sheet: Locator, label: string) {
  const animationName = await sheet.evaluate((element) => window.getComputedStyle(element).animationName);
  expect(animationName, `${label}: animation`).toContain("h5-mobile-sheet-in");
}

async function waitForSheetAnimation(sheet: Locator) {
  await sheet.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  });
}

async function captureSearchableSheetListMetrics(sheet: Locator, optionLabel: string) {
  return sheet.evaluate((element, label) => {
    const list = element.querySelector<HTMLElement>("[cmdk-list]");
    const option = Array.from(element.querySelectorAll<HTMLElement>("[cmdk-item]"))
      .find((item) => item.textContent?.includes(label));
    if (!list || !option) {
      throw new Error(`Missing searchable sheet list or option: ${label}`);
    }

    const probe = element.ownerDocument.createElement("span");
    probe.style.color = "hsl(var(--foreground))";
    element.ownerDocument.body.append(probe);
    const foregroundColor = window.getComputedStyle(probe).color;
    probe.remove();

    return {
      sheetHeight: Math.round(element.getBoundingClientRect().height),
      listHeight: Math.round(list.getBoundingClientRect().height),
      optionColor: window.getComputedStyle(option).color,
      optionOpacity: window.getComputedStyle(option).opacity,
      foregroundColor,
      dataDisabled: option.getAttribute("data-disabled"),
      ariaDisabled: option.getAttribute("aria-disabled"),
    };
  }, optionLabel);
}

async function tapMobileSheetBackdrop(page: Page) {
  const backdrop = page.locator("[data-mobile-overlay-backdrop]").last();
  await expect(backdrop).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-mobile-overlay-open", "");
  await backdrop.click({ position: { x: 12, y: 12 } });
}

test.describe("public H5 chrome", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("login and setup routes keep native mobile viewport constraints", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 640 });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();

    const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewportMeta).toContain("viewport-fit=cover");
    expect(viewportMeta).toContain("interactive-widget=resizes-content");
    await expectNoHorizontalOverflow(page, "mobile login");
    await expect(page.getByLabel("邮箱")).toHaveAttribute("inputmode", "email");
    await expect(page.getByLabel("邮箱")).toHaveAttribute("enterkeyhint", "next");
    await expect(page.getByLabel("密码", { exact: true })).toHaveAttribute("enterkeyhint", "done");
    await expectTouchTarget(page.getByRole("button", { name: "登录" }), "login submit");

    await page.goto("/setup");
    await expectNoHorizontalOverflow(page, "mobile setup completed state");
  });
});

test("core authenticated H5 pages do not create horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });

  const routes = [
    { path: "/", label: "dashboard" },
    { path: "/subscriptions", label: "subscriptions" },
    { path: "/calendar", label: "calendar" },
    { path: "/statistics", label: "statistics" },
    { path: "/settings", label: "settings" },
  ] as const;

  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.getByTestId("app-header")).toBeVisible();
    await expectNoHorizontalOverflow(page, `mobile ${route.label}`);
  }
});

test("short H5 viewport keeps dialogs and bottom actions operable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 560 });

  await page.goto("/subscriptions");
  const subscriptionDialog = await openAddSubscriptionDialog(page);
  await expectPanelInsideViewport(page, "subscription dialog");
  await expectNoHorizontalOverflow(page, "mobile subscription dialog");
  await expectTouchTarget(subscriptionDialog.getByRole("button", { name: "取消" }), "subscription dialog cancel");
  await expectTouchTarget(subscriptionDialog.getByRole("button", { name: "添加订阅" }), "subscription dialog submit");
  await expectActionNearContainerBottom(
    subscriptionDialog,
    subscriptionDialog.getByRole("button", { name: "添加订阅" }),
    "mobile subscription dialog submit",
  );
  await expectScrollContentNearFooter(
    subscriptionDialog.locator("[data-subscription-dialog-scroll]"),
    "mobile subscription dialog scroll end",
  );
  await subscriptionDialog.getByRole("button", { name: "取消" }).click();
  await expect(subscriptionDialog).toBeHidden();

  await gotoSettingsAfterHydration(page);
  const testPhoneInput = page.getByLabel("第三方 API 测试号码", { exact: true });
  await fillChangedTestPhone(testPhoneInput);
  const saveButton = getSettingsSaveButton(page);
  const discardButton = getSettingsDiscardButton(page);
  await expect(saveButton).toBeVisible();
  await expect(discardButton).toBeVisible();
  await expectTouchTarget(saveButton, "settings save button");
  await expectTouchTarget(discardButton, "settings discard button");
  await expectNoHorizontalOverflow(page, "mobile settings bottom bar");
});

test("mobile sheets keep Logo and currency search stable while typing", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 640 });

  const subscriptionName = uniqueE2EName(testInfo, "Mobile Overlay");
  await page.goto("/subscriptions");
  await createSubscription(page, {
    name: subscriptionName,
    price: "16",
    currencyLabel: "美元 ($)",
  });

  const editDialog = await openSubscriptionEditDialog(page, subscriptionName);
  await editDialog.getByRole("button", { name: "搜索" }).click();

  const logoSheet = page.getByTestId("logo-search-sheet");
  await expect(logoSheet).toBeVisible();
  await expect(logoSheet).toHaveClass(/h5-mobile-sheet-content/);
  await waitForSheetAnimation(logoSheet);
  await expectLocatorInsideViewport(page, logoSheet, "mobile logo search sheet");
  await expectNoHorizontalOverflow(page, "mobile logo search sheet");

  const logoSearchInput = logoSheet.getByPlaceholder("输入服务名称或品牌...");
  await logoSearchInput.fill("Linear");
  await logoSearchInput.press("Enter");
  await expect(logoSearchInput).toHaveValue("Linear");
  await expect(logoSheet.getByTitle("Linear").first()).toBeVisible({ timeout: 10_000 });
  await expectLocatorInsideViewport(page, logoSheet, "mobile logo search sheet after input");

  await logoSheet.getByTitle("Linear").first().click();
  await expect(logoSheet).toBeHidden();

  const rootScrollBefore = await page.evaluate(() => document.getElementById("root")?.scrollTop ?? 0);
  await editDialog.getByRole("combobox", { name: "选择货币" }).click();
  const currencySheet = page.getByTestId("searchable-select-sheet");
  await expect(currencySheet).toBeVisible();
  await expect(currencySheet).toHaveClass(/h5-mobile-sheet-content/);
  await waitForSheetAnimation(currencySheet);
  await expectLocatorInsideViewport(page, currencySheet, "mobile currency sheet");
  const currencySheetBeforeFilter = await captureSearchableSheetListMetrics(currencySheet, "美元 ($)");

  const bodyScrollLocked = await page.evaluate(() => document.body.hasAttribute("data-scroll-locked"));
  expect(bodyScrollLocked).toBe(true);
  await currencySheet.getByPlaceholder("搜索货币、代码或符号...").fill("USD");
  await expect(currencySheet.getByText("美元 ($)", { exact: true })).toBeVisible();
  const currencySheetAfterFilter = await captureSearchableSheetListMetrics(currencySheet, "美元 ($)");
  expect(
    Math.abs(currencySheetAfterFilter.sheetHeight - currencySheetBeforeFilter.sheetHeight),
    "searchable sheet height should stay stable while filtering",
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(currencySheetAfterFilter.listHeight - currencySheetBeforeFilter.listHeight),
    "searchable sheet list height should stay stable while filtering",
  ).toBeLessThanOrEqual(1);
  expect(currencySheetAfterFilter.optionColor, "enabled searchable option text color").toBe(
    currencySheetAfterFilter.foregroundColor,
  );
  expect(currencySheetAfterFilter.optionOpacity, "enabled searchable option opacity").toBe("1");
  expect(currencySheetAfterFilter.dataDisabled, "enabled searchable option data-disabled").not.toBe("true");
  expect(currencySheetAfterFilter.ariaDisabled, "enabled searchable option aria-disabled").not.toBe("true");
  await page.mouse.wheel(0, 600);
  const rootScrollAfter = await page.evaluate(() => document.getElementById("root")?.scrollTop ?? 0);
  expect(rootScrollAfter, "root scroll should stay locked behind mobile currency sheet").toBe(rootScrollBefore);

  await currencySheet.getByText("美元 ($)", { exact: true }).click();
  await expect(currencySheet).toBeHidden();
  await editDialog.getByRole("button", { name: "取消" }).click();
  await expect(editDialog).toBeHidden();
});

test("mobile option sheets use consistent detents and do not leak backdrop events", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });

  await gotoSettingsAfterHydration(page);
  await page.getByRole("combobox", { name: "语言" }).click();
  const languageSheet = page.locator(".h5-mobile-sheet-content").filter({ hasText: "English" }).last();
  await expect(languageSheet).toBeVisible();
  await expect(languageSheet).toHaveAttribute("data-mobile-detent", "compact");
  await expectSheetAnimationFromBottom(languageSheet, "language compact sheet");
  const languageSheetBox = await getRequiredLocatorBoundingBox(languageSheet, "language compact sheet");
  expect(languageSheetBox.height, "language compact sheet should not collapse to a tiny strip").toBeGreaterThan(180);
  await page.keyboard.press("Escape");
  await expect(languageSheet).toBeHidden();

  await page.goto("/subscriptions");
  await page.getByRole("combobox").filter({ hasText: "所有分类" }).click();
  const categorySheet = page.locator(".h5-mobile-sheet-content").filter({ hasText: "AI 工具" }).last();
  await expect(categorySheet).toBeVisible();
  await expect(categorySheet).toHaveAttribute("data-mobile-detent", "large");
  await waitForSheetAnimation(categorySheet);
  await expectOverlayLeavesTopScrim(page, categorySheet, "category large sheet");
  await expectLocatorInsideViewport(page, categorySheet, "category large sheet");
  await expectNoHorizontalOverflow(page, "category large sheet");
  await page.keyboard.press("Escape");
  await expect(categorySheet).toBeHidden();

  const dialog = await openAddSubscriptionDialog(page);
  const statusTrigger = dialog.getByRole("combobox").filter({ hasText: "活跃" });
  await statusTrigger.scrollIntoViewIfNeeded();
  await statusTrigger.click();
  const statusSheet = page.locator(".h5-mobile-sheet-content").filter({ hasText: "活跃" }).last();
  await expect(statusSheet).toBeVisible();
  await tapMobileSheetBackdrop(page);
  await expect(statusSheet).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(page.locator(".h5-mobile-sheet-content")).toHaveCount(0);

  const paymentTrigger = dialog.getByRole("combobox").filter({ hasText: "选择支付方式" });
  await paymentTrigger.scrollIntoViewIfNeeded();
  await paymentTrigger.click();
  const paymentSheet = page.locator(".h5-mobile-sheet-content").filter({ hasText: "支付宝" }).last();
  await expect(paymentSheet).toBeVisible();
  await tapMobileSheetBackdrop(page);
  await expect(paymentSheet).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(page.locator(".h5-mobile-sheet-content")).toHaveCount(0);

  const reminderTrigger = dialog.getByRole("combobox").filter({ hasText: "提前 3 天" });
  await reminderTrigger.scrollIntoViewIfNeeded();
  await reminderTrigger.click();
  const reminderSheet = page.locator(".h5-mobile-sheet-content").filter({ hasText: "自定义天数" }).last();
  await expect(reminderSheet).toBeVisible();
  await tapMobileSheetBackdrop(page);
  await expect(reminderSheet).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(page.locator(".h5-mobile-sheet-content")).toHaveCount(0);

  await dialog.getByText("日期设置").scrollIntoViewIfNeeded();
  await dialog.getByRole("button", { name: /选择日期/ }).first().click();
  const calendarSheet = page.locator(".h5-mobile-sheet-calendar").last();
  await expect(calendarSheet).toBeVisible();
  await expect(calendarSheet.getByRole("grid")).toBeVisible();
  const calendarGrid = await calendarSheet.evaluate((element) => {
    const sheetRect = element.getBoundingClientRect();
    const firstWeek = element.querySelector<HTMLElement>(".h5-calendar-week");
    if (!firstWeek) {
      throw new Error("Missing mobile calendar week");
    }
    const cells = Array.from(firstWeek.querySelectorAll<HTMLElement>(".h5-calendar-day"));
    if (cells.length !== 7) {
      throw new Error(`Expected 7 calendar cells, got ${cells.length}`);
    }
    const firstCell = cells[0].getBoundingClientRect();
    const lastCell = cells[6].getBoundingClientRect();
    return {
      leftInset: Math.round(firstCell.left - sheetRect.left),
      rightInset: Math.round(sheetRect.right - lastCell.right),
    };
  });
  expect(calendarGrid.rightInset, "calendar should not leave a large blank area on the right").toBeLessThan(48);
  expect(calendarGrid.leftInset, "calendar should keep normal left padding").toBeLessThan(48);
  await calendarSheet.locator(".h5-calendar-day-button:not([disabled])").filter({ hasText: /^18$/ }).first().click();
  await expect(calendarSheet).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toBeHidden();
});
