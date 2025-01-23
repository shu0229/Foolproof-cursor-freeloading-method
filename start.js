const { spawn } = require('child_process');
const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.static(path.join(__dirname)));
app.use(express.json());

let apiProcess = null;
let tokenProcess = null;
let apiServer = null;

// 启动API服务器
const startApiServer = () => {
    if (apiProcess) return false;
    
    // 先尝试杀死可能占用3010端口的进程
    try {
        if (process.platform === 'win32') {
            spawn('cmd', ['/c', 'for /f "tokens=5" %a in (\'netstat -aon ^| find ":3010" ^| find "LISTENING"\') do taskkill /f /pid %a >nul 2>&1'], { shell: true });
        } else {
            spawn('sh', ['-c', 'lsof -ti:3010 | xargs kill -9']);
        }
    } catch (error) {
        console.log('No process found on port 3010');
    }

    // 等待一小段时间确保端口释放
    setTimeout(() => {
        console.log('Starting API server...');
        try {
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
    }, 1000);
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
        res.json({ message: 'Port 3010 cleaned successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
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

// 添加端口清理函数
const cleanPort = async (port) => {
    if (process.platform === 'win32') {
        try {
            await new Promise((resolve, reject) => {
                const cmd = spawn('cmd', ['/c', `for /f "tokens=5" %a in ('netstat -aon ^| find ":${port}" ^| find "LISTENING"') do taskkill /f /pid %a`], { shell: true });
                cmd.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Failed to clean port ${port}`));
                });
            });
        } catch (error) {
            console.log('No process found on port');
        }
    } else {
        try {
            await new Promise((resolve, reject) => {
                const cmd = spawn('sh', ['-c', `lsof -ti:${port} | xargs kill -9`]);
                cmd.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Failed to clean port ${port}`));
                });
            });
        } catch (error) {
            console.log('No process found on port');
        }
    }
};

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