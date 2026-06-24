# 合同陷阱扫描器 - 云平台部署指南

## 推荐：Render（免费，部署最简单）

Render 提供免费的 Web 服务，支持 Node.js，有永久公网链接。

### 部署步骤

1. **将项目上传到 GitHub**

   ```bash
   # 在项目根目录初始化 git
   cd contract-trap-scanner
   git init
   git add .
   git commit -m "Initial commit"

   # 在 GitHub 创建新仓库（不要初始化 README）
   # 然后关联并推送
   git remote add origin https://github.com/你的用户名/contract-trap-scanner.git
   git branch -M main
   git push -u origin main
   ```

2. **注册 Render 账号**

   - 访问 https://render.com
   - 用 GitHub 账号直接登录

3. **一键部署**

   - 进入 Render Dashboard
   - 点击 "New +" → "Web Service"
   - 选择你的 GitHub 仓库 `contract-trap-scanner`
   - Render 会自动识别 `render.yaml` 配置
   - 点击 "Create Web Service"

4. **等待部署完成**

   - 构建大约需要 3-5 分钟
   - 完成后会分配一个永久链接：`https://contract-trap-scanner-xxx.onrender.com`

### Render 免费额度

| 项目 | 额度 |
|------|------|
| 运行时间 | 750 小时/月（足够 24x7 运行） |
| 带宽 | 100GB/月 |
| 磁盘 | 1GB |
| 休眠 | 15 分钟无访问自动休眠，下次访问 30 秒冷启动 |

---

## 备选：Railway

Railway 也提供免费额度（5 美元/月），支持更灵活的配置。

### 部署步骤

1. **注册 Railway 账号**

   - 访问 https://railway.app
   - 用 GitHub 账号登录

2. **从 GitHub 部署**

   - 点击 "New Project"
   - 选择 "Deploy from GitHub repo"
   - 选择你的仓库
   - Railway 会自动读取 `railway.json` 配置

3. **生成域名**

   - 部署完成后，在 Settings → Domains 中生成公网域名
   - 格式：`https://contract-trap-scanner-xxx.up.railway.app`

### Railway 免费额度

| 项目 | 额度 |
|------|------|
| 运行时间 | 500 小时/月 |
| 内存 | 512MB |
| 磁盘 | 1GB |
| 带宽 | 100GB/月 |

---

## 注意事项

### 1. 免费平台的限制

- **冷启动延迟**：Render 免费版 15 分钟无访问会休眠，首次访问需等待 30 秒启动
- **OCR 处理时间**：扫描件 PDF 分析需要 30-60 秒，免费版内存 512MB 可能较慢
- **文件上传**：临时文件存储在内存中，重启后清空（不影响功能）

### 2. 环境变量配置

部署后可以在平台 Dashboard 中设置环境变量：

| 变量 | 说明 | 建议值 |
|------|------|--------|
| `AI_PROVIDER` | 分析模式 | `builtin`（免费版建议用内置规则，不用 DeepSeek） |
| `AI_API_KEY` | DeepSeek API Key | 如需 AI 增强可配置 |
| `MAX_FILE_SIZE` | 最大文件大小(MB) | `5`（免费版建议限制小一点） |

### 3. 如果部署失败

检查平台日志，常见问题：
- **Tesseract 语言包下载失败**：确保 `@tesseract.js-data/chi_sim` 和 `@tesseract.js-data/eng` 在 package.json 中
- **pdftoppm 未找到**：Render/Railway 的 Node.js 环境可能缺少 poppler-utils，需要检查构建日志
- **内存不足**：大文件 OCR 可能超出 512MB 限制，建议限制上传文件大小

### 4. 加速冷启动

Render 免费版休眠后首次访问慢，可以用 UptimeRobot 等免费服务每 10 分钟 ping 一次保持活跃。

---

## 快速对比

| 平台 | 免费运行时间 | 内存 | 冷启动 | 部署难度 |
|------|:----------:|:----:|:------:|:--------:|
| Render | 750h/月 | 512MB | 30秒 | 最简单 |
| Railway | 500h/月 | 512MB | 无 | 简单 |
| 阿里云/腾讯云 | 需付费 | 自定义 | 无 | 较复杂 |

**推荐 Render**，部署最简单，免费额度足够个人使用。
