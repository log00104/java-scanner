// 配置
const API_BASE_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000/api'
    : '/api';

// DOM元素
const codeInput = document.getElementById('codeInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const fileUpload = document.getElementById('fileUpload');
const dropArea = document.getElementById('dropArea');
const resultsArea = document.getElementById('resultsArea');
const summaryCards = document.getElementById('summaryCards');
const issuesList = document.getElementById('issuesList');
const codeViewer = document.getElementById('codeViewer');
const apiStatus = document.getElementById('apiStatus');
const historyList = document.getElementById('historyList');

// 状态变量
let currentCode = '';
let currentFile = null;
let analysisHistory = JSON.parse(localStorage.getItem('javaAnalysisHistory')) || [];

// 示例代码
const sampleCode = {
    vulnerable: `import java.sql.*;

public class VulnerableCode {
    // 示例：SQL注入漏洞
    public void getUserData(String userId) {
        try {
            Connection conn = DriverManager.getConnection("jdbc:mysql://localhost:3306/test");
            // 危险：直接拼接用户输入
            String sql = "SELECT * FROM users WHERE id = '" + userId + "'";
            Statement stmt = conn.createStatement();
            ResultSet rs = stmt.executeQuery(sql);
            
            // 示例：硬编码密码
            String password = "admin123"; // 安全漏洞
            
            while (rs.next()) {
                System.out.println(rs.getString("username"));
            }
            
            rs.close();
            stmt.close();
            conn.close();
        } catch (SQLException e) {
            e.printStackTrace();
        }
    }
    
    // 示例：命令注入
    public void executeCommand(String input) {
        try {
            // 危险：执行用户输入的命令
            Runtime.getRuntime().exec("cmd /c " + input);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}`,

    performance: `import java.util.*;

public class PerformanceIssues {
    private List<String> items = new ArrayList<>();
    
    // 示例：循环内创建对象
    public void inefficientLoop() {
        for (int i = 0; i < 10000; i++) {
            String s = new String("item" + i); // 应该使用String.valueOf()
            items.add(s);
        }
    }
    
    // 示例：字符串拼接低效
    public String buildString(List<String> strings) {
        String result = "";
        for (String s : strings) {
            result += s; // 应该使用StringBuilder
        }
        return result;
    }
    
    // 示例：不必要的自动装箱
    public void unnecessaryBoxing() {
        Long sum = 0L; // 应该是long
        for (int i = 0; i < Integer.MAX_VALUE; i++) {
            sum += i; // 每次循环都进行自动装箱
        }
    }
}`,

    buggy: `import java.io.*;

public class BuggyCode {
    // 示例：资源未关闭
    public void readFile(String path) {
        try {
            FileReader reader = new FileReader(path);
            BufferedReader br = new BufferedReader(reader);
            String line = br.readLine();
            System.out.println(line);
            // 忘记关闭资源！
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
    
    // 示例：空指针异常风险
    public void processData(String data) {
        if (data.equals("test")) { // 应该先检查null
            System.out.println("Processing data");
        }
    }
    
    // 示例：并发问题
    private int counter = 0;
    
    public void incrementCounter() {
        counter++; // 不是线程安全的
    }
}`,

    style: `public class StyleProblems {
    // 示例：糟糕的命名
    private int a; // 应该用有意义的名称
    private String s;
    
    // 示例：过长的方法
    public void doEverything() {
        // ... 200行代码 ...
        // 应该拆分成多个小方法
    }
    
    // 示例：重复代码
    public void method1() {
        System.out.println("Header");
        System.out.println("Processing...");
        System.out.println("Footer");
    }
    
    public void method2() {
        System.out.println("Header");
        System.out.println("Another process...");
        System.out.println("Footer");
    }
    
    // 示例：过高的圈复杂度
    public void complexMethod(int value) {
        if (value > 0) {
            if (value < 10) {
                for (int i = 0; i < value; i++) {
                    if (i % 2 == 0) {
                        // ... 更多嵌套 ...
                    }
                }
            }
        }
    }
}`
};

// 初始化
document.addEventListener('DOMContentLoaded', function () {
    initEventListeners();
    loadHistory();
    checkAPIStatus();
    updateCharCount();

    // 初始化代码高亮
    hljs.highlightAll();
});

// 初始化事件监听器
function initEventListeners() {
    // 输入模式切换
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.input-mode').forEach(m => m.classList.remove('active'));

            this.classList.add('active');
            const mode = this.dataset.mode;
            document.getElementById(mode + 'Input').classList.add('active');
        });
    });

    // 代码输入监听
    codeInput.addEventListener('input', updateCharCount);

    // 文件上传
    fileUpload.addEventListener('change', handleFileUpload);

    // 拖放功能
    dropArea.addEventListener('dragover', function (e) {
        e.preventDefault();
        this.style.borderColor = '#2563eb';
        this.style.background = '#f1f5f9';
    });

    dropArea.addEventListener('dragleave', function (e) {
        e.preventDefault();
        this.style.borderColor = '#cbd5e1';
        this.style.background = '#f8fafc';
    });

    dropArea.addEventListener('drop', function (e) {
        e.preventDefault();
        this.style.borderColor = '#cbd5e1';
        this.style.background = '#f8fafc';

        if (e.dataTransfer.files.length) {
            handleFileUpload({ target: { files: e.dataTransfer.files } });
        }
    });

    // 分析按钮
    analyzeBtn.addEventListener('click', analyzeCode);

    // 示例按钮
    document.getElementById('sampleBtn').addEventListener('click', showSampleModal);
    document.getElementById('clearBtn').addEventListener('click', clearCode);

    // 模态框
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', function () {
            document.getElementById('sampleModal').classList.add('hidden');
        });
    });

    document.querySelectorAll('.sample-item').forEach(item => {
        item.addEventListener('click', function () {
            const sample = this.dataset.sample;
            codeInput.value = sampleCode[sample];
            updateCharCount();
            document.getElementById('sampleModal').classList.add('hidden');
            switchToTextMode();
        });
    });

    // 选项卡切换
    document.querySelectorAll('.tab-btn').forEach(tab => {
        tab.addEventListener('click', function () {
            document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

            this.classList.add('active');
            document.getElementById('tab-' + this.dataset.tab).classList.add('active');
        });
    });

    // 导出和复制按钮
    document.getElementById('exportBtn').addEventListener('click', exportReport);
    document.getElementById('copyBtn').addEventListener('click', copyResults);
    document.getElementById('clearHistory').addEventListener('click', clearHistory);
}

// 更新字符计数
function updateCharCount() {
    const text = codeInput.value;
    const charCount = text.length;
    const lineCount = text.split('\\n').length;

    document.getElementById('charCount').textContent = `${charCount} 字符`;
    document.getElementById('lineCount').textContent = `${lineCount} 行`;
}

// 切换文本输入模式
function switchToTextMode() {
    document.querySelector('[data-mode="text"]').click();
}

// 处理文件上传
function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // 检查文件类型
    if (!file.name.endsWith('.java') && !file.name.endsWith('.txt')) {
        alert('请选择 .java 或 .txt 文件');
        return;
    }

    // 检查文件大小
    if (file.size > 1024 * 1024) { // 1MB
        alert('文件大小不能超过 1MB');
        return;
    }

    currentFile = file;

    // 显示文件信息
    const fileInfo = document.getElementById('fileInfo');
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileSize').textContent = formatFileSize(file.size);
    fileInfo.classList.remove('hidden');

    // 读取文件内容
    const reader = new FileReader();
    reader.onload = function (e) {
        codeInput.value = e.target.result;
        updateCharCount();
    };
    reader.readAsText(file);

    // 移除文件按钮
    document.getElementById('removeFile').addEventListener('click', function () {
        currentFile = null;
        fileInfo.classList.add('hidden');
        fileUpload.value = '';
        codeInput.value = '';
        updateCharCount();
    });
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 检查API状态
async function checkAPIStatus() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        const data = await response.json();

        const statusDot = apiStatus.querySelector('.status-dot');
        const statusText = apiStatus.querySelector('span:last-child');

        if (data.status === 'healthy') {
            statusDot.classList.add('online');
            statusText.textContent = '在线';
        } else {
            statusDot.classList.remove('online');
            statusText.textContent = '离线';
        }
    } catch (error) {
        console.error('API状态检查失败:', error);
        apiStatus.querySelector('.status-dot').classList.remove('online');
        apiStatus.querySelector('span:last-child').textContent = '连接失败';
    }
}

// 分析代码
async function analyzeCode() {
    const code = codeInput.value.trim();
    if (!code) {
        alert('请输入或上传Java代码');
        return;
    }

    currentCode = code;

    // 显示加载状态
    showLoading(true);
    clearResults();

    // 获取分析选项
    const options = {
        security: document.getElementById('optSecurity').checked,
        performance: document.getElementById('optPerformance').checked,
        style: document.getElementById('optStyle').checked,
        bugs: document.getElementById('optBugs').checked
    };

    try {
        const response = await fetch(`${API_BASE_URL}/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                code: code,
                options: options,
                fileName: currentFile ? currentFile.name : 'Unnamed.java'
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP错误: ${response.status}`);
        }

        const result = await response.json();

        if (result.success) {
            displayResults(result.data);
            saveToHistory(code, result.data);
        } else {
            throw new Error(result.error || '分析失败');
        }

    } catch (error) {
        console.error('分析失败:', error);
        showError('分析失败: ' + error.message);
    } finally {
        showLoading(false);
    }
}

// 显示加载状态
function showLoading(isLoading) {
    const loadingSpinner = document.getElementById('loadingSpinner');
    const statusMessage = document.getElementById('statusMessage');
    const analyzeBtn = document.getElementById('analyzeBtn');

    if (isLoading) {
        loadingSpinner.classList.remove('hidden');
        statusMessage.classList.add('hidden');
        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 分析中...';
    } else {
        loadingSpinner.classList.add('hidden');
        statusMessage.classList.add('hidden');
        analyzeBtn.disabled = false;
        analyzeBtn.innerHTML = '<i class="fas fa-search"></i> 开始分析';
    }
}

// 清除结果
function clearResults() {
    resultsArea.classList.add('hidden');
    summaryCards.classList.add('hidden');
    issuesList.innerHTML = '';
    document.getElementById('suggestionsList').innerHTML = '';

    // 禁用导出和复制按钮
    document.getElementById('exportBtn').disabled = true;
    document.getElementById('copyBtn').disabled = true;
}

// 显示结果
function displayResults(data) {
    // 显示结果区域
    resultsArea.classList.remove('hidden');
    summaryCards.classList.remove('hidden');

    // 更新摘要卡片
    updateSummaryCards(data.summary);

    // 显示问题列表
    displayIssues(data.issues);

    // 显示修复建议
    displaySuggestions(data.suggestions);

    // 显示代码视图
    displayCodeView();

    // 显示代码度量
    displayMetrics(data.metrics);

    // 启用导出和复制按钮
    document.getElementById('exportBtn').disabled = false;
    document.getElementById('copyBtn').disabled = false;

    // 切换到问题列表
    document.querySelector('[data-tab="issues"]').click();
}

// 更新摘要卡片
function updateSummaryCards(summary) {
    document.getElementById('criticalCount').textContent = summary.critical || 0;
    document.getElementById('highCount').textContent = summary.high || 0;
    document.getElementById('mediumCount').textContent = summary.medium || 0;
    document.getElementById('lowCount').textContent = summary.low || 0;
}

// 显示问题列表
function displayIssues(issues) {
    const issuesList = document.getElementById('issuesList');
    issuesList.innerHTML = '';

    if (!issues || issues.length === 0) {
        issuesList.innerHTML = `
            <div class="issue-item">
                <div class="issue-header">
                    <span class="severity-badge" style="background: var(--success)">无问题</span>
                    <div class="issue-title">代码质量优秀</div>
                </div>
                <div class="issue-description">
                    未检测到任何问题。您的代码质量很好！
                </div>
            </div>
        `;
        return;
    }

    issues.forEach(issue => {
        const severityClass = getSeverityClass(issue.severity);
        const severityText = getSeverityText(issue.severity);

        const issueElement = document.createElement('div');
        issueElement.className = `issue-item ${severityClass}`;
        issueElement.innerHTML = `
            <div class="issue-header">
                <span class="severity-badge">${severityText}</span>
                <div class="issue-title">${issue.title}</div>
                <span class="issue-location">第 ${issue.line} 行</span>
            </div>
            <div class="issue-description">
                ${issue.description}
            </div>
            ${issue.codeSnippet ? `
                <div class="issue-code">
                    ${escapeHtml(issue.codeSnippet)}
                </div>
            ` : ''}
            ${issue.solution ? `
                <div class="issue-solution">
                    <strong>修复建议：</strong> ${issue.solution}
                </div>
            ` : ''}
        `;

        issuesList.appendChild(issueElement);
    });
}

// 显示修复建议
function displaySuggestions(suggestions) {
    const suggestionsList = document.getElementById('suggestionsList');
    suggestionsList.innerHTML = '';

    if (!suggestions || suggestions.length === 0) {
        suggestionsList.innerHTML = `
            <div class="issue-item">
                <div class="issue-description">
                    暂无额外的优化建议。
                </div>
            </div>
        `;
        return;
    }

    suggestions.forEach((suggestion, index) => {
        const suggestionElement = document.createElement('div');
        suggestionElement.className = 'issue-item';
        suggestionElement.innerHTML = `
            <div class="issue-header">
                <div class="issue-title">建议 ${index + 1}</div>
            </div>
            <div class="issue-description">
                ${suggestion}
            </div>
        `;
        suggestionsList.appendChild(suggestionElement);
    });
}

// 显示代码视图
function displayCodeView() {
    const codeBlock = document.getElementById('codeViewer');
    codeBlock.textContent = currentCode;
    hljs.highlightElement(codeBlock);
}

// 显示代码度量
function displayMetrics(metrics) {
    if (!metrics) return;

    const metricElements = {
        complexity: document.getElementById('metricComplexity'),
        lines: document.getElementById('metricLines'),
        maintainability: document.getElementById('metricMaintainability'),
        security: document.getElementById('metricSecurity')
    };

    const barElements = {
        complexity: document.querySelector('#metricComplexity').parentElement.nextElementSibling.querySelector('.metric-fill'),
        lines: document.querySelector('#metricLines').parentElement.nextElementSibling.querySelector('.metric-fill'),
        maintainability: document.querySelector('#metricMaintainability').parentElement.nextElementSibling.querySelector('.metric-fill'),
        security: document.querySelector('#metricSecurity').parentElement.nextElementSibling.querySelector('.metric-fill')
    };

    // 更新数值
    if (metrics.complexity !== undefined) {
        metricElements.complexity.textContent = metrics.complexity;
        barElements.complexity.style.width = `${Math.min(metrics.complexity * 10, 100)}%`;
    }

    if (metrics.lines !== undefined) {
        metricElements.lines.textContent = metrics.lines;
        barElements.lines.style.width = `${Math.min(metrics.lines / 10, 100)}%`;
    }

    if (metrics.maintainability !== undefined) {
        metricElements.maintainability.textContent = metrics.maintainability;
        barElements.maintainability.style.width = `${metrics.maintainability}%`;
    }

    if (metrics.security !== undefined) {
        metricElements.security.textContent = `${metrics.security}%`;
        barElements.security.style.width = `${metrics.security}%`;
    }
}

// 获取严重性类名
function getSeverityClass(severity) {
    switch (severity.toLowerCase()) {
        case 'critical': return 'severity-critical';
        case 'high': return 'severity-high';
        case 'medium': return 'severity-medium';
        case 'low': return 'severity-low';
        default: return '';
    }
}

// 获取严重性文本
function getSeverityText(severity) {
    const map = {
        'critical': '严重',
        'high': '高危',
        'medium': '中危',
        'low': '低危'
    };
    return map[severity.toLowerCase()] || severity;
}

// 显示错误
function showError(message) {
    const issuesList = document.getElementById('issuesList');
    issuesList.innerHTML = `
        <div class="issue-item severity-critical">
            <div class="issue-header">
                <span class="severity-badge">错误</span>
                <div class="issue-title">分析过程中出现错误</div>
            </div>
            <div class="issue-description">
                ${message}
            </div>
            <div class="issue-solution">
                请检查网络连接后重试，或联系管理员。
            </div>
        </div>
    `;

    resultsArea.classList.remove('hidden');
    summaryCards.classList.add('hidden');
}

// 保存到历史记录
function saveToHistory(code, result) {
    const historyItem = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        code: code.substring(0, 500), // 只保存前500个字符
        fileName: currentFile ? currentFile.name : '手动输入',
        summary: result.summary,
        issueCount: result.issues ? result.issues.length : 0
    };

    analysisHistory.unshift(historyItem);
    if (analysisHistory.length > 50) {
        analysisHistory = analysisHistory.slice(0, 50);
    }

    localStorage.setItem('javaAnalysisHistory', JSON.stringify(analysisHistory));
    loadHistory();
}

// 加载历史记录
function loadHistory() {
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = '';

    if (analysisHistory.length === 0) {
        historyList.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--gray-500)">
                <i class="fas fa-history fa-2x" style="margin-bottom: 16px; opacity: 0.5"></i>
                <p>暂无分析历史</p>
            </div>
        `;
        return;
    }

    analysisHistory.forEach(item => {
        const historyElement = document.createElement('div');
        historyElement.className = 'history-item';
        historyElement.innerHTML = `
            <i class="fas fa-file-code"></i>
            <div class="history-content">
                <div class="history-title">${item.fileName}</div>
                <div class="history-meta">
                    <span>${formatDate(item.timestamp)}</span>
                    <span>${item.issueCount} 个问题</span>
                </div>
            </div>
        `;

        historyElement.addEventListener('click', function () {
            loadFromHistory(item);
        });

        historyList.appendChild(historyElement);
    });
}

// 从历史记录加载
function loadFromHistory(item) {
    // 这里可以扩展为从服务器获取完整代码
    codeInput.value = item.code + '...';
    updateCharCount();
    switchToTextMode();

    // 可以在这里添加代码来重新显示历史分析结果
    alert('已加载历史代码。点击"开始分析"重新分析。');
}

// 清除历史记录
function clearHistory() {
    if (analysisHistory.length > 0 && confirm('确定要清除所有历史记录吗？')) {
        analysisHistory = [];
        localStorage.removeItem('javaAnalysisHistory');
        loadHistory();
    }
}

// 显示示例模态框
function showSampleModal() {
    document.getElementById('sampleModal').classList.remove('hidden');
}

// 清除代码
function clearCode() {
    if (codeInput.value.trim() && !confirm('确定要清空当前代码吗？')) {
        return;
    }

    codeInput.value = '';
    currentFile = null;
    updateCharCount();
    clearResults();

    // 隐藏文件信息
    document.getElementById('fileInfo').classList.add('hidden');
    fileUpload.value = '';
}

// 导出报告
function exportReport() {
    const report = generateReport();
    const blob = new Blob([report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `java-analysis-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 生成报告
function generateReport() {
    const date = new Date().toLocaleString('zh-CN');
    const fileName = currentFile ? currentFile.name : '未命名文件';
    const lines = currentCode.split('\\n').length;

    return `# Java代码分析报告
生成时间: ${date}
文件名称: ${fileName}
代码行数: ${lines}

## 代码概览
\`\`\`java
${currentCode}
\`\`\`

## 分析结果
（这里可以添加从分析结果生成的具体报告内容）

---
*报告由 Java代码缺陷检测工具 生成*
`;
}

// 复制结果
async function copyResults() {
    try {
        const report = generateReport();
        await navigator.clipboard.writeText(report);
        alert('分析结果已复制到剪贴板');
    } catch (err) {
        console.error('复制失败:', err);
        alert('复制失败，请手动复制');
    }
}

// 工具函数
function formatDate(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}