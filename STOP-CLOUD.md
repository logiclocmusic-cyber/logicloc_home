# 停用云端部署（Railway / Vercel）

NAS 已作为唯一生产环境时，可按此清单关闭 Railway 与（可选）Vercel，避免双写和多余费用。

## 停用前检查

1. **确认 NAS 数据最新**  
   对比条数：
   ```bash
   curl -s http://logicloc.home/api/health
   curl -s https://logiclochome-production.up.railway.app/api/health
   ```
   若 Railway 更新，先在 Mac 执行：
   ```bash
   npm run pull-from-railway
   NAS_PASS='你的NAS密码' ./scripts/deploy-to-synology.sh
   ```

2. **确认日常只用 NAS**  
   浏览器固定访问：**http://logicloc.home**

---

## 一、停止 Railway 后端（必做）

当前线上地址：`https://logiclochome-production.up.railway.app`

### 方式 A：Railway 网页（推荐）

1. 打开 [railway.app/dashboard](https://railway.app/dashboard)
2. 使用 **GitHub** 或邮箱登录（与当初部署时相同账号）
3. 进入项目（家庭记账本 / logicloc_home 相关）
4. 点击 **后端服务**（Express 那个）
5. 右上角 **Settings** → 滚动到底部：
   - **Remove Service from Project**（删除服务，推荐），或
   - 先在 **Deployments** 里 **Remove** 最新部署并关闭 GitHub 自动部署
6. 若不再需要整个项目：**Project Settings → Delete Project**

### 方式 B：Railway CLI

```bash
npx @railway/cli login
npx @railway/cli link          # 选择 logicloc_home 项目
npx @railway/cli service       # 选择 API 服务
npx @railway/cli down          # 停止当前部署
# 或在 Dashboard 删除服务（CLI 无法删 Volume，删服务仍建议用网页）
```

### 验证已停用

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://logiclochome-production.up.railway.app/api/health
```

应返回 **404** 或连接失败，而不是 `200`。

---

## 二、停止 Vercel 前端（可选）

若不再使用 `logicloc-home.vercel.app`：

1. 打开 [vercel.com/dashboard](https://vercel.com/dashboard)
2. 进入 **logicloc-home** 项目
3. **Settings → General → Delete Project**

仅停 Railway、保留 Vercel 时，Vercel 页面会无法加载数据（API 已下线），建议一并删除或暂停。

---

## 三、仓库侧（可选，防止误 redeploy）

- Railway：在 Railway 项目里 **Disconnect GitHub Repo**，或删除项目
- Vercel：删除项目即可
- 本地 `railway.toml` 可保留作参考，不影响 NAS

---

## 四、以后只用 NAS 更新

```bash
cd "/Users/hanhu/Documents/家庭记账本 2"
NAS_PASS='你的密码' ./scripts/deploy-to-synology.sh
```

访问：**http://logicloc.home**

---

## 常见问题

**删 Railway 后数据还在吗？**  
在 Railway Volume 里，删服务后数据会丢。你已在 NAS 有完整 `data/`，停用前务必确认 NAS 已同步最新。

**Mac 脚本 `pull-from-railway` 还能用吗？**  
Railway 停用后不能。备份请直接复制 NAS 的 `/volume1/docker/family-ledger/data/`。

**还要改代码吗？**  
不用。NAS 部署不依赖 `VITE_API_BASE` / Railway 环境变量。
