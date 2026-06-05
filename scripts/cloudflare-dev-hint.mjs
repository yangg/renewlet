#!/usr/bin/env node

const localUrl = "http://localhost:8787";
const scheduledCommand = `curl "${localUrl}/__scheduled?cron=*+*+*+*+*"`;

// Wrangler 的默认 /cdn-cgi scheduled 提示会误导 Workers Static Assets 项目；Renewlet 本地固定走 --test-scheduled 注入的 /__scheduled。
console.log([
  "",
  "Renewlet Cloudflare local dev",
  `  Worker: ${localUrl}`,
  `  Manual Cron: ${scheduledCommand}`,
  "  Expected response: Ran scheduled event",
  "  Do not use /cdn-cgi/handler/scheduled here; Workers Static Assets may return a bare exception.",
  "",
].join("\n"));
