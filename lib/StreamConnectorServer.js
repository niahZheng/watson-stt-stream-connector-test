// const setupTelemetry = require('./setupTelemetry');
// const provider = setupTelemetry();

const WebSocket = require('ws');
const WebSocketServer = require('ws').Server;
const express = require('express');
const http = require('http');

//  CCaaS specific adapters currently supported
const GenesysAudioHookAdapter = require('./GenesysAudioHookAdapter');

// 设置默认日志级别
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';  // 添加默认值
const logger = require('pino')({ 
  level: LOG_LEVEL,
  name: 'StreamConnectorServer' 
});

let eventPublisher = null;
let wsServer = null;
let httpServer = null;

/**
 * 
 * @returns 
 */
function startServer() {
  return new Promise((resolve, reject) => {
    //  Setup event publisher
    // eventPublisher = new EventPublisher();

    try {
      // 创建 Express 应用
      const app = express();
      
      // 创建 HTTP 服务器
      httpServer = http.createServer(app);
      
      // 创建 WebSocket 服务器并附加到 HTTP 服务器
      wsServer = new WebSocket.Server({ 
        server: httpServer,
        path: '/ws'  // 明确指定 WebSocket 路径
      });

      // 错误处理
      wsServer.on('error', (error) => {
        logger.error(error);
      });

      // 处理 WebSocket 连接
      if (process.env.STREAM_ADAPTER_TYPE === 'GenesysAudioHookAdapter') {
        GenesysAudioHookAdapter.setEventPublisher(eventPublisher);
        wsServer.on('connection', GenesysAudioHookAdapter.handleAudioHookConnection);
      } else {
        logger.error(`Unknown adapter type`);
      }

      // 启动 HTTP 服务器，监听所有网络接口
      const port = process.env.DEFAULT_SERVER_LISTEN_PORT || 80;
      httpServer.listen(port, '0.0.0.0', () => {
        logger.info(`Speech To Text Adapter has started. Listening on 0.0.0.0:${port}`);
        resolve();
      });

    } catch (e) {
      logger.error('Failed to start server:', e);
      return reject(e);
    }
  });
}

/**
 * 
 * @returns 
 */
function stopServer() {
  return new Promise((resolve, reject) => {
    
    if (eventPublisher != null){
      eventPublisher.destroy();
      eventPublisher = null;
    }

    if (httpServer === null) {
      return reject(new Error('server not started'));
    }
    
    httpServer.close((err) => {
      if (err) {
        return reject(err);
      }
      wsServer = null;
      httpServer = null;
      return resolve();
    });
    
    return wsServer;
  });
}

module.exports = {
  start: startServer,
  stop: stopServer
};

