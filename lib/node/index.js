const { Client } = require('rpc-json');

const args = process.argv.slice(2);

let nodeId;
let nodeHash = Math.random().toString(36).substr(2);

for (let arg of args) {
    const match = arg.match(/^--nodeId=(\d+)$/);

    if (match) {
        nodeId = Number(match[1]);
        break;
    }
}

if (!nodeId) {
    console.error('--nodeId not found');
    process.exit(1);
}

let closing             = false;
let currentRequests     = 0;
let fatalCloseTimeoutId = null;

const client = new Client({
    port:          10000,
    autoReconnect: true,
    useQueue:      true,
    requestHandler(apiName, data) {
        switch (apiName) {
            case 'callApi':
                console.log('Call api');
                currentRequests++;

                return new Promise(resolve => {
                    setTimeout(() => {
                        resolve(`ANSWER FROM NODE ${nodeId} #${nodeHash} RND:${Math.random()}`);

                        currentRequests--;

                        if (closing && currentRequests === 0) {
                            setTimeout(() => {
                                clearTimeout(fatalCloseTimeoutId);
                                client.close();
                            }, 100);
                        }
                    }, 500);
                });
            case 'shutdown':
                if (!closing) {
                    console.log('shutdown received');

                    if (currentRequests === 0) {
                        setTimeout(() => {
                            client.close();
                        }, 100);

                    } else {
                        closing = true;

                        fatalCloseTimeoutId = setTimeout(() => {
                            console.log('NOT GRACEFUL client.close() !!!');
                            client.close();
                        }, 5000).unref();
                    }
                }

                return 'SHUTDOWNING';

            default:
                throw new Error('BAD_API');
        }
    }
});

client.on('connect', () => {
    client.request('RegisterNode', { nodeId, nodeHash }).then(() => {
        console.log(`Node started, NodeId:${nodeId}, Hash:${nodeHash}`);
    }, err => {
        console.error('RegisterNode failed:', err);
        client.close();
    });
});

client.on('error', err => {
    console.error('Client connection error:', err);
});

//console.log('Loading...');

setTimeout(() => {
    //console.log('Loaded');

    client.connect();
}, 1000);

// setTimeout(() => {
//     console.error('Exit(1)');
//     process.exit(1);
// }, 8000 + Math.floor(Math.random() * 80000));

if (Math.random() < 0.3) {
    setTimeout(() => {
        process.exit(48);
    }, 200);
}

setInterval(() => {
    if (Math.random() < 0.02) {
        process.exit(50);
    }
}, 1000).unref();

// setInterval(() => {
//
// }, 99999);
