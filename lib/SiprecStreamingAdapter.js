
const WebSocket = require('ws');
const WebSocketServer = require('ws').Server;

// Change to your own Speech To Text Engine implementation, you can use
// the WatsonSpeechToTextEngine.js for guidance
const SpeechToTextEngine = require('./WatsonSpeechToTextEngine');
const StreamingSessionState = require('./SiprecStreamingSessionState');
const url = require('url');

const DEFAULT_PORT = process.env.DEFAULT_AUDIO_HOOK_LISTEN_PORT;
const LOG_LEVEL = process.env.LOG_LEVEL;
const logger = require('pino')({ level: LOG_LEVEL, name: 'SiprecStreamingAdapter' });

const rootTopic = "agent-assist/";
const rootSessionTopic = rootTopic + "session";

var eventPublisher = null;
function setEventPublisher(publisher){eventPublisher = publisher;}
module.exports.setEventPublisher = setEventPublisher;

var numberOfChannels = 0;

/**
 * Function for sending an 'opened" response.
 * 
 * @param {*} webSocket 
 * @param {*} openRequest 
 * @param {*} sessionState 
 */
function sendOpenedResponse (webSocket, openRequest, sessionState){
  logger.debug('Send opened message.');

  //  Notify all the event listeners that a new session is starting
  let event = {
                'type': 'session_started',
                'parameters': {
                  'session_id': sessionState.conversationId,
                  'customer_ani': sessionState.participant.ani,
                  'customer_name': sessionState.participant.aniName,
                  'dnis': sessionState.participant.dnis
                }
              };
  eventPublisher.publish(rootSessionTopic, JSON.stringify(event));

  // Send the listening message back to the client
  sessionState.serverSeq++;
  const listeningMsg = {
    state: 'listening',
  };
  webSocket.send(JSON.stringify(listeningMsg));
}

/**
 * Functaion for destroying active speech engines.
 * 
 * @param {*} speechToTextEngine 
 * @param {*} internalSpeechToTextEngine 
 */
function removeActiveSpeechEngines(speechToTextEngine, sessionState) {
  if (speechToTextEngine != null){
    speechToTextEngine.removeAllListeners();
    speechToTextEngine.on('error', () => {}); // no-op
    speechToTextEngine.destroy();
  }

  //  Notify all the event listeners that the session as ended
  let event = {
                'type': 'session_ended'
              };
  eventPublisher.publish(rootTopic + sessionState.conversationId, JSON.stringify(event));
}

/**
 * This menthod is used to send a disconnect back to client. This typically happens when there is an error
 * or problem encountered here at the server.
 * 
 * @param {*} webSocket 
 */
function sendDisconnect(webSocket, sessionState, reason){
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
 * @param {*} speechToTextEngine 
 * @param {*} internalSpeechToTextEngine 
 * @param {*} webSocket 
 * @param {*} openRequest 
 * @param {*} sessionState 
 */
function setActiveSpeechEngine(speechToTextEngine, webSocket, openRequest, sessionState) {

  if (speechToTextEngine != null){

    speechToTextEngine.on('listening', () => {
      logger.debug('Mono Speech Engine is listening.');
      sessionState.setSpeechEngineListening('siprecSpeechToTextEngine', true);
  
      if (sessionState.getPreListenCache('siprecPreListenCache') != null){
        logger.debug('Writing monoPreListenCache to speech engine. Number of bytes: ' + sessionState.getPreListenCache('siprecPreListenCache').length);
        speechToTextEngine.write(sessionState.getPreListenCache('siprecPreListenCache'));
        sessionState.setPreListenCache('siprecPreListenCache',null);
      }
    });

    /*
    * Note that the externalSpeechToTextEnging is used for mono-mixed. Its the only engine that will
    * utilize speaker labels.
    */
    speechToTextEngine.on('data', (sttMessage) => {
      logger.debug (JSON.stringify(sttMessage, null, 4));
      const { transcript } = sttMessage.results[0].alternatives[0];
      const { final } = sttMessage.results[0];

      //  We only publish the final transcription. Interim results are ignored.
      if (final) {
        logger.debug(`External transcription event:` + transcript);

        //  Increatement the event sequence number.
        sessionState.eventCount++;

        let event = {
          'type': 'transcription',
          'parameters': {
            'source': "mono",
            'text': transcript,
            'seq': sessionState.eventCount
          }
        };

        eventPublisher.publish(rootTopic + sessionState.conversationId + "/transcription", JSON.stringify(event));
      }
      else {
        logger.trace(`External transcription interim result received:` + transcript);
      }
    });

    speechToTextEngine.on('error', (error) => {
      logger.error(error, 'speechToTextEngine encountered an error: ' + error.message);
      sendDisconnect(webSocket, sessionState, error);
     });
  
     speechToTextEngine.on('end', (reason = 'No close reason defined') => {
      logger.error(reason, 'speechToTextEngine received an end, sending a disconnect to client');
      sendDisconnect(webSocket, sessionState, reason);
    });
  
    //  This code initialzes the speech recognition engines. This kicks off the initialization process and avoids
    //  any race conditions with getting the 'listening' events back. Note that I tried to use the 'initialize'
    //  method on the SDK but that didn't seem to work.
    speechToTextEngine.write(Buffer.alloc(1));
  }
}

/**
 * 
 * @param {*} headers 
 * @returns 
 *    true: if headers contain a valid API KEY
 *    false: if headers do NOT contain a valid API KEY
 */
function isApiKeyValid(headers) {

  if (process.env.STREAM_CONNECTOR_API_KEY == ""){
    logger.debug('WARNING: No API key configured. Accepting websocket. Only use when testing.');
    return (true);
  }

  //  We check both cases of the x-api-key header because Genesys doc says that the header
  //  will be sent with all caps. Note that http headers in general are supposed to be case insensitive. 
  if (headers.hasOwnProperty('x-api-key')){
    if (headers['x-api-key'] !== process.env.STREAM_CONNECTOR_API_KEY){
      logger.error('WeSocket connection does not contain a valid API Key. Rejecting webSocket.');
      return false;
    }
    else{
      logger.debug('Valid API Key detected. Setting up webSocket session.');
    }
  }
  else if (headers.hasOwnProperty('X-API-KEY')){
    if (headers['X-API-KEY'] !== process.env.STREAM_CONNECTOR_API_KEY){
      logger.error('WeSocket connection does not contain a valid API Key. Rejecting webSocket.');
      return false;
    }
    else{
      logger.debug('Valid API Key detected. Setting up webSocket session.');
    }
  }
  else if (headers.hasOwnProperty('Authorization')){
    logger.debug('Authorization header received: ' + headers.hasOwnProperty('Authorization'));
    if (headers['Authorization'] != "Basic " + Buffer.from("apikey:" + process.env.STREAM_CONNECTOR_API_KEY).toString('base64')){
      logger.error('WeSocket connection does not contain a valid API Key. Rejecting webSocket.');
      return false;
    }
    else {
      logger.debug('Valid API Key detected. Setting up webSocket session.');
    }
  }
  else{
    logger.error('WeSocket connection does not contain an X-API-KEY or Authorization header. Rejecting webSocket.');
    return false;
  }
  return true;
}

/**
 * Function for handling a new Mono Channel streaming connection.
 * 
 * @param {*} webSocket 
 * @param {*} incomingMessage 
 */
function handleSiprecStreamingConnection(webSocket, incomingMessage) {
  logger.debug('connection received');

  // Parse query parameters
  const queryParams = url.parse(incomingMessage.url, true).query;
  logger.trace(queryParams, 'query parameters:');
  
  // Get headers
  const { headers } = incomingMessage;
  logger.trace(headers, 'headers on websocket connection:');

  //  Check to see if the apikey sent in the connect matches the configured API_KEY. 
  //  If not we will reject the websocket.
  if (!isApiKeyValid(headers)){
    logger.error('Rejecting webSocket due to invalid API KEY.');
    webSocket.close();
    return;
  }

  let siprecSpeechToTextEngine = null;
  let internalSpeechToTextEngine = null;
  let sessionState = null;;

  webSocket.on('message', (data) => {
     if (typeof data === 'string') {
        try {
          const message = JSON.parse(data);
          
          if (message.action === "start") {

            logger.debug('received: start for new session');

            // Message contains, text and accept
            // Combine the start message with query parameters to generate a config
            const config = Object.assign(queryParams, message);
            logger.debug(config, 'config for engine: ');

            //  Now combine the headers with the message JSON
            message = Object.assign(message, headers);
            logger.debug(message, 'message + headers for session: ');

            //  Create the streaming session state object
            sessionState = new StreamingSessionState(message);

            //  Increment the client message seq number to insure protocol is valid.
            sessionState.clientSeq++;

            // Create a speech to text engine instance, for both the internal (agent) and external (user)
            //  audio streams.
            siprecSpeechToTextEngine = new SpeechToTextEngine();
            
            setActiveSpeechEngine(siprecSpeechToTextEngine, webSocket, message, sessionState);          


            //  We immediately send an opened response to avoid the timeout.
            //  This means we may start receive data before receiving a listening event
            //  from each of the speech engines.  
            sendOpenedResponse(webSocket, message, sessionState);
          };

          if (message.action === "stop") {
            logger.debug('received: stop');

            if (siprecSpeechToTextEngine != null){
              removeActiveSpeechEngines(siprecSpeechToTextEngine, sessionState);
              siprecSpeechToTextEngine = null;
            }

            sessionState.serverSeq++;
            const listeningMsg = {
              state: 'listening',
            };
            webSocket.send(JSON.stringify(listeningMsg));
          };

          if (message.type === "discarded") {
            logger.debug('received: discarded');
          };

          if (message.type === "error") {
            logger.debug('received: error from client with message: ' + message.parameters.message);
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
      }
    } 
    else if (Buffer.isBuffer(data)) {
      //  Track buffer count for debugging purposes
      sessionState.receivedBufferCount++;

      //  Used to track received buffers in trace.
      if (sessionState.receivedBufferCount % 100 == 0)
        logger.trace('Buffer received: data.length: ' + data.length);
      
      //  If there are two channels the data is interleaved and needs to be split up
      let channelBuffer = data;

      if (siprecSpeechToTextEngine != null && sessionState.isSpeechEngineListening('siprecSpeechToTextEngine') == true) {
        if (sessionState.receivedBufferCount % 100 == 0)
          logger.trace('Writing ' + externalBuffer.length + ' bytes to external speech engine.');  

        siprecSpeechToTextEngine.write(channelBuffer);
      }
      else{
        //  Here we cache the audio until the internal speech engine is listening and ready for the data.
        if (sessionState.getPreListenCache('siprecPreListenCache') == null){
          sessionState.setPreListenCache('siprecPreListenCache',channelBuffer);
        }
        else{
          //  Here we cache the audio until the external speech engine is listening and ready for the data.
          let preListenCache = sessionState.getPreListenCache('siprecPreListenCache')
          let newBuffer = Buffer.alloc(preListenCache.length + channelBuffer.length);
          preListenCache.copy(newBuffer);
          channelBuffer.copy(newBuffer, preListenCache.length);
          sessionState.setPreListenCache('siprecPreListenCache',newBuffer);
        }
      }
    } 
    else {
      logger.warn('received unrecognized data');
    }
  });

  // Close event
  webSocket.on('close', (code, reason) => {
    logger.debug(`onClose, code = ${code}, reason = ${reason}`);
    if (siprecSpeechToTextEngine != null){
      removeActiveSpeechEngines(siprecSpeechToTextEngine, sessionState);
      siprecSpeechToTextEngine = null;
    }
  });
}

module.exports.handleSiprecStreamingConnection = handleSiprecStreamingConnection;