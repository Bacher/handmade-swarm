const childProcess = require('child_process');
const Path = require('path');
const _ = require('lodash');
const colors = require('colors');

const nodes = [];

const NODES_COUNT = 6;
const TRY_COUNT = 10;

const online = new Set();
const reloadOnline = new Set();
const failed = new Set();

let curLoadId = 1;
let inReloadMode = false;
let currentReloadId = null;

let waitReload = new Set();
let reloadFails = new Map();

for (let i = 1; i <= NODES_COUNT; i++) {
    startChild(curLoadId, i);
}

function log(...args) {
    let status = '';

    for (let i = 1; i <= NODES_COUNT; i++) {
        let symbol;

        if (inReloadMode) {
            if (currentReloadId === null || i < currentReloadId) {
                symbol = '+'.black;
            } else if (i === currentReloadId) {
                symbol = '*'.black;
            } else {
                symbol = ' ';
            }

            symbol = (online.has(i) || reloadOnline.has(i)) ? symbol.bgGreen : symbol.bgRed;

        } else {
            symbol = online.has(i) ? ' '.bgGreen : failed.has(i) ? ' '.bgRed : ' ';
        }

        status += symbol;
    }

    console.log(`[${status}] `, ...args);
}

function startChild(loadId, i, reloading) {
    if (reloading) {
        waitReload.delete(i);

        setTimeout(() => {
            for (let node of nodes) {
                if (node.i === i && node.loadId !== curLoadId) {
                    log(`Force kill child: ${i}`);
                    node.child.kill('SIGKILL');
                }
            }
        }, 10000);
    }

    const child = childProcess.fork(Path.join(__dirname, '../node/index.js'), [`--nodeId=${i}`, `--revisionId=${loadId}`], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    failed.delete(i);
    online.add(i);

    if (reloading) {
        reloadOnline.add(i);
    }

    log(`Child starting: ${i}`.bgYellow.black);

    const nodeInfo = {
        ts:    Date.now(),
        loadId,
        i,
        child,
    };

    nodes.push(nodeInfo);

    child.on('exit', (code, signal) => {
        nodes.splice(nodes.indexOf(nodeInfo), 1);

        failed.add(i);
        online.delete(i);

        if (inReloadMode && loadId === curLoadId && currentReloadId !== i) {
            reloadOnline.delete(i);
        }

        const strCode = `(${code})`;
        log(`Child dying: ${i} code: ${code === 0 ? strCode.bgGreen.black : strCode.bgRed.white.bold} ${signal ? `signal: ${signal.bgRed.white.bold} ` : ''}ts: ${new Date(nodeInfo.ts)}`);

        if (inReloadMode) {
            if (currentReloadId === i && loadId !== curLoadId) {
                if (code === 0) {
                    log(`  \\ Graceful shutdown`);
                } else {
                    // Возможно тут неадо прекращать перезагрузку
                    log(`  \\ Node failed with error`);
                }

                setTimeout(() => {
                    checkReloadNext(i + 1);
                }, 1000);
                return;
            }

            if (currentReloadId === i && loadId === curLoadId) {
                const failedCount = reloadFails.get(i);

                log(`Current reloading node failed: ${i}`);

                if (failedCount < TRY_COUNT) {
                    waitReload.add(i);
                    reloadFails.set(i, failedCount + 1);

                    setTimeout(() => {
                        log(`Retry start node: ${i} try: ${failedCount + 1}/${TRY_COUNT}`);
                        checkReloadNext(i);
                    }, 2000);

                } else {
                    inReloadMode = false;
                    currentReloadId = null;

                    mergeOnline();

                    log(`[RELOAD] Reloading failed on node: ${i}`.bgRed.bold.white);
                }
                return;
            }
        }

        setTimeout(() => {
            log(`Restarting: ${i}`.bgMagenta.black);
            startChild(curLoadId, i);
        }, 2000);
    });

    // const SPACE = '                                        ';
    //
    // const ii = _.padStart(i, 2);
    //
    // child.stdio[1].on('data', data => {
    //     process.stdout.write(`${SPACE}${ii} [I]: ${data}`);
    // });
    //
    // child.stdio[2].on('data', data => {
    //     process.stdout.write(`${SPACE}${ii} [E]: ${data}`);
    // });
}

process.on('SIGUSR2', () => {
    if (inReloadMode) {
        log('Already in reload mode, sorry...');

    } else {
        log('Start refreshing nodes'.bgGreen.black);
        inReloadMode = true;
        curLoadId++;

        reloadOnline.clear();
        waitReload.clear();
        reloadFails.clear();

        for (let i = 1; i <= NODES_COUNT; i++) {
            waitReload.add(i);
            reloadFails.set(i, 0);
        }

        checkReloadNext(1);
    }
});

function checkReloadNext(i) {
    //log(`              checkReloadNext ${i}`.yellow);

    if (i <= NODES_COUNT) {
        if (waitReload.has(i)) {
            currentReloadId = i;
            startChild(curLoadId, i, true);

        } else {
            checkReloadNext(i + 1);
        }

    } else {
        mergeOnline();
        currentReloadId = null;
        log('[RELOAD] Reloading success ended'.bgGreen.black);
        inReloadMode = false;
    }
}

function mergeOnline() {
    for (let id of reloadOnline) {
        online.add(id);
    }

    reloadOnline.clear();
}
