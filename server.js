const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();

// ==================== 配置部分 ====================
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const NODE_ENV = process.env.NODE_ENV || 'production';

// ==================== 验证API密钥 ====================
function validateApiKey(key) {
  if (!key || key.trim() === '') {
    return { valid: false, reason: 'API密钥未设置', code: 'NO_API_KEY' };
  }
  if (!key.startsWith('sk-')) {
    return { valid: false, reason: 'API密钥格式错误，应以sk-开头', code: 'INVALID_FORMAT' };
  }
  if (key.length < 30) {
    return { valid: false, reason: 'API密钥长度不足', code: 'KEY_TOO_SHORT' };
  }
  return { valid: true, code: 'VALID' };
}

const apiKeyStatus = validateApiKey(DEEPSEEK_API_KEY);
console.log(`API密钥状态: ${apiKeyStatus.valid ? '有效' : '无效'} - ${apiKeyStatus.reason || ''}`);

// ==================== 创建axios实例 ====================
const apiClient = axios.create({
  baseURL: 'https://api.deepseek.com',
  timeout: 45000, // 45秒超时
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
});

// 请求拦截器
apiClient.interceptors.request.use(
  config => {
    if (DEEPSEEK_API_KEY) {
      config.headers.Authorization = `Bearer ${DEEPSEEK_API_KEY}`;
    }
    return config;
  },
  error => Promise.reject(error)
);

// 响应拦截器
apiClient.interceptors.response.use(
  response => response,
  error => {
    let errorMessage = 'API请求失败';
    
    if (error.response) {
      // API返回了错误响应
      const status = error.response.status;
      const data = error.response.data;
      
      switch (status) {
        case 400:
          errorMessage = '请求参数错误';
          break;
        case 401:
          errorMessage = 'API密钥无效或已过期';
          break;
        case 403:
          errorMessage = 'API密钥权限不足';
          break;
        case 429:
          errorMessage = '请求过于频繁，请稍后重试';
          break;
        case 500:
          errorMessage = 'DeepSeek服务器内部错误';
          break;
        case 502:
        case 503:
        case 504:
          errorMessage = 'DeepSeek服务暂时不可用';
          break;
        default:
          errorMessage = `API错误: ${status}`;
      }
      
      console.error(`API错误 ${status}:`, data);
    } else if (error.request) {
      // 请求已发送但没有收到响应
      if (error.code === 'ECONNRESET') {
        errorMessage = '连接被重置，请检查网络';
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage = '连接超时，请稍后重试';
      } else if (error.code === 'ENOTFOUND') {
        errorMessage = '无法连接到DeepSeek服务器';
      } else {
        errorMessage = '网络错误，请检查连接';
      }
      console.error('网络错误:', error.code, error.message);
    } else {
      // 请求配置错误
      errorMessage = `请求配置错误: ${error.message}`;
      console.error('配置错误:', error.message);
    }
    
    return Promise.reject(new Error(errorMessage));
  }
);

// ==================== API调用函数 ====================
async function callDeepSeekAPI(prompt, options = {}) {
  // 如果没有API密钥，返回模拟数据
  if (!apiKeyStatus.valid) {
    return generateMockResponse(prompt);
  }

  const requestBody = {
    model: options.model || 'deepseek-chat',
    messages: [
      {
        role: 'system',
        content: '你是一个专业的Java代码审查助手。请以JSON格式返回分析结果，包含summary、issues、suggestions字段。'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    max_tokens: options.maxTokens || 3000,
    temperature: options.temperature || 0.3,
    stream: false
  };

  try {
    console.log('正在调用DeepSeek API...');
    const startTime = Date.now();
    
    const response = await apiClient.post('/v1/chat/completions', requestBody);
    
    const endTime = Date.now();
    console.log(`API调用成功，耗时: ${endTime - startTime}ms`);
    
    return response.data;
  } catch (error) {
    console.error('DeepSeek API调用失败:', error.message);
    throw error;
  }
}

// ==================== 模拟响应（用于测试） ====================
function generateMockResponse(code) {
  console.log('使用模拟响应（API密钥未配置）');
  
  const lines = code.split('\n').length;
  const issuesCount = Math.min(Math.floor(lines / 10), 10);
  
  const issues = [];
  for (let i = 0; i < issuesCount; i++) {
    issues.push({
      title: `示例问题 ${i + 1}`,
      severity: ['low', 'medium', 'high'][i % 3],
      line: Math.floor(Math.random() * lines) + 1,
      description: '这是一个示例问题描述',
      solution: '建议修复方法'
    });
  }
  
  return {
    choices: [{
      message: {
        content: JSON.stringify({
          summary: {
            critical: Math.floor(Math.random() * 2),
            high: Math.floor(Math.random() * 3),
            medium: Math.floor(Math.random() * 5),
            low: Math.floor(Math.random() * 8),
            total: issuesCount
          },
          issues: issues,
          suggestions: [
            '建议添加更多注释',
            '考虑使用设计模式重构',
            '优化算法复杂度'
          ],
          metrics: {
            complexity: Math.floor(Math.random() * 15) + 5,
            lines: lines,
            maintainability: Math.floor(Math.random() * 30) + 60,
            security: Math.floor(Math.random() * 40) + 50
          }
        }, null, 2)
      }
    }]
  };
}

// ==================== Express路由 ====================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查端点
app.get('/api/health', (req, res) => {
  res.json({
    status: apiKeyStatus.valid ? 'healthy' : 'degraded',
    api_key_configured: apiKeyStatus.valid,
    api_key_status: apiKeyStatus.code,
    message: apiKeyStatus.valid ? 'API已配置' : apiKeyStatus.reason,
    environment: NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// 代码分析端点
app.post('/api/analyze', async (req, res) => {
  try {
    const { code, options = {}, fileName = 'Unnamed.java' } = req.body;
    
    // 验证输入
    if (!code || code.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: '代码不能为空'
      });
    }
    
    if (code.length > 10000) {
      return res.status(400).json({
        success: false,
        error: '代码过长，请限制在10000字符以内'
      });
    }
    
    // 构建分析提示
    const analysisPrompt = `请分析以下Java代码，返回JSON格式的分析报告。

文件名: ${fileName}

要分析的Java代码:
\`\`\`java
${code.substring(0, 8000)}${code.length > 8000 ? '\n...（代码过长，已截断）' : ''}
\`\`\`

请返回包含以下结构的JSON:
{
  "summary": {
    "critical": 严重问题数量,
    "high": 高危问题数量,
    "medium": 中危问题数量,
    "low": 低危问题数量,
    "total": 总问题数
  },
  "issues": [
    {
      "title": "问题标题",
      "severity": "critical|high|medium|low",
      "line": 行号,
      "description": "详细描述",
      "solution": "修复建议"
    }
  ],
  "suggestions": ["优化建议1", "优化建议2"],
  "metrics": {
    "complexity": 圈复杂度,
    "lines": 代码行数,
    "maintainability": 可维护性评分(0-100),
    "security": 安全评分(0-100)
  }
}`;

    // 调用API
    const apiResponse = await callDeepSeekAPI(analysisPrompt, {
      model: 'deepseek-chat',
      maxTokens: 3500
    });
    
    // 解析响应
    let analysisResult;
    try {
      const aiContent = apiResponse.choices[0].message.content;
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        // 如果AI没有返回标准JSON，包装它
        analysisResult = {
          summary: { total: 1 },
          issues: [{
            title: 'AI响应解析',
            severity: 'info',
            description: aiContent.substring(0, 500)
          }],
          suggestions: ['AI返回了分析结果，但格式非标准'],
          metrics: { lines: code.split('\n').length }
        };
      }
    } catch (parseError) {
      console.error('解析AI响应失败:', parseError);
      analysisResult = {
        summary: { total: 0 },
        issues: [],
        suggestions: ['解析AI响应时出错'],
        metrics: { lines: code.split('\n').length }
      };
    }
    
    // 添加API密钥状态信息
    if (!apiKeyStatus.valid) {
      analysisResult.note = '注意: 当前使用模拟数据。请配置DEEPSEEK_API_KEY环境变量使用真实AI分析。';
    }
    
    res.json({
      success: true,
      data: analysisResult,
      api_status: apiKeyStatus
    });
    
  } catch (error) {
    console.error('分析请求失败:', error);
    
    // 根据错误类型返回不同响应
    let statusCode = 500;
    let errorMessage = error.message;
    
    if (error.message.includes('API密钥') || error.message.includes('权限')) {
      statusCode = 401;
    } else if (error.message.includes('超时') || error.message.includes('网络')) {
      statusCode = 408;
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      api_status: apiKeyStatus,
      solution: apiKeyStatus.valid ? 
        '请稍后重试或联系管理员' : 
        '请在Vercel环境变量中配置DEEPSEEK_API_KEY'
    });
  }
});

// 测试端点
app.post('/api/test', async (req, res) => {
  try {
    // 简单的测试请求
    const testPrompt = '请回复"Hello World"';
    const response = await callDeepSeekAPI(testPrompt, { maxTokens: 10 });
    
    res.json({
      success: true,
      message: 'API连接测试成功',
      response: response.choices[0].message.content,
      api_status: apiKeyStatus
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      api_status: apiKeyStatus
    });
  }
});

// 前端页面
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    success: false,
    error: '服务器内部错误',
    message: NODE_ENV === 'development' ? err.message : '请联系管理员'
  });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`环境: ${NODE_ENV}`);
  console.log(`API密钥状态: ${apiKeyStatus.valid ? '已配置' : '未配置'}`);
  if (!apiKeyStatus.valid) {
    console.log(`警告: ${apiKeyStatus.reason}`);
    console.log('提示: 请设置DEEPSEEK_API_KEY环境变量');
  }
  console.log(`健康检查: http://localhost:${PORT}/api/health`);
});

module.exports = app;
