// const setupTelemetry = require('./setupTelemetry');
// const provider = setupTelemetry();

const WebSocket = require('ws');
const WebSocketServer = require('ws').Server;

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

/**
 * 
 * @returns 
 */
function startServer() {
  return new Promise((resolve, reject) => {
    //  Setup event publisher
    // eventPublisher = new EventPublisher();

    try {
      wsServer = new WebSocketServer({ 
        port: process.env.DEFAULT_SERVER_LISTEN_PORT,
        path: '/ws'  // 指定 WebSocket 路径
      });
    } catch (e) {
      return reject(e);
    }

    wsServer.on('error', (error) => {
      logger.error(error);
    });

    wsServer.on('listening', () => {
      logger.info(`Speech To Text Adapter has started. Listening on port = ${process.env.DEFAULT_SERVER_LISTEN_PORT}`);
      resolve();
    });

    //  As new adapters are added this is where they will be triggered
    if (process.env.STREAM_ADAPTER_TYPE === 'GenesysAudioHookAdapter') {
      GenesysAudioHookAdapter.setEventPublisher(eventPublisher);
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
    
    if (eventPublisher != null){
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

