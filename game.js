const f = require('session-file-store');
const { v4: uuidv4 } = require('uuid');

module.exports = function (server) {
    const io = require('socket.io')(server, {
        transports: ['websocket']
    });

    // 방 정보
    var rooms = []; // 게임 대기방
    var socketRooms = new Map();    // 게임 진행방

    io.on('connection', (socket) => {
        // 서버 구현
        console.log('사용자 접속됨 : ', socket.id);

        // 특정 소켓이 방에 접속했을 때
        // 대기방에 방이 없으면 새로 만들고, 있으면 입장
        if (rooms.length > 0) {
            // 대기방이 있을 때
            var roomId = rooms.shift();
            socket.join(roomId);
            socket.emit('joinRoom', { roomId: roomId });
            socket.to(roomId).emit('opponentJoined', { roomId: roomId });
            socketRooms.set(socket.id, roomId);
        }
        else {
            // 대기방이 없을 때
            var roomId = uuidv4();
            socket.join(roomId);
            socket.emit('createRoom', { roomId: roomId });
            rooms.push(roomId);
            socketRooms.set(socket.id, roomId);
        }

        socket.on('leaveRoom', function (data) {
            var roomId = data.roomId;
            socket.leave(roomId);
            socket.emit('leaveRoom', { roomId: roomId });
            socket.to(roomId).emit('opponentLeft', { roomId: roomId });

            // 혼자있던 방이면 삭제
            const roomIdx = rooms.indexOf(roomId);
            if (roomIdx !== -1) {
                rooms.splice(roomIdx, 1);
                console.log('대기방 삭제됨 : ', roomId);
            }

            // 나간 방의 소켓 정보 삭제
            socketRooms.delete(socket.id);
        });

        socket.on('doPlayer', function (playerInfo) {
            var roomId = socketRooms.get(socket.id);
            var blockIdx = playerInfo.blockIdx;

            console.log(`방 ${roomId}에서 플레이어 ${socket.id}가 ${blockIdx} 위치에 돌을 놓음`);
            socket.to(roomId).emit('doOpponent', { blockIdx: blockIdx });
        });

        socket.on('disconnect', function () {
            console.log('사용자 접속 해제 : ', socket.id);
            var roomId = socketRooms.get(socket.id);
            if (roomId) {
                socket.to(roomId).emit('opponentLeft', { roomId: roomId });
            }
        });
    });
};