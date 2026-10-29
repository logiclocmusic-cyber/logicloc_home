# NAS 部署指南（Docker）

在 NAS 上一键运行 **前端 + API + SQLite**，无需 Vercel / Railway。浏览器访问 `http://NAS的IP:3001` 即可。

## 架构

| 组件 | 说明 |
|------|------|
| **Docker 容器** | Node 22，内置 Vite 构建产物 + Express |
| **数据卷 `./data`** | `ledger.db`、装备图、发票、家庭事件、OCR 缓存 |
| **端口** | 默认 `3001`（可在 `.env` 改 `PORT`） |

---

## 一、准备项目

### 方式 A：Git 克隆（推荐）

在 NAS 的 SSH 或「Container Manager / Docker」可访问目录执行：

```bash
git clone https://github.com/logiclocmusic-cyber/logicloc_home.git family-ledger
cd family-ledger
cp .env.nas.example .env
# 编辑 .env，填入 AI Key 等（可选）
```

### 方式 B：从 Mac 拷贝整个项目

```bash
rsync -avz --exclude node_modules --exclude dist \
  "/Users/hanhu/Documents/家庭记账本 2/" \
  user@NAS_IP:/volume1/docker/family-ledger/
```

---

## 二、迁移现有数据

任选其一。

### 1. 从本机 Mac 同步（仅首次迁库；平时不要用）

> **注意：生产数据以 NAS 为准。** 日常部署不会同步 `data/`。只有首次把旧库灌进 NAS、且确认要覆盖时才用下面命令。

在 **Mac** 上（先停止 NAS 容器）：

```bash
cd "/Users/hanhu/Documents/家庭记账本 2"
chmod +x scripts/sync-data-to-nas.sh
CONFIRM=YES ./scripts/sync-data-to-nas.sh user@NAS_IP:/volume1/docker/family-ledger/data
```

### 2. 从 Railway 拉取

在 NAS 项目目录、且已安装 Node 22 时：

```bash
export RAILWAY_API_BASE=https://你的-railway域名
export RAILWAY_EMAIL=你的邮箱
export RAILWAY_PASSWORD=你的密码
export PULL_DATA_ROOT="$(pwd)/data"
npm ci
npm run pull-from-railway
```

拉取完成后用 Docker 启动即可，无需再跑 Railway。

### 3. 全新安装

不拷贝数据，直接 `docker compose up -d`。首次登录使用 README 中的本地账号。

---

## 三、启动容器

在项目根目录（含 `docker-compose.yml`）：

```bash
docker compose up -d --build
```

查看日志：

```bash
docker compose logs -f
```

健康检查：`curl http://127.0.0.1:3001/api/health` 应返回 `{"ok":true,...}`。

局域网访问：`http://192.168.x.x:3001`（把 IP 换成 NAS 地址）。

### 群晖 DS418play 一键部署（推荐）

**数据以 NAS 为准。** 部署只更新代码，不会上传本机 `data/`。

NAS 上 **3001 端口已被 ogenius 占用**，记账本使用 **3080** 端口。

在 **Mac** 上执行（需已开启 NAS 的 SSH）：

```bash
cd "/Users/hanhu/Documents/家庭记账本 2"
NAS_PASS='你的NAS密码' ./scripts/deploy-to-synology.sh
```

脚本会：本地 `npm run build` → rsync **代码**（排除 `data/`、`.env`）→ 远程 `docker-compose -f docker-compose.synology.yml up -d --build`。

本机 `data/` 可忽略；切勿再用本机账本覆盖 NAS（除非明确 `SYNC_DATA=FORCE`）。

### 访问域名（推荐）

配置反向代理后，局域网内可直接访问：

**http://logicloc.home**

（80 端口，无需 `:3080`）

首次使用需让设备能解析 `logicloc.home` → `192.168.1.102`：
- Mac：运行 `NAS_PASS='密码' ./scripts/setup-logicloc-home.sh`（会写入 `/etc/hosts`）
- 其他设备：在路由器 `192.168.1.250` 添加本地 DNS，或手动 hosts

---

## 四、各品牌 NAS 操作要点

### 群晖 Synology（Container Manager）

1. **套件中心** 安装 **Container Manager**
2. **项目** → **创建** → 路径选含 `docker-compose.yml` 的文件夹，环境文件选 `.env`
3. 确保 `data/` 存在且可写
4. （可选）**控制面板 → 登录门户 → 反向代理** 把域名指到 `localhost:3001`

### 威联通 QNAP（Container Station）

1. 安装 **Container Station**
2. **创建** → **应用程序** → 导入 `docker-compose.yml`
3. 映射端口 `3001:3001`，卷绑定 `./data:/data`

### 飞牛 fnOS / 其他 Linux NAS

SSH 登录后安装 Docker Compose，按第三节命令执行即可。

---

## 五、环境变量（`.env`）

| 变量 | 说明 |
|------|------|
| `PORT` | 宿主机端口，默认 `3001` |
| `FRONTEND_URL` | 若用域名 + HTTPS 反向代理，填 origin，用于 CORS |
| `DEEPSEEK_API_KEY` | 发票 AI 解析（可选） |
| `GEMINI_API_KEY` | 发票图片识别（可选） |
| `DEEPSEEK_VISION_*` | 发票 AI（硅基流动，需填写密钥） |

### 配置硅基流动（发票识别）

NAS 部署后若 AI 无效，多半是 `.env` 未填密钥。在 Mac 执行：

```bash
DEEPSEEK_VISION_API_KEY=你的密钥 NAS_PASS=密码 ./scripts/setup-nas-ai-env.sh
```

或在群晖编辑 `/volume1/docker/family-ledger/.env`（三行不要有 `#`）后重启容器。

数据路径在 compose 里已固定为 `/data/*`，一般无需改。

---

## 六、更新版本

```bash
cd /path/to/family-ledger
git pull   # 或重新 rsync 代码
docker compose up -d --build
```

`data/` 在卷里，更新不会丢账。

---

## 七、备份

定期备份整个 `data/` 目录即可，至少包含：

- `ledger.db`
- `gear-images/`、`invoices/`、`family-events/`

群晖可用 **Hyper Backup** 定时备份该文件夹。

---

## 八、与 Vercel + Railway 的关系

NAS 部署后可在同一局域网或经反向代理对外访问，**不必再依赖** Vercel / Railway。若暂时保留云端：

- 停止 NAS 与 Railway 同时写入同一数据源（只保留一个「主库」）
- 需要迁移时用 `npm run pull-from-railway` 或 `npm run push-to-railway`

---

## 常见问题

**构建很慢**  
首次 `docker compose build` 需下载 Node 镜像并 `npm ci`，NAS CPU 较弱时约 5–15 分钟，属正常。

**PDF 发票识别失败**  
镜像已装 `poppler-utils`。若仍失败，检查 `.env` 里 AI Key，或改用手动录入。

**无法从手机访问**  
确认 NAS 防火墙放行 `3001`，且手机与 NAS 在同一局域网（或通过 VPN / 反向代理）。

**改端口**  
`.env` 中设 `PORT=8080`，重建后访问 `http://NAS_IP:8080`。
