const { ServiceBusClient } = require('@azure/service-bus');
const LOG_LEVEL = process.env.LOG_LEVEL;
const logger = require('pino')({ level: LOG_LEVEL, name: 'CeleryEventPublisher' });

const { trace, SpanKind } = require('@opentelemetry/api');
const tracer = trace.getTracer('GenesysAudioHookAdapter');

const EventPublisher = require('./EventPublisher');

class CeleryEventPublisher extends EventPublisher {
  constructor() {
    super();

    // Azure Service Bus configuration
    const policyName = process.env.AZURE_SERVICE_BUS_POLICY_NAME;
    const key = process.env.AZURE_SERVICE_BUS_KEY;
    const namespace = process.env.AZURE_SERVICE_BUS_NAMESPACE;
    
    if (!policyName || !key || !namespace) {
      throw new Error('Azure Service Bus configuration is required');
    }

    const connectionString = `Endpoint=sb://${namespace}/;SharedAccessKeyName=${policyName};SharedAccessKey=${key}`;
    this.serviceBusClient = new ServiceBusClient(connectionString);
    this.sender = this.serviceBusClient.createSender('celery');
    
    // name of the celery task
    this.taskName = "aan_extensions.DispatcherAgent.tasks.process_transcript";
    logger.debug('CeleryEventPublisher: established Azure Service Bus client');
    return this;
  }

  publish(topic, message, parentSpanCtx) {
    logger.debug('CeleryEventPublisher: publishing message: ' + message + ' on topic: ' + topic);
    
    // Create Celery task message format
    const celeryMessage = {
      body: {
        task: this.taskName,
        args: [topic, message],
        kwargs: {},
        id: Date.now().toString(),
        retries: 0,
        eta: null,
        expires: null,
        utc: true
      },
      'content-encoding': 'utf-8',
      'content-type': 'application/json',
      headers: {},
      properties: {
        delivery_info: {
          routing_key: 'celery',
          exchange: '',
          consumer_tag: null
        },
        delivery_mode: 2,
        delivery_tag: null,
        message_id: null,
        priority: 0,
        reply_to: null,
        correlation_id: null
      }
    };

    tracer.startActiveSpan('CeleryEventPublisher.send_celery', {kind: SpanKind.PRODUCER}, parentSpanCtx, async (span) => {
      try {
        logger.debug('send_celery context');
        logger.debug(parentSpanCtx);
        logger.debug(span._spanContext);
        logger.debug(span.parentSpanId);

        // Send message to Azure Service Bus
        await this.sender.sendMessages({
          body: celeryMessage,
          contentType: 'application/json'
        });
        
        logger.debug('Celery task message sent successfully');
      } catch (error) {
        logger.error('Error sending Celery task message:', error);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  async destroy() {
    if (this.sender) {
      await this.sender.close();
    }
    if (this.serviceBusClient) {
      await this.serviceBusClient.close();
    }
  }
}

module.exports = CeleryEventPublisher;
