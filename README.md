# 家庭记账本

本地运行的家庭账本，支持导入微信 / 支付宝 / 银行 CSV，自动分类与二次确认。

## 技术栈

- **前端**：Vite + 原生 JavaScript
- **后端**：Express + **SQLite**（Node 内置 `node:sqlite`）
- **数据文件**：`data/ledger.db`

## 登录账户

首次启动会自动创建管理账户：

| 字段 | 值 |
|------|-----|
| 用户名 | Logic Loc |
| 邮箱 | logicloc@qq.com |
| 初始密码 | huhan123 |

登录后，首页「欢迎回来」与右上角会显示用户名。

```bash
npm install
npm run dev
```

浏览器打开 **http://localhost:5173**（Vite 开发服务器，API 代理到 3001 端口）。

生产构建：

```bash
npm run build
npm start
```

访问 **http://localhost:3001**（同时提供 API 与静态页面）。

## 从旧版（localStorage）迁移

1. 在旧版页面使用「备份数据」导出 JSON
2. 启动新版后，侧栏「恢复备份」导入该 JSON 即可写入 SQLite

## 功能

- 导入微信 / 支付宝 / 银行 CSV，预览时间轴后确认入库
- 自动分类 + 用户二次分类（规则学习）
- 明细列表、统计图表、监控、退款管理
- 按导入文件删除关联账目
- JSON 备份 / 恢复

## 目录

```
index.html          Vite 入口页
src/                前端源码
server/             Express + SQLite API
data/ledger.db      数据库（自动生成，已 gitignore）
```

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | API / 生产服务端口 | `3001` |
| `DB_PATH` | SQLite 文件路径 | `data/ledger.db` |
