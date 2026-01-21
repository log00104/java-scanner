/**
 * Java代码缺陷检测工具 - 后端服务器
 * 针对Vercel部署优化版本
 * 包含冷启动处理、重试机制、详细错误日志
 */

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");

const app = express();

// ============ 配置和初始化 ============

// 获取环境变量 - 处理不同环境
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || process.env.REACT_APP_DEEPSEEK_API_KEY || "";
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

// 标记冷启动
let isColdStart = true;
const startupTime = new Date();

// 请求计数器
let requestCount = 0;
let apiCallCount = 0;
let errorCount = 0;

// ============ 中间件配置 ============

// CORS配置
app.use(cors({
  origin: IS_PRODUCTION ? [
    "https://java-scanner.vercel.app",
    "https://*.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173"
  ] : "*",
  credentials: true,
  methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"]
}));

// 请求体解析
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// 请求日志中间件
app.use((req, res, next) => {
  requestCount++;
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // 记录请求开始
  console.log(`[${new Date().toISOString()}] [${requestId}] ${req.method} ${req.path} - 开始`);
  
  if (isColdStart) {
    console.log(`[${requestId}] ⚡ 冷启动请求 - 应用启动于: ${startupTime.toISOString()}`);
    global.coldStart = true;
    isColdStart = false;
  }
  
  // 添加请求ID到响应头
  res.setHeader("X-Request-ID", requestId);
  
  // 监听响应完成
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] [${requestId}] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  
  next();
});

// ============ 静态文件服务 ============

// 静态文件缓存（生产环境）
const staticOptions = IS_PRODUCTION ? {
  maxAge: "1d",
  setHeaders: (res, path) => {
    if (path.endsWith(".html")) {
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    } else if (path.endsWith(".js") || path.endsWith(".css")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  }
} : {};

app.use(express.static(path.join(__dirname, "public"), staticOptions));

// ============ 工具函数 ============

/**
 * 安全的API调用函数，包含重试机制
 */
async function callDeepSeekAPI(prompt, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxTokens = 2000,
    temperature = 0.1,
    model = "deepseek-coder"
  } = options;
  
  apiCallCount++;
  
  // 检查API密钥
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY 未配置");
  }
  
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[API调用] 尝试 ${attempt}/${maxRetries}, 令牌: ${DEEPSEEK_API_KEY.substring(0, 8)}...`);
      
      // 动态调整超时时间
      const timeout = Math.min(30000 + (attempt * 10000), 60000);
      
      const response = await axios.post(
        "https://api.deepseek.com/v1/chat/completions",
        {
          model: model,
          messages: [
            {
              role: "system",
              content: "你是一个Java代码安全审查和缺陷检测专家。请严格分析代码问题，并以JSON格式返回结果。"
            },
            {
              role: "user",
              content: prompt
            }
          ],
          max_tokens: maxTokens,
          temperature: temperature,
          response_format: { type: "json_object" }
        },
        {
          headers: {
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
            "Content-Type": "application/json",
            "User-Agent": "Java-Code-Scanner/1.0"
          },
          timeout: timeout,
          validateStatus: (status) => status < 500 // 只重试服务器错误
        }
      );
      
      console.log(`[API调用] 成功！使用令牌: ${response.data.usage?.total_tokens || '未知'}`);
      return response.data;
      
    } catch (error) {
      lastError = error;
      errorCount++;
      
      const errorDetails = {
        attempt,
        maxRetries,
        error: error.message,
        code: error.code,
        status: error.response?.status,
        data: error.response?.data
      };
      
      console.error(`[API调用] 尝试 ${attempt} 失败:`, errorDetails);
      
      // 如果是API密钥错误，立即失败
      if (error.response?.status === 401) {
        throw new Error("API密钥无效或已过期");
      }
      
      // 如果是速率限制，等待更长时间
      if (error.response?.status === 429) {
        const waitTime = baseDelay * Math.pow(2, attempt) * 5; // 指数退避
        console.log(`[API调用] 速率限制，等待 ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // 如果是服务器错误，等待后重试
      if (error.response?.status >= 500 || !error.response) {
        if (attempt < maxRetries) {
          const waitTime = baseDelay * Math.pow(2, attempt - 1);
          console.log(`[API调用] 等待 ${waitTime}ms 后重试`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
      }
      
      // 其他错误立即抛出
      throw error;
    }
  }
  
  throw lastError || new Error("API调用失败，达到最大重试次数");
}

/**
 * 解析AI响应为结构化数据
 */
function parseAIResponse(aiResponse, originalCode) {
  try {
    // 尝试直接解析JSON
    const parsed = JSON.parse(aiResponse);
    
    // 验证和标准化响应结构
    const result = {
      summary: parsed.summary || { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      metrics: parsed.metrics || {}
    };
    
    // 确保summary有total字段
    if (!result.summary.total && result.summary) {
      const { critical = 0, high = 0, medium = 0, low = 0 } = result.summary;
      result.summary.total = critical + high + medium + low;
    }
    
    // 计算基本指标
    if (!result.metrics.lines) {
      result.metrics.lines = originalCode.split("\n").length;
    }
    
    return result;
    
  } catch (parseError) {
    console.warn("[解析] AI响应不是标准JSON，尝试提取:", aiResponse.substring(0, 200));
    
    // 返回安全的结构
    return {
      summary: { critical: 0, high: 0, medium: 0, low: 1, total: 1 },
      issues: [
        {
          title: "AI响应解析",
          severity: "low",
          line: 1,
          description: aiResponse.substring(0, 500),
          solution: "AI返回了非标准格式，但内容可能有用"
        }
      ],
      suggestions: ["请检查AI返回的原始内容"],
      metrics: {
        complexity: 5,
        lines: originalCode.split("\n").length,
        maintainability: 80,
        security: 85
      }
    };
  }
}

/**
 * 生成分析提示
 */
function generateAnalysisPrompt(code, options = {}, fileName = "") {
  const analysisTasks = [];
  
  if (options.security !== false) {
    analysisTasks.push("安全漏洞检测（SQL注入、命令注入、硬编码凭证等）");
  }
  
  if (options.performance !== false) {
    analysisTasks.push("性能问题（循环内创建对象、字符串拼接低效等）");
  }
  
  if (options.bugs !== false) {
    analysisTasks.push("潜在Bug（空指针异常、资源泄漏、并发问题等）");
  }
  
  if (options.style !== false) {
    analysisTasks.push("代码规范（命名规范、代码重复、复杂度等）");
  }
  
  const tasksDescription = analysisTasks.length > 0 
    ? `检测范围：${analysisTasks.join("、")}`
    : "全面代码分析";
  
  return `请分析以下Java代码，返回详细的缺陷检测报告。

文件：${fileName || "未命名.java"}
${tasksDescription}

要求：
1. 返回严格的JSON格式
2. 为每个问题指定严重性等级：critical（严重）、high（高危）、medium（中危）、low（低危）
3. 提供具体的行号和代码片段
4. 给出详细的修复建议
5. 计算代码的度量指标

JSON格式要求：
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
  "suggestions": ["整体优化建议1", "整体优化建议2"],
  "metrics": {
    "complexity": "圈复杂度",
    "lines": "代码行数",
    "maintainability": "可维护性评分(0-100)",
    "security": "安全评分(0-100)"
  }
}

要分析的Java代码：
\`\`\`java
${code}
\`\`\`

请直接返回JSON，不要有其他解释。`;
}

// ============ API 路由 ============

/**
 * 健康检查端点
 */
app.get("/api/health", (req, res) => {
  const memoryUsage = process.memoryUsage();
  
  res.json({
    status: "ok",
    apiKeyConfigured: !!DEEPSEEK_API_KEY,
    apiKeyPreview: DEEPSEEK_API_KEY 
      ? `${DEEPSEEK_API_KEY.substring(0, 6)}...${DEEPSEEK_API_KEY.substring(DEEPSEEK_API_KEY.length - 4)}`
      : "未设置",
    environment: NODE_ENV,
    uptime: process.uptime(),
    startupTime: startupTime.toISOString(),
    coldStart: global.coldStart || false,
    requestCount,
    apiCallCount,
    errorCount,
    memory: {
      rss: Math.round(memoryUsage.rss / 1024 / 1024) + "MB",
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + "MB",
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + "MB"
    },
    nodeVersion: process.version,
    timestamp: new Date().toISOString()
  });
});

/**
 * 配置信息端点
 */
app.get("/api/config", (req, res) => {
  res.json({
    service: "Java Code Scanner API",
    version: "1.0.0",
    environment: NODE_ENV,
    features: {
      aiAnalysis: !!DEEPSEEK_API_KEY,
      fileUpload: true,
      history: true,
      export: true
    },
    limits: {
      maxCodeLength: 10000,
      maxFileSize: "1MB",
      timeout: "60s"
    },
    supportedJavaVersions: ["Java 8+", "Java 17+", "Java 21"],
    timestamp: new Date().toISOString()
  });
});

/**
 * 预热端点 - 保持函数活跃
 */
app.get("/api/warmup", async (req, res) => {
  console.log("[预热] 保持函数活跃请求");
  
  // 模拟API调用检查
  const apiStatus = DEEPSEEK_API_KEY ? "configured" : "not_configured";
  
  res.json({
    status: "warm",
    message: "函数已预热",
    apiKeyStatus: apiStatus,
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
    timestamp: new Date().toISOString()
  });
});

/**
 * 代码分析主端点
 */
app.post("/api/analyze", async (req, res) => {
  const requestId = res.getHeader("X-Request-ID") || `analyze_${Date.now()}`;
  const startTime = Date.now();
  
  try {
    console.log(`[${requestId}] 收到分析请求`);
    
    const { code, options = {}, fileName = "" } = req.body;
    
    // 验证输入
    if (!code || typeof code !== "string" || code.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "代码不能为空",
        requestId
      });
    }
    
    // 检查代码长度
    if (code.length > 10000) {
      return res.status(400).json({
        success: false,
        error: `代码过长 (${code.length}字符)，请限制在10000字符以内`,
        requestId
      });
    }
    
    // 检查API密钥配置
    if (!DEEPSEEK_API_KEY) {
      console.warn(`[${requestId}] API密钥未配置，使用演示模式`);
      return useDemoMode(code, fileName, res, requestId);
    }
    
    console.log(`[${requestId}] 代码长度: ${code.length}字符，文件: ${fileName || "未命名"}`);
    
    // 生成分析提示
    const prompt = generateAnalysisPrompt(code, options, fileName);
    
    // 调用AI API
    console.log(`[${requestId}] 开始AI分析...`);
    const aiResponse = await callDeepSeekAPI(prompt, {
      maxTokens: 2500,
      model: "deepseek-coder"
    });
    
    const aiContent = aiResponse.choices[0].message.content;
    console.log(`[${requestId}] AI响应长度: ${aiContent.length}字符`);
    
    // 解析响应
    const analysisResult = parseAIResponse(aiContent, code);
    
    // 添加元数据
    analysisResult.metadata = {
      analyzedAt: new Date().toISOString(),
      fileName: fileName || "未命名.java",
      codeLines: code.split("\n").length,
      codeSize: code.length,
      aiModel: "deepseek-coder",
      processingTime: Date.now() - startTime
    };
    
    // 返回成功响应
    res.json({
      success: true,
      data: analysisResult,
      usage: aiResponse.usage,
      processingTime: Date.now() - startTime,
      requestId
    });
    
    console.log(`[${requestId}] 分析完成，耗时: ${Date.now() - startTime}ms`);
    
  } catch (error) {
    errorCount++;
    const processingTime = Date.now() - startTime;
    
    console.error(`[${requestId}] 分析失败:`, {
      error: error.message,
      stack: error.stack,
      processingTime,
      codeLength: req.body?.code?.length || 0
    });
    
    // 提供友好的错误信息
    let errorMessage = "分析失败";
    let errorDetails = error.message;
    let statusCode = 500;
    
    if (error.message.includes("API密钥无效") || error.message.includes("未配置")) {
      errorMessage = "服务器配置错误";
      errorDetails = "API密钥未配置或无效";
      statusCode = 503;
    } else if (error.message.includes("timeout") || error.message.includes("TIMEDOUT")) {
      errorMessage = "分析超时";
      errorDetails = "AI服务响应时间过长，请稍后重试";
      statusCode = 504;
    } else if (error.message.includes("rate limit") || error.message.includes("429")) {
      errorMessage = "请求过于频繁";
      errorDetails = "已达到API调用限制，请稍后再试";
      statusCode = 429;
    } else if (error.message.includes("network") || error.message.includes("ECONNREFUSED")) {
      errorMessage = "网络错误";
      errorDetails = "无法连接到AI服务，请检查网络连接";
      statusCode = 503;
    }
    
    // 返回错误响应
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: errorDetails,
      processingTime,
      requestId,
      fallback: !DEEPSEEK_API_KEY ? "建议使用演示模式" : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 演示模式分析端点
 */
app.post("/api/analyze/demo", (req, res) => {
  const requestId = res.getHeader("X-Request-ID") || `demo_${Date.now()}`;
  
  try {
    const { code, fileName = "" } = req.body;
    
    if (!code || typeof code !== "string") {
      return res.status(400).json({
        success: false,
        error: "代码不能为空",
        requestId
      });
    }
    
    // 生成模拟分析结果
    const lines = code.split("\n").length;
    const issues = [];
    
    // 根据代码内容生成一些模拟问题
    if (code.includes("System.out.println")) {
      issues.push({
        title: "使用System.out.println",
        severity: "low",
        line: code.indexOf("System.out.println"),
        description: "在生产代码中建议使用日志框架",
        codeSnippet: "System.out.println(...)",
        solution: "使用SLF4J或Log4j等日志框架"
      });
    }
    
    if (code.includes("new String(")) {
      issues.push({
        title: "不必要的字符串构造",
        severity: "medium",
        line: code.indexOf("new String("),
        description: "直接使用字符串字面量，避免不必要的对象创建",
        codeSnippet: "new String(\"text\")",
        solution: "使用字符串字面量：\"text\""
      });
    }
    
    if (code.includes("+=") && code.includes("for") || code.includes("while")) {
      issues.push({
        title: "循环内字符串拼接",
        severity: "medium",
        line: Math.max(code.indexOf("for"), code.indexOf("while")),
        description: "在循环内使用字符串拼接效率低下",
        codeSnippet: "result += item;",
        solution: "使用StringBuilder提高性能"
      });
    }
    
    // 确保至少有一个问题
    if (issues.length === 0) {
      issues.push({
        title: "代码结构良好",
        severity: "low",
        line: 1,
        description: "未发现明显问题",
        solution: "继续保持良好的编码习惯"
      });
    }
    
    const result = {
      summary: {
        critical: Math.random() > 0.9 ? 1 : 0,
        high: issues.filter(i => i.severity === "high").length,
        medium: issues.filter(i => i.severity === "medium").length,
        low: issues.filter(i => i.severity === "low").length,
        total: issues.length
      },
      issues: issues,
      suggestions: [
        "建议添加更多注释",
        "考虑使用设计模式优化结构",
        "添加单元测试提高代码质量"
      ],
      metrics: {
        complexity: Math.floor(Math.random() * 15) + 5,
        lines: lines,
        maintainability: Math.floor(Math.random() * 30) + 70,
        security: Math.floor(Math.random() * 35) + 65
      },
      metadata: {
        mode: "demo",
        analyzedAt: new Date().toISOString(),
        fileName: fileName || "未命名.java",
        note: "这是演示数据，配置API密钥后可使用真实AI分析"
      }
    };
    
    res.json({
      success: true,
      data: result,
      requestId,
      note: DEEPSEEK_API_KEY 
        ? "API已配置，但当前使用演示模式" 
        : "未配置API密钥，使用演示模式"
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "演示模式错误",
      details: error.message,
      requestId
    });
  }
});

/**
 * 演示模式辅助函数
 */
function useDemoMode(code, fileName, res, requestId) {
  // 创建临时请求对象调用演示端点
  const mockReq = { body: { code, fileName } };
  const mockRes = {
    json: (data) => {
      data.demoFallback = true;
      data.note = "由于API密钥未配置，自动使用演示模式";
      res.json(data);
    },
    status: (code) => ({
      json: (data) => {
        data.demoFallback = true;
        res.status(code).json(data);
      }
    })
  };
  
  // 调用演示端点
  require("./server.js").prototype.post.call(
    { getHeader: () => requestId },
    "/api/analyze/demo",
    mockReq,
    mockRes
  );
}

/**
 * 快速分析端点（简化版）
 */
app.post("/api/analyze/quick", async (req, res) => {
  const requestId = res.getHeader("X-Request-ID") || `quick_${Date.now()}`;
  
  try {
    const { code } = req.body;
    
    if (!code || code.trim().length === 0) {
      return res.status(400).json({ error: "代码不能为空" });
    }
    
    // 简单分析，不调用AI
    const issues = [];
    const lines = code.split("\n");
    
    lines.forEach((line, index) => {
      const lineNum = index + 1;
      
      // 简单规则检测
      if (line.includes("System.out.println") && !line.includes("//")) {
        issues.push({
          line: lineNum,
          issue: "使用System.out.println",
          suggestion: "建议使用日志框架"
        });
      }
      
      if (line.includes("new String(")) {
        issues.push({
          line: lineNum,
          issue: "不必要的字符串构造",
          suggestion: "直接使用字符串字面量"
        });
      }
    });
    
    res.json({
      success: true,
      quickAnalysis: true,
      issues: issues,
      totalLines: lines.length,
      issueCount: issues.length,
      requestId
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "快速分析失败",
      requestId
    });
  }
});

/**
 * 历史记录端点（示例）
 */
app.get("/api/history", (req, res) => {
  // 这里可以连接数据库，当前返回示例
  res.json({
    success: true,
    data: {
      total: 0,
      history: [],
      message: "历史记录功能待实现"
    }
  });
});

// ============ 前端路由 ============

/**
 * 主页路由
 */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/**
 * 所有其他路由返回404或重定向到首页
 */
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({
      success: false,
      error: "API端点不存在",
      path: req.path,
      availableEndpoints: [
        "/api/health",
        "/api/config",
        "/api/analyze",
        "/api/analyze/demo",
        "/api/analyze/quick",
        "/api/warmup"
      ]
    });
  } else {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }
});

// ============ 错误处理 ============

// 404处理
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: "路由不存在",
    path: req.path,
    method: req.method
  });
});

// 全局错误处理
app.use((err, req, res, next) => {
  errorCount++;
  
  console.error("[全局错误]", {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    requestId: res.getHeader("X-Request-ID")
  });
  
  const statusCode = err.statusCode || 500;
  
  res.status(statusCode).json({
    success: false,
    error: "服务器内部错误",
    message: IS_PRODUCTION ? "请稍后重试" : err.message,
    requestId: res.getHeader("X-Request-ID"),
    timestamp: new Date().toISOString()
  });
});

// ============ 服务器启动 ============

const PORT = process.env.PORT || 3000;

// 启动服务器
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`
    🚀 Java代码缺陷检测工具服务器启动成功！
    
    环境: ${NODE_ENV}
    端口: ${PORT}
    模式: ${IS_PRODUCTION ? "生产环境" : "开发环境"}
    API密钥: ${DEEPSEEK_API_KEY ? "已配置" : "未配置 (使用演示模式)"}
    
    接口地址:
    - 主页: http://localhost:${PORT}
    - 健康检查: http://localhost:${PORT}/api/health
    - 配置信息: http://localhost:${PORT}/api/config
    - 分析端点: http://localhost:${PORT}/api/analyze
    - 演示模式: http://localhost:${PORT}/api/analyze/demo
    - 预热端点: http://localhost:${PORT}/api/warmup
    
    启动时间: ${startupTime.toISOString()}
    `);
  });
  
  // 优雅关闭
  process.on("SIGTERM", () => {
    console.log("收到 SIGTERM 信号，正在优雅关闭服务器...");
    server.close(() => {
      console.log("服务器已关闭");
      process.exit(0);
    });
    
    // 强制关闭超时
    setTimeout(() => {
      console.error("强制关闭服务器");
      process.exit(1);
    }, 10000);
  });
  
  // 未捕获异常处理
  process.on("uncaughtException", (error) => {
    console.error("未捕获异常:", error);
    // 记录后退出
    process.exit(1);
  });
  
  process.on("unhandledRejection", (reason, promise) => {
    console.error("未处理的Promise拒绝:", reason);
  });
}

module.exports = app;
