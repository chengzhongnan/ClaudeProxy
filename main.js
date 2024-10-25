import express from 'express';
import axios from 'axios';

const app = express();
const PORT = process.env.PORT || 3000;

// 配置
const CLAUDE_API_KEY = ''; // 替换成你的 API Key
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

app.use(express.json());

// 日志中间件
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// CORS设置
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// 代理端点
app.post('/v1/messages', async (req, res) => {
    try {
        const requestBody = formatRequestBody(req.body);

        const headers = {
            'Content-Type': 'application/json',
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01'
        };

        // 如果是流式请求
        if (req.body.stream) {
            // 设置 SSE 头部
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // 发送初始数据，保持连接活跃
            res.write('\n');

            const response = await axios.post(CLAUDE_API_URL, JSON.stringify(requestBody), {
                headers,
                responseType: 'stream'
            });

            // 处理上游服务器的流式响应
            response.data.on('data', (chunk) => {
                res.write(chunk);
            });

            // 处理流结束
            response.data.on('end', () => {
                res.write('\n');
                res.end();
            });

            // 错误处理
            response.data.on('error', (error) => {
                console.error('Stream error:', error);
                res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
                res.end();
            });

            // 客户端断开连接时的处理
            req.on('close', () => {
                console.log('Client closed connection');
                response.data.destroy();
            });

        } else {
            // 非流式请求
            const response = await axios.post(CLAUDE_API_URL, JSON.stringify(requestBody), { headers });
            res.json(response.data);
        }
    } catch (error) {
        console.error('Error details:', {
            message: error.message,
            response: error.response?.data,
            request: error.config?.data
        });

        const statusCode = error.response?.status || 500;
        const errorResponse = {
            error: {
                type: error.response?.data?.error?.type || 'proxy_error',
                message: error.response?.data?.error?.message || error.message
            }
        };

        res.status(statusCode).json(errorResponse);
    }
});

// 健康检查端点
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`代理服务器运行在端口 ${PORT}`);
});

// 格式化请求体的函数
function formatRequestBody(body) {
    const formattedBody = {
        model: body.model,
        max_tokens: body.max_tokens,
        temperature: body.temperature,
        stream: body.stream,
        system: body.system[0].text,
        messages: []
    };

    if (Array.isArray(body.messages[0].content)) {
        for (let msg of body.messages[0].content) {
            formattedBody.messages.push({
                role: body.messages[0].role,
                content: msg.text
            });
        }
    } else {
        if (body.messages.length > 1) {
            for (let msg of body.messages) {
                formattedBody.messages.push({
                    role: msg.role,
                    content: msg.content.text
                });
            }
        } else {
            formattedBody.messages.push({
                role: body.messages[0].role,
                content: body.messages[0].content.text
            });
        }
        
    }

    return formattedBody;
}
