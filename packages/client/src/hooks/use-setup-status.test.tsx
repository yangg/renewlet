import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSetupStatus } from "./use-setup-status";

describe("useSetupStatus app status", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads setup and demo capability from the app status endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        setupRequired: false,
        setupEnabled: false,
        demoMode: true,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSetupStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/app/status", expect.objectContaining({
      cache: "no-store",
      credentials: "include",
    }));
    expect(result.current).toMatchObject({
      setupRequired: false,
      setupEnabled: false,
      demoMode: true,
    });
  });

  it("falls back to hidden setup and non-demo status when the payload is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        setupRequired: true,
        setupEnabled: false,
      }),
    }));

    const { result } = renderHook(() => useSetupStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current).toMatchObject({
      setupRequired: false,
      setupEnabled: true,
      demoMode: false,
    });
  });
});
