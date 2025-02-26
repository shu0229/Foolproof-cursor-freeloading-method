#!/bin/bash

echo "====== 启动程序 ======"

# 安装Python依赖
pip3 install -r requirements.txt

# 安装Node.js依赖
npm install

# 启动Node.js应用（在后台运行，以便继续执行后续命令）
npm run start &

# 等待一段时间，确保服务启动（可根据实际情况调整等待时间）
sleep 5

# 在默认浏览器中打开应用
open http://localhost:3000

# 暂停脚本执行，等待用户操作（按任意键继续）
read -p "按任意键退出..."