const f = require('session-file-store');
const { v4: uuidv4 } = require('uuid');
const { MongoClient, ObjectId } = require('mongodb');

module.exports = function (server) {
    const io = require('socket.io')(server, {
        transports: ['websocket']
    });

    // DB 연결
    let database = null;
    async function connectDB() {
        try {
            const client = new MongoClient('mongodb://localhost:27017');
            await client.connect();
            database = client.db('omok-20');
            console.log('게임 서버 DB 연결 성공');
        } catch (error) {
            console.error('게임 서버 DB 연결 실패:', error);
        }
    }

    // 서버 시작 시 DB 연결
    connectDB();

    // 방 정보
    var matchQueue = new Map();     // grade -> [{ socketId, userId, grade, username, nickname, waitTime }]
    var userSessions = new Map();   // socketId -> { userId, grade, username, nickname }
    var socketRooms = new Map();    // 게임 진행방

    function findOpponentExpanded(myGrade, maxDiff) {
        for (let diff = 1; diff <= maxDiff; diff++) {
            // 더 높은 등급
            let queue = matchQueue.get(myGrade - diff);
            if (queue && queue.length > 0) {
                return queue.shift();
            }

            // 더 낮은 등급
            queue = matchQueue.get(myGrade + diff);
            if (queue && queue.length > 0) {
                return queue.shift();
            }
        }
        return null;
    }

    function createGameRoom(socket1, player2Info) {
        const roomId = uuidv4();
        const socket2 = io.sockets.sockets.get(player2Info.socketId);

        if (!socket1 || !socket2) {
            console.error('소켓이 존재하지 않습니다.');
            return;
        }

        // 방 입장
        socket1.join(roomId);
        socket2.join(roomId);

        // 방 정보 저장
        socketRooms.set(socket1.id, roomId);
        socketRooms.set(socket2.id, roomId);

        // 플레이어 1 정보
        const player1 = userSessions.get(socket1.id);
        // 플레이어 2 정보
        const player2 = userSessions.get(socket2.id);

        // 매칭 성공 알림
        socket1.emit('matchFound', {
            roomId,
            userId: player2.userId,
            username: player2.username,
            nickname: player2.nickname,
            grade: player2.grade
        });


        socket2.emit('matchFound', {
            roomId,
            userId: player1.userId,
            username: player1.username,
            nickname: player1.nickname,
            grade: player1.grade
        });

        console.log(`매칭 성공: ${player1.username} vs ${player2.username} (방: ${roomId})`);
    }

    // 30초마다 매칭 범위 확장
    setInterval(() => {
        matchQueue.forEach((queue, grade) => {
            for (let i = queue.length - 1; i >= 0; i--) {
                const player = queue[i];
                const waitTime = Date.now() - player.waitTime;

                // 30초 이상 대기 시 범위 확장
                if (waitTime > 30000) {
                    const socket1 = io.sockets.sockets.get(player.socketId);
                    if (socket1 && !player.expandedNotified) {
                        socket1.emit('matchExpanded', { message: '매칭 범위가 확장되었습니다.' });
                        player.expandedNotified = true; // 한 번만 알림
                    }

                    const opponent = findOpponentExpanded(grade, 5);
                    if (opponent) {
                        queue.splice(i, 1); // 대기열에서 제거

                        const socket1 = io.sockets.sockets.get(player.socketId);
                        const socket2 = io.sockets.sockets.get(opponent.socketId);

                        if (socket1 && socket2) {
                            createGameRoom(socket1, opponent);
                        }
                    }
                    else if (waitTime > 60000) { // 1분 이상 대기 시 매칭 실패 처리
                        if (socket1) {
                            socket1.emit('matchFailed', { message: '매칭 가능한 상대가 없습니다.' });
                        }
                        queue.splice(i, 1); // 대기열에서 제거
                    }
                }
            }
        });
    }, 5000); // 5초마다 체크

    io.on('connection', async (socket) => {
        // 서버 구현
        console.log('사용자 접속됨 : ', socket.id);

        // 인증 이벤트 대기
        socket.on('authenticate', async (username) => {
            console.log('인증 요청:', username);

            try {
                // DB에서 사용자 정보 조회
                if (database) {
                    console.log('DB 연결됨, 사용자 조회 중...');
                    const users = database.collection('users');
                    const user = await users.findOne({ username: username });

                    if (user) {
                        // 사용자 정보 저장
                        const userInfo = {
                            userId: user._id.toString(),
                            username: user.username,
                            nickname: user.nickname,
                            grade: user.grade || 18,
                        };

                        userSessions.set(socket.id, userInfo);
                        socket.emit('userInfoLoaded', userInfo);
                        console.log(`사용자 인증 성공: ${user.username}`);
                    } else {
                        console.log('사용자를 찾을 수 없음:', username);
                        socket.emit('authFailed', { message: '사용자를 찾을 수 없습니다.' });
                    }
                } else {
                    console.log('DB가 연결되지 않았습니다.');
                    socket.emit('authFailed', { message: 'DB 연결 오류' });
                }
            } catch (error) {
                console.error('인증 실패:', error);
                socket.emit('authFailed', { message: '인증에 실패했습니다.' });
            }
        });

        // 매칭 요청
        socket.on('requestMatch', function () {
            const user = userSessions.get(socket.id);

            if (!user) {
                console.error('사용자 정보 없음:', socket.id);
                socket.emit('matchError', { message: '사용자 정보가 없습니다.' });
                return;
            }

            console.log(`매칭 요청: ${user.username} (등급: ${user.grade})`);

            // 비슷한 등급 상대 찾기
            const opponent = findOpponent(user.grade);

            if (opponent) {
                // 상대방 찾음 -> 즉시 매칭
                console.log(`즉시 매칭: ${user.username} vs ${opponent.username}`);
                createGameRoom(socket, opponent);
            } else {
                // 대기열에 추가
                console.log(`대기열 추가: ${user.username}`);
                addToQueue(socket.id, user);
                socket.emit('matchWaiting', { message: '상대방을 찾는 중...' });
            }
        });

        function findOpponent(myGrade) {
            // 같은 등급 먼저 찾기
            let queue = matchQueue.get(myGrade);
            if (queue && queue.length > 0) {
                return queue.shift(); // 가장 오래 기다린 사람
            }

            // 비슷한 등급 찾기 (±2등급)
            for (let diff = 1; diff <= 2; diff++) {
                // 더 높은 등급
                queue = matchQueue.get(myGrade - diff);
                if (queue && queue.length > 0) {
                    return queue.shift();
                }

                // 더 낮은 등급
                queue = matchQueue.get(myGrade + diff);
                if (queue && queue.length > 0) {
                    return queue.shift();
                }
            }

            return null; // 상대방 없음
        }

        function addToQueue(socketId, user) {
            if (!matchQueue.has(user.grade)) {
                matchQueue.set(user.grade, []);
            }

            matchQueue.get(user.grade).push({
                socketId,
                userId: user.userId,
                grade: user.grade,
                username: user.username,
                nickname: user.nickname,
                waitTime: Date.now(),
                expandedNotified: false
            });
        }

        socket.on('cancelMatch', function () {
            const user = userSessions.get(socket.id);
            if (!user) return;

            // 대기열에서 제거
            const queue = matchQueue.get(user.grade);
            if (queue) {
                const index = queue.findIndex(p => p.socketId === socket.id);
                if (index !== -1) {
                    queue.splice(index, 1);
                    socket.emit('matchCanceled', { message: '매칭이 취소되었습니다.' });
                }
            }
        });

        socket.on('leaveRoom', function () {
            var roomId = socketRooms.get(socket.id);
            socket.leave(roomId);
            socket.emit('exitRoom', { roomId: roomId });
            socket.to(roomId).emit('opponentLeft', { roomId: roomId });
            socketRooms.delete(socket.id);
        });

        socket.on('doPlayer', function (playerInfo) {
            var roomId = socketRooms.get(socket.id);
            var blockIdx_x = playerInfo.blockIdx_x;
            var blockIdx_y = playerInfo.blockIdx_y;

            console.log(`방 ${roomId}에서 플레이어 ${socket.id}가 ${blockIdx_x}, ${blockIdx_y} 위치에 돌을 놓음`);
            socket.to(roomId).emit('doOpponent', {
                blockIdx_x: blockIdx_x,
                blockIdx_y: blockIdx_y
            });
        });

        socket.on('disconnect', function () {
            console.log('사용자 접속 해제 : ', socket.id);
            // 대기열에서 제거
            const user = userSessions.get(socket.id);
            if (user) {
                const queue = matchQueue.get(user.grade);
                if (queue) {
                    const index = queue.findIndex(p => p.socketId === socket.id);
                    if (index !== -1) {
                        queue.splice(index, 1);
                        console.log(`연결 해제로 대기열에서 제거: ${user.username}`);
                    }
                }
            }

            // 방에서 나가기
            var roomId = socketRooms.get(socket.id);
            if (roomId) {
                socket.to(roomId).emit('opponentLeft', { roomId: roomId });
            }

            // 세션 정리
            userSessions.delete(socket.id);
            socketRooms.delete(socket.id);
        });
    });
};