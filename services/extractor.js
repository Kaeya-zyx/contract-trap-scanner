const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 本地 Tesseract 语言包路径
const TESSDATA_LANG_PATH = path.join(__dirname, '..', 'tessdata');

// 图片扩展名集合
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif'];

/**
 * 创建 Tesseract Worker（使用本地语言包）
 */
async function createOCRWorker(logger) {
  const { createWorker } = await import('tesseract.js');
  return createWorker('chi_sim+eng', 1, {
    langPath: TESSDATA_LANG_PATH,
    logger: logger || undefined
  });
}

/**
 * 从上传的文件中提取文本
 * @param {string} filePath - 文件路径
 * @param {string} fileType - 文件扩展名
 * @returns {Promise<string>} 提取的文本内容
 */
async function extractTextFromFile(filePath, fileType) {
  switch (fileType) {
    case '.pdf':
      return extractFromPDF(filePath);
    case '.docx':
      return extractFromDocx(filePath);
    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.webp':
    case '.bmp':
    case '.tiff':
    case '.tif':
      return extractFromImage(filePath);
    default:
      throw new Error('不支持的文件类型: ' + fileType);
  }
}

/**
 * 从 PDF 文件中提取文本
 * 如果提取的文本太少，说明可能是扫描件，自动走 OCR
 */
async function extractFromPDF(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    let text = pdfData.text;

    // 如果提取到的文本太少（每页平均不到 20 字），可能是扫描件/图片 PDF
    const pageCount = pdfData.numpages || 1;
    const avgCharsPerPage = text.replace(/\s/g, '').length / pageCount;

    if (avgCharsPerPage < 20) {
      console.log(`PDF 每页仅 ${Math.round(avgCharsPerPage)} 字，疑似扫描件，启用 OCR...`);
      // 将 PDF 页渲染为图片再做 OCR（通过 pdf-poppler 或直接用内嵌方式）
      // 这里用一种替代方案：尝试用 tesseract 直接读取 PDF
      text = await ocrFromPDF(filePath);
    }

    return text;
  } catch (error) {
    console.error('PDF解析错误:', error.message);
    throw new Error('PDF文件解析失败，请确保文件未加密且内容可读');
  }
}

/**
 * 用 Tesseract OCR PDF 文件（支持扫描件）
 * 先将 PDF 转为图片，再 OCR
 * Vercel 环境下没有 pdftoppm，直接尝试 Tesseract.js 处理
 */
async function ocrFromPDF(filePath) {
  try {
    const { execSync } = require('child_process');
    const tmpDir = os.tmpdir();
    const pdfId = Date.now();
    const imgPrefix = path.join(tmpDir, `pdf-ocr-${pdfId}`);

    // 检查 pdftoppm 是否可用
    let hasPdftoppm = false;
    try {
      execSync('which pdftoppm', { stdio: 'pipe' });
      hasPdftoppm = true;
    } catch (e) {
      hasPdftoppm = false;
    }

    if (hasPdftoppm) {
      // 本地环境：使用 pdftoppm 将 PDF 转为 PNG 图片（300 DPI 保证清晰度）
      console.log('将 PDF 转换为图片...');
      execSync(`pdftoppm -png -r 300 "${filePath}" "${imgPrefix}"`, {
        timeout: 60000,
        stdio: 'pipe'
      });

      // 查找生成的图片文件
      const imgFiles = fs.readdirSync(tmpDir)
        .filter(f => f.startsWith(`pdf-ocr-${pdfId}`) && f.endsWith('.png'))
        .sort()
        .map(f => path.join(tmpDir, f));

      if (imgFiles.length === 0) {
        throw new Error('PDF 转图片失败，未生成图片文件');
      }

      console.log(`PDF 转换完成，共 ${imgFiles.length} 页`);

      // 对每页图片进行 OCR
      const allText = [];
      for (let i = 0; i < imgFiles.length; i++) {
        console.log(`OCR 第 ${i + 1}/${imgFiles.length} 页...`);
        const worker = await createOCRWorker(m => {
          if (m.status === 'recognizing text') {
            process.stdout.write(`\rPDF OCR 第${i + 1}页进度: ${Math.round(m.progress * 100)}%`);
          }
        });

        const { data: { text } } = await worker.recognize(imgFiles[i]);
        await worker.terminate();

        if (text && text.trim()) {
          allText.push(text.trim());
        }

        // 清理临时图片
        try { fs.unlinkSync(imgFiles[i]); } catch (e) { /* ignore */ }
      }

      console.log('\nPDF OCR 全部完成');
      return allText.join('\n\n');
    } else {
      // Vercel 环境：没有 pdftoppm，尝试直接用 Tesseract.js 处理 PDF
      // Tesseract.js 对 PDF 的支持有限，但可以处理简单 PDF
      console.log('未检测到 pdftoppm，使用 Tesseract.js 直接处理 PDF...');
      const worker = await createOCRWorker(m => {
        if (m.status === 'recognizing text') {
          process.stdout.write(`\rPDF OCR 进度: ${Math.round(m.progress * 100)}%`);
        }
      });

      const { data: { text } } = await worker.recognize(filePath);
      await worker.terminate();

      console.log('\nPDF OCR 完成');
      return text || '';
    }

  } catch (error) {
    console.error('PDF OCR 错误:', error.message);
    throw new Error('PDF文件OCR识别失败: ' + error.message);
  }
}

/**
 * 从 DOCX 文件中提取文本
 */
async function extractFromDocx(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer: dataBuffer });
    return result.value;
  } catch (error) {
    console.error('DOCX解析错误:', error.message);
    throw new Error('DOCX文件解析失败，请确保文件格式正确');
  }
}

/**
 * 从图片文件中提取文本（增强版 OCR）
 * 
 * 策略：
 * 1. 图片预处理（缩放、灰度、对比度增强、锐化、去噪）
 * 2. 高精度 Tesseract OCR（中英文 + 合同专用配置）
 * 3. 后处理（去重、去噪、合并碎片文本）
 */
async function extractFromImage(filePath) {
  try {
    console.log('\n===== 开始图片文字提取 =====');

    // 第一步：图片预处理
    const preprocessedPath = await preprocessImage(filePath);
    console.log('图片预处理完成');

    // 第二步：OCR 识别
    const worker = await createOCRWorker(m => {
      if (m.status === 'recognizing text') {
        process.stdout.write(`\rOCR 识别进度: ${Math.round(m.progress * 100)}%`);
      }
    });

    console.log('\n开始 OCR 识别...');

    // 使用合同文档优化的 PSM 模式
    // --psm 6: 假设为统一的文本块（适合合同等排版规范的文档）
    // --psm 4: 假设为单列可变大小的文本（适合手机拍照）
    const result = await worker.recognize(preprocessedPath, {
      tessedit_pageseg_mode: '4',  // 自动检测，适合拍照合同
    });

    await worker.terminate();
    console.log('\nOCR 原始识别完成');

    // 第三步：后处理
    const text = postProcessOCRText(result.data.text);

    // 清理临时文件
    try { fs.unlinkSync(preprocessedPath); } catch (e) { /* ignore */ }

    console.log('===== 图片文字提取完成 =====\n');
    return text;

  } catch (error) {
    console.error('OCR识别错误:', error.message);
    throw new Error('图片文字识别失败，请确保图片清晰且文字可读');
  }
}

/**
 * 图片预处理流水线
 * 针对手机拍照的合同照片做优化
 */
async function preprocessImage(inputPath) {
  const outputPath = path.join(os.tmpdir(), 'ocr-preprocess-' + Date.now() + '.png');

  try {
    const metadata = await sharp(inputPath).metadata();
    console.log(`原始图片: ${metadata.width}x${metadata.height}, ${metadata.format}`);

    // 1. 自适应缩放：确保最小边 >= 2000px（提高 OCR 精度）
    //    但最大边不超过 4000px（控制处理时间和内存）
    let pipeline = sharp(inputPath);

    const minDim = Math.min(metadata.width, metadata.height);
    const maxDim = Math.max(metadata.width, metadata.height);

    if (minDim < 2000 && maxDim < 4000) {
      // 图片太小，放大
      const scale = 2000 / minDim;
      pipeline = pipeline.resize(
        Math.round(metadata.width * scale),
        Math.round(metadata.height * scale),
        { fit: 'fill', kernel: 'lanczos3' }
      );
    } else if (maxDim > 4000) {
      // 图片太大，缩小到合理范围
      const scale = 4000 / maxDim;
      pipeline = pipeline.resize(
        Math.round(metadata.width * scale),
        Math.round(metadata.height * scale),
        { fit: 'fill', kernel: 'lanczos3' }
      );
    }

    // 2. 转灰度
    pipeline = pipeline.grayscale();

    // 3. 对比度增强（轻度，避免过度处理）
    pipeline = pipeline.linear(1.3, -20);

    // 4. 锐化（增强文字边缘）
    pipeline = pipeline.sharpen({ sigma: 0.8, m1: 0.5, m2: 0.3 });

    // 5. 中值滤波去噪（去除拍摄噪点）
    pipeline = pipeline.median(1);

    // 6. 自适应二值化（通过 normalize + threshold 模拟）
    //    先做直方图均衡化（normalize），再做轻度阈值处理
    pipeline = pipeline.normalize();

    // 7. 输出为高质量 PNG（无损，保证文字清晰度）
    await pipeline.png({ compressionLevel: 6 }).toFile(outputPath);

    const outMeta = await sharp(outputPath).metadata();
    console.log(`预处理后: ${outMeta.width}x${outMeta.height}`);

    return outputPath;
  } catch (error) {
    console.error('图片预处理失败:', error.message);
    // 预处理失败时返回原图，让 OCR 直接处理
    return inputPath;
  }
}

/**
 * OCR 文本后处理
 * 清理识别噪音，合并碎片文本
 */
function postProcessOCRText(rawText) {
  if (!rawText) return '';

  let text = rawText;

  // 1. 去除纯数字行（除非是金额、日期、百分比等有意义的数字）
  //    保留包含中文上下文或特殊字符的数字行
  text = text.split('\n').filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    // 纯数字且长度 <= 2 的行大概率是噪音
    if (/^\d{1,2}$/.test(trimmed)) return false;
    return true;
  }).join('\n');

  // 2. 合并被错误分割的行（上一行末尾没有标点，下一行开头是小写/中文）
  const lines = text.split('\n');
  const merged = [];
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i].trim();
    if (!current) continue;

    if (merged.length > 0) {
      const prev = merged[merged.length - 1];
      // 如果上一行以中文字符结尾且没有句末标点，当前行以中文/小写开头，则合并
      const prevEndsWithIncomplete = /[\u4e00-\u9fff]$/.test(prev) && !/[。！？；…」】]$/.test(prev);
      const currStartsWithContinue = /^[\u4e00-\u9fff]/.test(current);

      if (prevEndsWithIncomplete && currStartsWithContinue) {
        merged[merged.length - 1] = prev + current;
        continue;
      }
    }
    merged.push(current);
  }
  text = merged.join('\n');

  // 3. 清理常见 OCR 噪音字符
  text = text.replace(/[│┃┆┊┈╎╏┄┅]/g, '');  // 竖线类噪音
  text = text.replace(/\s{3,}/g, ' ');       // 多余空格
  text = text.replace(/\n{3,}/g, '\n\n');     // 多余空行

  // 4. 修复常见中文 OCR 错误
  text = text.replace(/，\s*，/g, '，');       // 重复逗号
  text = text.replace(/。\s*。/g, '。');       // 重复句号
  text = text.replace(/、\s*、/g, '、');       // 重复顿号

  return text.trim();
}

module.exports = { extractTextFromFile, IMAGE_EXTS };
