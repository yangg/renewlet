package main

// 系统更新测试保护 Docker 页面内自更新的 Release 选择、checksum、备份恢复和 pending restart 状态机。
// fake client 隔离 GitHub 网络，重点锁住 /renewlet 稳定入口与 current 二进制替换契约。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type fakeSystemReleaseClient struct {
	release     *systemRelease
	releases    []systemRelease
	fetchDelay  time.Duration
	fetchCount  int32
	probeCount  int32
	downloadFn  func(targetPath string) error
	checksumTxt []byte
	probeAssets []systemReleaseAsset
}

func (client *fakeSystemReleaseClient) FetchReleases(ctx context.Context) ([]systemRelease, error) {
	atomic.AddInt32(&client.fetchCount, 1)
	if client.fetchDelay > 0 {
		select {
		case <-time.After(client.fetchDelay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if client.releases != nil {
		return append([]systemRelease(nil), client.releases...), nil
	}
	if client.release == nil {
		return nil, errors.New("missing release")
	}
	return []systemRelease{*client.release}, nil
}

func (client *fakeSystemReleaseClient) ProbeReleaseAssets(_ context.Context, _ string, _ string) []systemReleaseAsset {
	atomic.AddInt32(&client.probeCount, 1)
	if client.probeAssets != nil {
		return append([]systemReleaseAsset(nil), client.probeAssets...)
	}
	return nil
}

func (client *fakeSystemReleaseClient) DownloadFile(_ context.Context, _ string, targetPath string, _ int64) error {
	if client.downloadFn != nil {
		return client.downloadFn(targetPath)
	}
	return errors.New("download not configured")
}

func (client *fakeSystemReleaseClient) FetchText(_ context.Context, _ string, _ int64) ([]byte, error) {
	return client.checksumTxt, nil
}

func TestSystemVersionComparison(t *testing.T) {
	cases := []struct {
		name    string
		current string
		latest  string
		want    bool
	}{
		{name: "patch update", current: "0.1.0", latest: "0.1.1", want: true},
		{name: "minor update", current: "0.1.9", latest: "0.2.0", want: true},
		{name: "equal stable", current: "0.1.0", latest: "0.1.0", want: false},
		{name: "ignore latest prerelease", current: "0.1.0", latest: "0.2.0-rc.1", want: false},
		{name: "stable channel ignores current prerelease", current: "0.2.0-rc.1", latest: "0.2.0", want: false},
		{name: "invalid current is not updateable", current: "dev", latest: "0.2.0", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isNewerSystemVersion(tc.current, tc.latest); got != tc.want {
				t.Fatalf("isNewerSystemVersion(%q, %q) = %v, want %v", tc.current, tc.latest, got, tc.want)
			}
		})
	}
}

func TestSystemRCVersionComparison(t *testing.T) {
	cases := []struct {
		name    string
		current string
		latest  string
		want    bool
	}{
		{name: "same base rc increment", current: "0.1.0-rc.1", latest: "0.1.0-rc.2", want: true},
		{name: "cross base rc increment", current: "0.1.0-rc.1", latest: "0.2.0-rc.1", want: true},
		{name: "older rc rejected", current: "0.1.0-rc.2", latest: "0.1.0-rc.1", want: false},
		{name: "stable target rejected", current: "0.1.0-rc.1", latest: "0.1.0", want: false},
		{name: "stable current rejected", current: "0.1.0", latest: "0.2.0-rc.1", want: false},
		{name: "invalid rc suffix rejected", current: "0.1.0-rc.1", latest: "0.2.0-beta.1", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isNewerSystemRCVersion(tc.current, tc.latest); got != tc.want {
				t.Fatalf("isNewerSystemRCVersion(%q, %q) = %v, want %v", tc.current, tc.latest, got, tc.want)
			}
		})
	}
}

func TestSelectSystemUpdateAssets(t *testing.T) {
	archiveName := systemArchiveName("1.2.3")
	archive, checksum, err := selectSystemUpdateAssets([]systemReleaseAsset{
		{Name: archiveName, BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v1.2.3/" + archiveName},
		{Name: "checksums.txt", BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v1.2.3/checksums.txt"},
	}, "1.2.3")
	if err != nil {
		t.Fatal(err)
	}
	if archive.Name != archiveName || checksum.Name != "checksums.txt" {
		t.Fatalf("unexpected assets: %#v %#v", archive, checksum)
	}
}

func TestSystemReleaseAssetProbeUsesDeterministicReleaseURLs(t *testing.T) {
	archiveName := systemArchiveName("1.2.3")
	seen := map[string]*http.Request{}
	client := &httpSystemReleaseClient{
		downloadClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			seen[request.URL.Path] = request
			if request.Method != http.MethodHead {
				t.Fatalf("method = %s, want HEAD", request.Method)
			}
			if got := request.Header.Get("Authorization"); got != "" {
				t.Fatalf("Authorization = %q", got)
			}
			status := http.StatusOK
			size := int64(123)
			if strings.HasSuffix(request.URL.Path, "/checksums.txt") {
				size = 45
			}
			return &http.Response{
				StatusCode:    status,
				Status:        "200 OK",
				Header:        make(http.Header),
				ContentLength: size,
				Body:          io.NopCloser(strings.NewReader("")),
				Request:       request,
			}, nil
		})},
	}

	assets := client.ProbeReleaseAssets(context.Background(), "v1.2.3", "1.2.3")
	if len(assets) != 2 {
		t.Fatalf("assets = %#v, want 2 assets", assets)
	}
	if assets[0].Name != archiveName || assets[0].Size != 123 {
		t.Fatalf("archive asset = %#v", assets[0])
	}
	if assets[1].Name != "checksums.txt" || assets[1].Size != 45 {
		t.Fatalf("checksum asset = %#v", assets[1])
	}
	if seen["/zhiyingzzhou/renewlet/releases/download/v1.2.3/"+archiveName] == nil || seen["/zhiyingzzhou/renewlet/releases/download/v1.2.3/checksums.txt"] == nil {
		t.Fatalf("unexpected probed paths: %#v", seen)
	}
}

func TestSystemReleaseAssetProbeOmitsMissingAssets(t *testing.T) {
	client := &httpSystemReleaseClient{
		downloadClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			status := http.StatusOK
			if strings.HasSuffix(request.URL.Path, "/checksums.txt") {
				status = http.StatusNotFound
			}
			return &http.Response{
				StatusCode: status,
				Status:     fmt.Sprintf("%d", status),
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader("")),
				Request:    request,
			}, nil
		})},
	}

	assets := client.ProbeReleaseAssets(context.Background(), "v1.2.3", "1.2.3")
	if len(assets) != 1 || assets[0].Name != systemArchiveName("1.2.3") {
		t.Fatalf("assets = %#v, want only archive asset", assets)
	}
}

func TestGitHubReleaseFeedRequestUsesAtomWithoutAuthorization(t *testing.T) {
	var captured *http.Request
	client := &httpSystemReleaseClient{
		metadataClient: &http.Client{
			Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
				captured = request
				return &http.Response{
					StatusCode: http.StatusOK,
					Status:     "200 OK",
					Header:     make(http.Header),
					Body:       io.NopCloser(strings.NewReader(systemReleaseAtomFixture("v1.2.3", "2026-05-27T00:00:00Z"))),
				}, nil
			}),
		},
	}
	releases, err := client.FetchReleases(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if captured == nil {
		t.Fatal("expected request to be captured")
	}
	if captured.URL.Host != "github.com" || captured.URL.Path != "/zhiyingzzhou/renewlet/releases.atom" {
		t.Fatalf("request URL = %s", captured.URL.String())
	}
	if got := captured.Header.Get("Accept"); got != "application/atom+xml" {
		t.Fatalf("Accept = %q", got)
	}
	if got := captured.Header.Get("X-GitHub-Api-Version"); got != "" {
		t.Fatalf("X-GitHub-Api-Version = %q", got)
	}
	if got := captured.Header.Get("User-Agent"); got == "" || !strings.HasPrefix(got, "Renewlet/") {
		t.Fatalf("User-Agent = %q", got)
	}
	if got := captured.Header.Get("Authorization"); got != "" {
		t.Fatalf("Authorization = %q", got)
	}
	if len(releases) != 1 || releases[0].TagName != "v1.2.3" || releases[0].Body == "" {
		t.Fatalf("unexpected parsed releases: %#v", releases)
	}
}

func TestSystemVersionWarningDoesNotExposeGitHubStatus(t *testing.T) {
	service := newSystemUpdateService(&fakeSystemReleaseClient{})
	service.now = func() time.Time { return time.Unix(1_779_820_800, 0) }
	warning := service.versionCheckWarning(localeZhCN, &systemReleaseCheckError{
		statusCode: http.StatusForbidden,
		status:     "403 Forbidden",
	})

	if strings.Contains(warning, "403") || strings.Contains(warning, "Forbidden") {
		t.Fatalf("warning leaked HTTP status: %q", warning)
	}
	if strings.Contains(strings.ToLower(warning), "token") || strings.Contains(warning, "API") {
		t.Fatalf("warning should not mention REST/token fallback, got %q", warning)
	}
}

func TestSystemVersionFailureIncludesOneShotUpstreamDetailsWithoutCachingRawBody(t *testing.T) {
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "0.1.0", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	service := newSystemUpdateService(&fakeSystemReleaseClient{release: &systemRelease{
		TagName:     "v0.1.0",
		Name:        "Renewlet 0.1.0",
		PublishedAt: "2026-06-04T00:00:00Z",
		HTMLURL:     "https://github.com/zhiyingzzhou/renewlet/releases/tag/v0.1.0",
		Assets:      []systemReleaseAsset{},
	}})
	service.now = func() time.Time { return time.Unix(1_779_820_800, 0) }
	if _, err := service.CheckVersion(context.Background(), localeZhCN, true); err != nil {
		t.Fatal(err)
	}

	service.client = &httpSystemReleaseClient{
		metadataClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusForbidden,
				Status:     "403 Forbidden",
				Header:     http.Header{"Content-Type": []string{"text/plain"}},
				Body:       io.NopCloser(strings.NewReader("release feed unavailable")),
				Request:    request,
			}, nil
		})},
	}

	failed, err := service.CheckVersion(context.Background(), localeZhCN, true)
	if err != nil {
		t.Fatal(err)
	}
	if failed.ErrorDetails == nil || failed.ErrorDetails.RawResponseText == nil {
		t.Fatalf("expected one-shot upstream details, got %#v", failed.ErrorDetails)
	}
	if *failed.ErrorDetails.RawResponseText != "release feed unavailable" {
		t.Fatalf("expected redacted upstream body, got %#v", failed.ErrorDetails.RawResponseText)
	}
	if payload, _ := json.Marshal(failed.ErrorDetails); strings.Contains(string(payload), "Authorization") {
		t.Fatalf("upstream details leaked request metadata: %s", payload)
	}

	cached, err := service.CheckVersion(context.Background(), localeZhCN, false)
	if err != nil {
		t.Fatal(err)
	}
	if cached.ErrorDetails != nil {
		t.Fatalf("cached version response must not keep raw upstream details: %#v", cached.ErrorDetails)
	}
}

func TestSelfUpdateCapabilityMatrix(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("self-update capability matrix depends on linux Docker binary semantics")
	}

	oldVersion, oldBuildType := Version, BuildType
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	cases := []struct {
		name           string
		buildType      string
		enabled        string
		writeBinary    bool
		wantDeployment string
		wantMode       string
		wantSupported  bool
		wantReasonPart string
	}{
		{
			name:           "docker release supports in-app binary update",
			buildType:      "release",
			enabled:        "true",
			writeBinary:    true,
			wantDeployment: "docker",
			wantMode:       "in-app-binary",
			wantSupported:  true,
		},
		{
			name:           "docker release with self update disabled falls back to compose",
			buildType:      "release",
			enabled:        "false",
			writeBinary:    true,
			wantDeployment: "docker",
			wantMode:       "docker-compose",
			wantSupported:  false,
			wantReasonPart: "RENEWLET_SELF_UPDATE_ENABLED=false",
		},
		{
			name:           "old docker bridge cannot replace container binary",
			buildType:      "release",
			enabled:        "true",
			writeBinary:    false,
			wantDeployment: "docker",
			wantMode:       "docker-compose",
			wantSupported:  false,
			wantReasonPart: "docker compose pull",
		},
		{
			name:           "non release source build stays manual",
			buildType:      "source",
			enabled:        "true",
			writeBinary:    true,
			wantDeployment: "source",
			wantMode:       "source-manual",
			wantSupported:  false,
			wantReasonPart: "Release",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tempDir := t.TempDir()
			binaryPath := filepath.Join(tempDir, "renewlet")
			if tc.writeBinary {
				if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
					t.Fatal(err)
				}
			}
			t.Setenv("RENEWLET_SELF_UPDATE_ENABLED", tc.enabled)
			t.Setenv("RENEWLET_SELF_UPDATE_BINARY", binaryPath)
			t.Setenv("RENEWLET_SELF_UPDATE_BACKUP_DIR", filepath.Join(tempDir, "backups"))
			Version, BuildType = "1.0.0", tc.buildType

			got := selfUpdateCapability(localeZhCN)
			if got.deployment != tc.wantDeployment {
				t.Fatalf("deployment = %q, want %q", got.deployment, tc.wantDeployment)
			}
			if got.updateMode != tc.wantMode {
				t.Fatalf("updateMode = %q, want %q", got.updateMode, tc.wantMode)
			}
			if got.supported != tc.wantSupported {
				t.Fatalf("supported = %v, want %v", got.supported, tc.wantSupported)
			}
			if tc.wantReasonPart != "" && !strings.Contains(got.unsupportedReason, tc.wantReasonPart) {
				t.Fatalf("unsupportedReason = %q, want to contain %q", got.unsupportedReason, tc.wantReasonPart)
			}
		})
	}
}

func TestStableVersionSkipsRCEntriesFromFeed(t *testing.T) {
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "0.1.0", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	client := &fakeSystemReleaseClient{release: &systemRelease{
		TagName: "v0.2.0-rc.1",
	}}
	service := newSystemUpdateService(client)

	response, err := service.CheckVersion(context.Background(), localeZhCN, true)
	if err != nil {
		t.Fatal(err)
	}
	if got := atomic.LoadInt32(&client.fetchCount); got != 1 {
		t.Fatalf("FetchReleases calls = %d, want 1", got)
	}
	if !response.CheckSucceeded || response.HasUpdate {
		t.Fatalf("stable version should not accept prerelease target: %#v", response)
	}
}

func TestStableVersionSelectsLatestStableReleaseFromFeed(t *testing.T) {
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "0.1.0", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	client := &fakeSystemReleaseClient{releases: []systemRelease{
		releaseFixture("v0.2.0-rc.1"),
		releaseFixture("v0.1.1"),
	}}
	service := newSystemUpdateService(client)

	response, err := service.CheckVersion(context.Background(), localeZhCN, true)
	if err != nil {
		t.Fatal(err)
	}
	if !response.CheckSucceeded || !response.HasUpdate {
		t.Fatalf("expected stable update from feed, got %#v", response)
	}
	if response.LatestVersion != "0.1.1" {
		t.Fatalf("latestVersion = %q, want 0.1.1", response.LatestVersion)
	}
}

func TestRCVersionSelectsHighestNewerRC(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("self-update capability depends on linux Docker binary semantics")
	}
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "renewlet")
	if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RENEWLET_SELF_UPDATE_ENABLED", "true")
	t.Setenv("RENEWLET_SELF_UPDATE_BINARY", binaryPath)
	t.Setenv("RENEWLET_SELF_UPDATE_BACKUP_DIR", filepath.Join(tempDir, "backups"))
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "0.1.0-rc.1", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	client := &fakeSystemReleaseClient{releases: []systemRelease{
		releaseFixture("v0.1.0"),
		releaseFixture("v0.1.0-rc.2"),
		releaseFixture("v0.2.0-rc.1"),
		releaseFixture("v0.2.0-beta.1"),
		releaseFixture("v0.1.0-rc.1"),
	}}
	service := newSystemUpdateService(client)

	response, err := service.CheckVersion(context.Background(), localeZhCN, true)
	if err != nil {
		t.Fatal(err)
	}
	if got := atomic.LoadInt32(&client.fetchCount); got != 1 {
		t.Fatalf("FetchReleases should be used for rc versions")
	}
	if !response.CheckSucceeded || !response.HasUpdate {
		t.Fatalf("expected rc version update, got %#v", response)
	}
	if !response.UpdateSupported {
		t.Fatalf("expected rc version update to be installable, got %#v", response)
	}
	if response.LatestVersion != "0.2.0-rc.1" {
		t.Fatalf("latestVersion = %q, want 0.2.0-rc.1", response.LatestVersion)
	}
}

func TestSystemVersionReleaseAssetsStayArrayWhenEmpty(t *testing.T) {
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "0.1.0-rc.1", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})
	t.Setenv("RENEWLET_SELF_UPDATE_ENABLED", "false")

	service := newSystemUpdateService(&fakeSystemReleaseClient{releases: []systemRelease{
		{
			TagName:     "v0.1.0-rc.2",
			Name:        "Renewlet 0.1.0-rc.2",
			PublishedAt: "2026-06-04T00:00:00Z",
			HTMLURL:     "https://github.com/zhiyingzzhou/renewlet/releases/tag/v0.1.0-rc.2",
			Assets:      nil,
		},
	}})

	first, err := service.CheckVersion(context.Background(), localeZhCN, true)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.CheckVersion(context.Background(), localeZhCN, false)
	if err != nil {
		t.Fatal(err)
	}
	for name, response := range map[string]*systemVersionResponse{"force": first, "cached": second} {
		payload, err := json.Marshal(response)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(payload), `"assets":[]`) {
			t.Fatalf("%s response JSON = %s, want releaseInfo.assets as []", name, payload)
		}
		if strings.Contains(string(payload), `"assets":null`) {
			t.Fatalf("%s response JSON = %s, must not encode assets as null", name, payload)
		}
	}
	if !second.Cached {
		t.Fatal("second check should come from cache")
	}
}

func TestSystemVersionDisablesInAppUpdateWhenReleaseAssetsMissing(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("self-update capability depends on linux Docker binary semantics")
	}
	oldVersion, oldBuildType := Version, BuildType
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	cases := []struct {
		name           string
		assets         []systemReleaseAsset
		wantReasonPart string
	}{
		{
			name:           "missing platform archive",
			assets:         []systemReleaseAsset{{Name: "renewlet-docker-v0.1.0-rc.2.zip"}},
			wantReasonPart: systemArchiveName("0.1.0-rc.2"),
		},
		{
			name:           "missing checksums",
			assets:         []systemReleaseAsset{{Name: systemArchiveName("0.1.0-rc.2")}},
			wantReasonPart: "checksums.txt",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tempDir := t.TempDir()
			binaryPath := filepath.Join(tempDir, "renewlet")
			if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
				t.Fatal(err)
			}
			t.Setenv("RENEWLET_SELF_UPDATE_ENABLED", "true")
			t.Setenv("RENEWLET_SELF_UPDATE_BINARY", binaryPath)
			t.Setenv("RENEWLET_SELF_UPDATE_BACKUP_DIR", filepath.Join(tempDir, "backups"))
			Version, BuildType = "0.1.0-rc.1", "release"

			service := newSystemUpdateService(&fakeSystemReleaseClient{releases: []systemRelease{
				{
					TagName: "v0.1.0-rc.2",
					Name:    "Renewlet 0.1.0-rc.2",
					HTMLURL: "https://github.com/zhiyingzzhou/renewlet/releases/tag/v0.1.0-rc.2",
					Assets:  tc.assets,
				},
			}})

			response, err := service.CheckVersion(context.Background(), localeZhCN, true)
			if err != nil {
				t.Fatal(err)
			}
			if !response.CheckSucceeded || !response.HasUpdate {
				t.Fatalf("expected newer release to be reported, got %#v", response)
			}
			if response.UpdateSupported {
				t.Fatalf("UpdateSupported = true, want false when install asset is missing: %#v", response)
			}
			if !strings.Contains(response.UnsupportedReason, tc.wantReasonPart) {
				t.Fatalf("UnsupportedReason = %q, want to contain %q", response.UnsupportedReason, tc.wantReasonPart)
			}
			if response.ReleaseInfo == nil || response.ReleaseInfo.HTMLURL == "" {
				t.Fatalf("release info should stay available: %#v", response.ReleaseInfo)
			}
		})
	}
}

func TestStableCurrentVersionDoesNotUpdateToRC(t *testing.T) {
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "0.1.0", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	release := releaseFixture("v0.2.0-rc.1")
	service := newSystemUpdateService(&fakeSystemReleaseClient{release: &release})

	response, err := service.CheckVersion(context.Background(), localeZhCN, true)
	if err != nil {
		t.Fatal(err)
	}
	if !response.CheckSucceeded || response.HasUpdate {
		t.Fatalf("stable current version must not update to rc: %#v", response)
	}
}

func TestRCVersionReportsLatestWhenNoNewerCandidateExists(t *testing.T) {
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "0.1.0-rc.1", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	service := newSystemUpdateService(&fakeSystemReleaseClient{releases: []systemRelease{
		releaseFixture("v0.1.0"),
		releaseFixture("v0.1.0-rc.1"),
		releaseFixture("v0.2.0-beta.1"),
	}})

	response, err := service.CheckVersion(context.Background(), localeZhCN, true)
	if err != nil {
		t.Fatal(err)
	}
	if !response.CheckSucceeded || response.HasUpdate {
		t.Fatalf("expected successful rc check without update, got %#v", response)
	}
	if response.Warning != "" {
		t.Fatalf("warning = %q, want empty", response.Warning)
	}
	if response.LatestVersion != "0.1.0-rc.1" {
		t.Fatalf("latestVersion = %q, want current version", response.LatestVersion)
	}
}

func TestRCUpdateWithoutNewerCandidateReturnsAlreadyLatest(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("self-update execution is only supported for linux Docker images")
	}
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "renewlet")
	if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RENEWLET_SELF_UPDATE_ENABLED", "true")
	t.Setenv("RENEWLET_SELF_UPDATE_BINARY", binaryPath)
	t.Setenv("RENEWLET_SELF_UPDATE_BACKUP_DIR", filepath.Join(tempDir, "backups"))
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "0.1.0-rc.1", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	service := newSystemUpdateService(&fakeSystemReleaseClient{releases: []systemRelease{
		releaseFixture("v0.1.0-rc.1"),
		releaseFixture("v0.1.0"),
	}})

	_, err := service.PerformUpdate(context.Background(), localeZhCN)
	if !errors.Is(err, errSystemUpdateNoUpdate) {
		t.Fatalf("PerformUpdate error = %v, want errSystemUpdateNoUpdate", err)
	}
	if err == nil || !strings.Contains(err.Error(), serverText(localeZhCN, "system.alreadyLatest")) {
		t.Fatalf("PerformUpdate error = %v, want already latest message", err)
	}
}

func TestChecksumForArchive(t *testing.T) {
	hash := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	got, err := checksumForArchive("renewlet_1.0.0_linux_amd64.tar.gz", []byte(hash+"  renewlet_1.0.0_linux_amd64.tar.gz\n"))
	if err != nil {
		t.Fatal(err)
	}
	if got != hash {
		t.Fatalf("checksum = %q, want %q", got, hash)
	}
}

func TestExtractRenewletBinaryRejectsPathTraversal(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "bad.tar.gz")
	if err := writeTarGz(archivePath, map[string]string{"../../renewlet": "evil"}); err != nil {
		t.Fatal(err)
	}
	targetPath := filepath.Join(t.TempDir(), "renewlet")
	if err := extractRenewletBinary(archivePath, targetPath); err == nil {
		t.Fatal("expected path traversal archive to be rejected")
	}
}

func TestReplaceRenewletBinaryRestoresOnFailure(t *testing.T) {
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "renewlet")
	backupDir := filepath.Join(tempDir, "backups")
	newBinaryPath := filepath.Join(t.TempDir(), "missing-renewlet")
	if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := replaceRenewletBinary(binaryPath, backupDir, newBinaryPath, "1.0.0"); err == nil {
		t.Fatal("expected replace to fail")
	}
	content, err := os.ReadFile(binaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "old" {
		t.Fatalf("binary content = %q, want old", string(content))
	}
}

func TestSystemUpdateRejectsConcurrentRun(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("self-update execution is only supported for linux Docker images")
	}
	release := &systemRelease{
		TagName: "v9.9.9",
		Assets: []systemReleaseAsset{
			{Name: systemArchiveName("9.9.9"), BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v9.9.9/" + systemArchiveName("9.9.9")},
			{Name: "checksums.txt", BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v9.9.9/checksums.txt"},
		},
	}
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "renewlet")
	if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RENEWLET_SELF_UPDATE_ENABLED", "true")
	t.Setenv("RENEWLET_SELF_UPDATE_BINARY", binaryPath)
	t.Setenv("RENEWLET_SELF_UPDATE_BACKUP_DIR", filepath.Join(tempDir, "backups"))
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "1.0.0", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	client := &fakeSystemReleaseClient{release: release, fetchDelay: 200 * time.Millisecond}
	service := newSystemUpdateService(client)
	service.downloadFnForTest("renewlet-new")

	errCh := make(chan error, 2)
	go func() {
		_, err := service.PerformUpdate(context.Background(), localeZhCN)
		errCh <- err
	}()
	time.Sleep(20 * time.Millisecond)
	go func() {
		_, err := service.PerformUpdate(context.Background(), localeZhCN)
		errCh <- err
	}()

	first := <-errCh
	second := <-errCh
	if !(errors.Is(first, errSystemUpdateInProgress) || errors.Is(second, errSystemUpdateInProgress)) {
		t.Fatalf("expected one concurrent update error, got %v and %v", first, second)
	}
}

func TestSystemUpdateWaitsForExplicitRestart(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("self-update execution is only supported for linux Docker images")
	}
	release := &systemRelease{
		TagName: "v9.9.9",
		Assets: []systemReleaseAsset{
			{Name: systemArchiveName("9.9.9"), BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v9.9.9/" + systemArchiveName("9.9.9")},
			{Name: "checksums.txt", BrowserDownloadURL: "https://github.com/zhiyingzzhou/renewlet/releases/download/v9.9.9/checksums.txt"},
		},
	}
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "renewlet")
	if err := os.WriteFile(binaryPath, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RENEWLET_SELF_UPDATE_ENABLED", "true")
	t.Setenv("RENEWLET_SELF_UPDATE_BINARY", binaryPath)
	t.Setenv("RENEWLET_SELF_UPDATE_BACKUP_DIR", filepath.Join(tempDir, "backups"))
	oldVersion, oldBuildType := Version, BuildType
	Version, BuildType = "1.0.0", "release"
	t.Cleanup(func() {
		Version, BuildType = oldVersion, oldBuildType
	})

	var exitCalled atomic.Bool
	client := &fakeSystemReleaseClient{release: release}
	service := newSystemUpdateService(client)
	service.exit = func(int) { exitCalled.Store(true) }
	service.downloadFnForTest("renewlet-new")

	result, err := service.PerformUpdate(context.Background(), localeZhCN)
	if err != nil {
		t.Fatal(err)
	}
	if !result.NeedsRestart {
		t.Fatal("expected update to require restart")
	}
	if exitCalled.Load() {
		t.Fatal("update should not exit before explicit restart")
	}
	if err := service.ConfirmRestart(localeZhCN); err != nil {
		t.Fatal(err)
	}
	if err := service.ConfirmRestart(localeZhCN); !errors.Is(err, errSystemRestartNotPending) {
		t.Fatalf("expected restart to be single-use, got %v", err)
	}
}

func TestSystemRestartRejectedBeforeSuccessfulUpdate(t *testing.T) {
	service := newSystemUpdateService(&fakeSystemReleaseClient{})
	err := service.ConfirmRestart(localeZhCN)
	if !errors.Is(err, errSystemRestartNotPending) {
		t.Fatalf("ConfirmRestart error = %v, want restart not pending", err)
	}
}

func systemReleaseAtomFixture(tag string, updated string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <updated>` + updated + `</updated>
    <link rel="alternate" type="text/html" href="https://github.com/zhiyingzzhou/renewlet/releases/tag/` + tag + `"/>
    <title>` + tag + `</title>
    <content type="html">&lt;p&gt;Release notes&lt;/p&gt;</content>
  </entry>
</feed>`
}
