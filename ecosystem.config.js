module.exports = {
  apps: [{
    name: 'watson-stt-stream-connector',
    script: './app.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      DEFAULT_SERVER_LISTEN_PORT: process.env.PORT || 80, // Azure 会提供 PORT 环境变量
      LOG_LEVEL: 'info',
      TELEMETRY: process.env.TELEMETRY || 'false',
      STREAM_ADAPTER_TYPE: 'GenesysAudioHookAdapter'
    }
  }]
}; 