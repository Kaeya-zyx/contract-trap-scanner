# 合同陷阱扫描器 - 部署指南

## 方案一：Docker 部署（推荐）

### 前置要求
- 一台有公网 IP 的服务器（阿里云/腾讯云/AWS 等）
- 已安装 Docker 和 Docker Compose

### 部署步骤

1. **将项目上传到服务器**

   ```bash
   # 方式一：git clone
   git clone <你的仓库地址>
   cd contract-trap-scanner

   # 方式二：直接上传压缩包
   # 将 contract-trap-scanner.zip 上传到服务器并解压
   ```

2. **运行部署脚本**

   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

   或手动执行：

   ```bash
   docker-compose up --build -d
   ```

3. **访问服务**

   打开浏览器访问：`http://你的服务器IP:3000`

### 常用命令

```bash
# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down

# 重启服务
docker-compose restart

# 更新代码后重新构建
docker-compose up --build -d
```

### 配置 Nginx 反向代理（可选，推荐用于生产环境）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }
}
```

### 配置 HTTPS（可选，推荐）

使用 Let's Encrypt + Certbot：

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 方案二：直接 Node.js 部署

如果你不想用 Docker，也可以直接部署：

```bash
# 1. 安装 Node.js 22+
# 2. 安装系统依赖
sudo apt-get update
sudo apt-get install -y poppler-utils fonts-wqy-zenhei

# 3. 安装项目依赖
npm ci --production

# 4. 启动服务
npm start
```

## 环境变量配置

编辑 `.env` 文件：

```env
PORT=3000
AI_PROVIDER=builtin
MAX_FILE_SIZE=10
```

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | 3000 |
| `AI_PROVIDER` | 分析模式: builtin/deepseek/hybrid | builtin |
| `AI_API_KEY` | DeepSeek API Key（hybrid/deepseek 模式需要） | - |
| `MAX_FILE_SIZE` | 最大上传文件大小（MB） | 10 |

## 防火墙配置

确保服务器防火墙开放 3000 端口（或你配置的 Nginx 80/443 端口）：

```bash
# Ubuntu/Debian (UFW)
sudo ufw allow 3000

# CentOS (firewalld)
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

## 常见问题

**Q: 上传 PDF 后一直显示"正在分析"？**
A: 扫描件 PDF 需要 OCR 识别，6 页大约需要 30-60 秒，请耐心等待。异步轮询模式不会超时。

**Q: 如何配置 DeepSeek AI 增强分析？**
A: 在 `.env` 中设置 `AI_PROVIDER=hybrid` 和 `AI_API_KEY=sk-xxx`，然后重启服务。

**Q: 服务占用多少内存？**
A: 基础运行约 200MB，OCR 处理时可能临时增加到 1GB 左右。
