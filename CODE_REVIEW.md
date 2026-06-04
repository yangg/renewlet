# Renewlet 全量代码审查报告

审查日期：2026-06-04

审查范围：`packages/client`、`packages/server`、`packages/cloudflare`、`packages/shared`、`apps/website`、Docker、Wrangler、CI/E2E 与部署配置。

本报告只基于当前仓库真实代码。修复建议默认采用彻底切换方案，不保留旧路径或兼容层。

> 修复进度：P1 已落实；P2/P3 已优先落实低风险、可测试的运行面修复，包括 Cloudflare Worker 单测门禁、前端错误边界与统一错误上报、Go/Cloudflare `/ready`、Go 通知调度结构化日志、官网非 root Nginx/安全头/字体资源优化，以及导入弹窗纯展示拆分。Go/PocketBase 全目录迁移仍按后续单领域逐步迁移执行，不做一次性大搬家。

## 验证基线

已通过：

- `git -C renewlet status --short`：审查前工作区干净。
- `pnpm --filter @renewlet/client lint`
- `pnpm --filter @renewlet/client typecheck`
- `pnpm --filter @renewlet/client typecheck:all`
- `pnpm --filter @renewlet/client test:run`：80 files / 486 tests passed
- `pnpm --dir packages/server test`
- `pnpm check:deploy`
- `pnpm check:cloudflare`
- `pnpm build:cloudflare`
- `pnpm check:website`
- `pnpm typecheck:e2e`
- `pnpm --filter @renewlet/shared test:run`：3 files / 11 tests passed
- `pnpm exec wrangler deploy --dry-run`
- `pnpm test:e2e`：21 passed

失败：

- `pnpm --filter @renewlet/cloudflare test:run`
- 失败点：`packages/cloudflare/src/calendar-feed.test.ts` 中 3 个断言直接检查 `"Category: Developer Tools"`；实际 ICS 按 RFC 5545 折行为 `Category: Developer \r\n Tools`，测试应先 unfold 再断言。

## 🔴 严重问题（必须修复）

当前未发现 P0 阻塞级问题。Docker 产品镜像、Go/PocketBase 运行面、Cloudflare dry-run、产品前端 lint/typecheck/Vitest、官网检查和 E2E 均有可运行基线。

## 🟠 重要问题（强烈建议修复）

### 1. Cloudflare 通知外发 URL SSRF 防护不完整

优先级：P1 高

问题描述：

- 位置：`packages/cloudflare/src/notifications.ts`
- 现象：`safeHttpsUrl()` 只通过 hostname 字符串正则拦截 `localhost`、`127.*`、`10.*`、`192.168.*`、`172.16-31.*`。
- 对照：Go 运行面 `packages/server/cmd/renewlet/notification_http.go` 已在 DNS 解析后检查解析 IP。

问题影响：

- Cloudflare Worker 的 webhook/Bark 外发目标由用户配置。当前正则无法可靠拦截 IPv6、本机别名、十进制/十六进制 IP、`*.localhost`、域名解析到内网地址等 SSRF 变体。
- Docker 与 Cloudflare 两个运行面的安全语义不一致，同一配置在不同部署方式下风险不同。

修改前：

```ts
function safeHttpsUrl(raw: string, locale: AppLocale): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(serverText(locale, "url.invalidGeneric"));
  }
  if (url.protocol !== "https:") throw new Error(serverText(locale, "url.mustUseHttpsGeneric"));
  // 用户可配置 webhook/Bark 地址；禁止内网和本机目标，避免 Worker 变成 SSRF 跳板。
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(url.hostname)) {
    throw new Error(serverText(locale, "url.privateOrLocalNotAllowedGeneric"));
  }
  return url.toString();
}
```

修改后：

```ts
const UNSAFE_HOSTNAMES = new Set(["localhost"]);

async function assertSafeOutboundUrl(raw: string, locale: AppLocale): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(serverText(locale, "url.invalidGeneric"));
  }

  if (url.protocol !== "https:") throw new Error(serverText(locale, "url.mustUseHttpsGeneric"));
  if (url.username || url.password) throw new Error(serverText(locale, "url.invalidGeneric"));

  const hostname = url.hostname.toLowerCase();
  if (UNSAFE_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error(serverText(locale, "url.privateOrLocalNotAllowedGeneric"));
  }

  const literal = parseIpLiteral(hostname);
  const resolved = literal ? [literal] : await resolveOutboundHostViaDoh(hostname);
  if (resolved.length === 0 || resolved.some(isUnsafeOutboundIpLiteral)) {
    throw new Error(serverText(locale, "url.privateOrLocalNotAllowedGeneric"));
  }

  return url;
}

async function resolveOutboundHostViaDoh(hostname: string): Promise<string[]> {
  const answers = await Promise.all(["A", "AAAA"].map(async (type) => {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
    });
    if (!response.ok) return [];
    const payload = await response.json() as { Answer?: Array<{ data?: string }> };
    return (payload.Answer ?? []).map((answer) => answer.data ?? "").filter(Boolean);
  }));
  return answers.flat();
}

function parseIpLiteral(hostname: string): string | null {
  const value = hostname.replace(/^\[|\]$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value;
  if (value.includes(":")) return value;
  return null;
}

function isUnsafeOutboundIpLiteral(value: string): boolean {
  const ip = value.toLowerCase();
  return ip === "::1"
    || ip.startsWith("fc")
    || ip.startsWith("fd")
    || ip.startsWith("fe80:")
    || /^(127|10)\./.test(ip)
    || /^192\.168\./.test(ip)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
}

async function postJson(url: string, payload: unknown, channel: string, locale: AppLocale, headers?: Record<string, string>): Promise<void> {
  const safeUrl = await assertSafeOutboundUrl(url, locale);
  await fetchOk(safeUrl, { method: "POST", headers: { "content-type": "application/json", ...(headers ?? {}) }, body: JSON.stringify(payload) }, channel, locale);
}
```

建议验证：

- 新增 `notifications.test.ts` 覆盖 `localhost`、`127.0.0.1`、`[::1]`、`*.localhost`、DoH 解析到私网、正常 HTTPS 域名。
- 运行 `pnpm --filter @renewlet/cloudflare test:run`、`pnpm check:cloudflare`。

### 2. Cloudflare `/system/restart` 路由错误复用 update handler

优先级：P1 高

问题描述：

- 位置：`packages/cloudflare/src/index.ts`、`packages/cloudflare/src/system.ts`
- 现象：`/api/admin/system/restart` 当前调用 `systemUpdate(request, env)`，返回 `SYSTEM_UPDATE_UNSUPPORTED`。

问题影响：

- 管理端“更新”和“重启”是两个不同状态机。Cloudflare 不支持容器内更新，也不支持容器式重启，二者应返回不同错误码，前端才能展示正确动作与文案。
- 错误码复用会让后续测试、日志聚合和用户排障误判真实失败原因。

修改前：

```ts
if (head === "admin" && second === "system" && third === "update") {
  return routeMethods(request, { POST: () => systemUpdate(request, env) });
}
if (head === "admin" && second === "system" && third === "restart") {
  return routeMethods(request, { POST: () => systemUpdate(request, env) });
}
```

修改后：

```ts
if (head === "admin" && second === "system" && third === "update") {
  return routeMethods(request, { POST: () => systemUpdate(request, env) });
}
if (head === "admin" && second === "system" && third === "restart") {
  return routeMethods(request, { POST: () => systemRestart(request, env) });
}
```

```ts
export async function systemRestart(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const locale = requestLocale(request);
  throw new HttpError(
    400,
    serverText(locale, "system.cloudflareRestartUnsupported"),
    "SYSTEM_RESTART_UNSUPPORTED",
  );
}
```

建议验证：

- 扩展 `packages/cloudflare/src/system.test.ts`，分别断言 update 与 restart 的 code。
- 运行 `pnpm --filter @renewlet/cloudflare test:run`、`pnpm check:cloudflare`。

### 3. Cloudflare ICS 单元测试不兼容 RFC 折行

优先级：P1 高

问题描述：

- 位置：`packages/cloudflare/src/calendar-feed.test.ts`
- 现象：测试直接 `expect(ics).toContain("Category: Developer Tools")`，但 ICS 长行允许折行，实际文本可出现 `Category: Developer \r\n Tools`。

问题影响：

- 当前 `pnpm --filter @renewlet/cloudflare test:run` 失败。
- 失败来自测试断言不理解 ICS 格式，而不是产品输出错误；若用改生产代码来迎合测试，会破坏日历兼容性。
- 更严重的是根 `check:cloudflare` 没有运行 Worker 单测，导致这个失败没有进入 Cloudflare 门禁。

修改前：

```ts
const ics = await icsResponse.text();
expectCalendarIcsLineEndings(ics);
expect(ics).toContain("BEGIN:VCALENDAR");
expect(ics).toContain("SUMMARY:Active Plan");
expect(ics).toContain("DTSTART;VALUE=DATE:20990602");
expect(ics).toContain("Category: Developer Tools");
expect(ics).toContain("Payment method: Credit Card");
expect(ics).toContain("CATEGORIES:Developer Tools");
```

修改后：

```ts
function unfoldIcsText(value: string): string {
  return value.replace(/\r\n[ \t]/g, "");
}

const ics = await icsResponse.text();
const unfoldedIcs = unfoldIcsText(ics);
expectCalendarIcsLineEndings(ics);
expect(unfoldedIcs).toContain("BEGIN:VCALENDAR");
expect(unfoldedIcs).toContain("SUMMARY:Active Plan");
expect(unfoldedIcs).toContain("DTSTART;VALUE=DATE:20990602");
expect(unfoldedIcs).toContain("Category: Developer Tools");
expect(unfoldedIcs).toContain("Payment method: Credit Card");
expect(unfoldedIcs).toContain("CATEGORIES:Developer Tools");
```

建议验证：

- 运行 `pnpm --filter @renewlet/cloudflare test:run`。
- 将 Worker 单测纳入 `check:cloudflare` 后再运行 `pnpm check:cloudflare`。

### 4. 产品前端缺少全局 Error Boundary

优先级：P1 高

问题描述：

- 位置：`packages/client/src/main.tsx`、`packages/client/src/providers.tsx`、`packages/client/src/App.tsx`
- 现象：路由已懒加载并有 `Suspense` fallback，但未发现 `ErrorBoundary`、`componentDidCatch` 或 `getDerivedStateFromError`。

问题影响：

- 任一路由 chunk 加载失败、渲染期异常或 Provider 子树异常，都可能导致整棵 React 树卸载成空白页。
- 当前只有若干局部 `console.error`，没有统一恢复 UI，也不利于后续接入 Sentry。

修改前：

```tsx
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <Providers>
        <App />
      </Providers>
    </BrowserRouter>
  </StrictMode>,
);
```

修改后：

```tsx
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <Providers>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </Providers>
    </BrowserRouter>
  </StrictMode>,
);
```

```tsx
type AppErrorBoundaryState = { error: Error | null };

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
    return <AppErrorFallback onReload={() => window.location.reload()} />;
  }
}
```

注意：`AppErrorFallback` 的用户可见文案必须走 Lingui catalog，不要硬编码双语。

建议验证：

- 增加 Testing Library 用例：模拟子组件 throw，断言 fallback 和 reload 按钮。
- 运行 `pnpm --filter @renewlet/client test:run`、`pnpm --filter @renewlet/client typecheck:all`。

## 🟡 优化建议（建议改进）

### 5. Cloudflare 检查门禁没有运行 Worker 单测

优先级：P2 中

问题描述：

- 位置：根 `package.json`
- 现象：`check:cloudflare` 只运行配置同步、shared typecheck、Worker typecheck、Cloudflare runtime 下的 client typecheck；没有运行 `@renewlet/cloudflare test:run`。

问题影响：

- 当前 Worker 单测已经失败，但 `pnpm check:cloudflare` 仍通过。
- Cloudflare 后端的 ICS、鉴权、SMTP MIME、system handler 等行为可能在 CI 中漏检。

修改前：

```json
"check:cloudflare": "pnpm check:media-resolver-config && pnpm check:server-i18n && pnpm --filter @renewlet/shared typecheck && pnpm --filter @renewlet/cloudflare typecheck && VITE_RENEWLET_RUNTIME=cloudflare pnpm --filter @renewlet/client typecheck && pnpm --filter @renewlet/client typecheck:all"
```

修改后：

```json
"check:cloudflare": "pnpm check:media-resolver-config && pnpm check:server-i18n && pnpm --filter @renewlet/shared typecheck && pnpm --filter @renewlet/cloudflare typecheck && pnpm --filter @renewlet/cloudflare test:run && VITE_RENEWLET_RUNTIME=cloudflare pnpm --filter @renewlet/client typecheck && pnpm --filter @renewlet/client typecheck:all"
```

建议验证：

- 先修复 ICS 测试折行问题。
- 再运行 `pnpm check:cloudflare`、`pnpm build:cloudflare`、`pnpm exec wrangler deploy --dry-run`。

### 6. 部分前端组件和 controller 体积过大，职责边界不够清晰

优先级：P2 中

问题描述：

- 位置：
  - `packages/client/src/modules/settings/application/use-settings-form-controller.ts`：738 行
  - `packages/client/src/components/import-data-dialog.tsx`：550 行
  - `packages/client/src/pages/subscriptions.tsx`：548 行
  - `packages/client/src/components/subscription-calendar.tsx`：590 行
- 现象：部分文件同时承担数据请求、业务状态机、格式化、UI 组合、错误处理和用户交互。

问题影响：

- 文件行数接近或超过维护警戒线，后续改动容易引发 hook 依赖、异步竞态和渲染回归。
- `import-data-dialog.tsx` 同时处理文件/粘贴输入、解析、预览、Logo 自动匹配和 apply 进度，测试会越来越难聚焦。

修改前：

```tsx
export function ImportDataDialog({ open, onOpenChange, onImported }: ImportDataDialogProps) {
  const [source, setSource] = useState<ImportSource>("csv");
  const [input, setInput] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsedRows, setParsedRows] = useState<ParsedImportRow[]>([]);
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [isApplying, setIsApplying] = useState(false);

  async function handleApply() {
    // 解析、校验、Logo 匹配、写入和 toast 都在组件内继续膨胀。
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>{/* 大量 UI */}</Dialog>;
}
```

修改后：

```tsx
export function ImportDataDialog(props: ImportDataDialogProps) {
  const controller = useImportDataDialogController(props);
  return <ImportDataDialogView controller={controller} />;
}
```

```ts
export function useImportDataDialogController({ open, onImported }: ImportDataDialogProps) {
  const source = useImportSourceState(open);
  const parser = useImportParser(source.input);
  const preview = useImportPreview(parser.rows);
  const mutation = useApplyImportMutation({ onImported });

  return {
    source,
    parser,
    preview,
    apply: mutation.mutateAsync,
    isApplying: mutation.isPending,
  };
}
```

建议验证：

- 按 controller/view 拆分后为 controller 增加 hook 单测，为 view 保留交互 smoke。
- 运行 `pnpm --filter @renewlet/client test:run`、`pnpm --filter @renewlet/client typecheck:all`。

### 7. Go/PocketBase 后端长期集中在 `cmd/renewlet`，建议按运行面职责切开

优先级：P2 中

问题描述：

- 位置：`packages/server/cmd/renewlet`
- 现象：Go 后端当前集中在单个 main package 内，`calendar_feed.go` 650 行、`hooks.go` 609 行，route、hook、schema、通知、calendar、i18n 和 update 状态机距离较近。

问题影响：

- PocketBase 项目可以先以 `cmd/renewlet` 起步，但业务增长后，handler/service/repository/contract 边界不明显会降低可测性。
- 订阅状态流、通知幂等、ICS 生成和用户隔离逻辑都属于高风险域，应逐步下沉到可单测包。

修改前：

```go
// packages/server/cmd/renewlet/calendar_feed.go
func registerCalendarFeedRoutes(app *pocketbase.PocketBase) {
  app.OnServe().BindFunc(func(se *core.ServeEvent) error {
    se.Router.GET("/calendar/renewals.ics", func(e *core.RequestEvent) error {
      // token 校验、查询、ICS 生成和 HTTP 输出都在同一文件推进。
    })
    return se.Next()
  })
}
```

修改后：

```go
// packages/server/internal/calendar/handler.go
type Handler struct {
  feeds FeedRepository
  subscriptions SubscriptionRepository
  generator Generator
}

func (h Handler) Register(router *router.RouterGroup[*core.RequestEvent]) {
  router.GET("/calendar/renewals.ics", h.publicFeed)
}
```

```go
// packages/server/internal/calendar/generator.go
func (g Generator) BuildRenewalsICS(ctx context.Context, input FeedInput) ([]byte, error) {
  // 只负责 ICS 业务格式，不读取 PocketBase，也不写 HTTP response。
}
```

建议验证：

- 先切 `calendar` 或 `notifications` 一个领域，不做全仓大搬家。
- 保留 API 行为不变，运行 `pnpm --dir packages/server test` 和 E2E 日历订阅旅程。

### 8. 可观测性仍停留在健康检查和分散日志，缺少 ready/metrics/统一错误采样

优先级：P2 中

问题描述：

- 位置：
  - Go：`packages/server/cmd/renewlet/routes.go` 只有 `/api/app/health`
  - Go：`packages/server/cmd/renewlet/notification_scheduler.go` 使用 `log.Println` / `log.Printf`
  - 前端：`packages/client/src/pages/login.tsx`、`packages/client/src/hooks/use-exchange-rates.ts` 等直接 `console.error`
  - Cloudflare：`packages/cloudflare/src/index.ts` 有 `/api/app/health`
- 现象：缺少 `/ready`、关键业务 metrics、统一结构化日志和前端错误追踪入口。

问题影响：

- 容器存活、数据库可用、迁移完成、通知队列可处理是不同健康语义；只有 `/health` 不足以支撑滚动部署和告警。
- 通知发送成功率、失败次数、订阅数量、Cron 延迟等关键业务指标无法聚合分析。

修改前：

```go
router.GET("/api/app/health", func(e *core.RequestEvent) error {
  return e.JSON(http.StatusOK, newHealthResponse())
})
```

```go
log.Printf("[notification-scheduler] processed=%d sent=%d skipped=%d failed=%d", result.Processed, result.Sent, result.Skipped, result.Failed)
```

修改后：

```go
router.GET("/api/app/health", healthHandler())
router.GET("/api/app/ready", readyHandler(app))
```

```go
logger.Info("notification scheduler completed",
  "processed", result.Processed,
  "sent", result.Sent,
  "skipped", result.Skipped,
  "failed", result.Failed,
)
```

```ts
export function reportClientError(error: unknown, context: Record<string, unknown>) {
  console.error("client error", { error, ...context });
  // 后续接入 Sentry 时只替换这里，不在页面组件散落 SDK 调用。
}
```

建议验证：

- Go 增加 `/ready` handler 测试，Docker healthcheck 仍指向轻量 `healthcheck`，部署平台 readiness 指向 `/api/app/ready`。
- 前端 Error Boundary 接入 `reportClientError()` 后运行 client tests。

### 9. 官网 Nginx 与容器安全头不足，最终镜像默认 root 运行

优先级：P2 中

问题描述：

- 位置：`apps/website/Dockerfile`、`apps/website/nginx.conf`
- 现象：官网镜像最终阶段 `FROM nginx:1.29-alpine` 后未切非 root；Nginx 只设置缓存和 SPA fallback，缺少安全响应头。

问题影响：

- 官网虽然不是产品数据面，但公开暴露面仍应最小化容器权限。
- 缺少 `X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`、CSP 等安全头，会降低静态站基础防护。

修改前：

```dockerfile
FROM nginx:1.29-alpine

COPY apps/website/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/website/dist /usr/share/nginx/html
```

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

修改后：

```dockerfile
FROM nginx:1.29-alpine

RUN addgroup -S -g 1000 renewlet \
  && adduser -S -D -H -u 1000 -G renewlet renewlet \
  && chown -R renewlet:renewlet /var/cache/nginx /var/run /usr/share/nginx/html

COPY apps/website/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=renewlet:renewlet /repo/apps/website/dist /usr/share/nginx/html

USER renewlet
```

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;

location / {
  try_files $uri $uri/ /index.html;
}
```

注意：Nginx 非 root 运行时需要同步监听高端口或调整权限，例如改为 `listen 8080;` 并同步 `apps/website/docker-compose.yml` 的端口映射。

建议验证：

- `pnpm check:website`
- `docker build -f apps/website/Dockerfile .`
- 本地容器 smoke：检查 `/`、深链 fallback、`/assets/*` 缓存头、安全头。

### 10. 官网字体资源策略偏重，首屏请求数有优化空间

优先级：P3 低

问题描述：

- 位置：`apps/website/src/index.css`
- 现象：官网引入 `@fontsource-variable/noto-sans-sc`，构建会产出多份 Noto Sans SC 字体分片。中文字体质量更稳定，但静态官网首屏成本偏高。

问题影响：

- 官网营销页首屏需要尽快展示品牌和截图；大量字体分片会增加首屏请求与缓存预热成本。
- 对产品功能无影响，属于官网体验优化。

修改前：

```css
@import "@fontsource-variable/noto-sans-sc";
```

修改后：

```css
@font-face {
  font-family: "Renewlet Sans SC";
  src: url("/fonts/noto-sans-sc-subset.woff2") format("woff2");
  font-display: swap;
  font-weight: 400 700;
}
```

建议验证：

- 用 Lighthouse 或浏览器 Network 面板比较首屏字体请求数和 LCP。
- 运行 `pnpm check:website`。

## 🟢 做得好的地方

- 产品前端路由已经使用 `React.lazy + Suspense`，并按路由提供不同 skeleton，首屏和切页体验基础较好。
- `packages/client/vite.config.ts` 已按 React、Radix、charts、forms、time、runtime-ui、data 等边界配置 chunk 分组，避免主包继续膨胀。
- 前端 API 边界已有 `src/lib/api/schemas`、`services`、`modules/*/{application,domain,presentation}` 分层，适合继续收敛 controller 和 view。
- 产品 Dockerfile 已使用多阶段构建，最终镜像基于 Alpine，创建 `renewlet` 非 root 用户，`pb_data` 卷和 healthcheck 配置清晰。
- `deploy/docker-compose.yml`、根 `docker-compose.yml` 和 `.env.example` 对数据卷、内存、时区、SMTP、通知 Cron 等配置说明较完整。
- Wrangler 配置已启用 Static Assets SPA fallback，并通过 `run_worker_first` 让 `/api/*`、ICS feed 和 scheduled 入口先进入 Worker，避免认证/API 被静态资源吞掉。
- Cloudflare R2 设计有 D1 asset metadata owner 校验约束，方向正确。
- Go 运行面通知外发 URL 已实现 HTTPS-only、DNS 解析后拦私网/本机地址，安全边界比 Worker 侧更完整，可作为 Worker 修复参考。
- i18n 体系较成熟，前端 Lingui catalog 与 server i18n 生成检查已进入门禁。
- E2E 已覆盖关键产品旅程，当前 `pnpm test:e2e` 通过。

## 推荐最终结构方向

- 前端：入口/Provider/路由/Error Boundary 收敛到 `src/app`；业务域继续按 `modules/*/{domain,application,presentation}` 拆分；Docker/Cloudflare 分流只放在 `services/runtime` 和 API service。
- Go/PocketBase：`cmd/renewlet` 逐步瘦身，只保留进程入口；优先把 `calendar`、`notifications`、`system` 三个高风险域下沉到 `internal/<domain>/{handler,service,repository}`。
- Cloudflare：`index.ts` 保持显式路由表；D1/R2 adapter、外发 URL policy、system、calendar、notifications 分成可测模块；DTO 优先复用 `packages/shared`。
- 官网：`apps/website` 继续与产品分离；Nginx 安全头、缓存策略、非 root 运行和字体资源策略独立维护。

## 建议修复顺序

1. 修复 Cloudflare ICS 测试 unfold，并把 `@renewlet/cloudflare test:run` 加入 `check:cloudflare`。
2. 修复 Cloudflare `/system/restart` 独立 handler 和错误码。
3. 补齐 Cloudflare 外发 URL policy，与 Go SSRF 防护语义对齐。
4. 为产品前端增加全局 Error Boundary 和统一 `reportClientError()`。
5. 拆 `import-data-dialog` 与设置页 controller，优先降低前端高变更文件风险。
6. 补 `/ready`、结构化日志和前端错误追踪入口。
7. 加固官网 Docker/Nginx，优化字体资源策略。
8. 按领域逐步迁移 Go/PocketBase 与 Worker 目录结构，先从 `calendar` 或 `notifications` 入手。

## 后续验收命令

```bash
pnpm --filter @renewlet/cloudflare test:run
pnpm check:cloudflare
pnpm build:cloudflare
pnpm exec wrangler deploy --dry-run
pnpm --filter @renewlet/client test:run
pnpm --filter @renewlet/client typecheck:all
pnpm --dir packages/server test
pnpm check:website
pnpm check:deploy
pnpm test:e2e
```
