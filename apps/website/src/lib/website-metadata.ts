const LOCAL_PREVIEW_BASE_URL = 'http://localhost:4173'
const SITEMAP_LASTMOD = '2026-06-02'

export type WebsiteEnv = Record<string, string | undefined>

export type WebsiteDeployment = {
  basePath: string
  baseUrl: string
  viteBase: string
}

function normalizeBasePath(rawBasePath: string | undefined) {
  const trimmed = rawBasePath?.trim() ?? ''
  if (!trimmed || trimmed === '/') return ''

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.replace(/\/+$/, '')
}

function normalizeBaseUrl(rawBaseUrl: string | undefined) {
  const candidate = rawBaseUrl?.trim() || LOCAL_PREVIEW_BASE_URL
  const url = new URL(candidate)

  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    url.protocol = 'https:'
  }
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/+$/, '')
}

export function resolveWebsiteDeployment(env: WebsiteEnv = {}): WebsiteDeployment {
  const basePath = normalizeBasePath(env.RENEWLET_WEBSITE_BASE_PATH)
  const baseUrl = normalizeBaseUrl(env.RENEWLET_WEBSITE_BASE_URL)

  return {
    basePath,
    baseUrl,
    viteBase: basePath ? `${basePath}/` : '/',
  }
}

export function websiteUrl(deployment: Pick<WebsiteDeployment, 'baseUrl'>, path = '') {
  const normalizedPath = path.replace(/^\/+/, '')
  return normalizedPath ? `${deployment.baseUrl}/${normalizedPath}` : `${deployment.baseUrl}/`
}

export function renderRobotsTxt(deployment: WebsiteDeployment) {
  return `User-agent: *
Allow: /

Sitemap: ${websiteUrl(deployment, 'sitemap.xml')}
`
}

export function renderSitemapXml(deployment: WebsiteDeployment) {
  const rootUrl = websiteUrl(deployment)
  const enUrl = websiteUrl(deployment, 'en/')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>${rootUrl}</loc>
    <lastmod>${SITEMAP_LASTMOD}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
    <xhtml:link rel="alternate" hreflang="zh-CN" href="${rootUrl}" />
    <xhtml:link rel="alternate" hreflang="en" href="${enUrl}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${rootUrl}" />
  </url>
  <url>
    <loc>${enUrl}</loc>
    <lastmod>${SITEMAP_LASTMOD}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
    <xhtml:link rel="alternate" hreflang="zh-CN" href="${rootUrl}" />
    <xhtml:link rel="alternate" hreflang="en" href="${enUrl}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${rootUrl}" />
  </url>
</urlset>
`
}

export function replaceWebsiteMetadataPlaceholders(html: string, deployment: WebsiteDeployment) {
  const replacements: Record<string, string> = {
    '%RENEWLET_WEBSITE_URL%': websiteUrl(deployment),
    '%RENEWLET_WEBSITE_EN_URL%': websiteUrl(deployment, 'en/'),
    '%RENEWLET_WEBSITE_LOGO_URL%': websiteUrl(deployment, 'assets/renewlet/logo.svg'),
    '%RENEWLET_WEBSITE_DASHBOARD_ZH_URL%': websiteUrl(deployment, 'assets/renewlet/images/dashboard-zh.png'),
    '%RENEWLET_WEBSITE_DASHBOARD_EN_URL%': websiteUrl(deployment, 'assets/renewlet/images/dashboard-en.png'),
  }

  return Object.entries(replacements).reduce((result, [placeholder, value]) => result.replaceAll(placeholder, value), html)
}
