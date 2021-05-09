const { Server } = require('socket.io');
const express = require('express');
const app = express();

// global variables
const port = process.env.PORT || 9999;
const games = {};
const players = {};
const gamesId = {};

// convert moves arrays into object for better sending to client
const arraysToObjects = (obj) => {
    let objCopy = { ...obj };
    for(let aK in objCopy) {
        let a = { ...objCopy[aK] };
        for(var bK in a) {
            var b = { ...a[bK] };

            var obj2 = {};
            for(var cK in b) obj2[cK] = b[cK];
            a[bK] = obj2;
        }
        objCopy[aK] = a;
    }

    return objCopy;
}

// express js 
app.use(express.json()) // for parsing application/json
app.use(express.urlencoded({ extended: true })) // for parsing application/x-www-form-urlencoded
app.use(express.static('public'));

// running server
const server = app.listen(port, () => console.log('runing on', port));
const io = new Server(server);

// on joingame post
app.post('/joingame', (req, res) => {
    let gameName = req.body.name;
        if(!gameName || (games[gamesId[gameName]] && games[gamesId[gameName]].started)) {
            res.status(400).send('Invalid game name');
            return;
        }

        res.status(200).send({success: 'joined!'});
        
        io.sockets.once('connection', (clientSocket) => {
            try {
                let clientId = clientSocket.id;
                
                // if game already exists
                if(gamesId[gameName]) {
                    let game = games[gamesId[gameName]];
                    players[clientId] = {game: game, socket: clientSocket};

                    game.player2 = clientId;
                    game.started = true;

                    // start game
                    let sockets = game.sockets;
                    sockets[0].emit('startgame', 'white');
                    sockets[1].emit('startgame', 'black');

                    sockets[0].emit('move', game.board.posibleMoves);

                    console.log('game started:', gameName, '| players:', sockets[0].id, '&' ,sockets[1].id);

                // if room doesn't exist
                } else {
                    // function to create unique room ID
                    const createUniqueId = (idsList) => {
                        let id;

                        do id = Math.round(Math.random() * (36**4)).toString(36);
                        while(idsList.includes(id));

                        return id;
                    }

                    // function to create default checkers grid
                    const createDefaultGrid = () => {
                        let grid = [];
                        
                        for(let c = 0o00; c < 0o100; c++) {
                            let id = c.toString(8);
                            id = id.length === 1 ? '0'+id:id;

                            if(!grid[+id[0]]) grid[+id[0]] = [];

                            if(c < 0o30 && ((+id[0])+(+id[1])) % 2) grid[+id[0]][+id[1]] = 2;
                            else if(c >= 0o50 && ((+id[0])+(+id[1])) % 2) grid[+id[0]][+id[1]] = 1;
                            else grid[+id[0]][+id[1]] = 0;
                        }

                        return grid;
                    }

                    // set up new game room
                    let gameId = createUniqueId(Object.keys(games));
                    games[gameId] = {};
                    gamesId[gameName] = gameId;
                    let game = games[gameId];
                    players[clientId] = {game: game, socket: clientSocket};

                    console.log('game created: ' + gameName);

                    game.name = gameName;
                    game.id = gameId;
                    game.player1 = clientSocket.id;
                    game.player2 = null;
                    game.started = false;
                    game.board = {
                        grid: createDefaultGrid(),
                        move: 0
                    }

                    // end game
                    game.end = (winner) => {
                        for(let s of players[clientId].game.sockets) s.emit('gameover', winner);
                        let game = players[clientId].game;
                        let player1 = game.player1, player2 = game.player2;
                        delete gamesId[game.name];
                        delete games[game.id];
                        delete players[player1];
                        delete players[player2];
                    }

                    Object.defineProperty(game, 'sockets', {
                        get: function() {
                            let sockets = [];
                            if(players[this.player1]) sockets.push(players[this.player1].socket);
                            if(players[this.player2]) sockets.push(players[this.player2].socket);

                            return sockets;
                        }, 
                        enumerable: true,
                        configurable: false
                    });

                    game.board.posibleMoves = nextMove(game.board.grid, game.board.move);
                }

                const game = players[clientId].game;
                const board = game.board;

                // on disconnect event end game
                clientSocket.on('disconnect', () => {
                    if(players[clientId] && game) {
                        let winner = players[clientId].game.player1 !== clientId ? 1:2
                        game.end(winner);
                    }
                });

                // when client calling place event
                clientSocket.on('place', (oldPos, newPos) => {
                    let col = game.player1 === clientId ? 0:1;

                    // if event can be called 
                    if(board.move % 2 !== col) return;

                    let ePos = board.posibleMoves[oldPos.join('')];

                    // check if client sent true checker to change position 
                    if(ePos) {
                        // go through all posible positions for checker
                        for(var c in ePos) {
                            var cell = ePos[c];

                            // check if client sent true position
                            if(cell[0] === newPos[0] && cell[1] === newPos[1]) {
                                newPos = cell;
                                var tempC = board.grid[oldPos[0]][oldPos[1]];
                                board.grid[oldPos[0]][oldPos[1]] = 0;
                                board.grid[newPos[0]][newPos[1]] = tempC;

                                const enemySocket = players[(col ? game.player1:game.player2)].socket;
                                enemySocket.emit('changepos', oldPos, newPos);  // send new id

                                // set up king
                                var reborn = false;
                                if(tempC !== 3 || tempC !== 4) {
                                    if(newPos[0] === 0 && board.grid[newPos[0]][newPos[1]] === 1) {
                                        board.grid[newPos[0]][newPos[1]] = 3;
                                        for(var s of game.sockets) s.emit('levelup', newPos);  // send information about new king
                                        reborn = true;
                                    } else if(newPos[0] === 7 && board.grid[newPos[0]][newPos[1]] === 2) {
                                        board.grid[newPos[0]][newPos[1]] = 4;
                                        for(var s of game.sockets) s.emit('levelup', newPos);  // send information about new king
                                        reborn = true;
                                    }
                                }

                                // if checker can't hit
                                if(!cell.hit) {
                                    board.move++;
                                    board.posibleMoves = nextMove(board.grid, board.move);

                                // if checker can hit
                                } else {
                                    // delete checker
                                    for(var s of players[clientId].game.sockets) s.emit('hit', newPos.hit);
                                    board.grid[newPos.hit[0]][newPos.hit[1]] = 0;
                                    board.posibleMoves = nextMove(board.grid, board.move, newPos.join(''), board);
                                    var m = Object.keys(board.posibleMoves);
                    
                                    // if can't hit anymore
                                    var compT = board.startHittingPos[0] === newPos[0] && board.startHittingPos[1] === newPos[1];
                                    if(!reborn && (!m.length || !board.posibleMoves[m[0]][0].hit || compT)) {
                                        board.move++;
                                        board.posibleMoves = nextMove(board.grid, board.move);
                                    }
                                }

                                // end game
                                if(!Object.keys(board.posibleMoves).length) {
                                    let winner = board.move % 2 ? 2:1;
                                    game.end(winner);
                                    return;
                                }

                                const nextPLayer = players[(board.move % 2 ? game.player2:game.player1)].socket;
                                nextPLayer.emit('move', arraysToObjects(board.posibleMoves));
                            }
                        }
                    }
                });
        // catch errors from client
        } catch (err){
            console.error(err.message);
        }
    });
});

// calculate posible moves 
const nextMove = (grid, move, isHitting=false, startHit = false) => {
    let moving = move % 2 ? 0:1;
    let direction = moving ? [2,3]:[0,1];
    let posibleMoves = {};
    let canHit = false;

    for(var y in grid) {
        let cY = grid[y];

        for(var x in cY) {
            let cX = cY[x];
            x = +x, y = +y;

            // if checker is in hitting row
            let hitPos = [y, x].join('');
            if(!startHit.startHittingPos) startHit.startHittingPos = hitPos;
            if(isHitting && isHitting !== hitPos) continue;
            else startHit.startHittingPos = false;

            if(cX && cX % 2 === moving) {
                let posibleMoves2 = [];

                // simple behaviour
                if(cX === 1 || cX === 2) {
                    // get posible moves for checker
                    posibleMoves2.push([ y - 1, x - 1 ]);  // top right
                    posibleMoves2.push([ y - 1, x + 1 ]);  // top left
                    posibleMoves2.push([ y + 1, x - 1 ]);  // bottom right
                    posibleMoves2.push([ y + 1, x + 1 ]);  // bottom left

                    // get valid moves
                    for(let m = 0; m < 4; m++) {
                        let move = posibleMoves2[m];
                        
                        // simple check for valid moves
                        let tooFar = (move[0] >= 0 && move[0] < 8) && (move[1] >= 0 && move[1] < 8);
                        if(!move.length || !tooFar || (grid[move[0]][move[1]] && (grid[move[0]][move[1]] % 2) === moving)) {
                            delete posibleMoves2[m];
                            continue;
                        }

                        // if can hit 
                        let c = moving ? 1:2;
                        const enemyCheck = (pos) => pos && pos % 2 !== c;
                        if(enemyCheck(grid[move[0]][move[1]])) {
                            // parse to bits
                            let p = m.toString(2);
                            p = p.length === 1 ? '0'+p:p;
                            p = p.split('').map(v => +v ? 1:-1);

                            // if after enemy checker is free space
                            let move2 = [move[0] + p[0], move[1] + p[1]];
                            let tooFar2 = (move2[0] >= 0 && move2[0] < 8) && (move2[1] >= 0 && move2[1] < 8);
                            if(tooFar2 && !grid[move2[0]][move2[1]]) {
                                posibleMoves2[m] = move2;
                                posibleMoves2[m].hit = move;
                                canHit = true;
                            } else delete posibleMoves2[m];
                        } else if(direction.includes(m)) {
                            delete posibleMoves2[m];
                        }
                    }


                // kings behaviour
                } else if(cX === 3 || cX === 4) {
                    // get moves
                    for(let d = 0; d < 4; d++) {
                        // parse to bits
                        let p = d.toString(2);
                        p = p.length === 1 ? '0'+p:p;
                        p = p.split('').map(v => +v ? 1:-1);

                        // find out distance from wall
                        let tY = p[0] === -1 ? y:7-y;
                        let tX = p[1] === -1 ? x:7-x;
                        let l = Math.min(tY, tX);

                        let hit = false;
                        for(let m = 1; m <= l; m++) {
                            // next position
                            var ttY = p[0]*m + y;
                            var ttX = p[1]*m + x;

                            let move = [ttY, ttX];
                            if(hit) move.hit = hit;

                            // if checker placed on that position
                            if(grid[ttY][ttX]) {
                                let ttYC = ttY + p[0], ttXC = ttX + p[1];
                                // if checker is enemy and if after it nothing is placed and if it is first hit 
                                if((grid[ttY][ttX] % 2) === moving || hit || ((ttYC < 0 || ttYC > 7) || (ttXC < 0 ||  ttXC > 7)) || (grid[ttYC][ttXC])) break;

                                canHit = true;
                                hit = [ttY, ttX];
                                continue;
                            }

                            posibleMoves2.push(move);
                        }
                    }
                }

                posibleMoves2 = posibleMoves2.filter(v => !!v);
                if(posibleMoves2.length) posibleMoves[[y,x].join('')] = posibleMoves2;
            }
        }
    }

    // if is not hitting anything
    if(!canHit) return posibleMoves;

    // if is hitting filter only hit moves
    for(let c in posibleMoves) {
        posibleMoves[c] = posibleMoves[c].filter(v => !!v.hit);
        if(!posibleMoves[c].length) delete posibleMoves[c];
    }

    return posibleMoves;
}