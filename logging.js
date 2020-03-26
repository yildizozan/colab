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
const bunyan = require("bunyan");
const path = require("path");
// We import the bunyan-rotating-file-stream package, which exports a
// constructor as a single object; we use lint disables here to make the usage
// below look reasonable.
//
// tslint:disable-next-line:no-require-imports variable-name
const RotatingFileStream = require('bunyan-rotating-file-stream');
let logger = null;
let requestLogger = null;
let jupyterLogger = null;
/**
 * Gets the logger for generating debug logs.
 * @returns the logger configured for debugging logging.
 */
function getLogger() {
    return logger;
}
exports.getLogger = getLogger;
/**
 * Gets the logger for generating Jupyter logs.
 * @returns the logger configured for Jupyter logging.
 */
function getJupyterLogger() {
    return jupyterLogger;
}
exports.getJupyterLogger = getJupyterLogger;
/**
 * Logs a request and the corresponding response.
 * @param request the request to be logged.
 * @param response the response to be logged.
 */
function logRequest(request, response) {
    requestLogger.info({ url: request.url, method: request.method }, 'Received a new request');
    response.on('finish', () => {
        requestLogger.info({
            url: request.url,
            method: request.method,
            status: response.statusCode
        });
    });
}
exports.logRequest = logRequest;
/**
 * Initializes loggers used within the application.
 */
function initializeLoggers(settings) {
    // We configure our loggers as follows:
    //  * our base logger tags all log records with `"name":"app"`, and sends logs
    //    to stderr (including logs of all children)
    //  * one child logger adds `"type":"request"`, and records method/URL for all
    //    HTTP requests to the app, and method/URL/response code for all responses
    //  * one child logger adds `"type":"jupyter"`, and records all messages from
    //    the jupyter notebook server. These logs are also sent to a file on disk
    //    (to assist user debugging).
    //
    // For more about bunyan, see:
    //   https://github.com/trentm/node-bunyan/tree/f21007d46c0e64072617380b70d3f542368318a8
    const jupyterLogPath = path.join(settings.datalabRoot, '/var/log/colab-jupyter.log');
    logger = bunyan.createLogger({
        name: 'app',
        streams: [
            { level: 'debug', type: 'stream', stream: process.stderr },
        ]
    });
    requestLogger = logger.child({ type: 'request' });
    jupyterLogger = logger.child({
        type: 'jupyter',
        streams: [{
                level: 'info',
                type: 'stream',
                stream: new RotatingFileStream({
                    path: jupyterLogPath,
                    rotateExisting: false,
                    threshold: '2m',
                    totalSize: '20m'
                }),
            }]
    });
}
exports.initializeLoggers = initializeLoggers;
