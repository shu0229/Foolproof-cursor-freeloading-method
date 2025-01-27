import { spawn } from 'child_process';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

app.use(express.static(path.join(__dirname)));
app.use(express.json());

let apiProcess = null;
let tokenProcess = null;
let apiServer = null;

// 启动API服务器
const startApiServer = async () => {
    if (apiProcess) return false;
    
    try {
        // 先清理端口
        await cleanPort(3010);
        
        // 等待短暂时间确保端口完全释放
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log('Starting API server...');
        apiProcess = spawn('node', ['src/index.js'], {
            stdio: 'pipe',
            detached: true
        });
        
        apiProcess.stdout.on('data', (data) => {
            console.log(`API server: ${data}`);
        });
        
        apiProcess.stderr.on('data', (data) => {
            console.error(`API server error: ${data}`);
        });

        apiProcess.on('error', (error) => {
            console.error(`Failed to start API server: ${error}`);
            apiProcess = null;
        });

        apiProcess.on('close', (code) => {
            console.log(`API server exited with code ${code}`);
            apiProcess = null;
        });
        
        return true;
    } catch (error) {
        console.error('Failed to start API server:', error);
        apiProcess = null;
        return false;
    }
};

// 停止API服务器
const stopApiServer = () => {
    if (!apiProcess) return false;
    
    try {
        console.log('Stopping API server...');
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', apiProcess.pid, '/f', '/t']);
        } else {
            process.kill(-apiProcess.pid);
        }
        apiProcess = null;
        return true;
    } catch (error) {
        console.error(`Error stopping API server: ${error}`);
        apiProcess = null;
        return false;
    }
};

// 添加Token进程管理函数
const startTokenProcess = () => {
    if (tokenProcess) return false;
    
    console.log('Starting Token process...');
    try {
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        tokenProcess = spawn(pythonCmd, [path.join(__dirname, 'src/cursor_register.py')], {
            stdio: 'pipe',
            detached: true
        });
        
        tokenProcess.stdout.on('data', (data) => {
            console.log(`Token process: ${data}`);
        });
        
        tokenProcess.stderr.on('data', (data) => {
            console.error(`Token process error: ${data}`);
        });

        tokenProcess.on('close', (code) => {
            console.log(`Token process exited with code ${code}`);
            tokenProcess = null;
        });
        
        return true;
    } catch (error) {
        console.error('Failed to start Token process:', error);
        tokenProcess = null;
        return false;
    }
};

const stopTokenProcess = () => {
    if (!tokenProcess) return false;
    
    try {
        console.log('Stopping Token process...');
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', tokenProcess.pid, '/f', '/t']);
        } else {
            process.kill(-tokenProcess.pid);
        }
        tokenProcess = null;
        return true;
    } catch (error) {
        console.error(`Error stopping Token process: ${error}`);
        tokenProcess = null;
        return false;
    }
};

// 路由处理
app.get('/api/status', (req, res) => {
    try {
        res.json({
            apiServer: apiProcess !== null,
            tokenProcess: tokenProcess !== null,
            error: null
        });
    } catch (error) {
        res.status(500).json({
            apiServer: false,
            tokenProcess: false,
            error: error.message
        });
    }
});

app.post('/api/start', (req, res) => {
    try {
        const result = startApiServer();
        res.json({
            success: result,
            message: result ? 'API server started' : 'API server already running or failed to start'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: `Failed to start API server: ${error.message}`
        });
    }
});

app.post('/api/stop', (req, res) => {
    try {
        const result = stopApiServer();
        res.json({
            success: result,
            message: result ? 'API server stopped' : 'API server not running or failed to stop'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: `Failed to stop API server: ${error.message}`
        });
    }
});

// 添加Token进程控制路由
app.post('/api/token/start', (req, res) => {
    try {
        const result = startTokenProcess();
        res.json({
            success: result,
            message: result ? 'Token process started' : 'Token process already running or failed to start'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: `Failed to start Token process: ${error.message}`
        });
    }
});

app.post('/api/token/stop', (req, res) => {
    try {
        const result = stopTokenProcess();
        res.json({
            success: result,
            message: result ? 'Token process stopped' : 'Token process not running or failed to stop'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: `Failed to stop Token process: ${error.message}`
        });
    }
});

// 添加获取token列表的路由
app.get('/api/tokens', (req, res) => {
    try {
        const tokenPath = path.join(__dirname, 'src/token.txt');
        let tokens = [];
        
        if (fs.existsSync(tokenPath)) {
            const content = fs.readFileSync(tokenPath, 'utf-8').trim();
            if (content) {
                tokens = content.split(',').map(t => t.trim()).filter(t => t);
            }
        }
        
        res.json({ tokens });
    } catch (error) {
        res.status(500).json({ 
            error: `Failed to read tokens: ${error.message}`,
            tokens: []
        });
    }
});

// 添加删除token的路由
app.post('/api/tokens/delete', (req, res) => {
    try {
        const { tokens } = req.body;
        if (!Array.isArray(tokens) || tokens.length === 0) {
            return res.status(400).json({
                success: false,
                message: '无效的请求参数'
            });
        }

        const tokenPath = path.join(__dirname, 'src/token.txt');
        let existingTokens = [];
        
        if (fs.existsSync(tokenPath)) {
            existingTokens = fs.readFileSync(tokenPath, 'utf-8')
                .split(',')
                .map(t => t.trim())
                .filter(t => t);
        }

        // 过滤掉要删除的token
        const remainingTokens = existingTokens.filter(token => !tokens.includes(token));

        // 写回文件
        fs.writeFileSync(tokenPath, remainingTokens.join(','), 'utf-8');

        res.json({
            success: true,
            message: `成功删除 ${tokens.length} 个Token`,
            remainingCount: remainingTokens.length
        });
    } catch (error) {
        console.error('Failed to delete tokens:', error);
        res.status(500).json({
            success: false,
            message: `删除Token失败: ${error.message}`
        });
    }
});

// 添加端口检查路由
app.get('/api/check-port', async (req, res) => {
    try {
        const inUse = await checkPortInUse(3010);
        res.json({ inUse });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 添加端口清理路由
app.post('/api/clean-port', async (req, res) => {
    try {
        await cleanPort(3010);
        res.json({ 
            success: true,
            message: 'Port 3010 cleaned successfully' 
        });
    } catch (error) {
        console.error('Port cleanup failed:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 添加端口检查函数
const checkPortInUse = (port) => {
    return new Promise((resolve) => {
        const server = require('net').createServer();
        
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(true);
            }
        });
        
        server.once('listening', () => {
            server.close();
            resolve(false);
        });
        
        server.listen(port);
    });
};

// 优化端口清理函数
const cleanPort = async (port) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (process.platform === 'win32') {
                // Windows 系统 - 使用更可靠的命令组合
                const cmd = spawn('cmd', [
                    '/c',
                    `netstat -ano | findstr :${port} | findstr LISTENING > nul && (for /f "tokens=5" %a in ('netstat -aon ^| find ":${port}" ^| find "LISTENING"') do taskkill /F /PID %a) || echo Port is free`
                ], {
                    shell: true,
                    stdio: 'pipe',
                    windowsHide: true
                });

                let output = '';
                let errorOutput = '';

                cmd.stdout.on('data', (data) => {
                    output += data.toString();
                });

                cmd.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });

                cmd.on('close', (code) => {
                    // 端口已清理或本来就是空闲的情况都视为成功
                    if (code === 0 || 
                        errorOutput.includes('没有运行的任务') || 
                        output.includes('Port is free')) {
                        console.log(`Port ${port} is now available`);
                        resolve(true);
                    } else {
                        const error = errorOutput || `Process exited with code ${code}`;
                        console.error(`Port cleanup failed: ${error}`);
                        reject(new Error(`Failed to clean port ${port}: ${error}`));
                    }
                });

                cmd.on('error', (error) => {
                    console.error(`Command execution error: ${error}`);
                    reject(error);
                });

            } else {
                // Unix 系统 - 使用更安全的命令组合
                const cmd = spawn('sh', [
                    '-c',
                    `lsof -i:${port} | grep LISTEN | awk '{print $2}' | xargs -r kill -9 || true`
                ], {
                    stdio: 'pipe'
                });

                let errorOutput = '';

                cmd.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });

                cmd.on('close', (code) => {
                    // Unix 系统下，即使没有找到进程也返回成功
                    if (code === 0 || code === 1) {
                        console.log(`Port ${port} is now available`);
                        resolve(true);
                    } else {
                        console.error(`Port cleanup failed with code ${code}: ${errorOutput}`);
                        reject(new Error(`Failed to clean port ${port}`));
                    }
                });

                cmd.on('error', (error) => {
                    console.error(`Command execution error: ${error}`);
                    reject(error);
                });
            }
        } catch (error) {
            console.error(`Error during port cleaning: ${error}`);
            reject(error);
        }
    });
};

// 添加延迟测试路由
app.post('/api/test-latency', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({
                success: false,
                error: '无效的Token'
            });
        }

        const { testTokenLatency } = await import('./src/test.js');
        const result = await testTokenLatency(token);
        
        res.json(result);
    } catch (error) {
        console.error('Latency test failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 启动控制面板服务器
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Control panel running at http://localhost:${PORT}`);
    console.log('Press Ctrl+C to stop the control panel');
});

// 清理进程
const cleanup = () => {
    if (apiProcess) {
        stopApiServer();
    }
    if (tokenProcess) {
        stopTokenProcess();
    }
    cleanPort(3010).catch(() => {});  // 清理端口
    process.exit();
};

process.on('exit', cleanup);
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    cleanup();
});
process.on('SIGTERM', cleanup);

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
}); 
