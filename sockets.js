"use strict";
/*
 * Copyright 2015 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const socketio = require("socket.io");
const url = require("url");
const WebSocket = require("ws");
const logging = require("./logging");
let sessionCounter = 0;
/**
 * The application settings instance.
 */
let appSettings;
/**
 * Creates a WebSocket connected to the Jupyter server for the URL in the specified session.
 */
function createWebSocket(socketHost, port, session) {
    const path = url.parse(session.url).path;
    const socketUrl = `ws://${socketHost}:${port}${path}`;
    logging.getLogger().debug('Creating WebSocket to %s for session %d', socketUrl, session.id);
    const ws = new WebSocket(socketUrl);
    ws.on('open', () => {
        // Stash the resulting WebSocket, now that it is in open state
        session.webSocket = ws;
        session.socket.emit('open', { url: session.url });
    })
        .on('close', () => {
        // Remove the WebSocket from the session, once it is in closed state
        logging.getLogger().debug('WebSocket [%d] closed', session.id);
        session.webSocket = null;
        session.socket.emit('close', { url: session.url });
    })
        .on('message', (data) => {
        // Propagate messages arriving on the WebSocket to the client.
        logging.getLogger().debug('WebSocket [%d] message\n%j', session.id, data);
        session.socket.emit('data', { data });
    })
        .on('error', (e) => {
        logging.getLogger().error('WebSocket [%d] error\n%j', session.id, e);
        if (e.code === 'ECONNREFUSED') {
            // This happens in the following situation -- old kernel that has gone
            // away likely due to a restart/shutdown... and an old notebook client
            // attempts to reconnect to the old kernel. That connection will be
            // refused. In this case, there is no point in keeping this socket.io
            // connection open.
            session.socket.disconnect(/* close */ true);
        }
    });
    return ws;
}
/**
 * Closes the WebSocket instance associated with the session.
 */
function closeWebSocket(session) {
    if (session.webSocket) {
        session.webSocket.close();
        session.webSocket = null;
    }
}
/**
 * Handles communication over the specified socket.
 */
function socketHandler(socket) {
    sessionCounter++;
    // Each socket is associated with a session that tracks the following:
    // - id: a counter for use in log output
    // - url: the url used to connect to the Jupyter server
    // - socket: the socket.io socket reference, which generates message
    //           events for anything sent by the browser client, and allows
    //           emitting messages to send to the browser
    // - webSocket: the corresponding WebSocket connection to the Jupyter
    //              server.
    // Within a session, messages recieved over the socket.io socket (from the browser)
    // are relayed to the WebSocket, and messages recieved over the WebSocket socket are
    // relayed back to the socket.io socket (to the browser).
    const session = { id: sessionCounter, url: '', socket, webSocket: null };
    logging.getLogger().debug('Socket connected for session %d', session.id);
    socket.on('disconnect', () => {
        logging.getLogger().debug('Socket disconnected for session %d', session.id);
        // Handle client disconnects to close WebSockets, so as to free up resources
        closeWebSocket(session);
    });
    socket.on('start', (message) => {
        logging.getLogger().debug('Start in session %d with url %s', session.id, message.url);
        try {
            let port = appSettings.nextJupyterPort;
            if (appSettings.kernelManagerProxyPort) {
                port = appSettings.kernelManagerProxyPort;
                logging.getLogger().debug('Using kernel manager proxy port %d', port);
            }
            let host = 'localhost';
            if (appSettings.kernelManagerProxyHost) {
                host = appSettings.kernelManagerProxyHost;
            }
            session.url = message.url;
            session.webSocket = createWebSocket(host, port, session);
        }
        catch (e) {
            logging.getLogger().error(e, 'Unable to create WebSocket connection to %s', message.url);
            session.socket.disconnect(/* close */ true);
        }
    });
    socket.on('stop', (message) => {
        logging.getLogger().debug('Stop in session %d with url %s', session.id, message.url);
        closeWebSocket(session);
    });
    socket.on('data', (message) => {
        // The client sends this message per data message to a particular channel. Propagate the
        // message over to the WebSocket associated with the specified channel.
        logging.getLogger().debug('Send data in session %d\n%s', session.id, message.data);
        if (session.webSocket) {
            session.webSocket.send(message.data, (e) => {
                if (e) {
                    logging.getLogger().error(e, 'Failed to send message to websocket');
                }
            });
        }
        else {
            logging.getLogger().error('Unable to send message; WebSocket is not open');
        }
    });
}
/** Initialize the socketio handler. */
function init(server, settings) {
    appSettings = settings;
    const io = socketio(server, {
        path: '/socket.io',
        transports: ['polling'],
        allowUpgrades: false,
        // v2.10 changed default from 60s to 5s, prefer the longer timeout to
        // avoid errant disconnects.
        pingTimeout: 60000,
    });
    io.of('/session')
        .on('connection', socketHandler);
}
exports.init = init;
/** Return true iff path is handled by socket.io. */
function isSocketIoPath(path) {
    return path.indexOf('/socket.io/') === 0;
}
exports.isSocketIoPath = isSocketIoPath;
