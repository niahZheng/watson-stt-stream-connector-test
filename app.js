// import env
require('dotenv').config();
const logger = require('./lib/logger');
const StreamConnectorServer = require('./lib/StreamConnectorServer');

// 创建服务器实例
const server = new StreamConnectorServer();

// 启动服务器
server.startServer()
  .then(() => {
    logger.info({
      event: 'app_started',
      port: process.env.DEFAULT_SERVER_LISTEN_PORT
    });
  })
  .catch(error => {
    logger.error({
      event: 'app_start_failed',
      error: error.message
    });
    process.exit(1);
  });

// 处理进程退出
process.on('SIGINT', () => {
  logger.info({
    event: 'shutdown_initiated'
  });
  
  server.stopServer()
    .then(() => {
      logger.info({
        event: 'shutdown_complete'
      });
      process.exit(0);
    })
    .catch(error => {
      logger.error({
        event: 'shutdown_failed',
        error: error.message
      });
      process.exit(1);
    });
});
