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
function log(level, message) {
  const timestamp = new Date().toISOString();

  // 如果 message 是对象或其他非字符串类型，转换为字符串
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${
    typeof message === 'string' ? message : JSON.stringify(message)
  }\n`;

  // 输出到标准输出
  process.stdout.write(logMessage);

  // 输出到日志文件
  logStream.write(logMessage);
}

// 导出统一的 logger
const logger = {
  info: (message) => log('info', message),
  error: (message) => log('error', message),
  debug: (message) => log('debug', message),
  trace: (message) => log('trace', message), // 添加 trace 方法
};

module.exports = logger;