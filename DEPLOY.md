# 部署指南：Vercel 前端 + Railway 后端

## 架构

| 平台 | 职责 | 构建/启动 |
|------|------|-----------|
| **Vercel** | 静态前端（Vite） | `npm run build` → `dist/` |
| **Railway** | Express API + SQLite | `npm run start:api` |

本地开发不变：`npm run dev`（Vite 代理 `/api` 到 3001）。

---

## 第一步：代码推送到 GitHub

```bash
cd 家庭记账本
git init
git add .
git commit -m "Add Vercel + Railway deployment config"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库.git
git push -u origin main
```

---

## 第二步：部署 Railway 后端

1. 打开 [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. 选择本仓库，Railway 会读取根目录的 `railway.toml`
3. **Settings → Networking → Generate Domain**，记下公网地址，例如：
   `https://family-ledger-production.up.railway.app`
4. **Variables** 添加：

   | 变量 | 值 |
   |------|-----|
   | `NODE_ENV` | `production` |
   | `SERVE_STATIC` | `false` |
   | `DB_PATH` | `/data/ledger.db` |
   | `GEAR_IMG_DIR` | `/data/gear-images` |
   | `INVOICE_DIR` | `/data/invoices` |
   | `DEEPSEEK_API_KEY` | **必填**。DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com) 获取），用于发票 OCR+AI 解析 |
   | `FRONTEND_URL` | 先留空，Vercel 部署后再填 |

5. **Volumes** → **Add Volume**：
   - Mount Path: `/data`
   - 绑定到当前服务

6. 部署完成后访问 `https://你的域名/api/health`，应返回 `{"ok":true,...}`

### 导入现有数据（可选）

若本地已有 `data/ledger.db`，可在 Railway 控制台用 **Data** 或 CLI 上传到 Volume 的 `/data/ledger.db`，然后重启服务。

---

## 第三步：部署 Vercel 前端

1. 打开 [vercel.com](https://vercel.com) → **Add New Project** → 导入同一 GitHub 仓库
2. Framework Preset 选 **Other**（或 Vite，会自动识别 `vercel.json`）
3. **Environment Variables** 添加：

   | 变量 | 值 |
   |------|-----|
   | `VITE_API_BASE` | Railway 域名，**无末尾斜杠**，例如 `https://family-ledger-production.up.railway.app` |

4. 点击 **Deploy**

5. 部署完成后复制 Vercel 域名，例如 `https://family-ledger.vercel.app`

---

## 第四步：回填 CORS

回到 **Railway → Variables**，更新：

```
FRONTEND_URL=https://logicloc-home.vercel.app
```

注意：**不要末尾斜杠**，必须含 `https://`。填错会导致登录时浏览器报 `Failed to fetch`。

若有多个域名（含预览域名），用英文逗号分隔：

```
FRONTEND_URL=https://logicloc-home.vercel.app,https://logicloc-home-xxx.vercel.app
```

保存后 Railway 会自动重新部署。

---

## 验证

1. 打开 Vercel 前端 URL
2. 使用账号登录（首次部署会自动创建管理员，见 `server/auth.js`）
3. 确认数据加载、保存正常

---

## 常见问题

**登录后立刻掉线 / 请求失败**  
检查 `VITE_API_BASE` 是否与 Railway 域名一致，且 `FRONTEND_URL` 包含当前 Vercel 域名。

**数据重启后丢失**  
确认 Railway Volume 已挂载到 `/data`，且 `DB_PATH=/data/ledger.db`。

**本地仍用 `npm run dev`**  
无需设置 `VITE_API_BASE`，Vite 代理会处理。

**单机部署（前后端同一进程）**  
仍可用 `npm run build && npm run start`（`SERVE_STATIC` 默认为 true）。
