const express = require('express');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { stringToHex, chunkToUtf8String, generateCursorChecksum } = require('./utils.js');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const app = express();

// 创建全局事件发射器
global.eventEmitter = new EventEmitter();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(morgan(process.env.MORGAN_FORMAT ?? 'tiny'));

// 新增：读取token.txt文件
let authToken = '';
try {
  const tokenPath = path.join(__dirname, 'token.txt');
  const tokens = fs.readFileSync(tokenPath, 'utf-8')
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0);

  if (tokens.length === 0) {
    throw new Error('token.txt is empty or contains invalid format');
  }

  // 随机选择一个token并处理分隔符
  let selectedToken = tokens[Math.floor(Math.random() * tokens.length)];
  
  // 保留对token格式的处理
  if (selectedToken.includes('%3A%3A')) {
    selectedToken = selectedToken.split('%3A%3A')[1];
  }
  if (selectedToken.includes('::')) {
    selectedToken = selectedToken.split('::')[1];
  }
  
  authToken = selectedToken;

  console.log('Token loaded successfully'); // 添加日志
  console.log('Token loaded, length:', authToken.length);
  console.log('Token prefix:', authToken.substring(0, 5) + '...');

} catch (error) {
  console.error('Error reading token file:', error.message);
  process.exit(1);
}

app.post('/v1/chat/completions', async (req, res) => {
  // o1开头的模型，不支持流式输出
  if (req.body.model.startsWith('o1-') && req.body.stream) {
    return res.status(400).json({
      error: 'Model not supported stream',
    });
  }

  try {
    const { model, messages, stream = false } = req.body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: 'Invalid request. Messages should be a non-empty array',
      });
    }

    const hexData = await stringToHex(messages, model);

    const checksum = req.headers['x-cursor-checksum'] 
      ?? process.env['x-cursor-checksum'] 
      ?? generateCursorChecksum(authToken.trim());

    const response = await fetch('https://api2.cursor.sh/aiserver.v1.AiService/StreamChat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/connect+proto',
        authorization: `Bearer ${authToken}`,
        'connect-accept-encoding': 'gzip,br',
        'connect-protocol-version': '1',
        'user-agent': 'connect-es/1.4.0',
        'x-amzn-trace-id': `Root=${uuidv4()}`,
        'x-cursor-checksum': checksum,
        'x-cursor-client-version': '0.42.3',
        'x-cursor-timezone': 'Asia/Shanghai',
        'x-ghost-mode': 'false',
        'x-request-id': uuidv4(),
        Host: 'api2.cursor.sh',
      },
      body: hexData,
      timeout: {
        connect: 5000,    // 连接超时 5 秒
        read: 30000       // 读取超时 30 秒
      }
    }).catch(error => {
      console.error('Fetch error:', error);
      throw error;
    });

    if (!response.ok) {
      console.error('API response not ok:', response.status, response.statusText);
      const text = await response.text();
      console.error('Response body:', text);
      throw new Error(`API request failed: ${response.status}`);
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const responseId = `chatcmpl-${uuidv4()}`;

      try {
        for await (const chunk of response.body) {
          const text = await chunkToUtf8String(chunk);

          if (text.length > 0) {
            res.write(
              `data: ${JSON.stringify({
                id: responseId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: req.body.model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: text,
                    },
                  },
                ],
              })}\n\n`
            );
          }
        }
      } catch (streamError) {
        console.error('Stream error:', streamError);
        if (streamError.name === 'TimeoutError') {
          res.write(`data: ${JSON.stringify({ error: 'Server response timeout' })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ error: 'Stream processing error' })}\n\n`);
        }
      } finally {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } else {
      try {
        let text = '';
        for await (const chunk of response.body) {
          text += await chunkToUtf8String(chunk);
        }
        // 对解析后的字符串进行进一步处理
        text = text.replace(/^.*<\|END_USER\|>/s, '');
        text = text.replace(/^\n[a-zA-Z]?/, '').trim();
        // console.log(text)

        return res.json({
          id: `chatcmpl-${uuidv4()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: text,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        });
      } catch (error) {
        console.error('Non-stream error:', error);
        if (error.name === 'TimeoutError') {
          return res.status(408).json({ error: 'Server response timeout' });
        }
        throw error;
      }
    }
  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      const errorMessage = {
        error: error.name === 'TimeoutError' ? 'Request timeout' : 'Internal server error'
      };

      if (req.body.stream) {
        res.write(`data: ${JSON.stringify(errorMessage)}\n\n`);
        return res.end();
      } else {
        return res.status(error.name === 'TimeoutError' ? 408 : 500).json(errorMessage);
      }
    }
  }
});

let pythonProcess = null;
let serverStatus = false;

// 添加新的路由用于控制面板
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// 获取服务器状态
app.get('/status', (req, res) => {
  res.json({
    serverRunning: serverStatus,
    tokenProcess: pythonProcess !== null
  });
});

// 修改token-process-output路由
app.get('/token-process-output', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // 直接发送一个连接成功的事件
  sendEvent('connected', { message: 'SSE连接已建立' });

  // 监听Python进程的输出
  const onOutput = (message) => {
    console.log('Sending output to client:', message);
    sendEvent('output', { message });
  };

  const onError = (error) => {
    console.log('Sending error to client:', error);
    sendEvent('error', { error });
  };

  const onExit = (code) => {
    console.log('Sending exit to client:', code);
    sendEvent('exit', { code });
    cleanup();
  };

  // 添加监听器
  global.eventEmitter.on('pythonOutput', onOutput);
  global.eventEmitter.on('pythonError', onError);
  global.eventEmitter.on('pythonExit', onExit);

  // 清理函数
  const cleanup = () => {
    global.eventEmitter.removeListener('pythonOutput', onOutput);
    global.eventEmitter.removeListener('pythonError', onError);
    global.eventEmitter.removeListener('pythonExit', onExit);
    res.end();
  };

  // 当客户端断开连接时清理
  req.on('close', cleanup);
});

// 修改start-token路由中的Python进程处理
app.post('/start-token', (req, res) => {
  if (pythonProcess) {
    return res.status(400).json({ error: 'Token process already running' });
  }

  try {
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    console.log('Starting Python process...');
    console.log('Python script path:', path.join(__dirname, 'cursor_register.py'));

    pythonProcess = spawn(pythonCommand, [path.join(__dirname, 'cursor_register.py')], {
      stdio: ['inherit', 'pipe', 'pipe']
    });
    
    pythonProcess.stdout.setEncoding('utf8');
    pythonProcess.stderr.setEncoding('utf8');

    pythonProcess.stdout.on('data', (data) => {
      const message = data.toString().trim();
      console.log('Python stdout:', message);
      global.eventEmitter.emit('pythonOutput', message);
    });

    pythonProcess.stderr.on('data', (data) => {
      const error = data.toString().trim();
      console.error('Python stderr:', error);
      global.eventEmitter.emit('pythonError', error);
    });

    pythonProcess.on('close', (code) => {
      console.log('Python process closed with code:', code);
      global.eventEmitter.emit('pythonExit', code);
      pythonProcess = null;
    });

    pythonProcess.on('error', (error) => {
      console.error('Python process error:', error);
      global.eventEmitter.emit('pythonError', error.message);
      pythonProcess = null;
    });

    res.json({ message: 'Token process started successfully' });
  } catch (error) {
    console.error('Error starting Python process:', error);
    res.status(500).json({ error: error.message });
  }
});

// 停止服务器
app.post('/stop-server', (req, res) => {
  serverStatus = false;
  res.json({ message: 'Server stopping...' });
  process.exit(0);
});

// 添加新的路由用于启动服务器
app.post('/start-server', (req, res) => {
  if (serverStatus) {
    return res.status(400).json({ error: 'Server is already running' });
  }
  
  serverStatus = true;
  res.json({ message: 'Server started successfully' });
});

// 修改停止Token进程的路由
app.post('/stop-token', (req, res) => {
  if (!pythonProcess) {
    return res.status(400).json({ error: 'Token process is not running' });
  }

  try {
    pythonProcess.kill();
    pythonProcess = null;
    res.json({ message: 'Token process stopped successfully' });
  } catch (error) {
    console.error('Error stopping token process:', error);
    res.status(500).json({ error: error.message });
  }
});

// 修改启动服务器部分
const startServer = () => {
    const PORT = process.env.PORT || 3010;
    try {
        app.listen(PORT, () => {
            serverStatus = true;
            console.log(`The server listens port: ${PORT}`);
        }).on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`Port ${PORT} is already in use. Please try again later.`);
                process.exit(1);
            } else {
                console.error('Server error:', error);
                process.exit(1);
            }
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

// 在app.use之后添加错误处理中间件
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 添加进程异常处理
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
