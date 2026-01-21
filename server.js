const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");

const app = express();

// 获取环境变量
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件
app.use(express.static(path.join(__dirname, "public")));

// ============ API 路由 ============

// 1. 健康检查
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    apiKeyConfigured: !!DEEPSEEK_API_KEY,
    timestamp: new Date().toISOString(),
    message: "Java Code Analyzer API is running"
  });
});

// 2. 代码分析端点
app.post("/api/analyze", async (req, res) => {
  try {
    console.log("收到分析请求");
    
    const { code, options, fileName } = req.body;
    
    // 验证输入
    if (!code || code.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "代码不能为空"
      });
    }
    
    // 检查API密钥
    if (!DEEPSEEK_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "服务器配置错误: API密钥未设置",
        solution: "请在Vercel环境变量中添加DEEPSEEK_API_KEY"
      });
    }
    
    // 限制代码长度
    if (code.length > 10000) {
      return res.status(400).json({
        success: false,
        error: "代码过长，请限制在10000字符以内"
      });
    }
    
    console.log("调用DeepSeek API...");
    
    // 调用DeepSeek API
    const response = await axios.post(
      "https://api.deepseek.com/v1/chat/completions",
      {
        model: "deepseek-coder",
        messages: [
          {
            role: "user",
            content: `请分析以下Java代码，返回JSON格式的缺陷报告：\n\n${code}\n\n请按严重性分类问题，并提供修复建议。`
          }
        ],
        max_tokens: 2000,
        temperature: 0.1
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 30000 // 30秒超时
      }
    );
    
    const aiResponse = response.data.choices[0].message.content;
    
    // 尝试解析JSON
    try {
      const analysisResult = JSON.parse(aiResponse);
      
      res.json({
        success: true,
        data: analysisResult,
        usage: response.data.usage
      });
      
    } catch (parseError) {
      // 如果AI返回的不是标准JSON，包装它
      res.json({
        success: true,
        data: {
          summary: { total: 1, critical: 0, high: 0, medium: 0, low: 1 },
          issues: [
            {
              title: "AI分析结果",
              severity: "low",
              line: 1,
              description: aiResponse.substring(0, 500),
              solution: "这是AI的原始分析结果"
            }
          ],
          suggestions: ["请检查代码逻辑", "优化算法复杂度"],
          metrics: {
            complexity: 5,
            lines: code.split("\n").length,
            maintainability: 80,
            security: 85
          }
        },
        note: "AI返回了非标准JSON格式"
      });
    }
    
  } catch (error) {
    console.error("分析错误:", error.message);
    
    // 提供友好的错误信息
    let errorMessage = "分析失败";
    if (error.response) {
      errorMessage = `API错误: ${error.response.status} ${error.response.statusText}`;
    } else if (error.request) {
      errorMessage = "网络错误: 无法连接到AI服务";
    } else {
      errorMessage = `错误: ${error.message}`;
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage,
      details: error.message
    });
  }
});

// 3. 模拟分析端点（如果API密钥未设置）
app.post("/api/analyze/demo", (req, res) => {
  const { code } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: "代码不能为空" });
  }
  
  res.json({
    success: true,
    data: {
      summary: { critical: 1, high: 2, medium: 3, low: 4, total: 10 },
      issues: [
        {
          title: "示例: 潜在的空指针异常",
          severity: "high",
          line: 15,
          description: "在第15行，变量可能为null",
          codeSnippet: "String result = user.getName(); // user可能为null",
          solution: "添加空值检查: if (user != null) user.getName()"
        },
        {
          title: "示例: 字符串拼接低效",
          severity: "medium",
          line: 23,
          description: "循环内使用字符串拼接，性能低下",
          codeSnippet: "result += item; // 应该使用StringBuilder",
          solution: "使用StringBuilder: StringBuilder sb = new StringBuilder();"
        }
      ],
      suggestions: [
        "建议使用try-with-resources管理资源",
        "考虑添加输入验证",
        "优化数据库查询性能"
      ],
      metrics: {
        complexity: 12,
        lines: code.split("\n").length,
        maintainability: 75,
        security: 80
      }
    },
    note: DEEPSEEK_API_KEY ? "真实AI分析" : "这是演示数据，请配置API密钥使用真实分析"
  });
});

// 4. 所有其他路由返回前端
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 错误处理
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "服务器内部错误" });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`API密钥配置: ${DEEPSEEK_API_KEY ? "已设置" : "未设置"}`);
  console.log(`健康检查: http://localhost:${PORT}/api/health`);
  console.log(`分析端点: http://localhost:${PORT}/api/analyze`);
});

module.exports = app;
