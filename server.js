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
const http = require("http");
const url = require("url");
const jupyter = require("./jupyter");
const logging = require("./logging");
const reverseProxy = require("./reverseProxy");
const sockets = require("./sockets");
let server;
/**
 * Handles all requests.
 * @param request the incoming HTTP request.
 * @param response the out-going HTTP response.
 * @path the parsed path in the request.
 */
function handleRequest(request, response, requestPath) {
    // Requests proxied to Jupyter
    // TODO(b/109975537): Forward paths directly from the TBE -> Jupyter and drop
    // here.
    if ((requestPath.indexOf('/api') === 0) ||
        (requestPath.indexOf('/nbextensions') === 0) ||
        (requestPath.indexOf('/files') === 0) ||
        (requestPath.indexOf('/static') === 0)) {
        jupyter.handleRequest(request, response);
        return;
    }
    // Not Found
    response.statusCode = 404;
    response.end();
}
/**
 * Base logic for handling all requests sent to the proxy web server. Some
 * requests are handled within the server, while some are proxied to the
 * Jupyter notebook server.
 *
 * Error handling is left to the caller.
 *
 * @param request the incoming HTTP request.
 * @param response the out-going HTTP response.
 */
function uncheckedRequestHandler(request, response) {
    const parsedUrl = url.parse(request.url || '', true);
    const urlpath = parsedUrl.pathname || '';
    logging.logRequest(request, response);
    const reverseProxyPort = reverseProxy.getRequestPort(request, urlpath);
    if (sockets.isSocketIoPath(urlpath)) {
        // Will automatically be handled by socket.io.
    }
    else if (reverseProxyPort) {
        reverseProxy.handleRequest(request, response, reverseProxyPort);
    }
    else {
        handleRequest(request, response, urlpath);
    }
}
function socketHandler(request, socket, head) {
    jupyter.handleSocket(request, socket, head);
}
/**
 * Handles all requests sent to the proxy web server. Some requests are handled within
 * the server, while some are proxied to the Jupyter notebook server.
 * @param request the incoming HTTP request.
 * @param response the out-going HTTP response.
 */
function requestHandler(request, response) {
    try {
        uncheckedRequestHandler(request, response);
    }
    catch (e) {
        logging.getLogger().error(`Uncaught error handling a request to "${request.url}": ${e}`);
    }
}
/**
 * Runs the proxy web server.
 * @param settings the configuration settings to use.
 */
function run(settings) {
    jupyter.init(settings);
    reverseProxy.init(settings);
    server = http.createServer(requestHandler);
    // Disable HTTP keep-alive connection timeouts in order to avoid connection
    // flakes. Details: b/112151064
    server.keepAliveTimeout = 0;
    server.on('upgrade', socketHandler);
    sockets.init(server, settings);
    logging.getLogger().info('Starting server at http://localhost:%d', settings.serverPort);
    process.on('SIGINT', () => process.exit());
    server.listen(settings.serverPort);
}
exports.run = run;
/**
 * Stops the server and associated Jupyter server.
 */
function stop() {
    jupyter.close();
}
exports.stop = stop;
