   

# pull official base image
FROM node:16-alpine

# set working directory
WORKDIR /app

# add `/app/node_modules/.bin` to $PATH
ENV PATH /app/node_modules/.bin:$PATH

# install app dependencies
COPY package.json ./
COPY package-lock.json ./

RUN apk add --update python3 make g++ && rm -rf /var/cache/apk/*
RUN npm install


# switch user
USER node

# add app
COPY . ./

# Expose the port
EXPOSE 8080

# Environment variables (note that these should be moved to an external config map)
ENV MQTT_BROKER_URL=
ENV MQTT_BROKER_USER_NAME=apikey
ENV MQTT_BROKER_PASSWORD=
ENV MQTT_BROKER_PATH=/ws
ENV MQTT_BROKER_PORT=443
ENV MQTT_BROKER_DISABLE_SLL=false

ENV WATSON_STT_USERNAME=apikey
ENV WATSON_STT_PASSWORD=
ENV WATSON_STT_URL=
ENV WATSON_STT_MODEL=en-US_Telephony
ENV WATSON_STT_END_OF_PHRASE_SILENCE_TIME=1.3

ENV DEFAULT_SERVER_LISTEN_PORT=8080
ENV STREAM_CONNECTOR_API_KEY=
ENV STREAM_ADAPTER_TYPE=GenesysAudioHookAdapter
ENV LOG_LEVEL=debug

# start app
CMD ["npm", "start"]
