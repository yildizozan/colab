"use strict";
/*
 * Copyright 2016 Google Inc. All rights reserved.
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
const httpProxy = require("http-proxy");
let appSettings;
const proxy = httpProxy.createProxyServer(null);
const regex = new RegExp('\/_proxy\/([0-9]+)($|\/)');
function errorHandler(error, request, response) {
    response.writeHead(500, 'Reverse Proxy Error.');
    response.end();
}
function getPort(url) {
    if (url) {
        var sr = regex.exec(url);
        if (sr) {
            return sr[1];
        }
    }
    return null;
}
/**
 * Normalize a header value to a string, turning null to the empty string and
 * joining multiple values as needed.
 */
function headerAsString(header) {
    if (!header) {
        return '';
    }
    else if (typeof header === 'string') {
        return header;
    }
    else {
        return header.join();
    }
}
/**
 * Get port from request. If the request should be handled by reverse proxy, returns
 * the port as a string. Othewise, returns null.
 */
function getRequestPort(request, path) {
    const referer = headerAsString(request.headers['referer']);
    const port = getPort(path) || getPort(referer);
    return port;
}
exports.getRequestPort = getRequestPort;
/**
 * Handle request by sending it to the internal http endpoint.
 */
function handleRequest(request, response, port) {
    request.url = request.url.replace(regex, '');
    const target = 'http://localhost:' + port;
    proxy.web(request, response, {
        target
    });
}
exports.handleRequest = handleRequest;
/**
 * Initialize the handler.
 */
function init(settings) {
    appSettings = settings;
    proxy.on('error', errorHandler);
}
exports.init = init;
