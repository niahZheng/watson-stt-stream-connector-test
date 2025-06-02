const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const WebSocketServer = require('ws').Server;
const logger = require('./logger');  // 使用统一的 logger

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

let eventPublisher = null;
let wsServer = null;

class StreamConnectorServer {
  constructor() {
    this.wsServer = null;
    this.setupLogDirectory();
  }

  setupLogDirectory() {
    // 确保日志目录存在
    const logDir = path.join(__dirname, '../log');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  startServer() {
    return new Promise((resolve, reject) => {
      try {
        // 记录启动信息
        logger.info({
          event: 'server_starting',
          port: process.env.DEFAULT_SERVER_LISTEN_PORT
        });

        // 创建 WebSocket 服务器
        this.wsServer = new WebSocket.Server({
          port: process.env.DEFAULT_SERVER_LISTEN_PORT,
        });

        // 监听服务器事件
        this.wsServer.on('listening', () => {
          logger.info(`Speech To Text Adapter has started. Listening on port = ${process.env.DEFAULT_SERVER_LISTEN_PORT}`);
          resolve();
        });

        // 根据配置初始化适配器
        if (process.env.STREAM_ADAPTER_TYPE === 'GenesysAudioHookAdapter') {
          logger.info({
            event: 'adapter_initialized',
            type: 'GenesysAudioHookAdapter'
          });
          this.wsServer.on('connection', GenesysAudioHookAdapter.handleAudioHookConnection);
        } else {
          logger.error(`Unknown adapter type`);
          reject(new Error('Invalid adapter type'));
        }

        // 错误处理
        this.wsServer.on('error', (error) => {
          logger.error({
            event: 'server_error',
            error: error.message
          });
        });

      } catch (error) {
        logger.error({
          event: 'server_start_failed',
          error: error.message,
          stack: error.stack  // 添加堆栈信息
        });
        reject(error);
      }
    });
  }

  stopServer() {
    return new Promise((resolve, reject) => {
      if (!this.wsServer) {
        logger.error({
          event: 'stop_failed',
          reason: 'server_not_started'
        });
        reject(new Error('Server not started'));
        return;
      }

      this.wsServer.close((error) => {
        if (error) {
          logger.error({
            event: 'stop_failed',
            error: error.message
          });
          reject(error);
          return;
        }

        logger.info({
          event: 'server_stopped'
        });
        resolve();
      });
    });
  }

  // 验证客户端连接
  verifyClient(info) {
    try {
      const headers = info.req.headers;
      
      // 验证必需的头部
      const requiredHeaders = [
        'audiohook-organization-id',
        'audiohook-correlation-id', 
        'audiohook-session-id',
        'x-api-key'
      ];

      // 暂时注释掉头部验证
      // for (const header of requiredHeaders) {
      //   if (!headers[header.toLowerCase()]) {
      //     logger.error({
      //       event: 'client_verification_failed',
      //       reason: `Missing required header: ${header}`,
      //       headers: headers
      //     });
      //     return false;
      //   }
      // }

      // 注释掉 API Key 验证
      // const apiKey = headers['x-api-key'];
      // const isValid = this.isValidApiKey(apiKey);
      // 
      // if (!isValid) {
      //   logger.error({
      //     event: 'client_verification_failed',
      //     reason: 'Invalid API key'
      //   });
      // }
      // 
      // return isValid;

      return true;  // 直接返回 true
    } catch (error) {
      logger.error({
        event: 'client_verification_error',
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  isValidApiKey(apiKey) {
    return apiKey === process.env.API_KEY;
  }
}

module.exports = StreamConnectorServer;

