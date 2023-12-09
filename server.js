const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
});

server.listen(3000, () => {
  console.log('server running at http://localhost:3000');
});

const playersLookingForGame = {}; // { socket.id: { name: 'player name'} }
//const lobbies = {}; // { hostSocketId: { hostName: 'host name', players: { id: name } }, socket: Socket, playerSockets: {id: socket} } }

const lobbies = {}; // { hostSocketId: { hostName: 'host name', players: { id: name }, hostSocket: Socket, playerSockets: {id: socket} } }
const lastSocketIds = {}; // { socketId: playerId }

io.on('connection', (socket) => {
    console.log('a user connected, socket id: ' + socket.id);
    socket.emit('updatePlayerList', playersLookingForGame);

    socket.on('disconnect', () => {
        console.log('user disconnected');
        
        if (lastSocketIds[socket.id]) {
            var playerId = lastSocketIds[socket.id];
            
            // Remove player from global player list (lobby list)
            delete lastSocketIds[socket.id];
            delete playersLookingForGame[playerId]; // Close lobby listing if player was host

            // Close lobby if player was host
            var lobby = lobbies[playerId];
            if (lobby){ 
                for (var otherPlayerId in lobby.players) {
                    var playerSocket = lobbies[playerId].playerSockets[otherPlayerId];
                    if (playerSocket) {
                        playerSocket.emit('lobbyClosed');
                    }
                    // lobbies[playerId].playerSockets[playerId].emit('lobbyClosed');
                }

                delete lobbies[playerId];
            }

            // Remove player from all lobbies
            for (var hostId in lobbies) {
                if (lobbies[hostId].players[playerId]) {
                    var playerName = lobbies[hostId].players[playerId].name;
                    delete lobbies[hostId].players[playerId];
                    delete lobbies[hostId].playerSockets[playerId];
                    lobbies[hostId].hostSocket.emit('playerLeftGame', playerId, playerName);
                }
            }
        }
    });

    // Host opens lobby
    socket.on('lookingForGame', (hostName, hostId, dungeonState) => {
        // Cache last socket id
        lastSocketIds[socket.id] = hostId;

        // Create lobby
        playersLookingForGame[hostId] = { name: hostName };
        lobbies[hostId] = { hostName: hostName, players: {}, hostSocket: socket, playerSockets: {} };

        // Add host to lobby player list
        lobbies[hostId].players[hostId] = { name: hostName };
        
        // Update global player list (lobby list)
        io.emit('updatePlayerList', playersLookingForGame);
    });

    // Host closes lobby
    socket.on('stopLookingForGame', (hostId) => {
        delete playersLookingForGame[hostId]; // Remove host from lobby list

        if (lobbies[hostId]) {
            var lobby = lobbies[hostId];

            for (var playerId in lobby.players) {
                var playerSocket = lobbies[hostId].playerSockets[playerId];

                if (playerSocket) {
                    playerSocket.emit('lobbyClosed');
                }
            }

            delete lobbies[hostId];
        }
        
        io.emit('updatePlayerList', playersLookingForGame);
    });

    // Player joins lobby
    socket.on('joinGame', (hostId, playerName, playerId, ack) => {
        // Cache last socket id
        lastSocketIds[socket.id] = playerId;

        // Add player to lobby
        lobbies[hostId].players[playerId] = { name: playerName };
        lobbies[hostId].playerSockets[playerId] = socket;
        
        // Ping host to let them know a player has joined
        var hostSocket = lobbies[hostId].hostSocket;
        if (hostSocket) {
            console.log("pinging host")
            hostSocket.emit('playerJoinedGame', playerName, playerId);

            // Acknowledge - let user know they have joined successfully
            ack({
                status: "ok",
                hostId: hostId,
                players: lobbies[hostId].players
            });

            // Send dungeon state to player
            hostSocket.emit('requestDungeonState', (dungeonState) => {
                if (dungeonState){
                    socket.emit('dungeonState', dungeonState);
                }
            });
        }else{
            // Host socket not found
            console.log('Host socket not found');
            ack({
                status: "not found"
            });
        }
    });

    // Player leaves lobby
    socket.on('leaveGame', (hostId, playerId) => {
        console.log("player left game " + playerId);
        console.log(lobbies[hostId].players[playerId]);
        console.log(lobbies[hostId]);

        var playerName = lobbies[hostId].players[playerId].name;

        // Remove player from lobby
        delete lobbies[hostId].players[playerId];
        delete lobbies[hostId].playerSockets[playerId];

        // Ping host to let them know a player has left
        var hostSocket = lobbies[hostId].hostSocket;
        if (hostSocket) {
            hostSocket.emit('playerLeftGame', playerId, playerName);
        }else{
            console.log('Host socket not found, user may not have been in a game');
        }
    });

    socket.on('sendPlayerAction', (hostId, playerId, actionData) => {
        console.log("player action " + playerId);

        // Add action to queue
        lobby = lobbies[hostId];
        if(lobby){
            playerSockets = lobby.playerSockets;
            for (var id in playerSockets) {
                if (id == playerId) {
                    continue;
                }

                var playerSocket = lobbies[hostId].playerSockets[id];
                if (playerSocket) {
                    console.log("sending action to player " + id);
                    playerSocket.emit('playerAction', actionData);
                }else{
                    console.log("player socket not found");
                }
            }

            // Also send to host
            hostSocket = lobbies[hostId].hostSocket;
            if (hostSocket && hostSocket != socket) {
                hostSocket.emit('playerAction', actionData);
            }
        }
    });
});

