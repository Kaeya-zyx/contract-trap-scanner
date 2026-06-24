FROM node:22-slim

# 安装系统依赖（pdftoppm、中文语言支持）
RUN apt-get update && apt-get install -y \
    poppler-utils \
    fonts-wqy-zenhei \
    fonts-wqy-microhei \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制依赖文件
COPY package.json package-lock.json ./
RUN npm ci --production

# 复制项目文件
COPY . .

# 创建上传目录
RUN mkdir -p uploads

# 暴露端口
EXPOSE 3000

# 启动服务
CMD ["node", "server.js"]
