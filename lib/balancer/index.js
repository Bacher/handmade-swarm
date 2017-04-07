const express    = require('express');
const moment     = require('moment');
const { Server } = require('rpc-json');

const app = express();

const userRoutes = new Map();

const API_TIMEOUT = 2000;

app.get('/', (req, res) => {
    const userId = req.query['userId'];
    console.log(`${moment().format('HH:mm:ss')} Reveal new request. UserId: [${userId}]`);

    if (nodes.size === 0) {
        res.send('Nodes not found');
        return;
    }

    let userRoute = userRoutes.get(userId);
    let node;

    if (userRoute) {
        node = nodes.get(userRoute.nodeId);

        if (!node) {
            node = getFreeNode();
            node.usersCount++;
        }

    } else {
        userRoute = {
            userId,
            isProcess: false,
            queue:     [],
        };

        node = getFreeNode();
        node.usersCount++;

        userRoutes.set(userId, userRoute);
    }

    userRoute.nodeId = node.nodeId;

    userRoute.queue.push({
        query: req.query,
        ts:    Date.now(),
        res,
    });

    if (!userRoute.isProcess) {
        processNextRequest(userRoute);
    }
});

function getFreeNode() {
    const nodesList = Array.from(nodes.values());

    if (nodesList.length >= 2) {
        return nodesList.sort((a, b) => a.usersCount - b.usersCount)[Math.random() < 0.2 ? 1 : 0];
    } else {
        return nodesList[0];
    }
}

function processNextRequest(userRoute) {
    if (userRoutes.isProcess) {
        throw new Error('Already in process');
    }

    if (userRoute.queue.length) {
        const request = userRoute.queue.shift();

        userRoute.isProcess = true;

        const node = nodes.get(userRoute.nodeId);

        let timeouted = false;
        const timeoutId = setTimeout(() => {
            timeouted = true;

            userRoute.isProcess = false;
            const forwardLimit = request.ts + API_TIMEOUT/2;

            request.res.status(500);
            request.res.send('Timeout');

            let ended = 0;
            for (let item of userRoute.queue) {
                if (item.ts > forwardLimit) {
                    break;
                }

                item.res.status(500);
                item.res.send('Timeout row');
                ended++;
            }

            userRoute.queue = userRoute.queue.slice(ended);

            processNextRequest(userRoute);
        }, API_TIMEOUT);

        node.conn.request('callApi', {}).then(response => {
            if (timeouted) {
                return;
            }
            clearTimeout(timeoutId);

            userRoute.isProcess = false;
            request.res.send(`RESPONSE: ${response}`);
            processNextRequest(userRoute);
        }, err => {
            if (timeouted) {
                return;
            }
            clearTimeout(timeoutId);

            userRoute.isProcess = false;
            request.res.status(500);
            request.res.send(`Error: ${err}`);
            processNextRequest(userRoute);
        });
    }
}

app.listen(9000, () => {
    console.log('Server started.');
});


const nodes = new Map();

const server = new Server({
    redirectErrors: true,
});

server.on('connection', connection => {
    let registered = false;
    let nodeId     = null;
    let nodeHash   = null;

    connection
        .on('error', err => {
            console.warn('Connection error:', err);
        })
        .on('close', () => {
            if (registered) {
                const currentNode = nodes.get(nodeId);

                if (currentNode && currentNode.nodeHash === nodeHash) {
                    nodes.delete(nodeId);
                }
            }
            console.warn('Connection closed');
        });

    connection.setRequestHandler((apiName, data) => {
        switch(apiName) {
            case 'RegisterNode':
                console.log('RegisterNode:', data.nodeId);

                nodeId   = data.nodeId;
                nodeHash = data.nodeHash;

                const alreadyNode = nodes.get(nodeId);

                if (alreadyNode) {
                    alreadyNode.conn.request('shutdown');

                    console.log(`Replacing node with id ${data.nodeId}`);
                }

                nodes.set(nodeId, {
                    nodeId:     nodeId,
                    nodeHash:   nodeHash,
                    conn:       connection,
                    usersCount: 0,
                });

                registered = true;

                break;
            default:
                throw new Error('BAD_API');
        }
    });
});

server.listen(10000, err => {
    if (err) {
        console.error('JSON-Server listen failed:', err);
        process.exit(1);
    }

    console.warn('JSON-Server started.');
});
