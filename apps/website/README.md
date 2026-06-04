# Renewlet Website

Renewlet 官网的静态站点工程，使用 Vite、React、TypeScript 和 Tailwind CSS 构建。

## 开发

```bash
pnpm --filter @renewlet/website dev
```

## 验证

```bash
pnpm --filter @renewlet/website lint
pnpm --filter @renewlet/website test
pnpm --filter @renewlet/website build
pnpm --filter @renewlet/website test:e2e
```

根目录快捷命令：

```bash
pnpm check:website
pnpm build:website
```

## 部署

官网独立构建为 `apps/website/dist`。它不部署 Renewlet 产品 API，也不需要 D1、R2、PocketBase、通知密钥或 Worker bindings。

### GitHub Pages

仓库已经提供 `.github/workflows/website-pages.yml`。它只在官网相关文件变化时触发，构建并发布 `apps/website/dist`。

1. 在 GitHub 仓库中打开 `Settings` -> `Pages`。
2. `Build and deployment` 的 source 选择 `GitHub Actions`。
3. 推送到 `main`，或手动运行 `Website Pages` workflow。
4. workflow 会设置 `GITHUB_PAGES=true`，Vite `base` 自动变成 `/renewlet/`，适配 `https://<user>.github.io/renewlet/` 这类仓库页路径。

如果后续绑定自定义域名并希望站点部署在域名根路径，需要把 `apps/website/vite.config.ts` 的 base 策略改成 `/`，或在 workflow 中区分自定义域名和仓库页。

本地模拟仓库页构建：

```bash
GITHUB_PAGES=true pnpm --filter @renewlet/website build
pnpm --filter @renewlet/website preview
```

### Cloudflare Pages

Cloudflare Pages 只部署静态站，不使用 Wrangler，也不绑定 Renewlet Worker 的 D1/R2/Cron。

Dashboard 配置：

- Root directory：`apps/website`
- Build command：`pnpm install --frozen-lockfile && pnpm build`
- Build output directory：`dist`
- Node.js version：`24`

如果选择从仓库根目录构建：

- Root directory：留空或仓库根目录
- Build command：`corepack enable && pnpm install --frozen-lockfile && pnpm --filter @renewlet/website build`
- Build output directory：`apps/website/dist`

Cloudflare Pages 默认部署到域名根路径，所以 Vite `base` 保持 `/`。

### Docker 静态站

官网提供独立静态镜像，使用多阶段构建：Node 构建 `dist`，最终由 NGINX 服务静态文件。

从仓库根目录构建：

```bash
docker build -f apps/website/Dockerfile -t renewlet-website .
docker run --rm -p 4180:8080 renewlet-website
```

然后访问：

```text
http://localhost:4180
```

也可以用 Compose：

```bash
cd apps/website
docker compose up --build
```

NGINX 配置在 `apps/website/nginx.conf`：

- `/assets/*` 使用一年 immutable 缓存。
- `/index.html` 使用 no-cache。
- 深链刷新 fallback 到 `/index.html`。

### 部署前检查

```bash
pnpm --filter @renewlet/website lint
pnpm --filter @renewlet/website test
pnpm --filter @renewlet/website build
pnpm --filter @renewlet/website test:e2e
```

根目录快捷命令：

```bash
pnpm check:website
pnpm build:website
```

### 常见问题

- GitHub Pages 页面空白或资源 404：确认 workflow 构建时设置了 `GITHUB_PAGES=true`，仓库页路径需要 `/renewlet/` base。
- Cloudflare Pages 资源 404：确认没有设置 `GITHUB_PAGES=true`，Cloudflare Pages 应使用 `/` base。
- Docker 深链刷新 404：确认镜像使用的是 `apps/website/nginx.conf`，`location /` 应 fallback 到 `/index.html`。
- 修改截图或字体后页面还是旧资源：浏览器可能缓存了 hashed asset 以外的资源，先重新构建并清理部署平台缓存。
