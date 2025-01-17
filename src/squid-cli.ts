#!/usr/bin/env node

import { spawn } from "child_process";
import { program } from "commander";
import { createSocket } from "dgram";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import nodemon from "nodemon";
import path from "path";
import { getComponentContext, getSquidContext } from "./modules/compile";

const IPC_PORT = 7150;
const npm = process.platform == 'win32' ? 'npm.cmd' : 'npm';

async function getContext() {
  if (existsSync('./build'))
    await rm('./build', { recursive: true });

  const componentContext = await getComponentContext();
  const squidContext = await getSquidContext();

  const rebuild = async () => {
    await componentContext.rebuild();
    await squidContext.rebuild();
  };

  const watch = async () => {
    componentContext.watch();
    squidContext.watch();
  };

  const dispose = async () => {
    componentContext.dispose();
    squidContext.dispose();
  };

  return {
    rebuild,
    watch,
    dispose
  };
}

program
  .command('build')
  .description('Build project for production')
  .action(async () => {
    const { rebuild, dispose } = await getContext();

    await rebuild();
    await dispose();

  });

program
  .command('dev')
  .description('Starts Squid server and rebuilds development build of the project on file changes (FOR DEVELOPMENT ONLY, use "build" for production builds))')
  .action(async () => {

    const { rebuild, watch } = await getContext();

    await rebuild();
    await watch();

    nodemon({
      scriptPosition: 0,
      script: 'build/main.js',
      args: []
    });
  });

program
  .command('start')
  .description('Starts the Squid server (does not rebuild the project)')
  .action(() => {
    const ipcSocket = createSocket({ type: 'udp4', reuseAddr: true });
    ipcSocket.bind(IPC_PORT, 'localhost');

    ipcSocket.on('message', (msg) => msg.toString('utf8') == 'started' ? process.exit() : '');

    //Process must NOT inherit stdio. This causes the gitlab CI/CD pipeline to get stuck (because why not?)
    //even after the CLI process terminates (prolly cause it waits for stdio to be free again?)
    const serverProcess = spawn('node', [path.resolve(process.cwd(), 'build/main.js')], {
      cwd: process.cwd(),
      detached: true
    });

    serverProcess.on('exit', () => process.exit());

    //We still gotta get the console output tho
    serverProcess.stdout.on('data', data => process.stdout.write(data));
    serverProcess.stderr.on('data', data => process.stderr.write(data));
    serverProcess.unref();
  });

program
  .command('stop')
  .description('Stops the Squid server')
  .action(() => {
    const ipcSocket = createSocket({ type: 'udp4', reuseAddr: true });
    ipcSocket.send('exit', IPC_PORT, 'localhost', (err) => {
      console.log(err ?? 'Stopped');
      process.exit();
    });
  });

program.parse();