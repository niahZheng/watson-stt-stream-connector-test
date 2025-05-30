
// const setupTelemetry = require('./setupTelemetry');
// const provider = setupTelemetry();

const WebSocket = require('ws');
const WebSocketServer = require('ws').Server;

// const EventPublisher = require('./CeleryEventPublisher');
let eventPublisher = null;

//  CCaaS specific adapters currently supported
const GenesysAudioHookAdapter = require('./GenesysAudioHookAdapter');
// const MonoChannelStreamingAdapter = require('./MonoChannelStreamingAdapter');
// const SiprecStreamingAdapter = require('./SiprecStreamingAdapter');

const LOG_LEVEL = process.env.LOG_LEVEL;
const logger = require('pino')({ level: LOG_LEVEL, name: 'StreamConnectorServer' });

/**
 * 
 * @returns 
 */
let wsServer = null;
function startServer() {
  return new Promise((resolve, reject) => {
    //  Setup event publisher
    // eventPublisher = new EventPublisher();

    try {
      wsServer = new WebSocketServer({ port: process.env.DEFAULT_SERVER_LISTEN_PORT });
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
    if (process.env.STREAM_ADAPTER_TYPE == 'GenesysAudioHookAdapter'){
        // GenesysAudioHookAdapter.setEventPublisher(eventPublisher);
        wsServer.on('connection', GenesysAudioHookAdapter.handleAudioHookConnection);
    }
    // else if (process.env.STREAM_ADAPTER_TYPE == 'MonoChannelStreamingAdapter'){
    //   MonoChannelStreamingAdapter.setEventPublisher(eventPublisher);
    //   wsServer.on('connection', MonoChannelStreamingAdapter.handleMonoChannelStreamingConnection);    
    // }
    // else if (process.env.STREAM_ADAPTER_TYPE == 'SiprecStreamingAdapter'){
    //   SiprecStreamingAdapter.setEventPublisher(eventPublisher);
    //   wsServer.on('connection', SiprecStreamingAdapter.handleSiprecStreamingConnection);    
    // }
    else
        logger.error(`Unknown adapter type`);

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

