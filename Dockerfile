FROM node:20

COPY ./package.json /app_build/

COPY ./server/package.json /node-app/

RUN cd /app_build && npm install

RUN cd /node-app && npm install --production

WORKDIR /app_build

COPY . .

RUN npm run build

WORKDIR /node-app

COPY ./server/libs ./libs
COPY ./server/messageTemplate ./messageTemplate
COPY ./server/* ./

RUN cp -r /app_build/build ./build

EXPOSE 8060

# 启动应用
CMD ["npm", "run", "start"]

