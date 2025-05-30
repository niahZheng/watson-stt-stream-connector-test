const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const WebSocketServer = require('ws').Server;

//  CCaaS specific adapters currently supported
const GenesysAudioHookAdapter = require('./GenesysAudioHookAdapter');

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
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

  // 输出到标准输出
  process.stdout.write(logMessage);

  // 输出到日志文件
  logStream.write(logMessage);
}

// 替代 pino 的 logger
const logger = {
  info: (message) => log('info', message),
  error: (message) => log('error', message),
  debug: (message) => log('debug', message),
};

let eventPublisher = null;
let wsServer = null;

/**
 * 
 * @returns 
 */
function startServer() {
  return new Promise((resolve, reject) => {
    try {
      wsServer = new WebSocketServer({ port: process.env.DEFAULT_SERVER_LISTEN_PORT });
    } catch (e) {
      return reject(e);
    }

    wsServer.on('error', (error) => {
      logger.error(error.message);
    });

    wsServer.on('listening', () => {
      logger.info(`Speech To Text Adapter has started. Listening on port = ${process.env.DEFAULT_SERVER_LISTEN_PORT}`);
      resolve();
    });

    //  As new adapters are added this is where they will be triggered
    if (process.env.STREAM_ADAPTER_TYPE === 'GenesysAudioHookAdapter') {
      wsServer.on('connection', GenesysAudioHookAdapter.handleAudioHookConnection);
    } else {
      logger.error(`Unknown adapter type`);
    }

    return wsServer;
  });
}
module.exports.start = startServer;

/**
 * 
 * @returns 
 */
function stopServer() {
  return new Promise((resolve, reject) => {
    if (eventPublisher != null) {
      eventPublisher.destroy();
      eventPublisher = null;
    }

    if (wsServer === null) {
      return reject(new Error('server not started'));
    }

    wsServer.close((err) => {
      if (err) {
        return reject(err);
      }
      return resolve();
    });

    return wsServer;
  });
}
module.exports.stop = stopServer;

