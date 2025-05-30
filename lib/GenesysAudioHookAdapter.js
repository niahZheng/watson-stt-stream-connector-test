// const { startSpan, endSpan } = require('./spanUtils');
// const {parentSpan} = require('./wsSpan')
const { trace, SpanKind, context } = require('@opentelemetry/api');

const tracer = trace.getTracer('GenesysAudioHookAdapter');

const WebSocket = require('ws');
const WebSocketServer = require('ws').Server;

// Change to your own Speech To Text Engine implementation, you can use
// the WatsonSpeechToTextEngine.js for guidance
const SpeechToTextEngine = require('./WatsonSpeechToTextEngine');
const StreamingSessionState = require('./GenesysStreamingSessionState');
const url = require('url');

const DEFAULT_PORT = process.env.DEFAULT_AUDIO_HOOK_LISTEN_PORT;
const LOG_LEVEL = process.env.LOG_LEVEL;
const logger = require('pino')({ level: LOG_LEVEL, name: 'GenesysAudioHookAdapter' });

const rootTopic = "agent-assist/";
const rootSessionTopic = rootTopic + "session";

var eventPublisher = null;
function setEventPublisher(publisher) { eventPublisher = publisher; }
module.exports.setEventPublisher = setEventPublisher;

/**
 * Function for sending an 'opened" response.
 * 
 * @param {*} webSocket 
 * @param {*} openRequest 
 * @param {*} sessionState 
 */
function sendOpenedResponse(webSocket, openRequest, sessionState, parentSpanCtx) {
  logger.debug('Send opened message.');

  //  Notify all the event listeners that a new session is starting
  let event = {
    'type': 'session_started',
    'parameters': {
      'session_id': sessionState.conversationId,
      'customer_ani': sessionState.participant.ani,
      'customer_name': sessionState.participant.aniName,
      'dnis': sessionState.participant.dnis,
    },
    'agent_id': sessionState.agent_id // this is a temporary parameter for routing backend messages
  };

  // this might need to be re-worked at some point
  // because the topic doesn't include the conversationId

  // tracer.startActiveSpan('eventPublisher.publishMessage',{kind: SpanKind.INTERNAL}, parentSpanCtx, (span) => {
  //   eventPublisher.publish(rootSessionTopic, JSON.stringify(event), parentSpanCtx);
  //   span.end();
  // });

  // Send the opened message back to Genesys 
  sessionState.serverSeq++;
  const openedResponse = {
    "version": 2,
    "type": "opened",
    "seq": sessionState.serverSeq,
    "clientseq": sessionState.clientSeq,
    "id": sessionState.sessionId,
    "parameters": {
      "organizationId": sessionState.organizationId,
      "conversationId": sessionState.conversationId,
      "participant": sessionState.participant,
      "media": [
        {
          "type": "audio",
          "format": "PCMU",
          "channels": ["external", "internal"],
          "rate": 8000
        }
      ]
    }
  };
  webSocket.send(JSON.stringify(openedResponse));
}

/**
 * Functaion for destroying active speech engines.
 * 
 * @param {*} externalSpeechToTextEngine 
 * @param {*} internalSpeechToTextEngine 
 */
function stopSession(externalSpeechToTextEngine, internalSpeechToTextEngine, sessionState, parentSpanCtx) {

  //  First we need to stream enough silence into each speechToText engine to flush any ongoing transcriptions
  //let silence_buffer = Buffer.alloc (silence_buffer_size);
  //silence_buffer.fill ('ff', 0, silence_buffer_size, 'hex');

  //  Send an empty blob to trigger the deliver of any final transcripts. This will also cause the session
  //  to be closed.
  let empty_blob = Buffer.alloc(0);
  externalSpeechToTextEngine.write(empty_blob);
  internalSpeechToTextEngine.write(empty_blob);

  //  Wait for any final transcripts to come in before closing STT engines
  setTimeout(cleanupSession, 3000, externalSpeechToTextEngine, internalSpeechToTextEngine, sessionState, parentSpanCtx);
}

/**
 * 
 * @param {*} externalSpeechToTextEngine 
 * @param {*} internalSpeechToTextEngine 
 * @param {*} sessionState 
 */
function cleanupSession(externalSpeechToTextEngine, internalSpeechToTextEngine, sessionState, parentSpanCtx) {

  if (externalSpeechToTextEngine != null) {
    externalSpeechToTextEngine.removeAllListeners();
    externalSpeechToTextEngine.on('error', () => { }); // no-op
    externalSpeechToTextEngine.destroy();
    externalSpeechToTextEngine = null;
  }

  if (internalSpeechToTextEngine != null) {
    internalSpeechToTextEngine.removeAllListeners();
    internalSpeechToTextEngine.on('error', () => { }); // no-op
    internalSpeechToTextEngine.destroy();
    internalSpeechToTextEngine = null
  }

  //  Notify all the event listeners that the session as ended
  let event = {
    'type': 'session_ended'
  };
  // eventPublisher.publish(rootTopic + sessionState.conversationId, JSON.stringify(event), parentSpanCtx);
}

/**
 * This menthod is used to send a disconnect back to Genesys. This typically happens when there is an error
 * or problem encountered here at the server.
 * 
 * @param {*} webSocket 
 */
function sendDisconnect(webSocket, sessionState, reason) {
  if (webSocket.readyState === WebSocket.OPEN && sessionState.state != 'disconnected') {
    sessionState.serverSeq++;
    sessionState.state = 'disconnected';
    webSocket.send(JSON.stringify({
      "version": "2",
      "type": "disconnect",
      "seq": sessionState.serverSeq,
      "clientseq": sessionState.clientSeq,
      "id": sessionState.sessionId,
      "parameters": {
        "reason": reason
      }
    }));
  }
}

/**
 * Function for setting up new speech engines.
 * 
 * @param {*} externalSpeechToTextEngine 
 * @param {*} internalSpeechToTextEngine 
 * @param {*} webSocket 
 * @param {*} sessionState 
 */
function setupSpeechEngine(channelName, speechToTextEngine, webSocket, sessionState, parentSpanCtx) {

  speechToTextEngine.on('listening', () => {
    logger.debug(channelName + ' Speech Engine is listening.');
    sessionState.setSpeechEngineListening(channelName, true);

    if (sessionState.getPreListenCache(channelName) != null) {
      logger.debug('Flush pre listen cache for ' + channelName);
      speechToTextEngine.write(sessionState.getPreListenCache(channelName));
      sessionState.setPreListenCache(channelName, null);
    }
  });

  speechToTextEngine.on('data', (sttMessage) => {

    const { transcript } = sttMessage.results[0].alternatives[0];
    const { final } = sttMessage.results[0];

    //  Timestamp is the time for the first word in the utterance.
    let timestamp = sttMessage.results[0].alternatives[0].timestamps[0][1];

    //  We only publish the final transcription.
    if (final) {
      // tracer.startActiveSpan('speechToTextEngine.eventPublisher', { kind: SpanKind.INTERNAL }, parentSpanCtx, (span) => {
      //   //  Increatement the event sequence number.
      //   sessionState.eventCount++;

      //   //  Notify all the event listeners of a new transcription event
      //   let event = {
      //     'type': 'transcription',
      //     'parameters': {
      //       'source': channelName,
      //       'text': transcript,
      //       'seq': sessionState.eventCount,
      //       'timestamp': timestamp,
      //     },
      //     'agent_id': sessionState.agent_id, // this is a temporary way to route messages to agents only
      //   };

      //   logger.debug("Publish event for channel: " + channelName + " transcription: " + event.parameters.text);
      //   eventPublisher.publish(rootTopic + sessionState.conversationId + "/transcription", JSON.stringify(event), parentSpanCtx);
      //   span.end();
      // });
    }
    else {
      //  Note that you will not get hypothesis with all speech models (e.g LSM does not send these)
      logger.debug(channelName + ` transcription hypothesis received:` + transcript);

    }
  });

  speechToTextEngine.on('error', (error) => {
    logger.error(error, channelName + ' SpeechToTextEngine encountered an error: ' + error.message);
    sendDisconnect(webSocket, sessionState, error);
  });

  speechToTextEngine.on('end', (reason = 'No close reason defined') => {
    logger.debug(channelName + ' SpeechToTextEngine received an end, sending a disconnect');
    sendDisconnect(webSocket, sessionState, reason);
  });

  //  This code initialzes the speech recognition engines. This kicks off the initialization process and avoids
  //  any race conditions with getting the 'listening' events back. Note that I tried to use the 'initialize'
  //  method on the SDK but that didn't seem to work.
  speechToTextEngine.write(Buffer.alloc(1));
}

/**
 * 
 * @param {*} headers 
 * @returns 
 *    true: if headers contain a valid API KEY
 *    false: if headers do NOT contain a valid API KEY
 */
function isApiKeyValid(headers) {

  if (process.env.STREAM_CONNECTOR_API_KEY == "") {
    logger.debug('WARNING: No API key configured. Accepting websocket. Only use when testing.');
    return (true);
  }

  //  We check both cases of the x-api-key header because Genesys doc says that the header
  //  will be sent with all caps. Note that http headers in general are supposed to be case insensitive. 
  if (headers.hasOwnProperty('x-api-key')) {
    if (headers['x-api-key'] !== process.env.STREAM_CONNECTOR_API_KEY) {
      logger.error('WeSocket connection does not contain a valid API Key. Rejecting webSocket.');
      return false;
    }
    else {
      logger.debug('Valid API Key detected. Setting up webSocket session.');
    }
  }
  else if (headers.hasOwnProperty('X-API-KEY')) {
    if (headers['X-API-KEY'] !== process.env.STREAM_CONNECTOR_API_KEY) {
      logger.error('WeSocket connection does not contain a valid API Key. Rejecting webSocket.');
      return false;
    }
    else {
      logger.debug('Valid API Key detected. Setting up webSocket session.');
    }
  }
  else {
    logger.error('WeSocket connection does not contain an X-API-KEY header. Rejecting webSocket.');
    return false;
  }
  return true;
}

/**
 * Handles inbound audio data from the websocket.
 * 
 * @param {*} channelName 
 * @param {*} speechToTextEngine 
 * @param {*} sessionState 
 * @param {*} buffer 
 */
function processReceivedData(channelName, speechToTextEngine, sessionState, buffer) {
  if (speechToTextEngine != null && sessionState.isSpeechEngineListening(channelName) == true) {
    if (sessionState.receivedBufferCount % 100 == 0)
      logger.trace('Writing ' + buffer.length + ' bytes to the ' + channelName + ' speech engine.');

    speechToTextEngine.write(buffer);
  }
  else {
    //  Here we cache the audio until the internal speech engine is listening and ready for the data.
    if (sessionState.getPreListenCache(channelName) == null) {
      sessionState.setPreListenCache(channelName, buffer);
    }
    else {
      //  Here we cache the audio until the external speech engine is listening and ready for the data.
      let newBuffer = Buffer.alloc(sessionState.getPreListenCache(channelName).length + buffer.length);
      sessionState.getPreListenCache(channelName).copy(newBuffer);
      buffer.copy(newBuffer, sessionState.getPreListenCache(channelName).length);
      sessionState.setPreListenCache(channelName, newBuffer);
    }
  }
}

/**
 * Function for handling a new Genesys AudioHook connection.
 * 
 * @param {*} webSocket 
 * @param {*} incomingMessage 
 */
function handleAudioHookConnection(webSocket, incomingMessage) {
  const parentSpan = tracer.startSpan('handleAudioHookConnection', { kind: SpanKind.SERVER });
  const parentSpanCtx = trace.setSpan(context.active(), parentSpan);

  logger.debug('connection received');

  // Parse query parameters
  const queryParams = url.parse(incomingMessage.url, true).query;
  logger.trace(queryParams, 'query parameters:');

  // Get headers
  const { headers } = incomingMessage;
  logger.trace(headers, 'headers on websocket connection:');

  //  Check to see if the Genesys X-API-KEY matches the configured API_KEY. 
  //  If not we will reject the websocket.
  if (!isApiKeyValid(headers)) {
    logger.error('Rejecting webSocket due to invalid API KEY.');
    webSocket.close();
    return;
  }

  let externalSpeechToTextEngine = null;
  let internalSpeechToTextEngine = null;
  let sessionState = null;;

  webSocket.on('message', (data) => {
    if (typeof data === 'string') {
      try {
        const message = JSON.parse(data);

        if (sessionState != null) {
          sessionState.clientSeq++;
          if (message.seq != sessionState.clientSeq) {
            logger.debug(data.length, 'FATAL PROTOCOL ERROR: Received Genesys command message from websocket connection with unexpexted sequence number; seq received: ' + message.seq + 'seq expected: ' + sessionState.clientSeq);
          }
        }

        logger.trace(data.length, 'Received Genesys command message from websocket connection with expexted sequence number; seq: ' + message.seq);
        if (message.type === "open") {
          //  Create the streaming session state object
          sessionState = new StreamingSessionState(message);

          parentSpan.setAttribute('session_id', sessionState.conversationId);
          parentSpan.setAttribute('customer_ani', sessionState.participant.ani);

          sessionState.clientSeq++;

          // === 关键修正：对 probe 消消息进行特殊处理 ===
          if (message.parameters.conversationId === "00000000-0000-0000-0000-000000000000") {
            logger.debug('received: open for probe');
            // 只返回 opened 响应，不初始化 Watson STT
            tracer.startActiveSpan('sendOpenedResponse', { kind: SpanKind.INTERNAL }, parentSpanCtx, (span) => {
              sendOpenedResponse(webSocket, message, sessionState, parentSpanCtx);
              span.end();
            });
            return; // 直接返回，不再往下执行
          }

          logger.debug('received: open for new session');
          tracer.startActiveSpan('setup-stt', { kind: SpanKind.INTERNAL }, parentSpanCtx, (span) => {
            externalSpeechToTextEngine = new SpeechToTextEngine();
            internalSpeechToTextEngine = new SpeechToTextEngine();
            setupSpeechEngine('external', externalSpeechToTextEngine, webSocket, sessionState, parentSpanCtx);
            setupSpeechEngine('internal', internalSpeechToTextEngine, webSocket, sessionState, parentSpanCtx);
            span.end();
          });

          tracer.startActiveSpan('sendOpenedResponse', { kind: SpanKind.INTERNAL }, parentSpanCtx, (span) => {
            sendOpenedResponse(webSocket, message, sessionState, parentSpanCtx);
            span.end();
          });
        }

        if (message.type === "close") {
          logger.debug('received: close');

          stopSession(externalSpeechToTextEngine, internalSpeechToTextEngine, sessionState, parentSpanCtx);

          sessionState.serverSeq++;
          const closedResponse = {
            "version": 2,
            "type": "closed",
            "seq": sessionState.serverSeq,
            "clientseq": sessionState.clientSeq,
            "id": sessionState.sessionId,
            "parameters": {}
          };
          webSocket.send(JSON.stringify(closedResponse));
          parentSpan.end() //need to close out the span
        };

        if (message.type === "discarded") {
          logger.debug('received: discarded');
        };

        if (message.type === "error") {
          logger.debug('received: error from Genesys client with message: ' + message.parameters.message);
        };

        if (message.type === "paused") {
          logger.debug('received: puased');
        };

        if (message.type === "resumed") {
          logger.debug('received: resumed');
        };

        if (message.type === "update") {
          logger.debug('received: update');
        };

        if (message.type === "ping") {
          logger.trace('received: ping, sending pong');
          sessionState.serverSeq++;
          const pong = {
            "version": 2,
            "type": "pong",
            "seq": sessionState.serverSeq,
            "clientseq": sessionState.clientSeq,
            "id": sessionState.sessionId,
            "parameters": {}
          };
          logger.trace('pong:' + pong);
          webSocket.send(JSON.stringify(pong));
        };

      } catch (e) {
        logger.error(e);
        webSocket.close(1000, 'Invalid start message');
        parentSpan.end() //need to close out the span
      }
    } else if (Buffer.isBuffer(data)) {
      //  Track buffer count for debugging purposes
      sessionState.receivedBufferCount++;

      //  Used to track received buffers in trace.
      if (sessionState.receivedBufferCount % 100 == 0)
        logger.trace('Buffer received: data.length: ' + data.length);

      //  First we need to split the internal audio (agents audio) from the external audio (customers audio) before
      //  passing it along to the appropriate speech engines.
      let pos = 0;
      let externalBuffer = Buffer.alloc(data.length / 2);
      let internalBuffer = Buffer.alloc(data.length / 2);

      for (let i = 0; i < data.length; i = i + 2) {
        externalBuffer[pos] = data[i];
        internalBuffer[pos] = data[i + 1];
        pos++;
      }

      processReceivedData('external', externalSpeechToTextEngine, sessionState, externalBuffer);
      processReceivedData('internal', internalSpeechToTextEngine, sessionState, internalBuffer);
    }
    else {
      logger.warn('received unrecognized data');
    }
  });

  // Close event
  webSocket.on('close', (code, reason) => {
    logger.debug(`websocket onClose, code = ${code}, reason = ${reason}`);
    stopSession(externalSpeechToTextEngine, internalSpeechToTextEngine, sessionState, parentSpanCtx);
    //eventPublisher.destroy()
    parentSpan.end();
  });

  // Error event: 防止 ECONNRESET 导致进程崩溃
  webSocket.on('error', (err) => {
    logger.warn({ err }, 'WebSocket error (connection will be closed, but process will not exit)');
    // 可选：webSocket.close();
  });
}

module.exports.handleAudioHookConnection = handleAudioHookConnection;