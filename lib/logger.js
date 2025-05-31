const fs = require('fs');
const path = require('path');

// 确保日志文件夹存在
const logDir = path.join(__dirname, '../log');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// 创建日志文件流
const logFile = path.join(logDir, 'app.log');
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

// 自定义日志函数，输出到文件和标准输出
function log(level, message, error = null) {
  const timestamp = new Date().toISOString();
  let logMessage;

  // 处理不同类型的消息
  if (error) {
    // 如果有错误对象，包含错误详情
    logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message} - ${error.stack || error.message}\n`;
  } else if (typeof message === 'object') {
    // 如果消息是对象，将其转换为格式化的 JSON 字符串
    logMessage = `[${timestamp}] [${level.toUpperCase()}] ${JSON.stringify(message, null, 2)}\n`;
  } else {
    // 普通字符串消息
    logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  }

  // 输出到标准输出
  process.stdout.write(logMessage);

  // 输出到日志文件
  logStream.write(logMessage);
}

// 导出统一的 logger
const logger = {
  info: (message) => log('info', message),
  error: (message, error) => log('error', message, error),
  debug: (message) => log('debug', message),
  warn: (message) => log('warn', message),
  trace: (message) => log('trace', message),
};

module.exports = logger;