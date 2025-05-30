

const celery = require('celery-node');

const LOG_LEVEL = process.env.LOG_LEVEL;
const logger = require('pino')({ level: LOG_LEVEL, name: 'CeleryEventPublisher' });

const { trace, SpanKind, context } = require('@opentelemetry/api');

const tracer = trace.getTracer('GenesysAudioHookAdapter');

const EventPublisher = require('./EventPublisher');

class CeleryEventPublisher extends EventPublisher {

   constructor() {
    super();

    // TODO: take proper env vars
    const rabbitUrl = process.env.AAN_AMQP_URI || 'amqp://admin:adminpass@localhost:5672';
    const redisUrl = process.env.AAN_REDIS_URI || 'redis://localhost:6379/1'
    
    this.client = celery.createClient(
        rabbitUrl, redisUrl
    );

    //this.client.conf.TASK_PROTOCOL = 1

    // name of the celery task
    this.task = this.client.createTask("aan_extensions.DispatcherAgent.tasks.process_transcript");
    logger.debug('CeleryEventPublisher: established celery client');
    return this;
  }

  /* eslint-disable class-methods-use-this */
  publish(topic, message, parentSpanCtx) {
    logger.debug('CeleryEventPublisher: publishing message: ' + message + ' on topic: ' + topic);
    // mqttClient.publish(topic, message);
    // const span = tracer.startSpan('CeleryEventPublisher', parentSpanCtx)
    // this.task.applyAsync([topic, message])
    // span.end()
    const execTask = this.task.applyAsync
    const taskInput = [topic, message]
    tracer.startActiveSpan('CeleryEventPublisher.send_celery',  {kind: SpanKind.PRODUCER} ,parentSpanCtx, (span) => {
      logger.debug('send_celery context ')
      logger.debug(parentSpanCtx)
      logger.debug(span._spanContext)
      logger.debug(span.parentSpanId)
      //console.log(execTask)
      //context.with(parentSpanCtx, execTask, this, taskInput)
      this.task.applyAsync([topic, message])
      span.end();
    });

  }

  destroy() {
    //  Force the shutdown of the client connection.
    this.client.disconnect()  
  }
}
module.exports = CeleryEventPublisher;
