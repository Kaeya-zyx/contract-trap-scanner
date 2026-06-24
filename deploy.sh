#!/bin/bash
set -e

echo "================================="
echo "  合同陷阱扫描器 - 部署脚本"
echo "================================="

# 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "错误: Docker 未安装"
    echo "请先安装 Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "错误: Docker Compose 未安装"
    echo "请先安装 Docker Compose"
    exit 1
fi

echo ""
echo "正在构建并启动服务..."
docker-compose up --build -d

echo ""
echo "================================="
echo "  部署完成！"
echo "================================="
echo ""
echo "服务地址: http://$(curl -s ifconfig.me 2>/dev/null || echo '你的服务器IP'):3000"
echo ""
echo "查看日志: docker-compose logs -f"
echo "停止服务: docker-compose down"
echo ""
