import { useEffect } from "react";

const APP_VIEWPORT_HEIGHT_VAR = "--app-viewport-height";

export function ViewportHeightSync() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;

    const writeViewportHeight = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const visualHeight = viewport?.height ?? window.innerHeight;
        const height = Math.min(visualHeight, window.innerHeight);
        root.style.setProperty(APP_VIEWPORT_HEIGHT_VAR, `${Math.round(height)}px`);
      });
    };

    writeViewportHeight();

    // iOS/Android 键盘会改变 visual viewport，但不一定触发 CSS dvh 重新计算。
    // 部分模拟器会给出大于 layout viewport 的 visualViewport.height，所以这里取较小值，
    // 让底部 sheet、Dialog 和页面滚动容器消费同一条保守高度边界。
    viewport?.addEventListener("resize", writeViewportHeight);
    viewport?.addEventListener("scroll", writeViewportHeight);
    window.addEventListener("resize", writeViewportHeight);
    window.addEventListener("orientationchange", writeViewportHeight);

    return () => {
      window.cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", writeViewportHeight);
      viewport?.removeEventListener("scroll", writeViewportHeight);
      window.removeEventListener("resize", writeViewportHeight);
      window.removeEventListener("orientationchange", writeViewportHeight);
      root.style.removeProperty(APP_VIEWPORT_HEIGHT_VAR);
    };
  }, []);

  return null;
}
