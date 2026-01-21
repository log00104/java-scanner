const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();

// Vercel自动提供环境变量
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// 中间件
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查端点
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'Java Code Analyzer API',
        timestamp: new Date().toISOString(),
        api_key_configured: !!DEEPSEEK_API_KEY
    });
});

// 代码分析端点
app.post('/api/analyze', async (req, res) => {
    try {
        const { code, options, fileName } = req.body;

        if (!DEEPSEEK_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'API密钥未配置，请在环境变量中设置DEEPSEEK_API_KEY'
            });
        }

        if (!code || code.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: '代码不能为空'
            });
        }

        // 限制代码长度（防止滥用）
        if (code.length > 10000) {
            return res.status(400).json({
                success: false,
                error: '代码过长，请限制在10000字符以内'
            });
        }

        // 构建分析提示
        const analysisPrompt = buildAnalysisPrompt(code, options, fileName);

        // 调用DeepSeek API
        const response = await axios.post(
            'https://api.deepseek.com/v1/chat/completions',
            {
                model: 'deepseek-coder',
                messages: [
                    {
                        role: 'system',
                        content: `你是一个专业的Java代码安全审查和缺陷检测专家。请严格遵循JSON格式输出结果。`
                    },
                    {
                        role: 'user',
                        content: analysisPrompt
                    }
                ],
                max_tokens: 4000,
                temperature: 0.1, // 低温度保证确定性输出
                response_format: { type: "json_object" }
            },
            {
                headers: {
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json',
                }
            }
        );

        // 解析AI响应
        const aiResponse = response.data.choices[0].message.content;

        try {
            const analysisResult = JSON.parse(aiResponse);

            // 增强结果数据
            const enhancedResult = enhanceAnalysisResult(analysisResult, code);

            res.json({
                success: true,
                data: enhancedResult,
                usage: response.data.usage
            });

        } catch (parseError) {
            console.error('解析AI响应失败:', parseError);
            console.log('原始响应:', aiResponse);

            // 如果JSON解析失败，尝试提取JSON部分
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const analysisResult = JSON.parse(jsonMatch[0]);
                    res.json({
                        success: true,
                        data: enhanceAnalysisResult(analysisResult, code),
                        usage: response.data.usage
                    });
                } catch (e) {
                    throw new Error('AI响应格式错误');
                }
            } else {
                throw new Error('AI响应格式错误');
            }
        }

    } catch (error) {
        console.error('分析请求失败:', error.response?.data || error.message);

        // 提供友好的错误信息
        let errorMessage = '分析失败';
        let errorDetails = error.response?.data || error.message;

        if (error.response?.status === 401) {
            errorMessage = 'API密钥无效或过期';
        } else if (error.response?.status === 429) {
            errorMessage = '请求过于频繁，请稍后重试';
        } else if (error.response?.status === 503) {
            errorMessage = 'AI服务暂时不可用';
        }

        res.status(500).json({
            success: false,
            error: errorMessage,
            details: errorDetails
        });
    }
});

// 构建分析提示
function buildAnalysisPrompt(code, options, fileName) {
    const analysisTasks = [];

    if (options.security) {
        analysisTasks.push(`1. 安全漏洞检测:
   - SQL注入
   - 命令注入
   - XSS漏洞
   - 硬编码凭证
   - 不安全的反序列化
   - 路径遍历
   - 不安全的随机数生成`);
    }

    if (options.performance) {
        analysisTasks.push(`2. 性能问题:
   - 循环内创建对象
   - 字符串拼接低效
   - 不必要的自动装箱
   - 资源未及时释放
   - 算法复杂度问题
   - 内存泄漏风险`);
    }

    if (options.bugs) {
        analysisTasks.push(`3. 潜在Bug:
   - 空指针异常风险
   - 并发问题
   - 资源泄漏
   - 逻辑错误
   - 边界条件问题
   - 异常处理不当`);
    }

    if (options.style) {
        analysisTasks.push(`4. 代码规范:
   - 命名规范
   - 代码重复
   - 方法过长
   - 圈复杂度过高
   - 注释质量
   - 代码结构问题`);
    }

    const tasksDescription = analysisTasks.join('\n\n');

    return `请分析以下Java代码，检测所有问题并提供详细报告。

文件名: ${fileName || 'Unnamed.java'}

检测范围:
${tasksDescription}

要求:
1. 为每个问题指定严重性等级: critical, high, medium, low
2. 提供具体的行号和代码片段
3. 给出详细的修复建议
4. 计算代码的度量指标

返回格式必须是严格的JSON，结构如下:
{
  "summary": {
    "critical": 数量,
    "high": 数量,
    "medium": 数量,
    "low": 数量,
    "total": 总数
  },
  "issues": [
    {
      "title": "问题标题",
      "severity": "严重性等级",
      "line": 行号,
      "description": "详细描述",
      "codeSnippet": "相关代码",
      "solution": "修复建议"
    }
  ],
  "suggestions": [
    "整体优化建议1",
    "整体优化建议2"
  ],
  "metrics": {
    "complexity": 估算的圈复杂度,
    "lines": 代码行数,
    "maintainability": 可维护性评分(0-100),
    "security": 安全评分(0-100)
  }
}

要分析的Java代码:
\`\`\`java
${code}
\`\`\`

请直接返回JSON，不要有其他内容。`;
}

// 增强分析结果
function enhanceAnalysisResult(result, originalCode) {
    // 确保必要字段存在
    if (!result.summary) {
        result.summary = {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            total: 0
        };
    }

    if (!result.issues) {
        result.issues = [];
    }

    if (!result.suggestions) {
        result.suggestions = [];
    }

    if (!result.metrics) {
        result.metrics = {};
    }

    // 计算摘要统计数据
    result.summary.total = result.issues.length;

    // 计算严重性统计
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    result.issues.forEach(issue => {
        const severity = issue.severity?.toLowerCase() || 'low';
        if (severityCounts[severity] !== undefined) {
            severityCounts[severity]++;
        }
    });

    result.summary = { ...result.summary, ...severityCounts };

    // 添加基本度量指标（如果AI未提供）
    if (!result.metrics.lines) {
        result.metrics.lines = originalCode.split('\n').length;
    }

    if (!result.metrics.complexity) {
        // 简单估算圈复杂度
        result.metrics.complexity = estimateCyclomaticComplexity(originalCode);
    }

    if (!result.metrics.maintainability) {
        // 基于问题数量估算可维护性
        const issuePenalty = Math.min(result.summary.total * 5, 50);
        result.metrics.maintainability = Math.max(50, 100 - issuePenalty);
    }

    if (!result.metrics.security) {
        // 基于安全问题估算安全评分
        const securityIssues = result.issues.filter(issue =>
            issue.title?.toLowerCase().includes('安全') ||
            issue.description?.toLowerCase().includes('安全')
        ).length;

        const securityPenalty = securityIssues * 10;
        result.metrics.security = Math.max(0, 100 - securityPenalty);
    }

    return result;
}

// 简单估算圈复杂度
function estimateCyclomaticComplexity(code) {
    let complexity = 1; // 基础复杂度

    // 计算决策点
    const decisionPatterns = [
        /if\s*\(/g,
        /for\s*\(/g,
        /while\s*\(/g,
        /catch\s*\(/g,
        /case\s+/g,
        /&&/g,
        /\|\|/g,
        /\?/g
    ];

    decisionPatterns.forEach(pattern => {
        const matches = code.match(pattern);
        if (matches) {
            complexity += matches.length;
        }
    });

    return Math.max(1, Math.min(complexity, 50));
}

// 备用端点：快速分析（使用流式响应）
app.post('/api/analyze/quick', async (req, res) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ error: '代码不能为空' });
        }

        // 设置流式响应
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // 构建快速分析提示
        const quickPrompt = `请快速分析以下Java代码的主要问题（3-5个最重要的问题），用中文回答。保持简洁：

${code}

请以以下格式流式输出：
1. [严重性] 问题描述
2. [严重性] 问题描述
...`;

        const response = await axios.post(
            'https://api.deepseek.com/v1/chat/completions',
            {
                model: 'deepseek-coder',
                messages: [
                    {
                        role: 'user',
                        content: quickPrompt
                    }
                ],
                stream: true,
                max_tokens: 1000,
                temperature: 0.3
            },
            {
                headers: {
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                responseType: 'stream'
            }
        );

        // 转发流式响应
        response.data.on('data', (chunk) => {
            res.write(chunk.toString());
        });

        response.data.on('end', () => {
            res.write('data: [DONE]\n\n');
            res.end();
        });

        response.data.on('error', (error) => {
            console.error('流式响应错误:', error);
            res.write('data: {"error": "Stream error"}\n\n');
            res.end();
        });

    } catch (error) {
        console.error('快速分析失败:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: '分析失败', details: error.message });
        }
    }
});

// 获取支持的检测类型
app.get('/api/checktypes', (req, res) => {
    res.json({
        checkTypes: [
            {
                id: 'security',
                name: '安全漏洞',
                description: '检测SQL注入、命令注入等安全风险',
                enabled: true
            },
            {
                id: 'performance',
                name: '性能问题',
                description: '检测循环内创建对象、字符串拼接低效等问题',
                enabled: true
            },
            {
                id: 'bugs',
                name: '潜在Bug',
                description: '检测空指针异常、资源泄漏等潜在问题',
                enabled: true
            },
            {
                id: 'style',
                name: '代码规范',
                description: '检测命名规范、代码重复等问题',
                enabled: true
            }
        ]
    });
});

// 所有其他路由返回前端
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Vercel会自动设置端口
const PORT = process.env.PORT || 3000;

// 本地开发时启动服务器
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
        console.log(`📝 Java代码分析工具已启动`);
        console.log(`🔑 API密钥状态: ${DEEPSEEK_API_KEY ? '已设置' : '未设置（需要设置）'}`);
    });
}

module.exports = app;