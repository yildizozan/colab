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
const childProcess = require("child_process");
const httpProxy = require("http-proxy");
const path = require("path");
const logging = require("./logging");
/**
 * Singleton tracking the jupyter server instance we manage.
 */
let jupyterServer = null;
/**
 * The maximum number of times we'll restart jupyter; we set a limit to avoid
 * users being stuck with a slow-crash-looping server.
 */
let remainingJupyterServerRestarts = 20;
/**
 * The application settings instance.
 */
let appSettings;
function pipeOutput(stream) {
    stream.setEncoding('utf8');
    // The format we parse here corresponds to the log format we set in our
    // jupyter configuration.
    const logger = logging.getJupyterLogger();
    stream.on('data', (data) => {
        for (const line of data.split('\n')) {
            if (line.trim().length === 0) {
                continue;
            }
            const parts = line.split('|', 3);
            if (parts.length !== 3) {
                // Non-logging messages (eg tracebacks) get logged as warnings.
                logger.warn(line);
                continue;
            }
            const level = parts[1];
            const message = parts[2];
            // We need to map Python's log levels to those used by bunyan.
            if (level === "CRITICAL" /* Critical */ || level === "ERROR" /* Error */) {
                logger.error(message);
            }
            else if (level === "WARNING" /* Warning */) {
                logger.warn(message);
            }
            else if (level === "INFO" /* Info */) {
                logger.info(message);
            }
            else {
                // We map DEBUG, NOTSET, and any unknown log levels to debug.
                logger.debug(message);
            }
        }
    });
}
function createJupyterServer() {
    if (!remainingJupyterServerRestarts) {
        logging.getLogger().error('No jupyter restart attempts remaining.');
        return;
    }
    remainingJupyterServerRestarts -= 1;
    const port = appSettings.nextJupyterPort;
    logging.getLogger().info('Launching Jupyter server at %d', port);
    function exitHandler(code, signal) {
        if (jupyterServer) {
            logging.getLogger().error('Jupyter process %d exited due to signal: %s', jupyterServer.childProcess.pid, signal);
        }
        else {
            logging.getLogger().error('Jupyter process exit before server creation finished due to signal: %s', signal);
        }
        // We want to restart jupyter whenever it terminates.
        createJupyterServer();
    }
    const contentDir = path.join(appSettings.datalabRoot, appSettings.contentDir);
    const processArgs = ['notebook'].concat(appSettings.jupyterArgs).concat([
        `--port=${port}`,
        `--FileContentsManager.root_dir="${appSettings.datalabRoot}/"`,
        `--MappingKernelManager.root_dir="${contentDir}"`,
    ]);
    let jupyterServerAddr = 'localhost';
    for (const flag of appSettings.jupyterArgs) {
        // Extracts a string like '1.2.3.4' from the string '--ip="1.2.3.4"'
        const match = flag.match(/--ip="([^"]+)"/);
        if (match) {
            jupyterServerAddr = match[1];
            break;
        }
    }
    logging.getLogger().info('Using jupyter server address %s', jupyterServerAddr);
    const processOptions = {
        detached: false,
        env: process.env,
    };
    const serverProcess = childProcess.spawn('jupyter', processArgs, processOptions);
    serverProcess.on('exit', exitHandler);
    logging.getLogger().info('Jupyter process started with pid %d and args %j', serverProcess.pid, processArgs);
    // Capture the output, so it can be piped for logging.
    pipeOutput(serverProcess.stdout);
    pipeOutput(serverProcess.stderr);
    // Create the proxy.
    const proxyTargetHost = appSettings.kernelManagerProxyHost || jupyterServerAddr;
    const proxyTargetPort = appSettings.kernelManagerProxyPort || port;
    const proxy = httpProxy.createProxyServer({ target: `http://${proxyTargetHost}:${proxyTargetPort}` });
    proxy.on('error', errorHandler);
    jupyterServer = { port, proxy, childProcess: serverProcess };
}
/**
 * Initializes the Jupyter server manager.
 */
function init(settings) {
    appSettings = settings;
    createJupyterServer();
}
exports.init = init;
/**
 * Closes the Jupyter server manager.
 */
function close() {
    if (!jupyterServer) {
        return;
    }
    const pid = jupyterServer.childProcess.pid;
    logging.getLogger().info(`jupyter close: PID: ${pid}`);
    jupyterServer.childProcess.kill('SIGHUP');
}
exports.close = close;
/** Proxy this socket request to jupyter. */
function handleSocket(request, socket, head) {
    if (!jupyterServer) {
        logging.getLogger().error('Jupyter server is not running.');
        return;
    }
    jupyterServer.proxy.ws(request, socket, head);
}
exports.handleSocket = handleSocket;
/** Proxy this HTTP request to jupyter. */
function handleRequest(request, response) {
    if (!jupyterServer) {
        response.statusCode = 500;
        response.end();
        return;
    }
    jupyterServer.proxy.web(request, response, null);
}
exports.handleRequest = handleRequest;
function errorHandler(error, request, response) {
    logging.getLogger().error(error, 'Jupyter server returned error.');
    response.writeHead(500, 'Internal Server Error');
    response.end();
}
