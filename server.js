const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { analyzeContract } = require('./services/analyzer');
const { extractTextFromFile, IMAGE_EXTS } = require('./services/extractor');
const { generateNegotiationScript } = require('./services/negotiator');

// 加载环境变量
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();

// ========== 环境配置（带兜底） ==========
const isVercel = !!process.env.VERCEL;
const PORT = parseInt(process.env.PORT) || 3000;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 10;
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

if (!isVercel && !fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ========== 工具函数 ==========

/**
 * 安全删除文件（无论成功失败都不抛异常）
 */
function safeUnlink(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn('清理文件失败:', filePath, e.message);
    }
  }
}

/**
 * 校验文本有效性（过滤全空白/无意义字符）
 */
function isValidText(text) {
  if (!text || typeof text !== 'string') return false;
  const cleanText = text.replace(/\s+/g, '');
  return cleanText.length >= 10;
}

/**
 * 通用文件分析函数（封装重复逻辑）
 * @param {string} filePath - 文件路径
 * @param {string} fileType - 文件类型
 * @returns {Promise<object>} 分析结果
 */
async function handleFileAnalysis(filePath, fileType) {
  const text = await extractTextFromFile(filePath, fileType);

  if (!isValidText(text)) {
    throw new Error('无法从文件中提取有效文本，请确保文件清晰可读');
  }

  return await analyzeContract(text);
}

/**
 * 将 multer 上传的文件转为文件路径（兼容内存/磁盘存储）
 */
function getUploadedFilePath(req, taskId, fileType) {
  if (isVercel && req.file.buffer) {
    const tmpPath = path.join(os.tmpdir(), `upload-${taskId}${fileType}`);
    fs.writeFileSync(tmpPath, req.file.buffer);
    return tmpPath;
  }
  return req.file.path;
}

// ========== 并发控制 ==========

const MAX_CONCURRENT_TASKS = 3;
let currentConcurrency = 0;
const taskQueue = [];

// 内存任务队列（本地环境使用，Vercel 用同步处理）
const tasks = new Map();
const TASK_MAX_AGE = 10 * 60 * 1000;

// 定期清理过期任务（仅本地）
if (!isVercel) {
  setInterval(() => {
    const now = Date.now();
    for (const [id, task] of tasks) {
      if (now - task.createdAt > TASK_MAX_AGE) {
        tasks.delete(id);
      }
    }
  }, 60000);
}

// 处理任务队列
function processQueue() {
  if (currentConcurrency >= MAX_CONCURRENT_TASKS || taskQueue.length === 0) return;

  currentConcurrency++;
  const { taskId, filePath, fileType } = taskQueue.shift();

  processTask(taskId, filePath, fileType).finally(() => {
    currentConcurrency--;
    processQueue();
  });
}

// ========== 中间件 ==========

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// ========== 文件上传配置 ==========

const storage = isVercel
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: function (req, file, cb) {
        cb(null, uploadDir);
      },
      filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'contract-' + uniqueSuffix + ext);
      }
    });

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['.pdf', '.docx', ...IMAGE_EXTS];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('不支持的文件格式，仅支持 PDF、DOCX、JPG、PNG、WebP、BMP、TIFF'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE * 1024 * 1024
  }
});

// ========== API 路由 ==========

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', env: isVercel ? 'vercel' : 'local', timestamp: new Date().toISOString() });
});

// ========== Vercel 同步扫描接口（Vercel 环境专用） ==========

app.post('/api/scan/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请上传合同文件' });
  }

  const taskId = 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
  const fileType = path.extname(req.file.originalname).toLowerCase();
  let filePath = null;

  try {
    filePath = getUploadedFilePath(req, taskId, fileType);

    if (isVercel) {
      // Vercel 环境：同步处理（Serverless 不支持后台异步）
      const analysisResult = await handleFileAnalysis(filePath, fileType);
      res.json({ success: true, taskId: taskId, status: 'completed', data: analysisResult });
    } else {
      // 本地环境：异步处理（支持大文件长时间 OCR）
      tasks.set(taskId, {
        id: taskId,
        status: 'processing',
        progress: 0,
        message: '正在提取文本...',
        result: null,
        error: null,
        createdAt: Date.now()
      });

      res.json({ success: true, taskId: taskId });

      // 加入并发队列
      taskQueue.push({ taskId, filePath, fileType });
      processQueue();
      filePath = null; // 队列会负责清理
    }
  } catch (error) {
    console.error('上传分析错误:', error);
    res.status(500).json({ error: '分析过程中出现错误: ' + error.message });
  } finally {
    safeUnlink(filePath);
  }
});

// 查询任务状态（仅本地异步模式使用）
app.get('/api/scan/status/:taskId', (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: '任务不存在或已过期' });
  }
  res.json({
    success: true,
    taskId: task.id,
    status: task.status,
    progress: task.progress,
    message: task.message,
    result: task.status === 'completed' ? task.result : null,
    error: task.status === 'failed' ? task.error : null
  });
});

// 后台处理任务（仅本地异步模式）
async function processTask(taskId, filePath, fileType) {
  const task = tasks.get(taskId);
  if (!task) {
    safeUnlink(filePath);
    return;
  }

  try {
    task.progress = 20;
    task.message = '正在提取文本...';
    const analysisResult = await handleFileAnalysis(filePath, fileType);

    task.progress = 100;
    task.status = 'completed';
    task.result = analysisResult;
    task.message = '分析完成';
  } catch (error) {
    console.error(`任务 ${taskId} 处理错误:`, error);
    task.status = 'failed';
    task.error = error.message || '分析过程中出现错误';
  } finally {
    safeUnlink(filePath);
  }
}

// ========== 同步扫描接口（兼容旧接口） ==========

app.post('/api/scan', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请上传合同文件' });
  }

  const fileType = path.extname(req.file.originalname).toLowerCase();
  let filePath = null;

  try {
    filePath = getUploadedFilePath(req, { file: req.file }, Date.now(), fileType);
    const analysisResult = await handleFileAnalysis(filePath, fileType);
    res.json({ success: true, data: analysisResult });
  } catch (error) {
    console.error('扫描分析错误:', error);
    res.status(500).json({ error: '分析过程中出现错误，请稍后重试: ' + error.message });
  } finally {
    safeUnlink(filePath);
  }
});

// ========== 谈判话术接口 ==========

app.post('/api/negotiate', (req, res) => {
  try {
    const { trapId, trapName, matchedClause } = req.body;

    // 严格类型校验
    if (typeof trapId !== 'string' || trapId.trim() === '') {
      return res.status(400).json({ error: '风险ID必须为非空字符串' });
    }
    if (typeof trapName !== 'string' || trapName.trim() === '') {
      return res.status(400).json({ error: '风险名称必须为非空字符串' });
    }

    const clause = typeof matchedClause === 'string' ? matchedClause : '';
    const script = generateNegotiationScript(trapId, trapName, clause);
    res.json({ success: true, data: script });
  } catch (error) {
    console.error('话术生成错误:', error);
    res.status(500).json({ error: '话术生成失败: ' + error.message });
  }
});

// ========== 纯文本分析接口 ==========

app.post('/api/scan/text', async (req, res) => {
  try {
    const { text } = req.body;
    if (!isValidText(text)) {
      return res.status(400).json({ error: '请提供有效的合同文本（至少10个有效字符）' });
    }

    const analysisResult = await analyzeContract(text);
    res.json({ success: true, data: analysisResult });
  } catch (error) {
    console.error('文本分析错误:', error);
    res.status(500).json({ error: '分析过程中出现错误，请稍后重试: ' + error.message });
  }
});

// ========== 错误处理中间件 ==========

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `文件大小超出限制（最大 ${MAX_FILE_SIZE}MB）` });
    }
    return res.status(400).json({ error: '文件上传失败: ' + err.message });
  }
  if (err.message && err.message.includes('不支持的文件格式')) {
    return res.status(400).json({ error: err.message });
  }
  console.error('服务器错误:', err);
  res.status(500).json({ error: '服务器内部错误: ' + err.message });
});

// 所有其他路由返回前端页面
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'contract-trap-scanner.html'));
});

// ========== 启动服务器（兼容本地 + Vercel 双环境） ==========

if (isVercel) {
  module.exports = app;
} else {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('  合同陷阱扫描器后端已启动');
    console.log(`  地址: http://localhost:${PORT}`);
    console.log(`  环境: 本地模式`);
    console.log(`  最大并发: ${MAX_CONCURRENT_TASKS}`);
    console.log('=================================');
  });

  server.timeout = 300000;
  server.keepAliveTimeout = 300000;
  server.headersTimeout = 310000;
}
